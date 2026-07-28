// Procedural arena: a walled stone courtyard on grass, baked once to an
// offscreen canvas and blitted every frame.

export const W = 480;
export const H = 288;
export const WALL = 20; // thickness of the impassable border

// Playable bounds (entity centres are clamped inside this rect).
export const BOUNDS = { x0: WALL + 6, y0: WALL + 10, x1: W - WALL - 6, y1: H - WALL - 6 };

// Static obstacles. Circles keep collision cheap and let entities slide.
export const PILLARS = [
  { x: 120, y: 92, r: 13 },
  { x: 360, y: 92, r: 13 },
  { x: 120, y: 208, r: 13 },
  { x: 360, y: 208, r: 13 },
];

// Deterministic noise so the arena looks the same on every host.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let baked = null;

export function arenaCanvas() {
  if (baked) return baked;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const rnd = mulberry32(0x5eed);

  // Grass bed with speckle texture.
  c.fillStyle = '#3f7a33';
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const x = (rnd() * W) | 0;
    const y = (rnd() * H) | 0;
    c.fillStyle = rnd() < 0.5 ? '#478a3a' : '#37692c';
    c.fillRect(x, y, 2, 1);
  }

  // Courtyard floor.
  const fx = WALL;
  const fy = WALL;
  const fw = W - WALL * 2;
  const fh = H - WALL * 2;
  c.fillStyle = '#b9a884';
  c.fillRect(fx, fy, fw, fh);

  // Flagstone grid.
  for (let y = fy; y < fy + fh; y += 16) {
    for (let x = fx; x < fx + fw; x += 16) {
      const v = rnd();
      c.fillStyle = v < 0.33 ? '#c2b18d' : v < 0.66 ? '#b09f7c' : '#bba986';
      c.fillRect(x, y, 15, 15);
      c.fillStyle = 'rgba(90,74,50,0.25)';
      c.fillRect(x, y + 15, 16, 1);
      c.fillRect(x + 15, y, 1, 16);
    }
  }

  // Worn centre ring — gives players a visual anchor for the arena middle.
  c.strokeStyle = 'rgba(120,100,70,0.45)';
  c.lineWidth = 3;
  c.beginPath();
  c.arc(W / 2, H / 2, 58, 0, Math.PI * 2);
  c.stroke();
  c.lineWidth = 1;
  c.beginPath();
  c.arc(W / 2, H / 2, 50, 0, Math.PI * 2);
  c.stroke();

  // Stone border wall, drawn as staggered blocks.
  const drawWallBlock = (x, y, w, h) => {
    c.fillStyle = '#7c7a86';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#9a98a6';
    c.fillRect(x, y, w, 2);
    c.fillStyle = '#4e4c58';
    c.fillRect(x, y + h - 2, w, 2);
    c.fillStyle = 'rgba(30,26,40,0.55)';
    c.fillRect(x + w - 1, y, 1, h);
  };
  for (let x = 0; x < W; x += 20) {
    drawWallBlock(x, 0, 20, WALL);
    drawWallBlock(x + 10 > W ? 0 : x + 10, H - WALL, 20, WALL);
  }
  for (let y = 0; y < H; y += 20) {
    drawWallBlock(0, y, WALL, 20);
    drawWallBlock(W - WALL, y + 10 > H ? 0 : y + 10, WALL, 20);
  }
  // Re-cap the corners so the stagger doesn't leave gaps.
  drawWallBlock(0, 0, WALL, WALL);
  drawWallBlock(W - WALL, 0, WALL, WALL);
  drawWallBlock(0, H - WALL, WALL, WALL);
  drawWallBlock(W - WALL, H - WALL, WALL, WALL);

  // Inner lip so the wall reads as raised.
  c.fillStyle = 'rgba(20,16,28,0.35)';
  c.fillRect(fx, fy, fw, 3);
  c.fillRect(fx, fy, 3, fh);

  // Pillars.
  for (const p of PILLARS) {
    c.fillStyle = 'rgba(20,16,28,0.3)';
    c.beginPath();
    c.ellipse(p.x, p.y + p.r - 2, p.r + 3, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#8d8b98';
    c.beginPath();
    c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#a8a6b4';
    c.beginPath();
    c.arc(p.x - 2, p.y - 3, p.r - 4, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#3a3844';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    c.stroke();
  }

  baked = cv;
  return cv;
}

/** Clamp a position inside the arena and push it out of any pillar. */
export function collide(pos, radius) {
  pos.x = Math.max(BOUNDS.x0 + radius, Math.min(BOUNDS.x1 - radius, pos.x));
  pos.y = Math.max(BOUNDS.y0 + radius, Math.min(BOUNDS.y1 - radius, pos.y));
  for (const p of PILLARS) {
    const dx = pos.x - p.x;
    const dy = pos.y - p.y;
    const min = p.r + radius;
    const d2 = dx * dx + dy * dy;
    if (d2 < min * min && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      pos.x = p.x + (dx / d) * min;
      pos.y = p.y + (dy / d) * min;
    }
  }
  return pos;
}

/** True if a point is blocked — used to keep projectiles from passing pillars. */
export function blocked(x, y) {
  if (x < BOUNDS.x0 || x > BOUNDS.x1 || y < BOUNDS.y0 || y > BOUNDS.y1) return true;
  for (const p of PILLARS) {
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < p.r * p.r) return true;
  }
  return false;
}

/** A spawn point on the arena edge, away from the given avoid-points. */
export function edgeSpawn(rand, avoid = []) {
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < 12; i++) {
    const side = (rand() * 4) | 0;
    let x;
    let y;
    if (side === 0) {
      x = BOUNDS.x0 + rand() * (BOUNDS.x1 - BOUNDS.x0);
      y = BOUNDS.y0 + 4;
    } else if (side === 1) {
      x = BOUNDS.x0 + rand() * (BOUNDS.x1 - BOUNDS.x0);
      y = BOUNDS.y1 - 4;
    } else if (side === 2) {
      x = BOUNDS.x0 + 4;
      y = BOUNDS.y0 + rand() * (BOUNDS.y1 - BOUNDS.y0);
    } else {
      x = BOUNDS.x1 - 4;
      y = BOUNDS.y0 + rand() * (BOUNDS.y1 - BOUNDS.y0);
    }
    let score = Infinity;
    for (const a of avoid) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < score) score = d;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
    if (bestScore > 90) break;
  }
  return best;
}
