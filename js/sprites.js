// Sprite loading, palette swapping and drawing.
//
// Art comes from a small atlas (assets/sprites.png) built by tools/build_atlas.py
// from A Link to the Past reference sheets — only the frames this game actually
// draws. Heroes are recoloured at load time by remapping the five palette
// entries that the game itself swaps between green, blue and red mail.

const ATLAS_URL = new URL('../assets/sprites.png', import.meta.url);
const META_URL = new URL('../assets/sprites.json', import.meta.url);

// The five mail palette entries, in the order the ramps below use:
// [cap dark, tunic light, cap light, tunic dark, strap]
const MAIL_KEYS = ['509010', '40d870', '78b820', '389068', '885828'];

// Green, blue and red are the game's own mail palettes. The other three follow
// the same structure — a contrasting cap accent over a distinct tunic — so six
// players stay tellable apart at a glance.
export const PLAYER_COLORS = [
  { name: 'Green', ramp: ['509010', '40d870', '78b820', '389068', '885828'] },
  { name: 'Blue', ramp: ['c0a848', '88a0e8', 'f8d880', '0060d0', 'c86020'] },
  { name: 'Red', ramp: ['9878d8', 'f05888', 'c8a8f8', 'b81020', '388840'] },
  { name: 'Violet', ramp: ['3f8f7f', 'c88ae8', '7fd8c8', '6b28a8', 'b8862f'] },
  { name: 'Amber', ramp: ['3a5fa8', 'ffc060', '7fa8e8', 'c85a10', '6a8f30'] },
  { name: 'Cyan', ramp: ['b85040', '60e0e0', 'f09080', '127a90', 'c8a030'] },
].map((c) => ({
  ...c,
  // Tunic light reads as the player's colour in UI chrome and name tags.
  t: `#${c.ramp[1]}`,
  T: `#${c.ramp[3]}`,
}));

let atlas = null;
let meta = null;
let loading = null;

/** Load the atlas + metadata. Safe to call repeatedly; resolves once. */
export function loadSprites() {
  if (loading) return loading;
  loading = Promise.all([
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load assets/sprites.png'));
      img.src = ATLAS_URL;
    }),
    fetch(META_URL).then((r) => {
      if (!r.ok) throw new Error('Could not load assets/sprites.json');
      return r.json();
    }),
  ]).then(([img, m]) => {
    atlas = img;
    meta = m;
    return true;
  });
  return loading;
}

export const spritesReady = () => atlas !== null;

function canvasOf(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

/** Cut one atlas rect into its own canvas. */
function slice(rect) {
  const [x, y, w, h] = rect;
  const cv = canvasOf(w, h);
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(atlas, x, y, w, h, 0, 0, w, h);
  return cv;
}

const hex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];

