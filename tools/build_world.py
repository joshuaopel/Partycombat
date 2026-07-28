"""Build the world tileset: assets/world.png + assets/world.json.

Ground tiles are sampled from the assembled Light World map (they are the real
terrain tiles, in context); props come from the Overworld Tiles sheet. As with
the character atlas, only the tiles the game places are emitted — the source
sheets are not redistributed.

Needs, alongside this script:
    sheets/lightworld_map.png   Light World  (the assembled overworld map)
    sheets/overworld.png        Overworld Tiles
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
TILE = 16

# Ground tiles, picked by frequency-scanning the map on its 16px grid (offset
# x=12) and keeping the most common terrain. Coordinates are map pixels.
GROUND = {
    'grass':  [(3932, 0), (2060, 4240), (1724, 4624), (2108, 4624), (1676, 2736)],
    'sand':   [(588, 4224), (3932, 1744), (1628, 1072)],
    'dirt':   [(60, 4112), (2700, 3104), (1500, 4624)],
    'water':  [(4012, 48), (3196, 80)],
}

# Props from the Overworld Tiles sheet (white background), as component
# indices found by flood-filling the sheet background.
#   name: (component index, blocking radius in px, ground-line offset from the
#          sprite's bottom edge)
PROPS = {
    'tree_green':  (42, 15, 6),
    'tree_amber':  (40, 15, 6),
    'tree_red':    (41, 15, 6),
    'boulder':     (30, 14, 4),
    'bush':        (21, 8, 2),
    'stump':       (6, 6, 2),
    'rock':        (11, 6, 2),
    'flower':      (13, 0, 2),
    'sprout':      (22, 0, 2),
}

OUTLINE = (40, 40, 40)

def _flood(a, fillable):
    """Clear every pixel reachable from the border through `fillable` colours."""
    h, w = a.shape[:2]
    seen = np.zeros((h, w), bool)
    stack = []

    def push(x, y):
        if 0 <= x < w and 0 <= y < h and not seen[y, x] and a[y, x, 3] > 0 \
                and tuple(a[y, x, :3]) in fillable:
            seen[y, x] = True
            stack.append((x, y))

    for i in range(w):
        push(i, 0); push(i, h - 1)
    for j in range(h):
        push(0, j); push(w - 1, j)
    while stack:
        x, y = stack.pop()
        push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
    a[seen] = (0, 0, 0, 0)
    return a

def _white_stripped(img):
    a = _flood(np.array(img.convert('RGBA')), {(255, 255, 255)})
    ys, xs = np.where(a[:, :, 3] > 0)
    return a, (ys, xs)

def learn_backing(img):
    """Read the shades of the grass tile props were ripped on.

    Sampled from the outer ring of the biggest prop, which is nothing but sheet
    background, grass and outline. Small props can't be sampled this way — a
    bush's own colour reaches its border and would end up in the palette,
    erasing the bush.
    """
    a = np.array(img.convert('RGBA'))
    h, w = a.shape[:2]
    ring = list(a[0]) + list(a[h - 1]) + list(a[:, 0]) + list(a[:, w - 1])
    return {tuple(px[:3]) for px in ring
            if tuple(px[:3]) not in (OUTLINE, (255, 255, 255))}

def strip_backing(img, grass):
    """Remove both backgrounds a prop was ripped on.

    Props sit on a square of overworld grass, which itself sits on the sheet's
    white background. Baking the grass in paints bright green rectangles over
    whatever the prop is placed on, and makes overlapping props cut chunks out
    of each other. The prop's own dark outline stops the fill, so grass *inside*
    the silhouette survives.
    """
    a, _ = _white_stripped(img)
    return Image.fromarray(_flood(a, grass))

def trim(img):
    a = np.array(img)
    ys, xs = np.where(a[:, :, 3] > 0)
    return img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def components(im, box, bg, minw=10, minh=10):
    sub = im.crop(box); a = np.array(sub)
    mask = (a[:, :, 0] == bg[0]) & (a[:, :, 1] == bg[1]) & (a[:, :, 2] == bg[2])
    lab, _ = ndimage.label(~mask, structure=np.ones((3, 3)))
    out = []
    for sl in ndimage.find_objects(lab):
        ys, xs = sl; w, h = xs.stop - xs.start, ys.stop - ys.start
        if w < minw or h < minh: continue
        out.append((box[0] + xs.start, box[1] + ys.start, w, h))
    out.sort(key=lambda b: (b[1] // 10, b[0]))
    return out

# ------------------------------------------------------------------- ground
map_im = Image.open(os.path.join(SRC, 'sheets/lightworld_map.png')).convert('RGB')
ground = {}
for kind, coords in GROUND.items():
    ground[kind] = [map_im.crop((x, y, x + TILE, y + TILE)).convert('RGBA') for x, y in coords]
    print(f'{kind:6s} {len(coords)} tiles')

# -------------------------------------------------------------------- props
ow = Image.open(os.path.join(SRC, 'sheets/overworld.png')).convert('RGB')
WHITE = (255, 255, 255)
comps = components(ow, (0, 0, 450, 520), WHITE)
_tx, _ty, _tw, _th = comps[PROPS['tree_green'][0]]
GRASS = learn_backing(ow.crop((_tx, _ty, _tx + _tw, _ty + _th)))
print(f'grass backing: {len(GRASS)} shades {sorted(GRASS)}')

props = {}
for name, (idx, radius, foot) in PROPS.items():
    x, y, w, h = comps[idx]
    img = trim(strip_backing(ow.crop((x, y, x + w, y + h)), GRASS))
    props[name] = (img, radius, foot)
    print(f'{name:11s} {w}x{h} -> {img.width}x{img.height} r={radius}')

# ------------------------------------------------------------------ packing
rows = []
for kind, tiles in ground.items():
    rows.append((f'ground_{kind}', tiles))
rows.append(('props', [p[0] for p in props.values()]))

PAD = 1
width = max(sum(t.width + PAD for t in ts) for _, ts in rows) + PAD
heights = [max(t.height for t in ts) + PAD for _, ts in rows]
sheet = Image.new('RGBA', (width, sum(heights) + PAD), (0, 0, 0, 0))

meta = {'tile': TILE, 'ground': {}, 'props': {}}
y = PAD
for (name, tiles), rh in zip(rows, heights):
    x = PAD
    rects = []
    for t in tiles:
        sheet.paste(t, (x, y), t)
        rects.append([x, y, t.width, t.height])
        x += t.width + PAD
    if name == 'props':
        for (pname, (_, radius, foot)), r in zip(props.items(), rects):
            meta['props'][pname] = {'rect': r, 'radius': radius, 'foot': foot}
    else:
        meta['ground'][name.split('_', 1)[1]] = rects
    y += rh

sheet.save(os.path.join(OUT, 'world.png'), optimize=True)
json.dump(meta, open(os.path.join(OUT, 'world.json'), 'w'), indent=1)
print(f'\nworld sheet {sheet.width}x{sheet.height} -> {OUT}/world.png')
print('bytes', os.path.getsize(os.path.join(OUT, 'world.png')))
