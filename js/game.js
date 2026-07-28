// Authoritative simulation. Runs only on the host; controllers send intent and
// receive HUD state. Everything here is deterministic per-frame given inputs,
// but we don't need lockstep determinism since there's exactly one simulator.

import {
  heroSheet, enemySprite, enemyFrames, prop, drawSprite, drawAt, drawGrounded,
  drawSword, PLAYER_COLORS,
} from './sprites.js';
import { W, H, BOUNDS, arenaCanvas, collide, blocked, edgeSpawn, PILLARS } from './arena.js';
import { ENEMY_TYPES, waveSpec } from './enemies.js';

const PLAYER_SPEED = 82;
const PLAYER_MAX_HP = 6; // two hit points per heart
const ATTACK_COOLDOWN = 0.42;
const ATTACK_ACTIVE = 0.26;
const ATTACK_RANGE = 25;
const ATTACK_ARC = 1.05; // radians either side of facing
const DASH_SPEED = 260;
const DASH_TIME = 0.2;
const DASH_COOLDOWN = 2.4;
const INVULN_TIME = 1.0;
const BLEEDOUT = 22;
const REVIVE_TIME = 2.4;
const REVIVE_RANGE = 24;
const INTERMISSION = 5;

const DIR_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

export class Game {
  constructor({ onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this.players = new Map(); // id -> player
    this.reset();
  }

  reset() {
    this.enemies = [];
    this.shots = [];
    this.pickups = [];
    this.particles = [];
    this.floaters = [];
    this.waves = [];
    this.wave = 0;
    this.score = 0;
    this.state = 'lobby'; // lobby | intermission | fighting | gameover
    this.stateT = 0;
    this.spawnQueue = [];
    this.spawnT = 0;
    this.spec = null;
    this.shakeAmt = 0;
    this.banner = null;
    this.time = 0;
    this.bestWave = this.bestWave || 0;
    for (const p of this.players.values()) this.resetPlayer(p);
  }

  // ------------------------------------------------------------- players

  freeSlot() {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
    return -1;
  }

  addPlayer(id, name) {
    const slot = this.freeSlot();
    if (slot < 0) return null;
    const p = {
      id,
      name: name.slice(0, 10).toUpperCase() || `P${slot + 1}`,
      slot,
      color: PLAYER_COLORS[slot],
      input: { ax: 0, ay: 0, attack: false, dash: false },
      connected: true,
      ...this.blankStats(),
    };
    this.placeAtSpawn(p);
    this.players.set(id, p);
    return p;
  }

  blankStats() {
    return {
      x: W / 2,
      y: H / 2,
      vx: 0,
      vy: 0,
      dir: 'down',
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      downed: false,
      bleed: 0,
      out: false,
      reviveProgress: 0,
      invuln: 0,
      atkT: 0,
      atkCool: 0,
      atkHits: null,
      dashT: 0,
      dashCool: 0,
      anim: 0,
      moving: false,
      score: 0,
      kills: 0,
      combo: 0,
      comboT: 0,
      flash: 0,
    };
  }

  resetPlayer(p) {
    Object.assign(p, this.blankStats());
    this.placeAtSpawn(p);
  }

  placeAtSpawn(p) {
    const n = Math.max(1, this.players.size);
    const i = p.slot;
    const ang = (i / Math.max(n, 4)) * Math.PI * 2;
    p.x = W / 2 + Math.cos(ang) * 34;
    p.y = H / 2 + Math.sin(ang) * 26;
    collide(p, 7);
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    p.input.ax = Math.max(-1, Math.min(1, input.ax || 0));
    p.input.ay = Math.max(-1, Math.min(1, input.ay || 0));
    p.input.attack = !!input.attack;
    p.input.dash = !!input.dash;
  }

  activePlayers() {
    return [...this.players.values()];
  }

  livePlayers() {
    return this.activePlayers().filter((p) => !p.downed && p.connected !== false);
  }

  // --------------------------------------------------------------- waves

  start() {
    this.reset();
    if (this.players.size === 0) return false;
    for (const p of this.players.values()) this.resetPlayer(p);
    this.state = 'intermission';
    this.stateT = 2.2;
    this.wave = 0;
    this.banner = { text: 'GET READY', sub: 'Survive the onslaught', t: 2.2 };
    return true;
  }

  beginWave(n) {
    this.wave = n;
    this.spec = waveSpec(n);
    this.spawnQueue = [];
    for (const { type, count } of this.spec.list) {
      for (let i = 0; i < count; i++) this.spawnQueue.push(type);
    }
    // Interleave types so a wave doesn't arrive sorted by archetype.
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [this.spawnQueue[i], this.spawnQueue[j]] = [this.spawnQueue[j], this.spawnQueue[i]];
    }
    this.spawnT = 0;
    this.state = 'fighting';
    this.banner = {
      text: `WAVE ${n}`,
      sub: this.spec.isBoss ? 'AN ARMOS KNIGHT AWAKENS' : `${this.spawnQueue.length} hostiles`,
      t: 2.4,
    };
    this.bestWave = Math.max(this.bestWave, n);
    this.onEvent({ t: 'wave', wave: n, boss: this.spec.isBoss });
  }

