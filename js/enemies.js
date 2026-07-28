// Enemy archetypes and the wave escalation curve.
//
// Each archetype supplies a `think(e, ctx, dt)` that sets e.vx/e.vy and may
// queue attacks through ctx. The game loop owns movement, collision and death.

export const ENEMY_TYPES = {
  octo: {
    label: 'Octo',
    hp: 3,
    speed: 26,
    radius: 7,
    score: 10,
    contact: 1,
    knockback: 1,
    // Scuttles in cardinal bursts, stops, spits a rock at whoever is closest.
    think(e, ctx, dt) {
      e.timer -= dt;
      if (e.timer <= 0) {
        if (e.mode === 'move') {
          e.mode = 'aim';
          e.timer = 0.55;
          e.vx = e.vy = 0;
          const t = ctx.nearestPlayer(e);
          if (t) {
            const d = Math.hypot(t.x - e.x, t.y - e.y);
            e.face = Math.abs(t.x - e.x) > Math.abs(t.y - e.y) ? (t.x > e.x ? 'r' : 'l') : t.y > e.y ? 'd' : 'u';
            if (d < 190) e.willFire = true;
          }
        } else {
          if (e.willFire) {
            const t = ctx.nearestPlayer(e);
            if (t) ctx.enemyShot(e, t.x, t.y, 'rock', 78, 1);
            e.willFire = false;
          }
          e.mode = 'move';
          e.timer = 0.7 + ctx.rand() * 0.8;
          const t = ctx.nearestPlayer(e);
          // Bias movement toward the target so they close distance over time.
          const ang = t
            ? Math.atan2(t.y - e.y, t.x - e.x) + (ctx.rand() - 0.5) * 2.4
            : ctx.rand() * Math.PI * 2;
          e.vx = Math.cos(ang);
          e.vy = Math.sin(ang);
        }
      }
    },
  },

  grunt: {
    label: 'Grunt',
    hp: 5,
    speed: 40,
    radius: 8,
    score: 15,
    contact: 1,
    knockback: 1,
    // Straight chaser that winds up and lunges when close.
    think(e, ctx, dt) {
      const t = ctx.nearestPlayer(e);
      if (!t) {
        e.vx = e.vy = 0;
        return;
      }
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.timer -= dt;
      if (e.mode === 'lunge') {
        if (e.timer <= 0) {
          e.mode = 'chase';
          e.timer = 1.4;
        }
        return; // velocity was set at lunge start
      }
      if (e.mode === 'wind') {
        e.vx = e.vy = 0;
        if (e.timer <= 0) {
          e.mode = 'lunge';
          e.timer = 0.34;
          e.vx = (dx / d) * 3.4;
          e.vy = (dy / d) * 3.4;
        }
        return;
      }
      e.vx = dx / d;
      e.vy = dy / d;
      if (d < 44 && e.timer <= 0) {
        e.mode = 'wind';
        e.timer = 0.3;
      }
    },
  },

  bat: {
    label: 'Keese',
    hp: 2,
    speed: 62,
    radius: 6,
    score: 12,
    contact: 1,
    knockback: 1.6,
    // Fast but wobbles hard, so it's dangerous in packs and whiffy alone.
    think(e, ctx, dt) {
      const t = ctx.nearestPlayer(e);
      e.phase = (e.phase || ctx.rand() * 6) + dt * 7;
      if (!t) {
        e.vx = e.vy = 0;
        return;
      }
      const base = Math.atan2(t.y - e.y, t.x - e.x);
      const ang = base + Math.sin(e.phase) * 0.9;
      e.vx = Math.cos(ang);
      e.vy = Math.sin(ang);
    },
  },

  bones: {
    label: 'Stalfos',
    hp: 10,
    speed: 30,
    radius: 8,
    score: 25,
    contact: 2,
    knockback: 0.35,
    // Slow, heavy, barely flinches. Pauses periodically to telegraph.
    think(e, ctx, dt) {
      const t = ctx.nearestPlayer(e);
      e.timer -= dt;
      if (e.timer <= 0) {
        e.mode = e.mode === 'rest' ? 'chase' : 'rest';
        e.timer = e.mode === 'rest' ? 0.6 : 2.2;
      }
      if (!t || e.mode === 'rest') {
        e.vx = e.vy = 0;
        return;
      }
      const d = Math.hypot(t.x - e.x, t.y - e.y) || 1;
      e.vx = (t.x - e.x) / d;
      e.vy = (t.y - e.y) / d;
    },
  },

  mage: {
    label: 'Taros',
    hp: 6,
    speed: 0,
    radius: 8,
    score: 35,
    contact: 1,
    knockback: 0,
    // Blinks around the arena and fans out three bolts. Never walks.
    think(e, ctx, dt) {
      e.vx = e.vy = 0;
      e.timer -= dt;
      if (e.mode === 'gone') {
        e.alpha = 0.15;
        if (e.timer <= 0) {
          const spot = ctx.randomSpot();
          e.x = spot.x;
          e.y = spot.y;
          e.mode = 'appear';
          e.timer = 0.85;
        }
        return;
      }
      e.alpha = 1;
      if (e.mode === 'appear' && e.timer <= 0) {
        const t = ctx.nearestPlayer(e);
        if (t) {
          const base = Math.atan2(t.y - e.y, t.x - e.x);
          for (const off of [-0.34, 0, 0.34]) {
            ctx.enemyShotAngle(e, base + off, 'bolt', 88, 1);
          }
        }
        e.mode = 'gone';
        e.timer = 1.5 + ctx.rand() * 0.8;
      }
    },
  },

  knight: {
    label: 'Armos Knight',
    hp: 90,
    speed: 34,
    radius: 16,
    score: 400,
    contact: 2,
    knockback: 0,
    boss: true,
    scale: 1.7,
    // Three-beat boss: stalk, charge across the arena, then a shockwave that
    // also summons adds. Readable enough that six players can coordinate.
    think(e, ctx, dt) {
      const t = ctx.nearestPlayer(e);
      e.timer -= dt;

      if (e.mode === 'charge') {
        if (e.timer <= 0) {
          e.mode = 'chase';
          e.timer = 2.6;
          e.vx = e.vy = 0;
        }
        return;
      }
      if (e.mode === 'wind') {
        e.vx = e.vy = 0;
        if (e.timer <= 0 && t) {
          const d = Math.hypot(t.x - e.x, t.y - e.y) || 1;
          e.mode = 'charge';
          e.timer = 0.9;
          e.vx = ((t.x - e.x) / d) * 4.2;
          e.vy = ((t.y - e.y) / d) * 4.2;
          ctx.shake(4);
        }
        return;
      }
      if (e.mode === 'slam') {
        e.vx = e.vy = 0;
        if (e.timer <= 0) {
          ctx.shockwave(e.x, e.y, 78, 2);
          ctx.shake(9);
          const adds = 2 + Math.floor(ctx.wave / 10);
          for (let i = 0; i < adds; i++) ctx.spawnAdd('bat');
          e.mode = 'chase';
          e.timer = 2.8;
        }
        return;
      }

      // chase
      if (!t) {
        e.vx = e.vy = 0;
        return;
      }
      const d = Math.hypot(t.x - e.x, t.y - e.y) || 1;
      e.vx = (t.x - e.x) / d;
      e.vy = (t.y - e.y) / d;
      if (e.timer <= 0) {
        if (d < 60) {
          e.mode = 'slam';
          e.timer = 0.8;
        } else {
          e.mode = 'wind';
          e.timer = 0.6;
        }
      }
    },
  },
};

