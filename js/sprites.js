// Original ALTTP-style pixel art, authored as indexed-colour character grids.
// Each character maps to a palette entry; swapping the 't'/'T' entries recolours
// a hero's cap and tunic without touching skin, hair or boots.

export const PAL = {
  '.': null,
  o: '#1a1420', // hard outline
  s: '#f8c89c', // skin
  d: '#c98a5e', // skin shadow
  h: '#f2d04a', // hair
  H: '#b8921f', // hair shadow
  t: '#4fbf5a', // tunic (overridden per player)
  T: '#2a7a35', // tunic shadow (overridden per player)
  b: '#7a4a1e', // leather
  B: '#4d2c10', // leather shadow
  w: '#ffffff',
  m: '#d8dee9', // steel
  M: '#8b95a6', // steel shadow
  K: '#15151a',
  k: '#2b2b33',
  e: '#e8e4d8', // bone
  E: '#b3ae9c', // bone shadow
  r: '#e2453c',
  R: '#8f1f1c',
  g: '#3fa34d',
  G: '#20642c',
  u: '#4a7fd4',
  U: '#26467f',
  p: '#a05fd0',
  P: '#5c2f80',
  y: '#ffd24a',
  n: '#8a5a2b',
  x: '#8a8a96', // stone
  X: '#5a5a66',
};

export const PLAYER_COLORS = [
  { name: 'Green', t: '#4fbf5a', T: '#2a7a35' },
  { name: 'Red', t: '#e2564a', T: '#8f2a22' },
  { name: 'Blue', t: '#4f8fe0', T: '#25508f' },
  { name: 'Violet', t: '#a763d8', T: '#5f3388' },
  { name: 'Amber', t: '#f0973a', T: '#a1581a' },
  { name: 'Teal', t: '#43cfc4', T: '#1d7b74' },
];

// ---------------------------------------------------------------- hero frames

const HERO_DOWN = [
  '....oooooooo....',
  '...oTttttttTo...',
  '..oTttttttttTo..',
  '..ohhhhhhhhhho..',
  '..ohssssssssho..',
  '..ohsowsswosho..',
  '..ohssssssssho..',
  '..oddssssssddo..',
  '...oddddddddo...',
  '...otttttttto...',
  '..osTttttttTso..',
  '..osTttttttTso..',
  '...oTttbbttTo...',
  '...oTttttttTo...',
  '....obbbbbbo....',
  '....oBBooBBo....',
];

const HERO_UP = [
  '....oooooooo....',
  '...oTttttttTo...',
  '..oTttttttttTo..',
  '..oTttttttttTo..',
  '..oThhhhhhhhTo..',
  '..ohhhhhhhhhho..',
  '..ohHhhhhhhHho..',
  '..oHHhhhhhhHHo..',
  '...oHHHHHHHHo...',
  '...otttttttto...',
  '..osTttttttTso..',
  '..osTttttttTso..',
  '...oTttbbttTo...',
  '...oTttttttTo...',
  '....obbbbbbo....',
  '....oBBooBBo....',
];

// Side view faces right; the renderer mirrors it for left.
const HERO_SIDE = [
  '....oooooooo....',
  '...oTttttttTo...',
  '..oTtttttttto...',
  '..ohhhhhhssso...',
  '..ohhhhhsssso...',
  '..ohhhhsowsso...',
  '..ohhhhssssso...',
  '..oHHhdsssso....',
  '...oHHddddo.....',
  '...ottttttto....',
  '..otttttttso....',
  '..oTtttttto.....',
  '...oTtbbtTo.....',
  '...oTttttTo.....',
  '...obbbbbo......',
  '...oBBoBBo......',
];

// Walk cycles only differ in the two boot rows, so derive them. This keeps the
// frames guaranteed consistent with the idle pose above.
const legs = (base, r14, r15) => base.map((row, i) => (i === 14 ? r14 : i === 15 ? r15 : row));

const FRONT_STEP_A = ['...obbbo.obbo...', '...oBBo...oBo...'];
const FRONT_STEP_B = ['...obbo.obbbo...', '...oBo...oBBo...'];
const SIDE_STEP_A = ['..obbbo.obbo....', '..oBBo...oBo....'];
const SIDE_STEP_B = ['...obbo.obbbo...', '...oBo...oBBo...'];

