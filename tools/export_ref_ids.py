#!/usr/bin/env python3
"""Write the website's reference codes (K33, BA02, ...) into the chatbot catalog as `ref_ids`, so the assistant can
resolve a code a participant reads off the site. Site names are matched to catalog names via the same aliases the
renderer uses. Usage: python3 tools/export_ref_ids.py [path/to/VanlifeChatbot/vanspace/van_items.json]"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent)); from render_assets import site_items, ALIASES, norm, REPO
path = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO.parent / 'VanlifeChatbot' / 'vanspace' / 'van_items.json'
cat = json.load(open(path)); by = {norm(e['item_name']): e for e in cat}
for e in cat: e.pop('ref_ids', None)
unmatched = []
for it in site_items():
    n = it['name'].strip(); e = by.get(norm(ALIASES.get(n, n)))
    if e is None: unmatched.append(f"{it['id']} {n}"); continue
    e.setdefault('ref_ids', []); e['ref_ids'].append(it['id'])
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
print(f"{path}: {sum(1 for e in cat if e.get('ref_ids'))} catalog items now carry ref_ids; unmatched: {unmatched or 'none'}")
