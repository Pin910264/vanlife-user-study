/* Live strip: what the assistant just mentioned, fed by the wizard's machine.
 *
 * Does nothing unless the page URL carries ?live=<feed url>&key=<participant key>
 * (the tunnel script prints that link each session). With it, a strip appears
 * under the header and polls <feed>/p/state every 2 s:
 *   - catalog items (with a code): picture + name + code; tap opens the item's modal
 *   - kinds the assistant named without a code ("a fold-down bed"): the label,
 *     followed by the catalog items it most likely means (matched on the wizard's
 *     machine with the same search that feeds the assistant)
 *   - the latest reply's items are shown large; "Earlier" unfolds the full history
 *     grouped by turn, newest first
 * Needs the page's DATA and openItem(); uses state/renderLibrary() only as a
 * fallback search when a kind has no matches.
 */
(function () {
  const q = new URLSearchParams(location.search);
  const FEED = (q.get('live') || '').replace(/\/+$/, '');
  const KEY = q.get('key') || '';
  const SAMPLE = q.get('sample') ? '&sample=1' : '';   // testing: stand-in mentions on an empty session
  if (!FEED || typeof DATA === 'undefined') return;

  const css = document.createElement('style');
  css.textContent = `
  #live{position:sticky;top:0;z-index:40;background:#111827;color:#fff;padding:10px 16px 12px;box-shadow:0 2px 10px #0003}
  #live .hd{display:flex;align-items:baseline;gap:10px;font-size:13px;color:#cbd5e1;margin-bottom:8px}
  #live .hd b{color:#fff;font-size:14px}
  #live .hd .sp{flex:1}
  #live .dot{width:8px;height:8px;border-radius:50%;background:#64748b;display:inline-block}
  #live .dot.on{background:#22c55e}
  #live .tg{border:1px solid #475569;background:transparent;color:#cbd5e1;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer}
  #live .tg:hover{border-color:#93c5fd;color:#fff}
  #live .row{display:flex;gap:10px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px;align-items:center}
  #live .it{flex:0 0 auto;display:flex;gap:9px;align-items:center;background:#1f2937;border:1px solid #374151;border-radius:10px;padding:6px 10px 6px 6px;cursor:pointer;min-width:200px;max-width:260px}
  #live .it:hover{border-color:#93c5fd}
  #live .it.new{border-color:#60a5fa;animation:livepulse 1.2s ease-out 2}
  @keyframes livepulse{0%{box-shadow:0 0 0 0 #60a5fa88}100%{box-shadow:0 0 0 8px #60a5fa00}}
  #live .it img{width:56px;height:44px;object-fit:contain;background:#fff;border-radius:6px}
  #live .it .nm{font-weight:650;font-size:13px;line-height:1.2}
  #live .it .cd{font:600 12px Menlo,Consolas,monospace;color:#93c5fd;margin-top:2px}
  #live .kind{flex:0 0 auto;display:flex;gap:8px;align-items:center;padding:4px 0 4px 10px;border-left:3px solid #475569;margin-left:4px}
  #live .kind .kl{flex:0 0 auto;font-size:12px;color:#cbd5e1;max-width:120px;line-height:1.25}
  #live .kind .kl b{display:block;color:#fff;font-size:13px}
  #live .kind .it{min-width:170px;max-width:220px}
  #live .kind.nomatch .kl{cursor:pointer;text-decoration:underline dotted}
  #live .it{position:relative}#live .it.chosen{border-color:#34d399}
  #live .it .ck{position:absolute;top:-7px;right:-7px;width:18px;height:18px;border-radius:50%;background:#34d399;color:#052e16;font:700 12px/18px -apple-system,Helvetica,sans-serif;text-align:center}
  #live .hist .sub{font-size:12px;color:#94a3b8;margin:0 0 6px}
  #live .empty{color:#94a3b8;font-size:13px}
  #live .hist{display:none;margin-top:10px;border-top:1px solid #374151;padding-top:8px;max-height:46vh;overflow-y:auto}
  #live.open .hist{display:block}
  #live .turn{display:flex;gap:10px;align-items:flex-start;margin-bottom:8px}
  #live .turn .tm{flex:0 0 58px;font:600 11px Menlo,Consolas,monospace;color:#94a3b8;padding-top:10px}
  #live .turn .row{flex:1}
  #live .turn .it{min-width:170px;max-width:230px}
  @media(max-width:720px){#live{padding:8px 12px}#live .it{min-width:170px}}`;
  document.head.appendChild(css);

  const strip = document.createElement('div');
  strip.id = 'live';
  strip.innerHTML =
    '<div class="hd"><span class="dot" id="livedot"></span><b>Mentioned by the assistant</b><span id="livenote">connecting…</span><span class="sp"></span><button class="tg" id="livetg" style="display:none">Earlier ▾</button></div>'
    + '<div class="row" id="liverow"><div class="empty">Items the assistant names will appear here as it says them — tap one to see it.</div></div>'
    + '<div class="hist" id="livehist"></div>';
  const header = document.querySelector('header') || document.querySelector('.nav');
  (header && header.parentNode) ? header.parentNode.insertBefore(strip, header.nextSibling) : document.body.prepend(strip);
  document.getElementById('livetg').onclick = () => {
    strip.classList.toggle('open');
    const tg = document.getElementById('livetg'); tg.textContent = tg.textContent.replace(/Earlier [▴▾]/, strip.classList.contains('open') ? 'Earlier ▴' : 'Earlier ▾');
    if (window.liveEvent) window.liveEvent('history_toggle', { open: strip.classList.contains('open') });
  };

  const ALL = Object.values(DATA).flat();
  const byCode = code => ALL.find(x => x.id === code);
  let shownTurn = 0;
  let failures = 0;
  let chosen = new Set();      // codes already in the van — ticked on their cards
  let chosenKey = '';

  function searchFor(term) {
    // fallback for a kind with no matches: put the words in the library search
    if (typeof state !== 'undefined') { state.q = term; state.filter = 'All'; }
    const box = document.getElementById('search'); if (box) box.value = term;
    if (typeof renderLibrary === 'function') renderLibrary();
    const lib = document.getElementById('furniture-library'); if (lib) lib.scrollIntoView({ behavior: 'smooth' });
  }

  function itemCard(code, name, isNew) {
    const x = byCode(code);
    const img = (x && (x.item_img || x.image)) || `img/item/${code}.webp`;
    const el = document.createElement('div');
    el.className = 'it' + (isNew ? ' new' : '') + (chosen.has(code) ? ' chosen' : '');
    el.innerHTML = `<img src="${img}" alt=""><div><div class="nm">${(x && x.name) || name || code}</div><div class="cd">${code}</div></div>` + (chosen.has(code) ? '<span class="ck" title="in your van">✓</span>' : '');
    el.onclick = () => { if (x && typeof openItem === 'function') openItem(x); else searchFor(code); if (window.liveEvent) window.liveEvent('strip_click', { code }); };
    return el;
  }

  function kindGroup(e, isNew) {
    // "fold-down bed" → the items the wizard's search matched, as ordinary cards
    const g = document.createElement('div');
    const matches = e.matches || [];
    g.className = 'kind' + (matches.length ? '' : ' nomatch');
    g.innerHTML = `<div class="kl"><b>${e.name}</b>${matches.length ? 'closest on the site' : 'tap to search'}</div>`;
    for (const code of matches) g.appendChild(itemCard(code, '', isNew));
    if (!matches.length) g.querySelector('.kl').onclick = () => { searchFor(e.name); if (window.liveEvent) window.liveEvent('kind_click', { label: e.name }); };
    return g;
  }

  function fill(row, items, isNew) {
    row.innerHTML = '';
    for (const it of items) row.appendChild(it.code ? itemCard(it.code, it.name, isNew) : kindGroup(it, isNew));
  }

  function render(mentions, force) {
    const withItems = mentions.filter(m => m.items && m.items.length);
    if (!withItems.length) return;
    const latest = withItems[withItems.length - 1];
    const isNew = latest.turn > shownTurn && shownTurn > 0;
    const changed = latest.turn !== shownTurn || force;
    if (changed) fill(document.getElementById('liverow'), latest.items, isNew);
    // "Earlier": everything mentioned before the latest reply, each item ONCE
    // (at its most recent mention), newest first — a compact "brought up so far"
    const seen = new Set(latest.items.map(it => it.code || 'kind:' + it.name));
    const earlier = [];
    for (const m of withItems.slice(0, -1).reverse())
      for (const it of m.items) {
        const k = it.code || 'kind:' + it.name;
        if (seen.has(k)) continue;
        seen.add(k); earlier.push({ ...it, at: m.at });
      }
    document.getElementById('livetg').style.display = earlier.length ? '' : 'none';
    document.getElementById('livetg').textContent = (strip.classList.contains('open') ? 'Earlier ▴' : 'Earlier ▾') + (earlier.length ? ` (${earlier.length})` : '');
    if (changed) {
      const hist = document.getElementById('livehist');
      hist.innerHTML = earlier.length ? '<p class="sub">Everything the assistant has brought up so far — ✓ means it is in your van</p>' : '';
      const row = document.createElement('div'); row.className = 'row'; row.style.flexWrap = 'wrap';
      fill(row, earlier, false);
      hist.appendChild(row);
    }
    shownTurn = latest.turn;
  }

  async function tick() {
    try {
      const r = await fetch(`${FEED}/p/state?key=${encodeURIComponent(KEY)}${SAMPLE}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const s = await r.json();
      failures = 0;
      const ck = (s.chosen || []).join(',');
      const chosenChanged = ck !== chosenKey;
      if (chosenChanged) { chosen = new Set(s.chosen || []); chosenKey = ck; }
      document.getElementById('livedot').className = 'dot on';
      document.getElementById('livenote').textContent = (s.mentions || []).some(m => m.items && m.items.length) ? 'latest reply · tap an item to see it' : 'waiting for the first suggestion';
      render(s.mentions || [], chosenChanged);
      window.liveSpeaking = !!s.speaking;                   // for the interrupt button (P3)
    } catch (e) {
      if (++failures >= 3) {
        document.getElementById('livedot').className = 'dot';
        document.getElementById('livenote').textContent = 'not connected';
      }
    }
  }
  tick(); setInterval(tick, 2000);
})();