const HERO = {
  down: [HERO_DOWN, legs(HERO_DOWN, ...FRONT_STEP_A), legs(HERO_DOWN, ...FRONT_STEP_B)],
  up: [HERO_UP, legs(HERO_UP, ...FRONT_STEP_A), legs(HERO_UP, ...FRONT_STEP_B)],
  side: [HERO_SIDE, legs(HERO_SIDE, ...SIDE_STEP_A), legs(HERO_SIDE, ...SIDE_STEP_B)],
};

// Drawn pointing up; the renderer rotates it to swing through an arc.
const SWORD = [
  '..mo..',
  '.mmo..',
  '.mMo..',
  '.mMo..',
  '.mMo..',
  '.mMo..',
  '.mMo..',
  '.mMo..',
  'oyyyyo',
  '.oyyo.',
  '..nn..',
  '..nn..',
  '.onno.',
  '..oo..',
];

// -------------------------------------------------------------- enemy frames

const ENEMY_ART = {
  octo: [
    '......oooo......',
    '....oorrrroo....',
    '...orrrrrrrro...',
    '..orrrrrrrrrro..',
    '..orrwrrrrwrro..',
    '..orrorrrrorro..',
    '..orrrroorrrro..',
    '..orrrroorrrro..',
    '..oRrrrrrrrrRo..',
    '...oRRrrrrRRo...',
    '....oRRRRRRo....',
    '...oRo.oo.oRo...',
    '...oRo.oo.oRo...',
    '..oRRo....oRRo..',
    '..oooo....oooo..',
    '................',
  ],
  grunt: [
    '.....oooooo.....',
    '....oMmmmmMo....',
    '...oMmmmmmmMo...',
    '...oMooooooMo...',
    '...okkrkkrkko...',
    '...okkkkkkkko...',
    '....oMMMMMMo....',
    '..ouuuUUuuuuo...',
    '..ouuuuuuuuuuo..',
    '..ouUuuuuuuUuo..',
    '..ouUuuuuuuUuo..',
    '...oUuuuuuuUo...',
    '...oUuuUUuuUo...',
    '...oBBo..oBBo...',
    '...oBBo..oBBo...',
    '...oooo..oooo...',
  ],
  bat: [
    '................',
    '..oo........oo..',
    '.okko......okko.',
    '.okkko....okkko.',
    '.okkkkkookkkkko.',
    '..okkkkkkkkkko..',
    '...okkrkkrkko...',
    '...okkkkkkkko...',
    '....okkkkkko....',
    '.....okkkko.....',
    '......oooo......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  bones: [
    '.....oooooo.....',
    '....oeeeeeeo....',
    '...oeeeeeeeeo...',
    '...oeokeekoeo...',
    '...oeeeeeeeeo...',
    '....oekekeko....',
    '.....oeeeeo.....',
    '..oeeoEEEEoeeo..',
    '..oeeoEeeEoeeo..',
    '..oeeoEEEEoeeo..',
    '...oooEeeEooo...',
    '.....oEEEEo.....',
    '....oEEooEEo....',
    '....oeo..oeo....',
    '....oeo..oeo....',
    '...oeeo..oeeo...',
  ],
  mage: [
    '......oooo......',
    '....oopppppoo...',
    '...oppppppppo...',
    '..opppppppppo...',
    '..oPPPPPPPPPPo..',
    '..oPkkkkkkkkPo..',
    '..oPkykkykkPo...',
    '..oPkkkkkkkkPo..',
    '...oppppppppo...',
    '..opppppppppo...',
    '..oPppppppppPo..',
    '.oPppppppppppPo.',
    '.oPppppppppppPo.',
    'oPPppppppppppPPo',
    'oPPPPPPPPPPPPPPo',
    '.oooooooooooooo.',
  ],
  knight: [
    '..oo........oo..',
    '.oyyo......oyyo.',
    '.oyyoMMMMMMoyyo.',
    '..ooMMMMMMMMoo..',
    '...oMMMMMMMMo...',
    '...oMkkrrkkMo...',
    '...oMkkkkkkMo...',
    '...oMMMMMMMMo...',
    '..oMMoyyyyoMMo..',
    '.oMMMoyyyyoMMMo.',
    '.oMMMMKKKKMMMMo.',
    '.oMMMKKKKKKMMMo.',
    '..oMMKKKKKKMMo..',
    '..oMMoKKKKoMMo..',
    '...oMoKKKKoMo...',
    '...oMMo..oMMo...',
  ],
};

