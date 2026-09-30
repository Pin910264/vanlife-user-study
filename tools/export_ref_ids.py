#!/usr/bin/env python3
"""Write the website's reference codes (K33, BA02, ...) and plain-English display names into the chatbot catalog as
`ref_ids` and `display_name`, so the assistant resolves codes participants read off the site and calls items what the
site calls them. Site items are matched to catalog entries by their `catalog_name` (the VanSpace3D name). Usage: python3 tools/export_ref_ids.py [path/to/VanlifeChatbot/vanspace/van_items.json]"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent)); from render_assets import site_items, catalog_key, norm, REPO
path = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO.parent / 'VanlifeChatbot' / 'vanspace' / 'van_items.json'
cat = json.load(open(path)); by = {norm(e['item_name']): e for e in cat}
for e in cat: e.pop('ref_ids', None); e.pop('display_name', None)
unmatched = []
for it in site_items():
    e = by.get(norm(catalog_key(it)))
    if e is None: unmatched.append(f"{it['id']} {it['name']}"); continue
    e.setdefault('ref_ids', []); e['ref_ids'].append(it['id'])
    e.setdefault('display_name', it['name'].strip())   # first site entry wins; duplicates share the same display name
def dump(entries):   # keep the file's existing style: 2-space indent, dimension and ref_ids on one line each
    def line(e):
        parts = []
        for k, v in e.items():
            val = json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else json.dumps(v, ensure_ascii=False)
            if isinstance(v, dict): val = '{ ' + ', '.join(f'{json.dumps(a)}: {json.dumps(b)}' for a, b in v.items()) + ' }'
            parts.append(f'    {json.dumps(k)}: {val}')
        return '  {\n' + ',\n'.join(parts) + '\n  }'
    return '[\n' + ',\n'.join(line(e) for e in entries) + '\n]\n'
text = dump(cat)
if b'\r\n' in path.read_bytes(): text = text.replace('\n', '\r\n')   # keep the file's line endings
path.write_text(text, newline='')
print(f"{path}: {sum(1 for e in cat if e.get('ref_ids'))} catalog items now carry ref_ids + display_name; unmatched: {unmatched or 'none'}")
