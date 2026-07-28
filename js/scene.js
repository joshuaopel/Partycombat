// Client-side scene reconstruction.
//
// Phones receive snapshots at a fixed rate and render at their own frame rate,
// so entities are interpolated between the two snapshots that bracket a render
// clock held slightly in the past. Cosmetic particles are not transmitted —
// they are spawned locally from the snapshot's one-shot `fx` events, which
// keeps them smooth and keeps the wire small.

import { DIR_NAMES, ENEMY_NAMES } from './game.js';

const INTERP_DELAY = 110; // ms behind the newest snapshot
const BUFFER = 5;

const lerp = (a, b, t) => a + (b - a) * t;

function decode(snap) {
  return {
    st: snap.st,
    wave: snap.wv,
    score: snap.sc,
    players: (snap.p || []).map((a) => ({
      slot: a[0], x: a[1], y: a[2], dir: DIR_NAMES[a[3]], frame: a[4],
      downed: !!(a[5] & 1), attacking: !!(a[5] & 2), connected: !(a[5] & 4),
      invuln: a[6] / 60, flash: a[7] / 60, atkAngle: a[8] / 100,
      meter: a[9] / 100, reviving: !!a[10],
    })),
    enemies: (snap.e || []).map((a) => ({
      id: a[0], type: ENEMY_NAMES[a[1]], x: a[2], y: a[3], face: a[4] ? 'l' : 'r',
      frame: a[5], flash: a[6] / 60, alpha: a[7] / 100, radius: a[8],
      scale: a[9] / 10, bossHp: a[10], winding: !!a[11], bob: a[12] / 20,
    })),
    shots: (snap.s || []).map((a) => ({ kind: a[0] ? 'bolt' : 'rock', x: a[1], y: a[2] })),
    pickups: (snap.k || []).map((a) => ({ kind: a[0] ? 'rupee' : 'heart', x: a[1], y: a[2], bob: a[3] / 10 })),
  };
}

export class SceneBuffer {
  constructor() {
    this.snaps = []; // { at, data }
    this.roster = new Map(); // slot -> { name, id }
    this.particles = [];
    this.floaters = [];
    this.rings = [];
    this.latest = null;
  }

  setRoster(list) {
    this.roster = new Map(list.map((p) => [p.slot, p]));
  }

  push(snap, now = performance.now()) {
    const data = decode(snap);
    this.snaps.push({ at: now, data });
    if (this.snaps.length > BUFFER) this.snaps.shift();
    this.latest = data;
    for (const [kind, x, y] of snap.fx || []) this.spawnFx(kind, x, y);
    for (const [x, y, text, color] of snap.fl || []) {
      this.floaters.push({ x, y, text, color, life: 0.9 });
    }
  }

  spawnFx(kind, x, y) {
    const spec = [
      { n: 6, color: '#ffffff', speed: 70 },   // 0 hit
      { n: 12, color: '#e8e4d8', speed: 80 },  // 1 kill
      { n: 8, color: '#e8e4d8', speed: 50 },   // 2 spawn
      { n: 26, color: '#ffd24a', speed: 110 }, // 3 boss kill
    ][kind] || { n: 6, color: '#ffffff', speed: 70 };
    for (let i = 0; i < spec.n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spec.speed * (0.3 + Math.random());
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.25 + Math.random() * 0.3, t: 0.55,
        color: spec.color, size: 1 + Math.random() * 2,
      });
    }
    if (kind === 3) this.rings.push({ x, y, r: 6, max: 80, life: 0.45, t: 0.45 });
  }

  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.02, dt);
      p.vy *= Math.pow(0.02, dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= dt * 18;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const r of this.rings) {
      r.life -= dt;
      r.r = r.max * (1 - r.life / r.t);
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  /** Interpolated scene for render.js, plus the raw latest state for HUD use. */
  sample(now = performance.now()) {
    if (!this.snaps.length) return null;
    const target = now - INTERP_DELAY;

    let a = this.snaps[0];
    let b = this.snaps[this.snaps.length - 1];
    for (let i = 0; i < this.snaps.length - 1; i++) {
      if (this.snaps[i].at <= target && this.snaps[i + 1].at >= target) {
        a = this.snaps[i];
        b = this.snaps[i + 1];
        break;
      }
    }
    // Past the newest snapshot (a stalled connection): hold the last pose
    // rather than extrapolating into nonsense.
    const span = b.at - a.at;
    const t = span > 0 ? Math.max(0, Math.min(1, (target - a.at) / span)) : 1;

    const bPlayers = new Map(b.data.players.map((p) => [p.slot, p]));
    const players = a.data.players.map((p) => {
      const q = bPlayers.get(p.slot) || p;
      const info = this.roster.get(p.slot) || {};
      return {
        ...q,
        id: info.id,
        name: info.name || `P${p.slot + 1}`,
        x: lerp(p.x, q.x, t),
        y: lerp(p.y, q.y, t),
        atkT: q.attacking ? 1 : 0,
        reviveProgress: q.downed && q.reviving ? q.meter : 0,
        bleed: q.downed && !q.reviving ? q.meter : 1,
      };
    });

    const bEnemies = new Map(b.data.enemies.map((e) => [e.id, e]));
    const enemies = a.data.enemies
      .filter((e) => bEnemies.has(e.id))
      .map((e) => {
        const q = bEnemies.get(e.id);
        return {
          ...q,
          x: lerp(e.x, q.x, t),
          y: lerp(e.y, q.y, t),
          boss: q.bossHp >= 0,
          hp: q.bossHp,
          maxHp: 100,
        };
      });
    // Enemies that appeared in the newer snapshot still need drawing.
    for (const e of b.data.enemies) {
      if (!a.data.enemies.some((x) => x.id === e.id)) {
        enemies.push({ ...e, boss: e.bossHp >= 0, hp: e.bossHp, maxHp: 100 });
      }
    }

    return {
      players,
      enemies,
      shots: b.data.shots,
      pickups: b.data.pickups,
      particles: this.particles.map((p) => ({
        x: p.x, y: p.y, size: p.size, color: p.color, a: Math.max(0, p.life / p.t),
      })),
      rings: this.rings.map((r) => ({ x: r.x, y: r.y, r: r.r, a: Math.max(0, r.life / r.t) })),
      floaters: this.floaters.map((f) => ({
        x: f.x, y: f.y, text: f.text, color: f.color, a: Math.min(1, f.life / 0.4),
      })),
      state: b.data.st,
      wave: b.data.wave,
      score: b.data.score,
    };
  }
}