// ------------------------------------------------------- props & projectiles

const PROP_ART = {
  heart: [
    '.oo..oo.',
    'orroorro',
    'orrrrrro',
    'orrrrrro',
    '.orrrro.',
    '..orro..',
    '...oo...',
    '........',
  ],
  rupee: [
    '...oo...',
    '..oggo..',
    '.oggggo.',
    'oggggggo',
    'oggggggo',
    '.oggggo.',
    '..oggo..',
    '...oo...',
  ],
  rock: [
    '..oooo..',
    '.oxxxxo.',
    'oxxxxxxo',
    'oxxXXxxo',
    'oxxXXxxo',
    'oxxxxxxo',
    '.oxxxxo.',
    '..oooo..',
  ],
  bolt: [
    '..oooo..',
    '.opppo..',
    'oppwwppo',
    'oppwwppo',
    'oppppppo',
    '.oppppo.',
    '..oooo..',
    '........',
  ],
  spark: [
    '...oo...',
    '..oyyo..',
    '.oywwyo.',
    'oywwwwyo',
    'oywwwwyo',
    '.oywwyo.',
    '..oyyo..',
    '...oo...',
  ],
};

// ------------------------------------------------------------------ renderer

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rasterise a character grid into an offscreen canvas at 1 pixel per cell. */
function rasterise(rows, overrides = {}) {
  const w = rows[0].length;
  const h = rows.length;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const palette = { ...PAL, ...overrides };
  const cache = {};

  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const hex = palette[ch];
      if (!hex) continue;
      const rgb = cache[ch] || (cache[ch] = hexToRgb(hex));
      const i = (y * w + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Desaturate a rendered canvas — used for knocked-down heroes. */
function toGrey(src) {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    const l = (img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11) * 0.75;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = l;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

const heroCache = new Map();
const enemyCache = new Map();
const propCache = new Map();

export function heroSheet(slot) {
  if (heroCache.has(slot)) return heroCache.get(slot);
  const c = PLAYER_COLORS[slot % PLAYER_COLORS.length];
  const over = { t: c.t, T: c.T };
  const sheet = {
    down: HERO.down.map((f) => rasterise(f, over)),
    up: HERO.up.map((f) => rasterise(f, over)),
    side: HERO.side.map((f) => rasterise(f, over)),
    color: c,
  };
  sheet.downed = { down: sheet.down.map(toGrey), up: sheet.up.map(toGrey), side: sheet.side.map(toGrey) };
  heroCache.set(slot, sheet);
  return sheet;
}

export function enemySprite(type) {
  if (enemyCache.has(type)) return enemyCache.get(type);
  const art = ENEMY_ART[type] || ENEMY_ART.grunt;
  const cv = rasterise(art);
  enemyCache.set(type, cv);
  return cv;
}

export function prop(name) {
  if (propCache.has(name)) return propCache.get(name);
  const cv = rasterise(PROP_ART[name]);
  propCache.set(name, cv);
  return cv;
}

let swordCanvas = null;
export function swordSprite() {
  if (!swordCanvas) swordCanvas = rasterise(SWORD);
  return swordCanvas;
}

/** Draw a sprite centred on (x, y) in logical pixels. */
export function drawSprite(ctx, cv, x, y, { flip = false, alpha = 1, tint = null } = {}) {
  const hw = cv.width / 2;
  const hh = cv.height / 2;
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(cv, -hw, -hh);
  if (tint) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = tint;
    ctx.fillRect(-hw, -hh, cv.width, cv.height);
  }
  ctx.restore();
}

/** Draw the sword rotated about the hero's hand for the slash arc. */
export function drawSword(ctx, x, y, angle, alpha = 1) {
  const cv = swordSprite();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  // Pivot at the grip (near the bottom of the sprite), blade pointing "up".
  ctx.drawImage(cv, -cv.width / 2, -cv.height + 3);
  ctx.restore();
}

export const SPRITE_SOURCES = { HERO, ENEMY_ART, PROP_ART, SWORD };