/**
 * Difficulty curve. Every fifth wave is a boss wave; the roster widens and
 * enemies gain bonus hit points as the run goes on.
 */
export function waveSpec(wave) {
  const isBoss = wave % 5 === 0;
  const budget = 4 + Math.floor(wave * 1.7);
  const pool = [];
  const add = (type, weight) => pool.push({ type, weight });

  add('octo', 10);
  if (wave >= 2) add('grunt', 8 + wave);
  if (wave >= 3) add('bat', 6 + wave);
  if (wave >= 6) add('bones', 4 + wave * 0.6);
  if (wave >= 8) add('mage', 3 + wave * 0.4);

  const total = pool.reduce((s, p) => s + p.weight, 0);
  const counts = {};
  for (let i = 0; i < budget; i++) {
    let r = Math.random() * total;
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) {
        counts[p.type] = (counts[p.type] || 0) + 1;
        break;
      }
    }
  }

  const list = Object.entries(counts).map(([type, count]) => ({ type, count }));
  if (isBoss) list.push({ type: 'knight', count: Math.max(1, Math.floor(wave / 15) + 1) });

  return {
    wave,
    isBoss,
    list,
    // Enemies get tougher and marginally faster; speed is capped so late
    // waves stay about crowd control rather than raw reaction time.
    hpMul: 1 + (wave - 1) * 0.16,
    speedMul: Math.min(1.55, 1 + (wave - 1) * 0.035),
    // Trickle spawns in so a wave arrives as pressure, not a wall.
    spawnInterval: Math.max(0.22, 0.85 - wave * 0.035),
    concurrent: Math.min(22, 6 + Math.floor(wave * 1.1)),
  };
}

export function bossWaveName(wave) {
  return wave % 5 === 0 ? `WAVE ${wave} — ARMOS KNIGHT` : `WAVE ${wave}`;
}
