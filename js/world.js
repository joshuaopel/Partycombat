// Procedural overworld: an island built from real Light World terrain tiles
// and Overworld Tiles props.
//
// Generation is deterministic from a seed, so the host and every phone build
// an identical world from the four bytes the host sends on join — no map data
// crosses the wire. The whole thing is baked once to an offscreen canvas and
// blitted per camera.

const SHEET_URL = new URL('../assets/world.png', import.meta.url);
const META_URL = new URL('../assets/world.json', import.meta.url);

export const TILE = 16;
export const WORLD_W = 2400; // ~5 screens across
export const WORLD_H = 1440;
export const TILES_X = WORLD_W / TILE;
export const TILES_Y = WORLD_H / TILE;

// Terrain kinds. Water is the only impassable ground.
export const GRASS = 0;
export const SAND = 1;
export const DIRT = 2;
export const WATER = 3;
const KIND_NAMES = ['grass', 'sand', 'dirt', 'water'];

// Prop gameplay data lives here rather than in the art metadata, so a world
// can be generated (and collided against) before any image has loaded.
// world.json only supplies where each prop sits on the sheet.
// r     blocking radius, sized to the prop's base rather than its canopy — you
//       walk behind a tree's leaves, not through its trunk.
// foot  pixels the sprite's bottom edge sits below the prop's ground line.
// gap   minimum centre-to-centre distance to any other prop, so canopies read
//       as separate trees instead of a green smear.
const PROP_DEFS = {
  tree_green: { r: 22, foot: 2, gap: 60 },
  tree_amber: { r: 22, foot: 2, gap: 60 },
  tree_red: { r: 22, foot: 2, gap: 60 },
  boulder: { r: 18, foot: 2, gap: 48 },
  bush: { r: 9, foot: 2, gap: 24 },
  stump: { r: 7, foot: 2, gap: 20 },
  rock: { r: 7, foot: 2, gap: 20 },
  flower: { r: 0, foot: 2, gap: 18 },
  sprout: { r: 0, foot: 2, gap: 18 },
};

let sheet = null;
let meta = null;
let loading = null;

export function loadWorldArt() {
  if (loading) return loading;
  loading = Promise.all([
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load assets/world.png'));
      img.src = SHEET_URL;
    }),
    fetch(META_URL).then((r) => {
      if (!r.ok) throw new Error('Could not load assets/world.json');
      return r.json();
    }),
  ]).then(([img, m]) => {
    sheet = img;
    meta = m;
    return true;
  });
  return loading;
}

export const worldArtReady = () => sheet !== null;

