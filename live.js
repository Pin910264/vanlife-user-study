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
  #live{position:sticky;top:0;z-index:40;background:#111827;color:#fff;padding:6px 12px 7px;box-shadow:0 2px 10px #0003}
  #live .hd{display:flex;align-items:center;gap:8px;font-size:12px;color:#cbd5e1;margin-bottom:5px;min-height:26px}
  #live .hd b{color:#fff;font-size:13px;white-space:nowrap}
  #live .hd .sp{flex:1}
  #live .dot{width:7px;height:7px;border-radius:50%;background:#64748b;display:inline-block;flex:0 0 auto}
  #live .dot.on{background:#22c55e}
  #live .tg{border:1px solid #475569;background:transparent;color:#cbd5e1;border-radius:7px;padding:3px 8px;font-size:11px;cursor:pointer;white-space:nowrap}
  #live .tg:hover{border-color:#93c5fd;color:#fff}
  #live .row{display:flex;gap:6px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px;align-items:center}
  #live .it{flex:0 0 auto;display:flex;gap:6px;align-items:center;background:#1f2937;border:1px solid #374151;border-radius:8px;padding:3px 8px 3px 3px;cursor:pointer;max-width:230px;position:relative}
  #live .it:hover{border-color:#93c5fd}
  #live .it.new{border-color:#60a5fa;animation:livepulse 1.2s ease-out 2}
  @keyframes livepulse{0%{box-shadow:0 0 0 0 #60a5fa88}100%{box-shadow:0 0 0 8px #60a5fa00}}
  #live .it img{width:36px;height:28px;object-fit:contain;background:#fff;border-radius:4px}
  #live .it .nm{font-weight:600;font-size:12px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
  #live .it .cd{font:600 11px Menlo,Consolas,monospace;color:#93c5fd;margin-top:1px}
  #live .it.chosen{border-color:#34d399}
  #live .it.cur{outline:2px solid #fbbf24;outline-offset:1px}
  #live .it .ck{position:absolute;top:-6px;right:-6px;width:15px;height:15px;border-radius:50%;background:#34d399;color:#052e16;font:700 10px/15px -apple-system,Helvetica,sans-serif;text-align:center}
  #live .kind{flex:0 0 auto;display:flex;gap:6px;align-items:center;padding:2px 0 2px 8px;border-left:3px solid #475569;margin-left:2px}
  #live .kind .kl{flex:0 0 auto;font-size:11px;color:#cbd5e1;max-width:110px;line-height:1.2}
  #live .kind .kl b{display:block;color:#fff;font-size:12px}
  #live .kind.nomatch .kl{cursor:pointer;text-decoration:underline dotted}
  #live .none{color:#94a3b8;font-size:12px;padding:4px 0}        /* not '.empty': the catalog styles that with 60px of padding, which made the bar 185px tall (10-14) */
  #live .keys{display:none;font-size:11px;color:#64748b;white-space:nowrap;margin-left:4px}
  @media(hover:hover) and (pointer:fine){#live .keys{display:inline}}
  #live .hist{display:none;margin-top:6px;border-top:1px solid #374151;padding-top:6px;max-height:40vh;overflow-y:auto}
  #live.open .hist{display:block}
  #live .hist .sub{font-size:11px;color:#94a3b8;margin:0 0 4px}
  #live .stopbtn{border:0;border-radius:8px;padding:5px 11px;font-size:12px;font-weight:800;cursor:pointer;background:#f59e0b;color:#1f1300;white-space:nowrap}
  #live .stopbtn:disabled{background:#374151;color:#6b7280;cursor:default}
  #live .stopbtn.sent{background:#22c55e;color:#052e16}
  #live .stopbtn:not(:disabled){animation:stoppulse 1.2s ease-in-out infinite}
  @keyframes stoppulse{0%,100%{box-shadow:0 0 0 0 #f59e0b66}50%{box-shadow:0 0 0 8px #f59e0b00}}
  /* the floor plan: a corner mini-map; tap to enlarge, tap again to shrink */
  #liveplanbox{position:fixed;right:12px;bottom:12px;z-index:50;width:200px;background:#0b1220;border:1px solid #334155;border-radius:10px;box-shadow:0 4px 16px #0006;cursor:zoom-in;overflow:hidden;transition:width .15s}
  #liveplanbox.big{width:min(92vw,900px);cursor:zoom-out}
  #liveplanbox .pt{display:flex;align-items:center;gap:6px;font:600 11px -apple-system,Helvetica,sans-serif;color:#cbd5e1;padding:5px 8px 2px}
  #liveplanbox .pt .sp{flex:1}
  #liveplanbox .pt .x{color:#94a3b8;font-size:11px}
  #liveplanbox svg{display:block;width:100%;height:auto}
  #liveplanbox.big .pt{font-size:13px;padding:8px 12px 4px}
  @media(max-width:720px){#live{padding:6px 8px}#liveplanbox{width:150px;right:8px;bottom:8px}}`;
  document.head.appendChild(css);

  const strip = document.createElement('div');
  strip.id = 'live';
  strip.innerHTML =
    '<div class="hd"><span class="dot" id="livedot"></span><b>Mentioned by the assistant</b><span id="livenote" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">connecting…</span><span class="keys">← → to flip through them</span><span class="sp"></span>'
    + '<button class="tg" id="livetg" style="display:none">Earlier ▾</button>'
    + '<button class="stopbtn" id="livestop" disabled title="Lights up while the assistant is talking — press it to cut in and keep going">✋ I wasn\'t done</button></div>'
    + '<div class="row" id="liverow"><div class="none">Items the assistant names appear here as it says them — tap one to see it.</div></div>'
    + '<div class="hist" id="livehist"></div>';
  const planbox = document.createElement('div');
  planbox.id = 'liveplanbox';
  planbox.innerHTML = '<div class="pt"><span>Your van from above</span><span id="livepn" class="x"></span><span class="sp"></span><span class="x" id="liveplanhint">tap to enlarge</span></div><svg id="liveplan" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet"></svg>';
  document.body.appendChild(planbox);
  function setPlanBig(big) {
    if (planbox.classList.contains('big') === big) return;
    planbox.classList.toggle('big', big);
    document.getElementById('liveplanhint').textContent = big ? 'tap to shrink' : 'tap to enlarge';
    liveEvent('plan_toggle', { big });
  }
  planbox.onclick = (e) => { e.stopPropagation(); setPlanBig(!planbox.classList.contains('big')); };
  document.addEventListener('click', () => setPlanBig(false));        // tap anywhere else closes it
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setPlanBig(false); });
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
  stopBtn.title = 'Lights up as soon as the assistant starts working on what you said — press it to keep going';
  stopBtn.onclick = async () => {
    stopBtn.disabled = true; stopBtn.textContent = '✋ …';
    liveEvent('interrupt', {});
    try {
      const r = await fetch(`${FEED}/p/interrupt?key=${encodeURIComponent(KEY)}`, { method: 'POST', body: '{}' });
      const j = await r.json();
      stopBtn.classList.add('sent'); stopBtn.textContent = j.accepted ? '✓ go ahead' : '✋ I wasn\'t done';
    } catch (e) { stopBtn.textContent = '✋ I wasn\'t done'; }
    setTimeout(() => { stopBtn.classList.remove('sent'); stopBtn.textContent = '✋ I wasn\'t done'; }, 2500);
  };
  function setSpeaking(on) {
    if (on && stopBtn.classList.contains('sent')) return;   // just pressed: stay off until the next reply
    stopBtn.disabled = !on;
  }

  // ── top-down plan (P5): the pieces on the floor, from the wizard's scene feed ──
  let planKey = '';
  function drawPlan(floor, van, chosenSet) {
    const key = JSON.stringify(floor) + '|' + [...chosenSet].join(',');
    if (key === planKey) return;
    planKey = key;
    const W = 1000, H = 560, MX = 90, T = 10;
    const Z0 = van.z[0], Z1 = van.z[1], X0 = van.x[0], X1 = van.x[1];
    const sz = (W - 2 * MX) / (Z1 - Z0), sx = sz;                 // true proportions
    const vh = (X1 - X0) * sx, MY = (H - T - vh) / 2;
    const PX = z => MX + (z - Z0) * sz, PY = x => T + MY + (x - X0) * sx;
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const pal = ['#cfe3ff', '#ffe2b8', '#d6f5d6', '#f6d6f0', '#fff3b0', '#d9d9f3', '#ffd6d6', '#c9f0f0'];
    let g = `<rect x="${PX(Z0)}" y="${PY(X0)}" width="${(Z1 - Z0) * sz}" height="${vh}" rx="14" fill="#1f2937" stroke="#94a3b8" stroke-width="2"/>`
      + `<text x="${PX(Z0) - 8}" y="${PY(X0) + vh / 2 + 4}" text-anchor="end" font-size="12" fill="#94a3b8">REAR DOORS</text>`
      + `<text x="${PX(Z1) + 8}" y="${PY(X0) + vh / 2 + 4}" text-anchor="start" font-size="12" fill="#94a3b8">FRONT · cab</text>`
      + `<text x="${W / 2}" y="${PY(X0) - 6}" text-anchor="middle" font-size="12" fill="#94a3b8">DRIVER SIDE</text>`
      + `<text x="${W / 2}" y="${PY(X1) + 16}" text-anchor="middle" font-size="12" fill="#94a3b8">PASSENGER SIDE</text>`
      + `<line x1="${PX(30)}" y1="${PY(X1)}" x2="${PX(40)}" y2="${PY(X1)}" stroke="#60a5fa" stroke-width="6"/>`
      + `<text x="${PX(35)}" y="${PY(X1) - 6}" text-anchor="middle" font-size="10" fill="#60a5fa">sliding door</text>`;
    floor.forEach((f, i) => {
      const z0 = Math.max(Math.min(f.z0, f.z1), Z0), z1 = Math.min(Math.max(f.z0, f.z1), Z1);
      const x0 = Math.max(Math.min(f.x0, f.x1), X0), x1 = Math.min(Math.max(f.x0, f.x1), X1);
      if (z1 - z0 < 1 || x1 - x0 < 1) return;
      const px = PX(z0), py = PY(x0), pw = (z1 - z0) * sz, ph = (x1 - x0) * sx;
      const fs = (pw > 110 && ph > 40) ? 12 : 9;
      const name = f.label.length > 24 ? f.label.slice(0, 23) + '…' : f.label;
      g += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="4" fill="${pal[i % pal.length]}" fill-opacity="0.9" stroke="${chosenSet.has(f.code) ? '#34d399' : '#111'}" stroke-width="${chosenSet.has(f.code) ? 3 : 1.5}"/>`
        + `<text x="${(px + pw / 2).toFixed(1)}" y="${(py + ph / 2).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="#111">${esc(name)}</text>`
        + (f.code ? `<text x="${(px + pw / 2).toFixed(1)}" y="${(py + ph / 2 + fs + 2).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#1a6fcc">${esc(f.code)}</text>` : '');
    });
    if (!floor.length) g += `<text x="${W / 2}" y="${PY(X0) + vh / 2}" text-anchor="middle" font-size="14" fill="#64748b">nothing on the floor yet</text>`;
    document.getElementById('liveplan').innerHTML = g;
    document.getElementById('livepn').textContent = floor.length ? `· ${floor.length} on the floor` : '· empty';
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
    for (const code of matches.slice(0, 3)) g.appendChild(itemCard(code, '', isNew));   // 3 is plenty to glance at (P7)
    if (!matches.length) g.querySelector('.kl').onclick = () => { searchFor(e.name); liveEvent('kind_click', { label: e.name }); };
    return g;
  }

  // ← / → walk the current reply's cards and open each one as you go (P8);
  // Esc (the catalog's own handler) closes the item. Ignored while typing.
  let cursor = -1;
  function stepCards(d) {
    const cards = Array.from(document.querySelectorAll('#liverow .it'));
    if (!cards.length) return;
    cursor = (cursor + d + cards.length) % cards.length;
    cards.forEach((c, i) => c.classList.toggle('cur', i === cursor));
    const el = cards[cursor];
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const code = el.querySelector('.cd').textContent, x = byCode(code);
    if (x && typeof openItem === 'function') openItem(x);
    liveEvent('strip_key', { code, index: cursor + 1, of: cards.length });
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    e.preventDefault(); stepCards(e.key === 'ArrowRight' ? 1 : -1);
  });

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
    if (isNew) { strip.classList.remove('open'); cursor = -1; }   // a new reply: Earlier folds, the keyboard cursor resets (P7)
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
      document.getElementById('livenote').textContent = (s.mentions || []).some(m => m.items && m.items.length) ? 'latest reply' : 'waiting for the first suggestion';
      render(s.mentions || [], chosenChanged);
      if (s.van && s.floor) drawPlan(s.floor, s.van, chosen);
      window.liveSpeaking = !!s.speaking;
      setSpeaking(!!s.speaking);
    } catch (e) {
      if (++failures >= 3) {
        document.getElementById('livedot').className = 'dot';
        document.getElementById('livenote').textContent = 'not connected';
      }
    }
  }
  tick(); setInterval(tick, 400);                       // the button must light within half a second of the stop press
})();
