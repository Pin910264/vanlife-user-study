#!/usr/bin/env python3
"""Render every furniture item on the study website two ways, from the VanSpace3D GLB hand-off:

  img/item/<ID>.webp   the item alone, front three-quarter view, light background   (card image)
  img/van/<ID>.webp    the item placed at true scale inside the Sprinter L2H1 shell (modal image)

Also writes img/render_manifest.json: per site ID, the matched manifest item, dimensions and which images exist.

Usage:  python3 tools/render_assets.py [--glb-dir ../vanspace_assets] [--only K33,B01] [--out img]
Requires numpy, opencv-python, Pillow and the `cwebp` binary. GLBs are Vanspace 3D's assets (used with permission for
this study) and are not part of this repository.

Pure-Python software rasterizer: perspective camera, z-buffer, flat shading, back-face culling, texture sampling with
KHR_texture_transform. About 5 s per item.
"""
import argparse, json, re, subprocess, sys, tempfile
from pathlib import Path
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent)); import glb_loader

HERE = Path(__file__).resolve().parent; REPO = HERE.parent
VAN_GLB = 'Mercedes_Benz_Sprinter_Panel_L2H1.glb'
HIDE = {'Ceiling', 'Outside_C', 'Left_Wall', 'Outside_B'}            # roof + passenger-side wall removed for the cutaway
FLOOR_Y, CEIL_Y = 0.46, 2.18                                         # metres, from the shell model
WALL_X = -0.89                                                       # far (driver-side) wall, inner face
FLOOR_CX, FLOOR_CZ = 0.0, (-1.96 + 1.31) / 2
VAN_CAM = dict(eye=(5.6, 3.9, -2.6), target=(0.0, 1.05, -0.15), fov=40)

# Site name -> manifest name where they differ. Uncertain guesses are marked and should be checked in the contact sheet.
ALIASES = {
    '5 Gallon Toilet': 'Luggable Loo Portable Toilet',
    'Top Wardrobe Rustic': 'Top Wardrobe Rustic v1',
    'Murphy Bed Queen Closed': 'Murphy Bed Queen Closed v.2',
    'Horizontal Sliding Black RV Window': 'Rectangle Sliding Window',        # guess
    'Floating Shelves Medium': 'Bayka Floating Shelves - Medium 1',
    'Collapsible Fabric Storage Basket Cubes': 'Seville Foldable Cube Basket',  # guess
    'Corner Kitchen': 'Corner Kitchen Demo',
    'Microwave Oven': 'Microwave',
    '5 Gallon Water Bottle': 'round 5 gallon water jug',
    'Magnetic Knife Bar': '10 Inch Magnetic Knife Holder',
    'Bathroom Vanity Sink': 'eclife  Vanity Sink 16',
    'Hitch Bike Rack for Car': 'Bike Rack',
}
# How each item sits in the van. Anything not listed stands centred on the floor.
#   wall     floor-standing, back against the far wall          counter  on the far wall, bottom at 36 in
#   upper    on the far wall, bottom at 51 in                   mount    on the far wall, centred at 55 in
#   ceiling  hanging from the ceiling, centred                  hang     centred, bottom 20 in up (hammock)
#   rear     hung on the outside of the rear door       hitch    on the hitch behind the rear bumper
#   awning   on the near (sliding-door) side, rotated to run the van's length, legs on the ground
PLACEMENT = {}
for ids, mode in [
    ('B08 B09 B10 B11 B12 B13 B15 B16 B17 B26 B27 K01 K02 K07 K10 K13 K14 K15 K18 K19 K20 K21 K25 K26 K27 K28 BA01 BA02 BA03 BA04 BA05 A13 '
     'B37 B38 B39 B40 K35 K36 K37 K38 K39 K41 K42 BA09 BA10 BA12 BA13', 'wall'),
    ('B18 K16 B30 A04 B31 A05 A19 B41 A38', 'upper'),
    ('K03 K04 K05 K06 K09 K11 K12 K30 BA07 BA08', 'counter'),
    ('B22 B23 B24 B25 K31 K32 BA06 A12 A23 A24 BA11', 'mount'),
    ('B19 B20 B21 B28 A14', 'ceiling'),
    ('B14 A07', 'hang'),
    ('A25', 'rear'), ('A26', 'hitch'), ('A09 A10', 'awning'),
]:
    for i in ids.split(): PLACEMENT[i] = mode
# Per-item rotation about the vertical axis, degrees (manifest name). VanSpace prefabs do not all face the same way;
# these were checked visually so that the front (doors, seat, screen) faces the camera in both renders.
YAW = {n: 180 for n in ['Sofa A Corner', 'Sofa B Corner', 'Murphy Bed Queen Closed v.2', 'Murphy Bed Single Closed',
                        'Wardrobe Rustic v2', 'Wide Wardrobe Rustic v2', 'Dometic RMD 10.5XT', 'TV 42inch', 'Decor PictureC', 'Safebox']}

def norm(s): return re.sub(r'[^a-z0-9]', '', s.lower())

