#!/usr/bin/env python3
"""Wire the rendered images (from render_assets.py) into index.html.

For every item in the embedded DATA blob: adds `dims` (inches), `item_img` and `van_img`, and drops the base64 thumbnail
when an item render exists (the thumbnail stays as a fallback only for items without a model). Also swaps in the card /
modal markup and CSS for the two-view modal. Idempotent: re-running just refreshes the data fields.
"""
import json, re
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
html = (REPO / 'index.html').read_text()
results = json.load(open(REPO / 'img' / 'render_manifest.json'))

m = re.search(r'const DATA=(\{.*?\});\n', html, re.S); data = json.loads(m.group(1))
for page, items in data.items():
    for it in items:
        r = results.get(it['id'], {})
        it['dims'] = r.get('dims_in'); it['item_img'] = r.get('item_img'); it['van_img'] = r.get('van_img')
        if it['item_img']: it['image'] = ''          # rendered card image replaces the embedded thumbnail
html = html[:m.start(1)] + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + html[m.end(1):]

CSS = """
/* rendered assets */
.imgwrap img{width:100%;height:100%;object-fit:contain}
.dims{font-size:12px;color:#5b6472;margin-top:4px;font-variant-numeric:tabular-nums}.dims small{color:#8b93a0}
.mtoggle{display:inline-flex;border:1px solid #e6e5e6;border-radius:999px;overflow:hidden;margin:0 0 10px}.mtoggle button{font:inherit;font-size:13px;padding:6px 14px;border:0;background:#fff;color:#5b6472;cursor:pointer}.mtoggle button.on{background:#0a0e1a;color:#fff}
.vanline{font-size:13px;color:#5b6472;margin-top:8px;padding-top:8px;border-top:1px solid #eef0f2}
.modalimg{background:#f5f6f8}.modalimg img{object-fit:contain}
"""
if '/* rendered assets */' not in html: html = html.replace('</style>', CSS + '</style>', 1)

# modal: add the view toggle + dimension lines
old_modal = '<h3 id="mname"></h3><p id="mdesc"></p><div class="orig" id="morig"></div>'
new_modal = '<h3 id="mname"></h3><div class="mtoggle" id="mtoggle"><button id="tVan" class="on">In the van</button><button id="tItem">Item only</button></div><p id="mdesc"></p><div class="dims" id="mdims"></div><div class="vanline" id="mvan"></div><div class="orig" id="morig"></div>'
if 'id="mtoggle"' not in html:
    assert old_modal in html; html = html.replace(old_modal, new_modal, 1)

# card: rendered image with thumbnail fallback, plus a dimensions line
old_card = """<div class="imgwrap">${x.image?`<img src="${x.image}" alt="${x.id} ${x.name}">`:''}</div><div class="cardbody"><div class="item-meta"><div class="item-id">${x.id}</div><span class="pill">${x.category}</span></div><div class="name">${x.name}</div>${x.desc?`<div class="desc">${x.desc}</div>`:''}</div>"""
new_card = """<div class="imgwrap">${(x.item_img||x.image)?`<img src="${x.item_img||x.image}" alt="${x.id} ${x.name}" loading="lazy">`:''}</div><div class="cardbody"><div class="item-meta"><div class="item-id">${x.id}</div><span class="pill">${x.category}</span></div><div class="name">${x.name}</div>${x.dims?`<div class="dims">${fmtDims(x.dims)}</div>`:''}${x.desc?`<div class="desc">${x.desc}</div>`:''}</div>"""
if 'fmtDims(x.dims)' not in html:
    assert old_card in html; html = html.replace(old_card, new_card, 1)

# openItem: two-view modal. Remove any earlier copy of this block first so re-runs never duplicate the declarations.
BLOCK_END = r"document\.getElementById\('tItem'\)\.onclick=\(\)=>\{modalView='item';showModalImg\(\)\}\n?"
html = re.sub(r"const fmtDims=.*?" + BLOCK_END, '', html, flags=re.S)
old_open = re.search(r"function openItem\(x\)\{.*?modal\.classList\.add\('open'\)\}\n?", html, re.S)
new_open = """const fmtDims=d=>`${d.width.toFixed(0)} W × ${d.height.toFixed(0)} H × ${d.depth.toFixed(0)} D <small>in</small>`;
let modalItem=null,modalView='van';
function showModalImg(){const x=modalItem;const src=(modalView==='van'&&x.van_img)?x.van_img:(x.item_img||x.image||'');document.getElementById('mimg').src=src;document.getElementById('tVan').classList.toggle('on',modalView==='van');document.getElementById('tItem').classList.toggle('on',modalView!=='van')}
function openItem(x){modalItem=x;modalView=x.van_img?'van':'item';document.getElementById('mtoggle').style.display=x.van_img?'':'none';showModalImg();document.getElementById('mid').textContent=x.id;document.getElementById('mname').textContent=x.name;document.getElementById('mcat').textContent=x.category;document.getElementById('mdesc').textContent=x.desc||'No additional description.';document.getElementById('mdims').innerHTML=x.dims?'Item: '+fmtDims(x.dims):'';document.getElementById('mvan').innerHTML=x.dims?'Van interior: 70 W × 128 L <small>in</small> (Mercedes Sprinter L2H1)':'';document.getElementById('morig').textContent='Source category: '+x.original_category;modal.classList.add('open')}
document.getElementById('tVan').onclick=()=>{modalView='van';showModalImg()};document.getElementById('tItem').onclick=()=>{modalView='item';showModalImg()}
"""
if old_open: html = html.replace(old_open.group(0), new_open, 1)
else:
    anchor = 'function go(page)'; assert anchor in html; html = html.replace(anchor, new_open + anchor, 1)

(REPO / 'index.html').write_text(html)
n_item = sum(1 for r in results.values() if r.get('item_img')); n_van = sum(1 for r in results.values() if r.get('van_img'))
print(f'index.html updated: {len(results)} items in manifest, {n_item} with item render, {n_van} with in-van render; size {len(html)/1024:.0f} KB')