  spawnEnemy(type, at = null) {
    const def = ENEMY_TYPES[type];
    if (!def) return;
    const spot = at || edgeSpawn(Math.random, this.activePlayers());
    const hp = Math.round(def.hp * (this.spec ? this.spec.hpMul : 1));
    const e = {
      type,
      def,
      x: spot.x,
      y: spot.y,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      radius: def.radius,
      mode: type === 'mage' ? 'appear' : 'chase',
      timer: 0.4 + Math.random() * 0.6,
      phase: Math.random() * 6,
      flash: 0,
      kx: 0,
      ky: 0,
      alpha: 1,
      bob: Math.random() * 6,
      face: 'd',
      spawnT: 0.45, // brief materialise window; harmless while it fades in
      willFire: false,
    };
    this.enemies.push(e);
    for (let i = 0; i < 8; i++) this.puff(e.x, e.y, '#e8e4d8');
  }

  // --------------------------------------------------------- enemy hooks

  enemyCtx() {
    if (this._ctx) return this._ctx;
    this._ctx = {
      rand: Math.random,
      get wave() {
        return this.game.wave;
      },
      game: this,
      nearestPlayer: (e) => this.nearestPlayer(e.x, e.y),
      randomSpot: () => ({
        x: BOUNDS.x0 + 16 + Math.random() * (BOUNDS.x1 - BOUNDS.x0 - 32),
        y: BOUNDS.y0 + 16 + Math.random() * (BOUNDS.y1 - BOUNDS.y0 - 32),
      }),
      enemyShot: (e, tx, ty, kind, speed, dmg) => {
        const ang = Math.atan2(ty - e.y, tx - e.x);
        this._ctx.enemyShotAngle(e, ang, kind, speed, dmg);
      },
      enemyShotAngle: (e, ang, kind, speed, dmg) => {
        this.shots.push({
          x: e.x,
          y: e.y,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          kind,
          dmg,
          life: 4,
          radius: 4,
        });
      },
      shake: (n) => {
        this.shakeAmt = Math.max(this.shakeAmt, n);
      },
      shockwave: (x, y, radius, dmg) => {
        this.particles.push({ kind: 'wave', x, y, r: 6, max: radius, life: 0.45, t: 0.45 });
        for (const p of this.livePlayers()) {
          if (Math.hypot(p.x - x, p.y - y) < radius) this.hurtPlayer(p, dmg, x, y);
        }
      },
      spawnAdd: (type) => this.spawnEnemy(type),
    };
    return this._ctx;
  }