def render(prims, W, H, eye, target, fov, ss=2, bg=(245, 246, 248)):
    W2, H2 = W * ss, H * ss
    eye = np.array(eye, float); fwd = np.array(target, float) - eye; fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right); up = np.cross(right, fwd)
    R = np.stack([right, up, fwd]); f = 1 / np.tan(np.radians(fov) / 2); aspect = W2 / H2
    L = np.array([0.35, 1.0, 0.5]); L /= np.linalg.norm(L)
    img = np.zeros((H2, W2, 3), np.float32); img[:] = np.array(bg) / 255; zb = np.full((H2, W2), np.inf, np.float32)
    for pr in prims:
        verts = pr['V']; V = (verts - eye) @ R.T
        ok = (V[:, :, 2] > 0.05).all(1); V = V[ok]; wv = verts[ok]; UV = pr['UV'][ok] if pr['UV'] is not None else None
        tex = pr['tex']; fac = pr['factor']; th, tw = (tex.shape[0], tex.shape[1]) if tex is not None else (0, 0)
        n = np.cross(wv[:, 1] - wv[:, 0], wv[:, 2] - wv[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        shade = 0.5 + 0.5 * np.abs(n @ L)
        px = (V[:, :, 0] / V[:, :, 2] * f / aspect + 1) * 0.5 * W2; py = (1 - V[:, :, 1] / V[:, :, 2] * f) * 0.5 * H2
        pz = V[:, :, 2] + pr.get('bias', 0.0)
        area = (px[:, 1] - px[:, 0]) * (py[:, 2] - py[:, 0]) - (px[:, 2] - px[:, 0]) * (py[:, 1] - py[:, 0])
        front = np.ones(len(V), bool) if pr.get('ds') else (area < 0)
        for i in range(len(V)):
            if not front[i]: continue
            x = px[i]; y = py[i]; z = pz[i]
            x0, x1 = int(max(0, np.floor(x.min()))), int(min(W2 - 1, np.ceil(x.max())))
            y0, y1 = int(max(0, np.floor(y.min()))), int(min(H2 - 1, np.ceil(y.max())))
            if x1 < x0 or y1 < y0: continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            den = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0])
            if abs(den) < 1e-12: continue
            w0 = ((x[1] - gx) * (y[2] - gy) - (x[2] - gx) * (y[1] - gy)) / den
            w1 = ((x[2] - gx) * (y[0] - gy) - (x[0] - gx) * (y[2] - gy)) / den; w2 = 1 - w0 - w1
            m = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
            if not m.any():
                if x1 - x0 <= 1 and y1 - y0 <= 1: m[:] = True
                else: continue
            zz = w0 * z[0] + w1 * z[1] + w2 * z[2]
            sub = zb[y0:y1 + 1, x0:x1 + 1]; upd = m & (zz < sub)
            if not upd.any(): continue
            if tex is not None:
                iz = 1 / z; a0, a1, a2 = w0 * iz[0], w1 * iz[1], w2 * iz[2]; s = a0 + a1 + a2
                u = (a0 * UV[i, 0, 0] + a1 * UV[i, 1, 0] + a2 * UV[i, 2, 0]) / s
                v = (a0 * UV[i, 0, 1] + a1 * UV[i, 1, 1] + a2 * UV[i, 2, 1]) / s
                t = tex[np.floor(v * th).astype(int) % th, np.floor(u * tw).astype(int) % tw]; col = t[..., :3] * fac
                if pr['alpha'] != 'OPAQUE': upd &= t[..., 3] > 0.5
            else:
                col = np.broadcast_to(fac, (*upd.shape, 3))
            c = col * shade[i]
            sub[upd] = zz[upd]; img[y0:y1 + 1, x0:x1 + 1][upd] = c[upd]
    out = cv2.resize((img * 255).clip(0, 255).astype(np.uint8), (W, H), interpolation=cv2.INTER_AREA)
    return Image.fromarray(out)

def load_item(glb_dir, entry):
    prims = glb_loader.load(str(glb_dir / entry['glb'])); a = np.radians(YAW.get(entry['name'], 0))
    if a:
        Rm = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
        for p in prims: p['V'] = p['V'] @ Rm.T
    return prims

def bounds(prims):
    V = np.concatenate([p['V'] for p in prims]); return V.min((0, 1)), V.max((0, 1))

