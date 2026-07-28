"""Slice the individual frames Partycombat needs out of the reference sheets
and pack them into one small atlas + JSON metadata.

Only the frames the game actually draws are emitted — the source sheets
themselves are not redistributed.
"""
from PIL import Image
import numpy as np, json, os
from scipy import ndimage

SRC = os.path.dirname(os.path.abspath(__file__))
# Source sheets are not in the repo; point PCBT_SHEETS at wherever you
# downloaded them (defaults to this directory).
SRC = os.environ.get('PCBT_SHEETS', SRC)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
OUT = os.path.normpath(OUT)
os.makedirs(OUT, exist_ok=True)

def bgmask(a, bgs):
    m = np.zeros(a.shape[:2], bool)
    for c in bgs:
        m |= (a[:, :, 0] == c[0]) & (a[:, :, 1] == c[1]) & (a[:, :, 2] == c[2])
    return m

def components(path, box, bgs, minw=6, minh=6):
    im = Image.open(os.path.join(SRC, path)).convert('RGB')
    sub = im.crop(box); a = np.array(sub)
    lab, _ = ndimage.label(~bgmask(a, bgs), structure=np.ones((3, 3)))
    out = []
    for sl in ndimage.find_objects(lab):
        ys, xs = sl; w, h = xs.stop - xs.start, ys.stop - ys.start
        if w < minw or h < minh: continue
        out.append((box[0] + xs.start, box[1] + ys.start, w, h))
    out.sort(key=lambda b: (b[1] // 10, b[0]))
    return im, out

def cutout(im, rect, bgs):
    """Crop a rect and knock the sheet background out to alpha."""
    x, y, w, h = rect
    a = np.array(im.crop((x, y, x + w, y + h)).convert('RGBA'))
    a[bgmask(a, bgs)] = (0, 0, 0, 0)
    return Image.fromarray(a)

# --------------------------------------------------------------- hero frames
LINK_BGS = ((0, 128, 128), (0, 64, 64))
HERO_W, HERO_H, HERO_FOOT = 24, 26, 24
WALK_FRAMES = 8

def link_cells(y0, y1):
    a = np.array(Image.open(os.path.join(SRC, 'link_sheet.png')).convert('RGB'))
    bg = bgmask(a, LINK_BGS)[y0:y1 + 1]
    cols = [bg[:, x].all() for x in range(bg.shape[1])]
    out, x = [], 0
    while x < len(cols):
        if not cols[x]:
            s = x
            while x < len(cols) and not cols[x]: x += 1
            out.append((s, x))
        else: x += 1
    return out

def hero_frame(im, y0, y1, cx0, cx1):
    """Anchor on the sheet cell centre horizontally and the feet vertically so
    the walk cycle doesn't jitter."""
    piece = cutout(im, (cx0, y0, cx1 - cx0, y1 - y0 + 1), LINK_BGS)
    alpha = np.array(piece)[:, :, 3]
    ys, _ = np.where(alpha > 0)
    canvas = Image.new('RGBA', (HERO_W, HERO_H), (0, 0, 0, 0))
    ox = int(round(HERO_W / 2 - (cx1 - cx0) / 2))
    oy = HERO_FOOT - (ys.max() + 1)
    canvas.paste(piece, (ox, oy), piece)
    return canvas

link_im = Image.open(os.path.join(SRC, 'link_sheet.png')).convert('RGB')
BANDS = {'down': (0, 27), 'side': (57, 84), 'up': (110, 136)}
hero = {}
for name, (y0, y1) in BANDS.items():
    cs = link_cells(y0, y1)[:WALK_FRAMES]
    hero[name] = [hero_frame(link_im, y0, y1, a, b) for a, b in cs]

# ------------------------------------------------------------ enemy frames
MAGENTA = ((255, 0, 255),)
ENEMY_SPECS = {
    # name: (sheet, search box, background colours, indices to keep)
    'octo':   ('sheets/lightworld.png', (285, 60, 470, 105), MAGENTA, [1, 2]),
    'bat':    ('sheets/lightworld.png', (0, 92, 120, 128),   MAGENTA, [0, 1]),
    'bones':  ('sheets/stalfos.png',    (0, 72, 200, 118),   MAGENTA, [0, 1]),
    'grunt':  ('sheets/moblin.png',     (0, 0, 130, 52),     MAGENTA, [0, 1]),
    'mage':   ('sheets/moblin.png',     (150, 0, 310, 52),   MAGENTA, [0, 1]),
}
enemies = {}
for name, (path, box, bgs, keep) in ENEMY_SPECS.items():
    im, boxes = components(path, box, bgs)
    picked = [boxes[i] for i in keep if i < len(boxes)]
    enemies[name] = [cutout(im, r, bgs) for r in picked]
    print(f'{name:7s} {len(picked)} frames  {[ (r[2],r[3]) for r in picked ]}')

# Armos Knight: the component merges with its shatter debris, so take a fixed
# crop of just the statue.
armos_im = Image.open(os.path.join(SRC, 'sheets/armos.png')).convert('RGB')
ARMOS_BGS = MAGENTA + ((248, 128, 248),)
enemies['knight'] = [cutout(armos_im, (8, 24, 26, 32), ARMOS_BGS)]
print(f'knight  1 frames  [(26, 32)]')

# Trim every enemy frame to its own tight bounds so the atlas stays small.
def trim(img):
    a = np.array(img); ys, xs = np.where(a[:, :, 3] > 0)
    return img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
for k in enemies: enemies[k] = [trim(f) for f in enemies[k]]

# ------------------------------------------------------------------- packing
groups = []
for d in ('down', 'side', 'up'):
    groups.append((f'hero_{d}', hero[d]))
for k, v in enemies.items():
    groups.append((f'enemy_{k}', v))

PAD = 1
atlas_w = max(sum(f.width + PAD for f in frames) for _, frames in groups) + PAD
rows_h = [max(f.height for f in frames) + PAD for _, frames in groups]
atlas_h = sum(rows_h) + PAD
atlas = Image.new('RGBA', (atlas_w, atlas_h), (0, 0, 0, 0))

meta = {'frames': {}, 'hero': {}, 'enemies': {}}
y = PAD
for (name, frames), rh in zip(groups, rows_h):
    x = PAD
    rects = []
    for f in frames:
        atlas.paste(f, (x, y), f)
        rects.append([x, y, f.width, f.height])
        x += f.width + PAD
    meta['frames'][name] = rects
    y += rh

atlas.save(os.path.join(OUT, 'sprites.png'), optimize=True)

meta['hero'] = {
    'w': HERO_W, 'h': HERO_H, 'foot': HERO_FOOT,
    'dirs': {d: f'hero_{d}' for d in ('down', 'side', 'up')},
}
meta['enemies'] = {k: f'enemy_{k}' for k in enemies}

# ----------------------------------------------------- mail recolour ramps
# The five palette entries that differ between green, blue and red mail on the
# reference sheet. Blue and red are the game's own palettes; the remaining
# three are hue rotations of the green ramp.
GREEN = ['509010', '40d870', '78b820', '389068', '885828']
BLUE  = ['c0a848', '88a0e8', 'f8d880', '0060d0', 'c86020']
RED   = ['9878d8', 'f05888', 'c8a8f8', 'b81020', '388840']

# The remaining three keep the same structure as the game's own palettes —
# a contrasting cap accent over a distinct tunic body — chosen by hand because
# a flat hue rotation muddies the cap/tunic separation.
# key order: [cap dark, tunic light, cap light, tunic dark, strap]
VIOLET = ['3f8f7f', 'c88ae8', '7fd8c8', '6b28a8', 'b8862f']
AMBER  = ['3a5fa8', 'ffc060', '7fa8e8', 'c85a10', '6a8f30']
CYAN   = ['b85040', '60e0e0', 'f09080', '127a90', 'c8a030']

meta['mail'] = {
    'keys': GREEN,
    'ramps': [
        {'name': 'Green',  'colors': GREEN},
        {'name': 'Blue',   'colors': BLUE},
        {'name': 'Red',    'colors': RED},
        {'name': 'Violet', 'colors': VIOLET},
        {'name': 'Amber',  'colors': AMBER},
        {'name': 'Cyan',   'colors': CYAN},
    ],
}

json.dump(meta, open(os.path.join(OUT, 'sprites.json'), 'w'), indent=1)
print(f'\natlas {atlas_w}x{atlas_h} -> {OUT}/sprites.png')
print('bytes', os.path.getsize(os.path.join(OUT, 'sprites.png')))
