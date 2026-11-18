# 3D assets: where they are and how to load them

All furniture models and the van shell are hosted on Cloudflare R2. Nothing is installed or
downloaded by hand; a page loads them from this URL:

    https://pub-f24619125cd545cbad22bea9cebcd8fe.r2.dev/

| What | Path |
|---|---|
| Catalog manifest (names, website codes, dimensions, file names) | `furniture_manifest.json` |
| One model per item, e.g. the queen bed | `glb/Platform_Simple.glb` |
| The van shell (Sprinter L2H1) | `glb/Mercedes_Benz_Sprinter_Panel_L2H1.glb` |

129 models, 75 MB in total, the biggest 3.5 MB. GLB format, in meters, so they load at true
size with no scaling. Textures are WebP inside the file; three.js and `<model-viewer>` read
that natively.

## Load one in three.js

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const BASE = 'https://pub-f24619125cd545cbad22bea9cebcd8fe.r2.dev/';
const manifest = await (await fetch(BASE + 'furniture_manifest.json')).json();
const item = manifest.items.find(i => i.name === 'Platform Simple');
new GLTFLoader().load(BASE + 'glb/' + item.glb, gltf => scene.add(gltf.scene));
```

Each manifest entry has `name` (the VanSpace name), `glb`, `dimensions_in` and `dimensions_m`
(width, height, depth), `keywords`, and `in_assistant_catalog`. The van entry has the
interior size: 70 in wide, 128 in long.

## Which pages may load them

The bucket only answers pages served from these origins; anything else gets a CORS error:

- `https://pin910264.github.io` (the study site)
- `http://localhost` and `http://127.0.0.1` on ports 5001, 8000 and 8080 (local dev)

Opening an HTML file straight from disk (`file://`) will not work. Serve the folder, e.g.
`python3 -m http.server 8000`, and open `http://localhost:8000/`.

Need another origin? Ask Stacey; it is a one-line change on the bucket.

## Quick check

Open the site's console and run:

```js
fetch('https://pub-f24619125cd545cbad22bea9cebcd8fe.r2.dev/furniture_manifest.json').then(r => r.json()).then(m => console.log(m.items.length, 'items'))
```

It should print `128 items`.
