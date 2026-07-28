// Authoritative simulation. Runs only on the host; controllers send intent and
// receive HUD state. Everything here is deterministic per-frame given inputs,
// but we don't need lockstep determinism since there's exactly one simulator.

import { PLAYER_COLORS } from './sprites.js';
import { World, WORLD_W, WORLD_H } from './world.js';
import { DIR_ANGLE } from './render.js';

// Wire encoding: identities and enums travel as small integers.
export const DIR_NAMES = ['down', 'up', 'left', 'right'];
export const DIR_INDEX = { down: 0, up: 1, left: 2, right: 3 };
export const ENEMY_NAMES = ['octo', 'grunt', 'bat', 'bones', 'mage', 'knight'];
const ENEMY_INDEX = Object.fromEntries(ENEMY_NAMES.map((n, i) => [n, i]));
// Enemy and player projectiles share one wire list; the renderer picks the
// sprite off the name.
export const SHOT_NAMES = ['rock', 'bolt', 'arrow', 'beam', 'rang', 'fire'];
const SHOT_INDEX = Object.fromEntries(SHOT_NAMES.map((n, i) => [n, i]));
// Pickups likewise. Index 0 and 1 stay put so the ordering reads as
// "consumables, then weapons".
export const PICKUP_NAMES = ['heart', 'rupee', 'master', 'bow', 'rang', 'rod'];
const PICKUP_INDEX = Object.fromEntries(PICKUP_NAMES.map((n, i) => [n, i]));
import { ENEMY_TYPES, waveSpec } from './enemies.js';
import { WEAPON_TYPES, WEAPON_NAMES, randomWeapon, meleeStats } from './weapons.js';

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
// Loose pickups keep appearing while a wave is running, so there is always a
// reason to leave your corner of the island.
const DROP_EVERY = [11, 17];
const DROP_HEART_CHANCE = 0.45;

export class Game {
  constructor({ onEvent, seed } = {}) {
    this.onEvent = onEvent || (() => {});
    this.players = new Map(); // id -> player
    // The seed is all a phone needs to build a byte-identical world.
    this.seed = (seed ?? ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
    this.world = new World(this.seed);
    this.reset();
  }

  reset() {
    this.enemies = [];
    this.shots = [];
    this.pshots = []; // player projectiles; they hurt enemies, not heroes
    this.pickups = [];
    this.dropT = DROP_EVERY[0];
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
    this.fx = [];
    this.fxFloaters = [];
    this.entId = 0;
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
      x: WORLD_W / 2,
      y: WORLD_H / 2,
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
      bestCombo: 0,
      comboT: 0,
      flash: 0,
      weapon: null, // key into WEAPON_TYPES, or null for the plain sword
      weaponT: 0, // seconds left on it
    };
  }

  resetPlayer(p) {
    Object.assign(p, this.blankStats());
    this.placeAtSpawn(p);
  }