  nearestPlayer(x, y) {
    let best = null;
    let bd = Infinity;
    for (const p of this.players.values()) {
      if (p.downed || p.connected === false) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  // -------------------------------------------------------------- update

  update(dt) {
    this.time += dt;
    dt = Math.min(dt, 0.05); // clamp so an alt-tab doesn't teleport everything
    if (this.shakeAmt > 0) this.shakeAmt = Math.max(0, this.shakeAmt - dt * 24);
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }

    this.updateParticles(dt);

    if (this.state === 'lobby' || this.state === 'gameover') return;

    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updatePickups(dt);
    this.checkTeamState(dt);

    if (this.state === 'intermission') {
      this.stateT -= dt;
      if (this.stateT <= 0) this.beginWave(this.wave + 1);
    } else if (this.state === 'fighting') {
      // Trickle the wave in rather than dumping it all at once.
      this.spawnT -= dt;
      if (this.spawnQueue.length && this.spawnT <= 0 && this.enemies.length < this.spec.concurrent) {
        this.spawnEnemy(this.spawnQueue.shift());
        this.spawnT = this.spec.spawnInterval;
      }
      if (!this.spawnQueue.length && !this.enemies.length) this.endWave();
    }
  }

  endWave() {
    this.state = 'intermission';
    this.stateT = INTERMISSION;
    const bonus = 50 * this.wave;
    this.score += bonus;
    for (const p of this.players.values()) {
      if (!p.downed) continue;
      p.downed = false;
      p.out = false;
      p.hp = 2;
      p.invuln = 2;
      p.reviveProgress = 0;
      this.floater(p.x, p.y - 14, 'BACK UP', '#7dfc9a');
      this.onEvent({ t: 'revived', id: p.id });
    }
    this.banner = { text: `WAVE ${this.wave} CLEARED`, sub: `+${bonus} bonus`, t: 2.6 };
    // Guarantee some sustain between waves, scaled to party size.
    const hearts = Math.max(1, Math.ceil(this.players.size / 2));
    for (let i = 0; i < hearts; i++) {
      this.pickups.push({
        kind: 'heart',
        x: BOUNDS.x0 + 24 + Math.random() * (BOUNDS.x1 - BOUNDS.x0 - 48),
        y: BOUNDS.y0 + 24 + Math.random() * (BOUNDS.y1 - BOUNDS.y0 - 48),
        life: 30,
        bob: Math.random() * 6,
      });
    }
    this.onEvent({ t: 'waveclear', wave: this.wave, bonus });
  }

  updatePlayer(p, dt) {
    p.flash = Math.max(0, p.flash - dt);
    if (p.comboT > 0) {
      p.comboT -= dt;
      if (p.comboT <= 0) p.combo = 0;
    }

    if (p.downed) {
      p.vx = p.vy = 0;
      p.bleed -= dt;
      // Once the bleedout clock runs out a teammate can no longer help; they
      // sit out the rest of the wave and come back when it's cleared. Nobody
      // gets benched for the whole run — that's a miserable party game.
      if (p.out) {
        p.reviveProgress = 0;
        return;
      }
      // Any nearby standing teammate contributes to the revive.
      const helpers = this.livePlayers().filter((o) => Math.hypot(o.x - p.x, o.y - p.y) < REVIVE_RANGE);
      if (helpers.length) {
        p.reviveProgress += dt * helpers.length;
        if (p.reviveProgress >= REVIVE_TIME) {
          p.downed = false;
          p.out = false;
          p.hp = 2;
          p.invuln = 1.6;
          p.reviveProgress = 0;
          this.floater(p.x, p.y - 14, 'REVIVED', '#7dfc9a');
          for (let i = 0; i < 14; i++) this.puff(p.x, p.y, '#7dfc9a');
          this.onEvent({ t: 'revived', id: p.id });
        }
      } else {
        p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.5);
      }
      return;
    }

    p.invuln = Math.max(0, p.invuln - dt);
    p.atkCool = Math.max(0, p.atkCool - dt);
    p.dashCool = Math.max(0, p.dashCool - dt);

    const inp = p.input;
    let ax = inp.ax;
    let ay = inp.ay;
    const mag = Math.hypot(ax, ay);
    if (mag > 1) {
      ax /= mag;
      ay /= mag;
    }
    p.moving = mag > 0.15;

    // Facing only changes while not mid-swing, so attacks commit to a direction.
    if (p.moving && p.atkT <= 0) {
      p.dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : ay > 0 ? 'down' : 'up';
    }

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.invuln = Math.max(p.invuln, 0.05);
    } else if (inp.dash && p.dashCool <= 0 && (p.moving || true)) {
      p.dashT = DASH_TIME;
      p.dashCool = DASH_COOLDOWN;
      const a = p.moving ? Math.atan2(ay, ax) : DIR_ANGLE[p.dir];
      p.dashVX = Math.cos(a) * DASH_SPEED;
      p.dashVY = Math.sin(a) * DASH_SPEED;
      p.invuln = Math.max(p.invuln, DASH_TIME + 0.1);
      for (let i = 0; i < 6; i++) this.puff(p.x, p.y, p.color.t);
    }