/** Remap the mail palette entries in place. */
function recolour(cv, ramp) {
  const c = cv.getContext('2d');
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  const from = MAIL_KEYS.map(hex);
  const to = ramp.map(hex);
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    for (let k = 0; k < from.length; k++) {
      if (d[i] === from[k][0] && d[i + 1] === from[k][1] && d[i + 2] === from[k][2]) {
        d[i] = to[k][0];
        d[i + 1] = to[k][1];
        d[i + 2] = to[k][2];
        break;
      }
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

function toGrey(src) {
  const cv = canvasOf(src.width, src.height);
  const c = cv.getContext('2d');
  c.drawImage(src, 0, 0);
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * 0.75;
    d[i] = d[i + 1] = d[i + 2] = l;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

const heroCache = new Map();
const enemyCache = new Map();

export function heroSheet(slot) {
  if (heroCache.has(slot)) return heroCache.get(slot);
  const colour = PLAYER_COLORS[slot % PLAYER_COLORS.length];
  const cut = (group) => meta.frames[group].map((r) => recolour(slice(r), colour.ramp));
  const sheet = {
    down: cut('hero_down'),
    side: cut('hero_side'),
    up: cut('hero_up'),
    color: colour,
    // Frames are foot-anchored: the ground line sits `foot` pixels down.
    foot: meta.hero.foot,
  };
  sheet.downed = {
    down: sheet.down.map(toGrey),
    side: sheet.side.map(toGrey),
    up: sheet.up.map(toGrey),
  };
  heroCache.set(slot, sheet);
  return sheet;
}

/** All frames for an enemy type, bottom-anchored. */
export function enemyFrames(type) {
  if (enemyCache.has(type)) return enemyCache.get(type);
  const group = meta.enemies[type] || meta.enemies.grunt;
  const frames = meta.frames[group].map(slice);
  enemyCache.set(type, frames);
  return frames;
}

export function enemySprite(type, frame = 0) {
  const f = enemyFrames(type);
  return f[frame % f.length];
}

// ---------------------------------------------------------- hand-drawn props
// Pickups, projectiles and the swing sword stay as small original pixel art —
// they are icons rather than characters, and authoring them keeps the atlas
// to just the frames that need to be authentic.

const PAL = {
  '.': null, o: '#1a1420', w: '#ffffff', m: '#d8dee9', M: '#8b95a6',
  r: '#e2453c', R: '#8f1f1c', g: '#3fa34d', y: '#ffd24a', n: '#8a5a2b',
  p: '#a05fd0', x: '#8a8a96', X: '#5a5a66', f: '#ff7a2a', c: '#8fe3ff',
};

const PROP_ART = {
  heart: ['.oo..oo.', 'orroorro', 'orrrrrro', 'orrrrrro', '.orrrro.', '..orro..', '...oo...', '........'],
  rupee: ['...oo...', '..oggo..', '.oggggo.', 'oggggggo', 'oggggggo', '.oggggo.', '..oggo..', '...oo...'],
  rock: ['..oooo..', '.oxxxxo.', 'oxxxxxxo', 'oxxXXxxo', 'oxxXXxxo', 'oxxxxxxo', '.oxxxxo.', '..oooo..'],
  bolt: ['..oooo..', '.opppo..', 'oppwwppo', 'oppwwppo', 'oppppppo', '.oppppo.', '..oooo..', '........'],
  spark: ['...oo...', '..oyyo..', '.oywwyo.', 'oywwwwyo', 'oywwwwyo', '.oywwyo.', '..oyyo..', '...oo...'],

  // Weapon pickups. Icons rather than characters, so they read at a glance
  // from across a 5x5-screen island.
  master: ['...oo...', '..owmo..', '..owmo..', '..owmo..', '.oyyyyo.', '..onno..', '..onno..', '...oo...'],
  bow: ['..oo....', '.onno...', 'onno.m..', 'ono..m..', 'ono..m..', 'onno.m..', '.onno...', '..oo....'],
  rod: ['.....oo.', '....orro', '....orro', '...onno.', '..onno..', '.onno...', 'onno....', 'oo......'],
};

// Projectiles drawn pointing right; the renderer rotates them to travel.
const SHOT_ART = {
  arrow: ['........', '.....o..', '..o..mo.', 'onnnnmmo', '..o..mo.', '.....o..', '........', '........'],
  beam: ['........', '...oo...', '..occo..', 'occwwcco', '..occo..', '...oo...', '........', '........'],
  // A bent L rather than a straight bar — a diagonal stick reads as a stick no
  // matter how fast it spins.
  rang: ['ooo.....', 'onyo....', 'onyo....', 'onyo....', 'onyooooo', 'onyyyyyo', 'onnnnnno', '.oooooo.'],
  fire: ['..oooo..', '.offyfo.', 'offywyfo', 'ofywwyfo', 'offywyfo', '.offyfo.', '..oooo..', '........'],
};
Object.assign(PROP_ART, SHOT_ART);
// The boomerang's pickup icon and its in-flight sprite are the same object.
PROP_ART.rang = SHOT_ART.rang;

/** Shots that read as pointing somewhere, so the renderer should rotate them. */
export const AIMED_SHOTS = new Set(['arrow', 'beam', 'rang']);

const SWORD = [
  '..mo..', '.mmo..', '.mMo..', '.mMo..', '.mMo..', '.mMo..', '.mMo..',
  '.mMo..', 'oyyyyo', '.oyyo.', '..nn..', '..nn..', '.onno.', '..oo..',
];

function rasterise(rows) {
  const w = rows[0].length;
  const h = rows.length;
  const cv = canvasOf(w, h);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = PAL[rows[y][x]];
      if (!col) continue;
      const [r, g, b] = hex(col.slice(1));
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

const propCache = new Map();
export function prop(name) {
  if (!propCache.has(name)) propCache.set(name, rasterise(PROP_ART[name]));
  return propCache.get(name);
}

let swordCanvas = null;
export function swordSprite() {
  if (!swordCanvas) swordCanvas = rasterise(SWORD);
  return swordCanvas;
}

// ------------------------------------------------------------------ drawing

/** Draw a sprite centred on (x, y). */
export function drawSprite(ctx, cv, x, y, { flip = false, alpha = 1, tint = null } = {}) {
  drawAt(ctx, cv, x, y, cv.height / 2, { flip, alpha, tint });
}

/**
 * Draw a sprite so that the row `anchor` pixels from its top lands on y —
 * used to stand characters on a ground line regardless of frame height.
 */
export function drawAt(ctx, cv, x, y, anchor, { flip = false, alpha = 1, tint = null } = {}) {
  const hw = cv.width / 2;
  const src = tint ? tinted(cv, tint) : cv;
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);
  // The scratch canvas can be bigger than the sprite, so blit just its corner.
  ctx.drawImage(src, 0, 0, cv.width, cv.height, -hw, -anchor, cv.width, cv.height);
  ctx.restore();
}

/**
 * A tinted copy of a sprite, for hit flashes and boss wind-ups.
 *
 * This has to happen on a canvas holding nothing but the sprite. Compositing
 * `source-atop` straight onto the scene tints every opaque pixel already under
 * the fill rect — which is the whole ground — so a flashing enemy came out as a
 * solid rectangle of colour rather than a white silhouette.
 */
let scratch = null;
function tinted(cv, tint) {
  if (!scratch || scratch.width < cv.width || scratch.height < cv.height) {
    scratch = canvasOf(Math.max(cv.width, scratch ? scratch.width : 0),
                       Math.max(cv.height, scratch ? scratch.height : 0));
  }
  const c = scratch.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, scratch.width, scratch.height);
  c.drawImage(cv, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = tint;
  c.fillRect(0, 0, cv.width, cv.height);
  c.globalCompositeOperation = 'source-over';
  return scratch;
}

/** Draw a character standing on the ground line at (x, groundY). */
export function drawGrounded(ctx, cv, x, groundY, opts) {
  drawAt(ctx, cv, x, groundY, cv.height, opts);
}

/** Draw the sword rotated about the hero's hand for the slash arc. */
export function drawSword(ctx, x, y, angle, alpha = 1) {
  const cv = swordSprite();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  ctx.drawImage(cv, -cv.width / 2, -cv.height + 3);
  ctx.restore();
}