  placeAtSpawn(p) {
    // Fan the party out around the middle of the island, nudging off anything
    // solid so nobody starts inside a tree.
    const ang = (p.slot / PLAYER_COLORS.length) * Math.PI * 2;
    p.x = this.world.w / 2 + Math.cos(ang) * 46;
    p.y = this.world.h / 2 + Math.sin(ang) * 34;
    for (let i = 0; i < 30 && this.world.blocked(p.x, p.y); i++) {
      p.x += Math.cos(ang) * 12;
      p.y += Math.sin(ang) * 12;
    }
    this.world.collide(p, 7);
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
    // Waves close in on the party rather than trickling from a map edge.
    const spot = at || this.world.spawnNear(Math.random, this.livePlayers());
    const hp = Math.round(def.hp * (this.spec ? this.spec.hpMul : 1));
    const e = {
      id: ++this.entId, // stable across snapshots so phones can interpolate
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
    this.emit(2, e.x, e.y);
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
      randomSpot: () => this.world.spawnNear(Math.random, this.livePlayers(), 60, 170),
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

  // -------------------------------------------------------- weapon hooks

  /** What a weapon's `fire` gets to work with. Mirrors enemyCtx in spirit. */
  weaponCtx() {
    if (this._wctx) return this._wctx;
    this._wctx = {
      shot: (p, spec) => {
        // Projectiles leave along the facing the swing committed to, so what
        // you aimed the sword at is what you shot at.
        //
        // They start on the hero rather than a few pixels ahead: standing with
        // your back to a tree would otherwise spawn the shot *inside* the
        // trunk, and it would die on its first terrain check without ever
        // leaving your hands.
        const a = DIR_ANGLE[p.dir];
        this.pshots.push({
          kind: spec.kind,
          x: p.x,
          y: p.y,
          vx: Math.cos(a) * spec.speed,
          vy: Math.sin(a) * spec.speed,
          dmg: spec.dmg,
          life: spec.life,
          radius: spec.radius ?? 4,
          pierce: !!spec.pierce,
          splash: spec.splash || 0,
          knock: spec.knock ?? 1,
          owner: p,
          hits: new Set(), // each enemy takes one hit per pass
          ang: a,
          spin: 0,
          mode: spec.kind === 'rang' ? 'out' : 'fly',
          t: 0,
        });
      },
      has: (p, kind) => this.pshots.some((s) => !s.dead && s.owner === p && s.kind === kind),
    };
    return this._wctx;
  }

  /** Hand a weapon over, replacing whatever was in play and resetting its clock. */
  giveWeapon(p, kind) {
    const w = WEAPON_TYPES[kind];
    if (!w) return;
    p.weapon = kind;
    p.weaponT = w.duration;
    this.floater(p.x, p.y - 14, `+${w.tag}`, w.color);
    this.onEvent({ t: 'weapon', id: p.id, weapon: kind, label: w.label, secs: w.duration });
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
    this.updatePlayerShots(dt);
    this.updatePickups(dt);
    this.maybeDrop(dt);
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
    // Guarantee some sustain between waves, scaled to party size, plus one
    // weapon so the next wave always opens with something worth racing for.
    const hearts = Math.max(1, Math.ceil(this.players.size / 2));
    for (let i = 0; i < hearts; i++) this.dropNear('heart', 30, 120);
    this.dropNear(randomWeapon(), 40, 150);
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

    // The weapon clock only runs while you are on your feet. Bleeding out for
    // twenty seconds and losing the thing you just earned is two punishments
    // for one mistake.
    if (p.weapon) {
      p.weaponT -= dt;
      if (p.weaponT <= 0) {
        this.floater(p.x, p.y - 14, `${WEAPON_TYPES[p.weapon].tag} SPENT`, '#9b93b5');
        p.weapon = null;
        p.weaponT = 0;
      }
    }

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
      this.world.move(p, p.dashVX * dt, p.dashVY * dt, 7);
    } else {
      this.world.move(p, ax * PLAYER_SPEED * dt, ay * PLAYER_SPEED * dt, 7);
    }

    // Attack
    if (inp.attack && p.atkCool <= 0 && p.atkT <= 0) {
      p.atkT = ATTACK_ACTIVE;
      p.atkCool = ATTACK_COOLDOWN;
      p.atkHits = new Set();
      const w = p.weapon && WEAPON_TYPES[p.weapon];
      if (w && w.fire) w.fire(p, this.weaponCtx());
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
    const arc = meleeStats(p.weapon, ATTACK_RANGE, ATTACK_ARC).arc;
    return DIR_ANGLE[p.dir] + (-arc + 2 * arc * k);
  }

  resolveSwing(p) {
    const base = DIR_ANGLE[p.dir];
    const m = meleeStats(p.weapon, ATTACK_RANGE, ATTACK_ARC);
    for (const e of this.enemies) {
      if (e.spawnT > 0) continue;
      if (p.atkHits.has(e)) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > m.range + e.radius) continue;
      let diff = Math.atan2(dy, dx) - base;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > m.arc) continue;
      p.atkHits.add(e);
      this.hurtEnemy(e, 1 + m.dmg + Math.floor(p.combo / 8), p);
    }
    // Sword also swats enemy projectiles out of the air.
    for (const s of this.shots) {
      if (s.dead) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d > m.range + 4) continue;
      let diff = Math.atan2(s.y - p.y, s.x - p.x) - base;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > m.arc) continue;
      s.dead = true;
      for (let i = 0; i < 5; i++) this.puff(s.x, s.y, '#ffd24a');
    }
  }

  /**
   * `from` is where the blow came from, which is the sword for a swing but the
   * projectile for anything thrown — knocking an enemy away from a distant
   * archer rather than away from the arrow looks wrong and plays worse.
   */
  hurtEnemy(e, dmg, byPlayer, { from = null, knock = 1 } = {}) {
    e.hp -= dmg;
    e.flash = 0.12;
    const src = from || byPlayer;
    if (src) {
      const a = Math.atan2(e.y - src.y, e.x - src.x);
      const k = 120 * (e.def.knockback ?? 1) * knock;
      e.kx += Math.cos(a) * k;
      e.ky += Math.sin(a) * k;
    }
    for (let i = 0; i < 5; i++) this.puff(e.x, e.y, '#ffffff');
    this.emit(0, e.x, e.y);
    if (e.hp <= 0) this.killEnemy(e, byPlayer);
  }

  killEnemy(e, byPlayer) {
    e.dead = true;
    const mult = byPlayer ? 1 + Math.min(2, byPlayer.combo * 0.05) : 1;
    const pts = Math.round(e.def.score * mult);
    this.score += pts;
    // Whoever landed the killing blow banks the points, whether that was their
    // sword, their arrow or their fireball.
    if (byPlayer) {
      byPlayer.score += pts;
      byPlayer.kills += 1;
      byPlayer.combo += 1;
      byPlayer.bestCombo = Math.max(byPlayer.bestCombo, byPlayer.combo);
      byPlayer.comboT = 3;
    }
    this.floater(e.x, e.y - 8, `+${pts}`, byPlayer ? byPlayer.color.t : '#ffd24a');
    const n = e.def.boss ? 26 : 10;
    for (let i = 0; i < n; i++) this.puff(e.x, e.y, e.def.boss ? '#ffd24a' : '#e8e4d8');
    if (e.def.boss) this.shakeAmt = Math.max(this.shakeAmt, 10);
    this.emit(e.def.boss ? 3 : 1, e.x, e.y);

    // Drops: rupees often, hearts rarely, weapons rarer still. A boss is worth
    // crossing the island for, so it always leaves both.
    if (e.def.boss) {
      this.dropPickup('heart', e.x, e.y);
      this.dropPickup(randomWeapon(), e.x + 14, e.y);
      return;
    }
    const r = Math.random();
    if (r < 0.03) this.dropPickup(randomWeapon(), e.x, e.y);
    else if (r < 0.09) this.dropPickup('heart', e.x, e.y);
    else if (r < 0.37) this.dropPickup('rupee', e.x, e.y);
  }

  /**
   * Loose drops keep landing away from the party while a wave runs, so the
   * fight keeps moving instead of settling into one corner of the island.
   */
  maybeDrop(dt) {
    if (this.state !== 'fighting') return;
    this.dropT -= dt;
    if (this.dropT > 0) return;
    this.dropT = DROP_EVERY[0] + Math.random() * (DROP_EVERY[1] - DROP_EVERY[0]);
    if (!this.livePlayers().length) return;
    this.dropNear(Math.random() < DROP_HEART_CHANCE ? 'heart' : randomWeapon(), 90, 260);
  }

  dropNear(kind, min, max) {
    const spot = this.world.spawnNear(Math.random, this.livePlayers(), min, max);
    this.dropPickup(kind, spot.x, spot.y);
  }

  dropPickup(kind, x, y) {
    // Weapons sit around longer than hearts — one may be half an island away
    // from whoever needs it, and expiring before anyone can reach it just
    // reads as the game teasing you.
    const consumable = kind === 'heart' || kind === 'rupee';
    this.pickups.push({
      kind,
      x,
      y,
      life: consumable ? 24 : 36,
      bob: Math.random() * 6,
    });
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
      this.world.move(p, Math.cos(a) * 8, Math.sin(a) * 8, 7);
    }
    for (let i = 0; i < 8; i++) this.puff(p.x, p.y, '#e2453c');
    this.emit(0, p.x, p.y);
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
      this.world.move(e, (e.vx * speed + e.kx) * dt, (e.vy * speed + e.ky) * dt, e.radius);
      e.kx *= Math.pow(0.0025, dt);
      e.ky *= Math.pow(0.0025, dt);
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
      if (s.life <= 0 || this.world.blocked(s.x, s.y)) {
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

  /**
   * Player projectiles. Kept apart from `this.shots` — enemy fire hits heroes,
   * these hit enemies, and one array trying to do both invites the bug where
   * your own arrow downs you.
   */
  updatePlayerShots(dt) {
    for (const s of this.pshots) {
      if (s.dead) continue;
      s.t += dt;
      s.life -= dt;

      if (s.kind === 'rang') {
        s.spin += dt * 16;
        if (s.mode === 'out' && s.t > 0.42) {
          s.mode = 'back';
          // Fresh on the way home, so a line of enemies gets swept twice.
          s.hits.clear();
        }
        if (s.mode === 'back') {
          const a = Math.atan2(s.owner.y - s.y, s.owner.x - s.x);
          s.vx = Math.cos(a) * 175;
          s.vy = Math.sin(a) * 175;
          if (Math.hypot(s.owner.x - s.x, s.owner.y - s.y) < 10) {
            s.dead = true;
            continue;
          }
        }
      }

      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.ang = Math.atan2(s.vy, s.vx);

      if (s.life <= 0) {
        this.expireShot(s);
        continue;
      }
      // A boomerang is thrown over the scenery; everything else stops at it.
      if (s.kind !== 'rang' && this.world.blocked(s.x, s.y)) {
        this.expireShot(s);
        continue;
      }

      for (const e of this.enemies) {
        if (e.dead || e.spawnT > 0 || s.hits.has(e)) continue;
        if (Math.hypot(e.x - s.x, e.y - s.y) > e.radius + s.radius) continue;
        s.hits.add(e);
        if (s.splash) {
          this.explode(s);
          break;
        }
        this.hurtEnemy(e, s.dmg, s.owner, { from: s, knock: s.knock });
        // Beams and the boomerang carry on through; an arrow is spent.
        if (!s.pierce && s.kind !== 'rang') {
          s.dead = true;
          for (let i = 0; i < 4; i++) this.puff(s.x, s.y, '#e8e4d8');
          break;
        }
      }
    }
    this.pshots = this.pshots.filter((s) => !s.dead);
  }

  /** A shot that ran out of road: splash weapons still go off where they land. */
  expireShot(s) {
    if (s.splash && !s.dead) {
      this.explode(s);
      return;
    }
    s.dead = true;
    for (let i = 0; i < 4; i++) this.puff(s.x, s.y, '#b3ae9c');
  }

  explode(s) {
    s.dead = true;
    this.particles.push({ kind: 'wave', x: s.x, y: s.y, r: 6, max: s.splash, life: 0.35, t: 0.35 });
    for (let i = 0; i < 12; i++) this.puff(s.x, s.y, '#ff7a2a');
    this.emit(5, s.x, s.y);
    this.shakeAmt = Math.max(this.shakeAmt, 3);
    for (const e of this.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      if (Math.hypot(e.x - s.x, e.y - s.y) < s.splash + e.radius) {
        this.hurtEnemy(e, s.dmg, s.owner, { from: s, knock: 1.4 });
      }
    }
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
          this.emit(4, k.x, k.y);
          if (k.kind === 'heart') {
            p.hp = Math.min(p.maxHp, p.hp + 2);
            this.floater(p.x, p.y - 14, '+HEART', '#ff7a7a');
            this.onEvent({ t: 'heal', id: p.id, hp: p.hp });
          } else if (k.kind === 'rupee') {
            const pts = 25;
            this.score += pts;
            p.score += pts;
            this.floater(p.x, p.y - 14, `+${pts}`, '#7dfc9a');
          } else {
            this.giveWeapon(p, k.kind);
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
    // Phones replay these locally rather than receiving per-frame positions.
    if (this.fxFloaters.length < 12) {
      this.fxFloaters.push([Math.round(x), Math.round(y), text, color]);
    }
  }

  /** Queue a one-shot effect for the phones (0 hit, 1 kill, 2 spawn, 3 boom). */
  emit(kind, x, y) {
    if (this.fx.length < 24) this.fx.push([kind, Math.round(x), Math.round(y)]);
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

  // ------------------------------------------------------- views & network

  /**
   * Plain-object scene for render.js. The host draws this directly; phones
   * build the same shape out of a decoded snapshot.
   */
  scene() {
    return {
      players: this.activePlayers().map((p) => this.playerView(p)),
      enemies: this.enemies.map((e) => this.enemyView(e)),
      shots: [
        ...this.shots.map((s) => ({ kind: s.kind, x: s.x, y: s.y, ang: 0 })),
        ...this.pshots.map((s) => ({ kind: s.kind, x: s.x, y: s.y, ang: s.kind === 'rang' ? s.spin : s.ang })),
      ],
      pickups: this.pickups
        // Blink out as they are about to expire.
        .filter((k) => !(k.life < 5 && Math.floor(k.life * 8) % 2 === 0))
        .map((k) => ({ kind: k.kind, x: k.x, y: k.y, bob: k.bob })),
      particles: this.particles
        .filter((p) => p.kind === 'puff')
        .map((p) => ({ x: p.x, y: p.y, size: p.size, color: p.color, a: Math.max(0, p.life / p.t) })),
      rings: this.particles
        .filter((p) => p.kind === 'wave')
        .map((p) => ({ x: p.x, y: p.y, r: p.r, a: Math.max(0, p.life / p.t) })),
      floaters: this.floaters.map((f) => ({
        x: f.x, y: f.y, text: f.text, color: f.color, a: Math.min(1, f.life / 0.4),
      })),
    };
  }

  playerView(p) {
    return {
      id: p.id,
      name: p.name,
      slot: p.slot,
      x: p.x,
      y: p.y,
      dir: p.dir,
      frame: p.moving && !p.downed ? Math.floor(p.anim) % 8 : 0,
      downed: p.downed,
      invuln: p.invuln,
      flash: p.flash,
      atkT: p.atkT,
      atkAngle: p.atkT > 0 ? this.swingAngle(p) : 0,
      reviveProgress: p.downed ? p.reviveProgress / REVIVE_TIME : 0,
      bleed: p.downed ? Math.max(0, p.bleed / BLEEDOUT) : 1,
      connected: p.connected,
      weapon: p.weapon,
    };
  }

  enemyView(e) {
    return {
      type: e.type,
      x: e.x,
      y: e.y,
      face: e.face,
      radius: e.radius,
      frame: Math.floor(e.bob * 0.9),
      bob: e.bob,
      flash: e.flash,
      alpha: e.spawnT > 0 ? 1 - e.spawnT / 0.45 : e.alpha,
      scale: e.def.scale || 1,
      boss: !!e.def.boss,
      hp: e.hp,
      maxHp: e.maxHp,
      winding: e.mode === 'wind' || e.mode === 'slam',
    };
  }

  /**
   * Compact state for the wire. Positions are rounded and identities are slot
   * numbers, so a full snapshot of a busy field stays around a couple of KB.
   * Cosmetic particles are not sent: the phone spawns its own from the `fx`
   * event list, which also lets them animate at the phone's frame rate rather
   * than stepping at the snapshot rate.
   */
  snapshot() {
    const r = Math.round;
    const snap = {
      t: 'snap',
      st: this.state,
      wv: this.wave,
      sc: this.score,
      p: this.activePlayers().map((p) => [
        p.slot, r(p.x), r(p.y), DIR_INDEX[p.dir],
        p.moving && !p.downed ? Math.floor(p.anim) % 8 : 0,
        (p.downed ? 1 : 0) | (p.atkT > 0 ? 2 : 0) | (p.connected === false ? 4 : 0),
        r(p.invuln * 60), r(p.flash * 60),
        p.atkT > 0 ? r(this.swingAngle(p) * 100) : 0,
        r((p.downed ? (p.reviveProgress > 0 ? p.reviveProgress / REVIVE_TIME : p.bleed / BLEEDOUT) : 1) * 100),
        p.downed && p.reviveProgress > 0 ? 1 : 0,
        // Everyone's weapon travels, so a power-up is visible to the whole
        // party rather than only to whoever picked it up.
        p.weapon ? WEAPON_NAMES.indexOf(p.weapon) + 1 : 0,
      ]),
      e: this.enemies.map((e) => [
        e.id, ENEMY_INDEX[e.type], r(e.x), r(e.y), e.face === 'l' ? 1 : 0,
        Math.floor(e.bob * 0.9) % 2, r(e.flash * 60),
        r((e.spawnT > 0 ? 1 - e.spawnT / 0.45 : e.alpha) * 100),
        e.radius, r((e.def.scale || 1) * 10),
        e.def.boss ? r((e.hp / e.maxHp) * 100) : -1,
        e.mode === 'wind' || e.mode === 'slam' ? 1 : 0,
        r((e.bob % (Math.PI * 2)) * 20),
      ]),
      s: [
        ...this.shots.map((s) => [SHOT_INDEX[s.kind] ?? 0, r(s.x), r(s.y), 0]),
        ...this.pshots.map((s) => [
          SHOT_INDEX[s.kind] ?? 0, r(s.x), r(s.y),
          r((s.kind === 'rang' ? s.spin : s.ang) * 100),
        ]),
      ],
      k: this.pickups.map((k) => [PICKUP_INDEX[k.kind] ?? 0, r(k.x), r(k.y), r(k.bob * 10) % 63]),
      fx: this.fx,
      fl: this.fxFloaters,
    };
    this.fx = [];
    this.fxFloaters = [];
    return snap;
  }

  // ----------------------------------------------------------- HUD state

  scoreRow(p) {
    const w = p.weapon ? WEAPON_TYPES[p.weapon] : null;
    return {
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
      bestCombo: p.bestCombo,
      weapon: p.weapon,
      weaponTag: w ? w.tag : '',
      weaponColor: w ? w.color : '',
      weaponLeft: w ? Math.max(0, p.weaponT / w.duration) : 0,
      weaponSecs: w ? Math.ceil(Math.max(0, p.weaponT)) : 0,
    };
  }

  /**
   * The scoreboard, best first. Ties break on kills and then on slot, so the
   * order is stable frame to frame — a board that reshuffles two names every
   * time they draw level is unreadable.
   */
  standings() {
    return this.activePlayers()
      .map((p) => this.scoreRow(p))
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.slot - b.slot)
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }

  hudState() {
    return {
      state: this.state,
      wave: this.wave,
      score: this.score,
      remaining: this.enemies.length + this.spawnQueue.length,
      intermission: this.state === 'intermission' ? Math.ceil(this.stateT) : 0,
      players: this.activePlayers()
        .sort((a, b) => a.slot - b.slot)
        .map((p) => this.scoreRow(p)),
      standings: this.standings(),
    };
  }

  playerState(p) {
    const board = this.standings();
    const w = p.weapon ? WEAPON_TYPES[p.weapon] : null;
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
      rank: board.findIndex((r) => r.id === p.id) + 1,
      party: board.length,
      weapon: p.weapon,
      weaponTag: w ? w.tag : '',
      weaponColor: w ? w.color : '',
      weaponLeft: w ? Math.max(0, p.weaponT / w.duration) : 0,
      weaponSecs: w ? Math.ceil(Math.max(0, p.weaponT)) : 0,
      // Everyone's line, so the phone can show the whole board without a
      // second message type.
      board: board.map((r) => ({
        slot: r.slot, name: r.name, score: r.score, kills: r.kills, color: r.color,
        downed: r.downed, rank: r.rank,
      })),
      wave: Math.max(1, this.wave),
      teamScore: this.score,
      state: this.state,
      dashCool: p.dashCool / DASH_COOLDOWN,
    };
  }
}

export { PLAYER_MAX_HP, DASH_COOLDOWN, WORLD_W, WORLD_H };