// ------------------------------------------------------------------- noise

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bilinear value noise over a coarse random lattice. */
function valueNoise(seed, cell) {
  const rnd = mulberry32(seed);
  const gw = Math.ceil(TILES_X / cell) + 2;
  const gh = Math.ceil(TILES_Y / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const smooth = (t) => t * t * (3 - 2 * t);
  return (tx, ty) => {
    const fx = tx / cell;
    const fy = ty / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const sx = smooth(fx - x0);
    const sy = smooth(fy - y0);
    const i = (x, y) => g[Math.min(gh - 1, y) * gw + Math.min(gw - 1, x)];
    const a = i(x0, y0);
    const b = i(x0 + 1, y0);
    const c = i(x0, y0 + 1);
    const d = i(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}

// -------------------------------------------------------------- generation

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.w = WORLD_W;
    this.h = WORLD_H;
    this.kind = new Uint8Array(TILES_X * TILES_Y);
    this.variant = new Uint8Array(TILES_X * TILES_Y);
    this.props = [];
    this.canvas = null;
    this._grid = null;
    this.generate();
  }

  generate() {
    const rnd = mulberry32(this.seed ^ 0x9e37);
    const elev = valueNoise(this.seed + 1, 11);
    const moist = valueNoise(this.seed + 2, 7);
    const forest = valueNoise(this.seed + 3, 5);

    for (let ty = 0; ty < TILES_Y; ty++) {
      for (let tx = 0; tx < TILES_X; tx++) {
        const i = ty * TILES_X + tx;
        // Push the edges under water so the map is a bounded island.
        const ex = Math.min(tx, TILES_X - 1 - tx) / 10;
        const ey = Math.min(ty, TILES_Y - 1 - ty) / 7;
        const edge = Math.min(1, Math.min(ex, ey));
        // A little per-tile jitter breaks the terrain boundaries into a
        // stipple, which reads far better than a hard 16px staircase.
        const j = (rnd() - 0.5) * 0.06;
        const e = elev(tx, ty) * 0.55 + edge * 0.55 + j;

        let k;
        if (e < 0.32) k = WATER;
        else if (e < 0.40) k = SAND;
        else if (moist(tx, ty) + j < 0.3) k = DIRT;
        else k = GRASS;

        this.kind[i] = k;
        // Keep the plain tile dominant: an even mix of grass variants reads as
        // a mown checkerboard rather than a field.
        this.variant[i] = rnd() < 0.88 ? 0 : 1 + ((rnd() * 4) | 0);
      }
    }

    // Props sit on grass only — they carry a grass backing from the sheet.
    const place = (name, chance, test) => {
      for (let ty = 2; ty < TILES_Y - 2; ty++) {
        for (let tx = 2; tx < TILES_X - 2; tx++) {
          const i = ty * TILES_X + tx;
          if (this.kind[i] !== GRASS) continue;
          if (rnd() > chance) continue;
          if (test && !test(tx, ty)) continue;
          const x = tx * TILE + TILE / 2;
          const y = ty * TILE + TILE / 2;
          const def = PROP_DEFS[name];
          // Honour the larger of the two gaps so a bush can't tuck under a
          // canopy, and two trees never overlap.
          if (this.props.some((p) => {
            const gap = Math.max(def.gap, PROP_DEFS[p.name].gap);
            return Math.hypot(p.x - x, p.y - y) < gap;
          })) continue;
          this.props.push({ name, x, y, r: def.r, foot: def.foot });
        }
      }
    };

    // Trees clump into woods where the forest field is high.
    place('tree_green', 0.07, (tx, ty) => forest(tx, ty) > 0.58);
    place('tree_amber', 0.022, (tx, ty) => forest(tx, ty) > 0.62);
    place('tree_red', 0.015, (tx, ty) => forest(tx, ty) > 0.64);
    place('boulder', 0.012, (tx, ty) => forest(tx, ty) < 0.42);
    place('bush', 0.02);
    place('rock', 0.012);
    place('stump', 0.008);
    place('flower', 0.02);
    place('sprout', 0.02);

    this.buildGrid();
  }

  /** Bucket blocking props so collision only tests what is nearby. */
  buildGrid() {
    const CELL = 64;
    const gw = Math.ceil(this.w / CELL);
    const gh = Math.ceil(this.h / CELL);
    const grid = Array.from({ length: gw * gh }, () => []);
    for (const p of this.props) {
      if (!p.r) continue;
      const x0 = Math.max(0, Math.floor((p.x - p.r) / CELL));
      const x1 = Math.min(gw - 1, Math.floor((p.x + p.r) / CELL));
      const y0 = Math.max(0, Math.floor((p.y - p.r) / CELL));
      const y1 = Math.min(gh - 1, Math.floor((p.y + p.r) / CELL));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) grid[y * gw + x].push(p);
      }
    }
    this._grid = { grid, gw, gh, CELL };

    // Props are drawn per frame (so entities can sort against them), so they
    // also need an index that includes the non-blocking decoration.
    const RCELL = 128;
    const rw = Math.ceil(this.w / RCELL);
    const rh = Math.ceil(this.h / RCELL);
    const rgrid = Array.from({ length: rw * rh }, () => []);
    for (const p of this.props) {
      const gx = Math.min(rw - 1, Math.floor(p.x / RCELL));
      const gy = Math.min(rh - 1, Math.floor(p.y / RCELL));
      rgrid[gy * rw + gx].push(p);
    }
    this._draw = { rgrid, rw, rh, RCELL };
  }

  /** Props whose base falls inside a rect, for the visible-camera draw pass. */
  propsIn(x0, y0, x1, y1) {
    const { rgrid, rw, rh, RCELL } = this._draw;
    const gx0 = Math.max(0, Math.floor(x0 / RCELL));
    const gx1 = Math.min(rw - 1, Math.floor(x1 / RCELL));
    const gy0 = Math.max(0, Math.floor(y0 / RCELL));
    const gy1 = Math.min(rh - 1, Math.floor(y1 / RCELL));
    const out = [];
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        for (const p of rgrid[gy * rw + gx]) out.push(p);
      }
    }
    return out;
  }

  /** Atlas rect for a prop, or null before the art has loaded. */
  propRect(name) {
    return meta ? meta.props[name].rect : null;
  }

  get sheet() {
    return sheet;
  }

  nearbyProps(x, y) {
    const { grid, gw, gh, CELL } = this._grid;
    const gx = Math.max(0, Math.min(gw - 1, Math.floor(x / CELL)));
    const gy = Math.max(0, Math.min(gh - 1, Math.floor(y / CELL)));
    return grid[gy * gw + gx];
  }

  kindAt(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= TILES_X || ty >= TILES_Y) return WATER;
    return this.kind[ty * TILES_X + tx];
  }

  /** True if a point can't be occupied — water or off the map. */
  blocked(x, y) {
    if (this.kindAt(x, y) === WATER) return true;
    for (const p of this.nearbyProps(x, y)) {
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy < p.r * p.r) return true;
    }
    return false;
  }

  /** True if a body of `radius` centred here would overlap water. */
  inWater(x, y, radius) {
    const r = radius * 0.6;
    return (
      this.kindAt(x, y) === WATER ||
      this.kindAt(x - r, y) === WATER ||
      this.kindAt(x + r, y) === WATER ||
      this.kindAt(x, y - r) === WATER ||
      this.kindAt(x, y + r) === WATER
    );
  }

  /**
   * Move a body by (dx, dy), resolving each axis separately so it slides along
   * a shoreline or a tree instead of sticking. Mutates and returns pos.
   */
  move(pos, dx, dy, radius) {
    if (dx) {
      const nx = pos.x + dx;
      if (!this.inWater(nx, pos.y, radius)) pos.x = nx;
    }
    if (dy) {
      const ny = pos.y + dy;
      if (!this.inWater(pos.x, ny, radius)) pos.y = ny;
    }
    return this.collide(pos, radius);
  }

  /** Clamp inside the map and push out of solid props. */
  collide(pos, radius) {
    pos.x = Math.max(radius, Math.min(this.w - radius, pos.x));
    pos.y = Math.max(radius, Math.min(this.h - radius, pos.y));

    for (const p of this.nearbyProps(pos.x, pos.y)) {
      let dx = pos.x - p.x;
      let dy = pos.y - p.y;
      const min = p.r + radius * 0.7;
      let d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      if (d2 < 0.0001) {
        // Dead centre: no meaningful normal, so pick one.
        dx = 1;
        dy = 0;
        d2 = 1;
      }
      const d = Math.sqrt(d2);
      pos.x = p.x + (dx / d) * min;
      pos.y = p.y + (dy / d) * min;
    }

    // If a push landed the body in water, walk it back to dry ground.
    if (this.inWater(pos.x, pos.y, radius)) {
      const step = TILE * 0.75;
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        for (const m of [1, 2, 3]) {
          const x = pos.x + Math.cos(a) * step * m;
          const y = pos.y + Math.sin(a) * step * m;
          if (this.inWater(x, y, radius)) continue;
          const d = step * m;
          if (d < bestD) {
            bestD = d;
            best = { x, y };
          }
        }
        if (best) break;
      }
      if (best) {
        pos.x = best.x;
        pos.y = best.y;
      }
    }
    return pos;
  }

  /** A walkable point, biased away from the given avoid-points. */
  openSpot(rand, avoid = [], minDist = 0, tries = 60) {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < tries; i++) {
      const x = 40 + rand() * (this.w - 80);
      const y = 40 + rand() * (this.h - 80);
      if (this.blocked(x, y)) continue;
      let score = Infinity;
      for (const a of avoid) score = Math.min(score, Math.hypot(a.x - x, a.y - y));
      if (!avoid.length) score = 1e9;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
      if (bestScore > minDist && minDist) break;
    }
    return best || { x: this.w / 2, y: this.h / 2 };
  }

  /** A walkable point in a ring around a target — used for wave spawns. */
  spawnNear(rand, targets, min = 190, max = 300) {
    const t = targets.length ? targets[(rand() * targets.length) | 0] : { x: this.w / 2, y: this.h / 2 };
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2;
      const d = min + rand() * (max - min);
      const x = t.x + Math.cos(a) * d;
      const y = t.y + Math.sin(a) * d;
      if (x < 24 || y < 24 || x > this.w - 24 || y > this.h - 24) continue;
      if (!this.blocked(x, y)) return { x, y };
    }
    return this.openSpot(rand, targets);
  }

  // ----------------------------------------------------------------- bake

  /**
   * Bake the ground only; cameras blit sub-rects of this. Props are drawn per
   * frame instead, so entities can depth-sort against them and walk behind a
   * tree's canopy rather than over it.
   */
  bake() {
    if (this.canvas) return this.canvas;
    if (!sheet) throw new Error('loadWorldArt() must resolve before baking the world');
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;

    for (let ty = 0; ty < TILES_Y; ty++) {
      for (let tx = 0; tx < TILES_X; tx++) {
        const i = ty * TILES_X + tx;
        const rects = meta.ground[KIND_NAMES[this.kind[i]]];
        const r = rects[this.variant[i] % rects.length];
        c.drawImage(sheet, r[0], r[1], r[2], r[3], tx * TILE, ty * TILE, TILE, TILE);
      }
    }

    this.canvas = cv;
    return cv;
  }

  /** Small overview image for the host's minimap. */
  minimap(scale = 1 / 12) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(this.w * scale);
    cv.height = Math.round(this.h * scale);
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(this.bake(), 0, 0, cv.width, cv.height);
    // Woods aren't in the ground bake any more, so dot them in — they are the
    // main landmark for reading the island at a glance.
    c.fillStyle = 'rgba(20,60,25,0.85)';
    for (const p of this.props) {
      if (p.r < 12) continue;
      c.fillRect(p.x * scale - 1, p.y * scale - 1, 2, 2);
    }
    return cv;
  }
}

export function propMeta() {
  return meta ? meta.props : {};
}