def place(prims, mode):
    if mode == 'awning':   # run along the van (rotate 90°), then hang off the far roof edge
        Rm = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], float)
        for p in prims: p['V'] = p['V'] @ Rm.T
    mn, mx = bounds(prims); c = (mn + mx) / 2; size = mx - mn
    if mode == 'rear':     # outside the rear door, bumper height
        off = np.array([0.45 - c[0], 0.35 - mn[1], (-2.28 - size[2] / 2) - c[2]])
        for p in prims: p['V'] = p['V'] + off
        return prims
    if mode == 'hitch':    # behind the bumper, centred
        off = np.array([0.0 - c[0], 0.30 - mn[1], (-2.40 - size[2] / 2) - c[2]])
        for p in prims: p['V'] = p['V'] + off
        return prims
    if mode == 'awning':   # near side, mounting bar at the body, legs on the ground, centred on the cargo area
        off = np.array([(1.02 + size[0] / 2) - c[0], 0.0 - mn[1], FLOOR_CZ - c[2]])
        for p in prims: p['V'] = p['V'] + off
        return prims
    x = FLOOR_CX; y = FLOOR_Y
    if mode in ('wall', 'counter', 'upper', 'mount'): x = WALL_X + size[0] / 2 + 0.01
    y = {'counter': FLOOR_Y + 0.91, 'upper': FLOOR_Y + 1.30, 'mount': FLOOR_Y + 1.40 - size[1] / 2,
         'ceiling': CEIL_Y - size[1], 'hang': FLOOR_Y + 0.50}.get(mode, FLOOR_Y)
    y = min(y, CEIL_Y - size[1]) if mode in ('counter', 'upper', 'mount') else y
    off = np.array([x - c[0], y - mn[1], FLOOR_CZ - c[2]])
    for p in prims: p['V'] = p['V'] + off
    return prims

_van = None
def van_prims(glb_dir):
    global _van
    if _van is None:
        _van = [p for p in glb_loader.load(str(glb_dir / VAN_GLB)) if p['node'] not in HIDE]
        for p in _van:
            if p['node'] not in ('Floor', 'Right_Wall', 'Back_Wall', 'Bulkhead'): p['bias'] = 0.02  # exterior loses depth ties
    return _van

def render_item_alone(prims, W=640, H=480, fov=30, fill=0.86):
    mn, mx = bounds(prims); c = (mn + mx) / 2
    corners = np.array([[x, y, z] for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])])
    d = np.array([1.35, 0.75, -1.0]); d /= np.linalg.norm(d); f = 1 / np.tan(np.radians(fov) / 2); aspect = W / H
    dist = np.linalg.norm(mx - mn)
    for _ in range(6):
        eye = c + d * dist; fwd = (c - eye) / np.linalg.norm(c - eye); right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
        Vc = (corners - eye) @ np.stack([right, up := np.cross(right, fwd), fwd]).T
        dist *= max(np.abs(Vc[:, 0] / Vc[:, 2] * f / aspect).max(), np.abs(Vc[:, 1] / Vc[:, 2] * f).max()) / fill
    return render(prims, W, H, eye=c + d * dist, target=c, fov=fov, bg=(250, 250, 250))

def save_webp(im, path, q):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as t: im.save(t.name); tmp = t.name
    subprocess.run(['cwebp', '-quiet', '-q', str(q), tmp, '-o', str(path)], check=True); Path(tmp).unlink()

def site_items():
    html = (REPO / 'index.html').read_text()
    data = json.loads(re.search(r'const DATA=(\{.*?\});\n', html, re.S).group(1))
    return [dict(it, page=page) for page, items in data.items() for it in items]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--glb-dir', default=str(REPO.parent / 'vanspace_assets'))
    ap.add_argument('--out', default=str(REPO / 'img')); ap.add_argument('--only', default=''); a = ap.parse_args()
    root = Path(a.glb_dir); glb_dir = root / 'glb'; out = Path(a.out)
    manifest = json.load(open(root / 'furniture_manifest.json')); by_norm = {norm(i['name']): i for i in manifest['items']}
    only = set(a.only.split(',')) if a.only else None
    results = json.load(open(out / 'render_manifest.json')) if (out / 'render_manifest.json').exists() else {}
    cache = {}   # manifest name -> rendered (item_png, van_png or None) so duplicate IDs render once
    for it in site_items():
        sid = it['id']
        if only and sid not in only: continue
        name = it['name'].strip(); entry = by_norm.get(norm(ALIASES.get(name, name)))
        if entry is None or not entry.get('glb_exported'):
            print(f'{sid:5s} {name}: no model', flush=True); results[sid] = dict(name=name, matched=None); continue
        mode = PLACEMENT.get(sid, 'center')
        results[sid] = dict(name=name, matched=entry['name'], glb=entry['glb'], placement=mode, dims_in=entry['dimensions_in'],
                            item_img=f'img/item/{sid}.webp', van_img=f'img/van/{sid}.webp')
        key = (entry['name'], mode)
        if key not in cache:
            prims = load_item(glb_dir, entry)
            item_im = render_item_alone(prims)
            van_im = render(van_prims(glb_dir) + place(prims, mode), 880, 560, **VAN_CAM)
            cache[key] = (item_im, van_im)
        item_im, van_im = cache[key]
        save_webp(item_im, out / 'item' / f'{sid}.webp', 85)
        if van_im is not None: save_webp(van_im, out / 'van' / f'{sid}.webp', 82)
        print(f'{sid:5s} {name:40s} -> {entry["name"]:40s} [{mode}]', flush=True)
        json.dump(results, open(out / 'render_manifest.json', 'w'), indent=1)
    out.mkdir(parents=True, exist_ok=True); json.dump(results, open(out / 'render_manifest.json', 'w'), indent=1)
    print('done', len(results), 'items')

if __name__ == '__main__': main()
