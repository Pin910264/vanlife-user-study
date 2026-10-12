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
  #live .stoprow{display:flex;align-items:center;gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid #374151}
  #live .stopnote{font-size:12px;color:#94a3b8}
  #live .stopbtn{border:0;border-radius:10px;padding:10px 16px;font-size:15px;font-weight:800;cursor:pointer;background:#f59e0b;color:#1f1300;box-shadow:0 0 0 0 #f59e0b00;transition:box-shadow .2s}
  #live .stopbtn:not(:disabled){animation:stoppulse 1.2s ease-in-out infinite}
  @keyframes stoppulse{0%,100%{box-shadow:0 0 0 0 #f59e0b66}50%{box-shadow:0 0 0 8px #f59e0b00}}
  #live .stopbtn:disabled{background:#374151;color:#6b7280;cursor:default}
  #live .stopbtn.sent{background:#22c55e;color:#052e16}
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
    + '<div class="hist" id="livehist"></div>'
    + '<div class="stoprow"><button class="stopbtn" id="livestop" disabled>✋ I wasn\'t done talking</button><span class="stopnote" id="livestopnote">lights up while the assistant is talking — press it to cut in and keep going</span></div>';
  const header = document.querySelector('header') || document.querySelector('.nav');
  (header && header.parentNode) ? header.parentNode.insertBefore(strip, header.nextSibling) : document.body.prepend(strip);
  document.getElementById('livetg').onclick = () => {
    strip.classList.toggle('open');
    const tg = document.getElementById('livetg'); tg.textContent = tg.textContent.replace(/Earlier [▴▾]/, strip.classList.contains('open') ? 'Earlier ▴' : 'Earlier ▾');
    liveEvent('history_toggle', { open: strip.classList.contains('open') });
  };

  // ── participant interaction log (P2): clicks and searches, one line each ──
  // Sent as a plain-text POST (no preflight) and ignored on failure; the page
  // never waits on it.
  function liveEvent(type, data) {
    try {
      fetch(`${FEED}/p/event?key=${encodeURIComponent(KEY)}`, { method: 'POST', keepalive: true,
        body: JSON.stringify({ type, data: data || {}, t: new Date().toISOString() }) }).catch(() => {});
    } catch (e) {}
  }
  window.liveEvent = liveEvent;
  if (typeof openItem === 'function') {                   // every item opened, from anywhere on the page
    const _open = openItem;
    openItem = function (x) { liveEvent('item_open', { code: x && x.id }); return _open.apply(this, arguments); };
  }
  let searchTimer = null;
  document.addEventListener('input', e => {               // a search, logged after the typing pauses
    if (e.target && e.target.id === 'search') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => liveEvent('search', { q: e.target.value }), 800);
    }
  });
  document.addEventListener('click', e => {               // area filter chips
    const b = e.target && e.target.closest && e.target.closest('[data-filter]');
    if (b) liveEvent('filter', { filter: b.dataset.filter });
  });
  liveEvent('page_open', { href: location.href.replace(/key=[^&]*/, 'key=…') });

  // ── "I wasn't done" (P3): live only while the assistant is speaking ──
  const stopBtn = document.getElementById('livestop');
  stopBtn.onclick = async () => {
    stopBtn.disabled = true; stopBtn.textContent = '✋ …';
    liveEvent('interrupt', {});
    try {
      const r = await fetch(`${FEED}/p/interrupt?key=${encodeURIComponent(KEY)}`, { method: 'POST', body: '{}' });
      const j = await r.json();
      stopBtn.classList.add('sent'); stopBtn.textContent = j.accepted ? '✓ go ahead' : '✋ I wasn\'t done talking';
    } catch (e) { stopBtn.textContent = '✋ I wasn\'t done talking'; }
    setTimeout(() => { stopBtn.classList.remove('sent'); stopBtn.textContent = '✋ I wasn\'t done talking'; }, 2500);
  };
  function setSpeaking(on) {
    if (on && stopBtn.classList.contains('sent')) return;   // just pressed: stay off until the next reply
    stopBtn.disabled = !on;
    const note = document.getElementById('livestopnote');
    if (note) note.textContent = on ? 'the assistant is talking — press to cut in and keep going' : 'lights up while the assistant is talking';
  }

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
    el.onclick = () => { if (x && typeof openItem === 'function') openItem(x); else searchFor(code); liveEvent('strip_click', { code }); };
    return el;
  }

  function kindGroup(e, isNew) {
    // "fold-down bed" → the items the wizard's search matched, as ordinary cards
    const g = document.createElement('div');
    const matches = e.matches || [];
    g.className = 'kind' + (matches.length ? '' : ' nomatch');
    g.innerHTML = `<div class="kl"><b>${e.name}</b>${matches.length ? 'closest on the site' : 'tap to search'}</div>`;
    for (const code of matches) g.appendChild(itemCard(code, '', isNew));
    if (!matches.length) g.querySelector('.kl').onclick = () => { searchFor(e.name); liveEvent('kind_click', { label: e.name }); };
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
      window.liveSpeaking = !!s.speaking;
      setSpeaking(!!s.speaking);
    } catch (e) {
      if (++failures >= 3) {
        document.getElementById('livedot').className = 'dot';
        document.getElementById('livenote').textContent = 'not connected';
      }
    }
  }
  tick(); setInterval(tick, 1000);
})();