    if (p.dashT > 0) {
      p.x += p.dashVX * dt;
      p.y += p.dashVY * dt;
    } else {
      p.x += ax * PLAYER_SPEED * dt;
      p.y += ay * PLAYER_SPEED * dt;
    }
    collide(p, 7);

    // Attack
    if (inp.attack && p.atkCool <= 0 && p.atkT <= 0) {
      p.atkT = ATTACK_ACTIVE;
      p.atkCool = ATTACK_COOLDOWN;
      p.atkHits = new Set();
    }
    if (p.atkT > 0) {
      p.atkT -= dt;
      this.resolveSwing(p);
    }

    p.anim += (p.moving ? Math.hypot(ax, ay) : 0) * dt * 9;
  }

  swingAngle(p) {
    // Sweep from behind to in front across the active window.
    const k = 1 - Math.max(0, p.atkT) / ATTACK_ACTIVE;
    return DIR_ANGLE[p.dir] + (-ATTACK_ARC + 2 * ATTACK_ARC * k);
  }

  resolveSwing(p) {
    const base = DIR_ANGLE[p.dir];
    for (const e of this.enemies) {
      if (e.spawnT > 0) continue;
      if (p.atkHits.has(e)) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > ATTACK_RANGE + e.radius) continue;
      let diff = Math.atan2(dy, dx) - base;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > ATTACK_ARC) continue;
      p.atkHits.add(e);
      this.hurtEnemy(e, 1 + Math.floor(p.combo / 8), p);
    }
    // Sword also swats enemy projectiles out of the air.
    for (const s of this.shots) {
      if (s.dead) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d > ATTACK_RANGE + 4) continue;
      let diff = Math.atan2(s.y - p.y, s.x - p.x) - base;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > ATTACK_ARC) continue;
      s.dead = true;
      for (let i = 0; i < 5; i++) this.puff(s.x, s.y, '#ffd24a');
    }
  }

  hurtEnemy(e, dmg, byPlayer) {
    e.hp -= dmg;
    e.flash = 0.12;
    if (byPlayer) {
      const a = Math.atan2(e.y - byPlayer.y, e.x - byPlayer.x);
      const k = 120 * (e.def.knockback ?? 1);
      e.kx += Math.cos(a) * k;
      e.ky += Math.sin(a) * k;
    }
    for (let i = 0; i < 5; i++) this.puff(e.x, e.y, '#ffffff');
    if (e.hp <= 0) this.killEnemy(e, byPlayer);
  }

  killEnemy(e, byPlayer) {
    e.dead = true;
    const mult = byPlayer ? 1 + Math.min(2, byPlayer.combo * 0.05) : 1;
    const pts = Math.round(e.def.score * mult);
    this.score += pts;
    if (byPlayer) {
      byPlayer.score += pts;
      byPlayer.kills += 1;
      byPlayer.combo += 1;
      byPlayer.comboT = 3;
    }
    this.floater(e.x, e.y - 8, `+${pts}`, byPlayer ? byPlayer.color.t : '#ffd24a');
    const n = e.def.boss ? 26 : 10;
    for (let i = 0; i < n; i++) this.puff(e.x, e.y, e.def.boss ? '#ffd24a' : '#e8e4d8');
    if (e.def.boss) this.shakeAmt = Math.max(this.shakeAmt, 10);

    // Drops: rupees often, hearts rarely (bosses always).
    const r = Math.random();
    if (e.def.boss || r < 0.06) {
      this.pickups.push({ kind: 'heart', x: e.x, y: e.y, life: 22, bob: 0 });
    } else if (r < 0.34) {
      this.pickups.push({ kind: 'rupee', x: e.x, y: e.y, life: 18, bob: 0 });
    }
  }

  hurtPlayer(p, dmg, fromX, fromY) {
    if (p.downed || p.invuln > 0) return;
    p.hp -= dmg;
    p.invuln = INVULN_TIME;
    p.flash = 0.3;
    p.combo = 0;
    this.shakeAmt = Math.max(this.shakeAmt, 4);
    if (fromX !== undefined) {
      const a = Math.atan2(p.y - fromY, p.x - fromX);
      p.x += Math.cos(a) * 8;
      p.y += Math.sin(a) * 8;
      collide(p, 7);
    }
    for (let i = 0; i < 8; i++) this.puff(p.x, p.y, '#e2453c');
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.bleed = BLEEDOUT;
      p.reviveProgress = 0;
      this.floater(p.x, p.y - 14, 'DOWN!', '#e2453c');
      this.onEvent({ t: 'downed', id: p.id });
    } else {
      this.onEvent({ t: 'hurt', id: p.id, hp: p.hp });
    }
  }

  updateEnemies(dt) {
    const ctx = this.enemyCtx();
    for (const e of this.enemies) {
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        continue;
      }
      e.flash = Math.max(0, e.flash - dt);
      e.bob += dt * 6;
      e.def.think(e, ctx, dt);

      const speed = e.def.speed * (this.spec ? this.spec.speedMul : 1);
      let nx = e.x + (e.vx * speed + e.kx) * dt;
      let ny = e.y + (e.vy * speed + e.ky) * dt;
      e.kx *= Math.pow(0.0025, dt);
      e.ky *= Math.pow(0.0025, dt);
      const before = { x: nx, y: ny };
      collide(before, e.radius);
      e.x = before.x;
      e.y = before.y;
      if (e.vx || e.vy) e.face = e.vx < -0.15 ? 'l' : e.vx > 0.15 ? 'r' : e.face;

      // Contact damage.
      if (e.def.contact) {
        for (const p of this.players.values()) {
          if (p.downed || p.invuln > 0) continue;
          if (Math.hypot(p.x - e.x, p.y - e.y) < e.radius + 7) {
            this.hurtPlayer(p, e.def.contact, e.x, e.y);
          }
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  updateShots(dt) {
    for (const s of this.shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0 || blocked(s.x, s.y)) {
        s.dead = true;
        for (let i = 0; i < 4; i++) this.puff(s.x, s.y, '#b3ae9c');
        continue;
      }
      for (const p of this.players.values()) {
        if (p.downed || p.invuln > 0) continue;
        if (Math.hypot(p.x - s.x, p.y - s.y) < s.radius + 6) {
          this.hurtPlayer(p, s.dmg, s.x, s.y);
          s.dead = true;
          break;
        }
      }
    }
    this.shots = this.shots.filter((s) => !s.dead);
  }

  updatePickups(dt) {
    for (const k of this.pickups) {
      k.life -= dt;
      k.bob += dt * 4;
      if (k.life <= 0) {
        k.dead = true;
        continue;
      }
      for (const p of this.players.values()) {
        if (p.downed) continue;
        if (Math.hypot(p.x - k.x, p.y - k.y) < 12) {
          k.dead = true;
          if (k.kind === 'heart') {
            p.hp = Math.min(p.maxHp, p.hp + 2);
            this.floater(p.x, p.y - 14, '+HEART', '#ff7a7a');
            this.onEvent({ t: 'heal', id: p.id, hp: p.hp });
          } else {
            const pts = 25;
            this.score += pts;
            p.score += pts;
            this.floater(p.x, p.y - 14, `+${pts}`, '#7dfc9a');
          }
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((k) => !k.dead);
  }

  checkTeamState() {
    const active = this.activePlayers();
    if (!active.length) return;
    // Bleedout: a downed player who isn't revived in time is out for the run.
    for (const p of active) {
      if (p.downed && p.bleed <= 0 && !p.out) {
        p.out = true;
      }
    }
    // A disconnected hero can't fight or revive anyone, so they don't keep the
    // run alive. The host's heartbeat grace period covers brief blips.
    const anyUp = active.some((p) => !p.downed && p.connected !== false);
    if (!anyUp && this.state !== 'gameover') {
      this.state = 'gameover';
      this.banner = null;
      this.onEvent({ t: 'gameover', wave: this.wave, score: this.score });
    }
  }

  // ---------------------------------------------------------- fx helpers

  puff(x, y, color) {
    const a = Math.random() * Math.PI * 2;
    const s = 20 + Math.random() * 60;
    this.particles.push({
      kind: 'puff',
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.25 + Math.random() * 0.3,
      t: 0.55,
      color,
      size: 1 + Math.random() * 2,
    });
  }

  floater(x, y, text, color) {
    this.floaters.push({ x, y, text, color, life: 0.9, t: 0.9 });
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      if (p.kind === 'puff') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.pow(0.02, dt);
        p.vy *= Math.pow(0.02, dt);
      } else if (p.kind === 'wave') {
        p.r = p.max * (1 - p.life / p.t);
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= dt * 18;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  // -------------------------------------------------------------- render

  render(ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (this.shakeAmt > 0.2) {
      ctx.translate(
        (Math.random() - 0.5) * this.shakeAmt,
        (Math.random() - 0.5) * this.shakeAmt
      );
    }

    ctx.drawImage(arenaCanvas(), 0, 0);

    // Ground-level marks first.
    for (const k of this.pickups) {
      if (k.life < 5 && Math.floor(k.life * 8) % 2 === 0) continue; // blink out
      const y = k.y + Math.sin(k.bob) * 2;
      this.shadow(ctx, k.x, k.y + 5, 5);
      drawSprite(ctx, prop(k.kind), k.x, y);
    }

    for (const p of this.particles) {
      if (p.kind !== 'wave') continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.t) * 0.8;
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Depth sort so sprites overlap correctly.
    const drawables = [];
    for (const e of this.enemies) drawables.push({ y: e.y, e });
    for (const p of this.players.values()) drawables.push({ y: p.y, p });
    drawables.sort((a, b) => a.y - b.y);

    for (const d of drawables) {
      if (d.e) this.drawEnemy(ctx, d.e);
      else this.drawPlayer(ctx, d.p);
    }

    for (const s of this.shots) {
      drawSprite(ctx, prop(s.kind === 'bolt' ? 'bolt' : 'rock'), s.x, s.y);
    }

    for (const p of this.particles) {
      if (p.kind !== 'puff') continue;
      ctx.globalAlpha = Math.max(0, p.life / p.t);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (const f of this.floaters) {
      ctx.globalAlpha = Math.min(1, f.life / 0.4);
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1a1420';
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
    this.drawBanner(ctx);
  }

  shadow(ctx, x, y, r) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPlayer(ctx, p) {
    const sheet = heroSheet(p.slot);
    const set = p.downed ? sheet.downed : sheet;
    const key = p.dir === 'left' || p.dir === 'right' ? 'side' : p.dir;
    const strip = set[key];
    const frame = p.moving && !p.downed ? Math.floor(p.anim) % strip.length : 0;
    const cv = strip[frame];
    // The source side frames face left, so mirror them for right.
    const flip = p.dir === 'right';
    const ground = p.y + 7;

    this.shadow(ctx, p.x, ground, 6);

    if (p.downed) {
      // Tipped on their side, feet where they fell.
      ctx.save();
      ctx.translate(p.x, ground);
      ctx.rotate(Math.PI / 2);
      drawAt(ctx, cv, 0, 0, sheet.foot, { alpha: 0.85 });
      ctx.restore();
      const pct = p.reviveProgress / REVIVE_TIME;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(p.x - 11, p.y - 15, 22, 4);
      ctx.fillStyle = pct > 0 ? '#7dfc9a' : '#e2453c';
      ctx.fillRect(p.x - 10, p.y - 14, 20 * (pct > 0 ? pct : p.bleed / BLEEDOUT), 2);
      return;
    }

    // Blink while invulnerable.
    const blink = p.invuln > 0 && Math.floor(p.invuln * 16) % 2 === 0;
    if (!blink) {
      drawAt(ctx, cv, p.x, ground, sheet.foot, {
        flip,
        tint: p.flash > 0 ? 'rgba(255,80,80,0.55)' : null,
      });
    }

    if (p.atkT > 0) {
      const a = this.swingAngle(p);
      const hx = p.x + Math.cos(a) * 7;
      const hy = p.y + Math.sin(a) * 7 + 1;
      // The sword sprite points "up"; rotate it onto the swing angle.
      drawSword(ctx, hx, hy, a + Math.PI / 2);
    }

    // Name tag in the player's colour.
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(p.name, p.x + 1, p.y - 15);
    ctx.fillStyle = p.color.t;
    ctx.fillText(p.name, p.x, p.y - 16);
  }

  drawEnemy(ctx, e) {
    const frames = enemyFrames(e.type);
    // Two-frame shuffle driven by the same clock as the bob.
    const cv = frames[Math.floor(e.bob * 0.9) % frames.length];
    const scale = e.def.scale || 1;
    const hover = e.type === 'bat' ? Math.sin(e.bob) * 2.5 - 3 : 0;
    const ground = e.y + e.radius * 0.9;

    this.shadow(ctx, e.x, ground, 6 * scale);

    ctx.save();
    if (e.spawnT > 0) ctx.globalAlpha = 1 - e.spawnT / 0.45;
    else if (e.alpha !== 1) ctx.globalAlpha = e.alpha;
    if (scale !== 1) {
      ctx.translate(e.x, ground);
      ctx.scale(scale, scale);
      ctx.translate(-e.x, -ground);
    }
    // Telegraph the boss wind-up and the grunt's lunge prep with a red tint.
    const winding = e.mode === 'wind' || e.mode === 'slam';
    drawGrounded(ctx, cv, e.x, ground + hover, {
      flip: e.face === 'l',
      tint: e.flash > 0 ? 'rgba(255,255,255,0.75)' : winding ? 'rgba(255,60,60,0.45)' : null,
    });
    ctx.restore();

    if (e.def.boss) {
      const w = 60;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(e.x - w / 2 - 1, e.y - 34, w + 2, 6);
      ctx.fillStyle = '#e2453c';
      ctx.fillRect(e.x - w / 2, e.y - 33, w * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  drawBanner(ctx) {
    if (!this.banner) return;
    const b = this.banner;
    const a = Math.min(1, b.t / 0.4);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10,8,16,0.72)';
    ctx.fillRect(0, H / 2 - 26, W, 44);
    ctx.fillStyle = '#ffd24a';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(b.text, W / 2, H / 2 - 4);
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '9px monospace';
    ctx.fillText(b.sub, W / 2, H / 2 + 11);
    ctx.restore();
  }

  // ----------------------------------------------------------- HUD state

  hudState() {
    return {
      state: this.state,
      wave: this.wave,
      score: this.score,
      remaining: this.enemies.length + this.spawnQueue.length,
      intermission: this.state === 'intermission' ? Math.ceil(this.stateT) : 0,
      players: this.activePlayers()
        .sort((a, b) => a.slot - b.slot)
        .map((p) => ({
          id: p.id,
          name: p.name,
          slot: p.slot,
          color: p.color.t,
          hp: p.hp,
          maxHp: p.maxHp,
          downed: p.downed,
          connected: p.connected,
          score: p.score,
          kills: p.kills,
          combo: p.combo,
        })),
    };
  }

  playerState(p) {
    return {
      t: 'you',
      hp: p.hp,
      maxHp: p.maxHp,
      downed: p.downed,
      reviving: p.downed ? p.reviveProgress / REVIVE_TIME : 0,
      bleed: p.downed ? Math.max(0, p.bleed / BLEEDOUT) : 1,
      out: !!p.out,
      score: p.score,
      kills: p.kills,
      combo: p.combo,
      wave: Math.max(1, this.wave),
      teamScore: this.score,
      state: this.state,
      dashCool: p.dashCool / DASH_COOLDOWN,
    };
  }
}

export { PLAYER_MAX_HP, W, H, PILLARS };
