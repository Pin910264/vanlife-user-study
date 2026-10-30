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
  const STAGE = q.get('stage') ? '&stage=' + encodeURIComponent(q.get('stage')) : '';   // testing: preview one stage (check / intro / talk / browse)
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
  /* status chip (P14): what the assistant is doing right now, beside the ✋ button */
  /* status chip, upper right of the bar: amber "Thinking…" / blue "Speaking", nothing while it is their turn */
  #livestwrap{position:relative;display:inline-block;margin-right:6px}
  #livest{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:4px 12px 4px 8px;font-weight:700;font-size:12px;white-space:nowrap;min-width:118px;cursor:default}
  #livest.idle{background:#1f2937;color:#9ca3af}#livest.idle .dot{width:8px;height:8px;border-radius:50%;background:#6b7280;display:inline-block}
  #livest.thinking{background:#2a1a00;color:#fbbf24}#livest.speaking{background:#0b1f3a;color:#93c5fd}
  #livemenu{display:none;position:absolute;left:0;top:100%;padding-top:6px;z-index:70}
  #livemenu .box{background:#111827;border:1px solid #374151;border-radius:10px;padding:8px 10px;box-shadow:0 6px 18px #0005;white-space:nowrap}
  #livestwrap:hover #livemenu,#livestwrap.open #livemenu{display:block}
  #livest{cursor:pointer}
  #livest .bars{display:inline-flex;gap:2px;align-items:flex-end;height:14px}#livest .bars i{width:3px;background:currentColor;border-radius:2px;animation:livebar .8s ease-in-out infinite}
  #livest .bars i:nth-child(2){animation-delay:.15s}#livest .bars i:nth-child(3){animation-delay:.3s}#livest.speaking .bars i{animation-duration:1.4s}
  @keyframes livebar{0%,100%{height:4px}50%{height:14px}}
  #livest .orbit{position:relative;width:14px;height:14px;display:inline-block}#livest .orbit i{position:absolute;width:4px;height:4px;border-radius:50%;background:currentColor;top:5px;left:5px;animation:liveorb 1.2s linear infinite}
  #livest .orbit i:nth-child(2){animation-delay:.4s}#livest .orbit i:nth-child(3){animation-delay:.8s}
  @keyframes liveorb{from{transform:rotate(0) translateX(6px)}to{transform:rotate(360deg) translateX(6px)}}
  /* the floating ✋: fixed bottom-left, one size, space bar too; the sound switch drops down on hover */
  #livefab{position:fixed;left:16px;bottom:16px;z-index:60}
  #livenotebox{display:none;position:fixed;left:16px;bottom:72px;z-index:59;width:300px;background:#0b1220;border:1px solid #334155;border-radius:10px;padding:10px 12px;box-shadow:0 4px 16px #0006;color:#e2e8f0;font:12px/1.4 Inter,system-ui,sans-serif}
  #livenotebox .nh{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#94a3b8;display:flex;gap:8px}#livenotebox .nh span{flex:1}#livenotebox .nh em{font-style:normal;font-weight:400;text-transform:none;letter-spacing:0;color:#4ade80}
  #livenotebox textarea{width:100%;box-sizing:border-box;margin-top:6px;height:58px;resize:vertical;font:inherit;color:#e2e8f0;background:#111a2e;border:1px solid #334155;border-radius:8px;padding:6px 8px}
  #livenotebox .nf{display:flex;gap:8px;align-items:center;margin-top:6px;font-size:11px;color:#94a3b8}#livenotebox .nf span{flex:1}#livenotebox button{font:inherit;font-weight:700;padding:4px 12px;border-radius:999px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer}
  #livefab .stopbtn{display:inline-flex;align-items:center;gap:10px;padding:12px 16px;font-size:15px;border-radius:14px;box-shadow:0 6px 18px #0005;min-width:200px;justify-content:center}
  #livefab .stopbtn .key{font:600 10px Menlo,Consolas,monospace;border:1px solid currentColor;border-radius:4px;padding:1px 5px;opacity:.6}
  @media(max-width:720px){#livefab{left:8px;bottom:8px}#livefab .stopbtn{min-width:0;padding:10px 12px;font-size:13px}#livefab .stopbtn .key{display:none}}
  /* the sound switch: a small toggle, on by default */
  #livesnd{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:#cbd5e1;font-size:11px;cursor:pointer;white-space:nowrap;padding:0 2px}
  #livesnd .sw{position:relative;width:30px;height:16px;border-radius:999px;background:#22c55e;transition:background .15s}
  #livesnd .sw:after{content:"";position:absolute;top:2px;left:16px;width:12px;height:12px;border-radius:50%;background:#fff;transition:left .15s}
  #livesnd.off .sw{background:#4b5563}#livesnd.off .sw:after{left:2px}#livesnd.off{color:#94a3b8}
  #live .stopbtn,#livefab .stopbtn{border:0;border-radius:8px;padding:5px 11px;font-size:12px;font-weight:800;cursor:pointer;background:#f59e0b;color:#1f1300;white-space:nowrap}
  #live .stopbtn:disabled,#livefab .stopbtn:disabled{background:#374151;color:#9ca3af;cursor:default}
  #live .stopbtn.sent,#livefab .stopbtn.sent{background:#22c55e;color:#052e16}
  #live .stopbtn:not(:disabled),#livefab .stopbtn:not(:disabled){animation:stoppulse 1.2s ease-in-out infinite}
  @keyframes stoppulse{0%,100%{box-shadow:0 0 0 0 #f59e0b66}50%{box-shadow:0 0 0 8px #f59e0b00}}
  /* A small overview; enlarge to point, explicit button to minimize. */
  #liveplanbox{position:fixed;right:12px;bottom:12px;z-index:50;width:200px;background:#0b1220;border:1px solid #334155;border-radius:10px;box-shadow:0 4px 16px #0006;cursor:zoom-in;overflow:hidden;transition:width .15s}
  #liveplanbox.big{width:min(92vw,900px);max-height:calc(100dvh - 24px);overflow:auto;cursor:default}
  #liveplanbox button{font:inherit;color:#e2e8f0;background:#1e293b;border:1px solid #64748b;border-radius:6px;padding:5px 9px;cursor:pointer}
  #liveplanbox button:disabled{opacity:.45;cursor:default}
  #liveplanbox button:focus-visible{outline:2px solid #fbbf24;outline-offset:2px}
  #liveplanbox.big svg{max-height:calc(100dvh - 200px)}
  #liveplanbox .pt{display:flex;align-items:center;gap:6px;font:600 11px -apple-system,Helvetica,sans-serif;color:#cbd5e1;padding:5px 8px 2px}
  #liveplanbox .pt .sp{flex:1}
  #liveplanbox .pt .x{color:#94a3b8;font-size:11px}
  #liveplanbox svg{display:block;width:100%;height:auto}
  #liveplanbox.big .pt{font-size:13px;padding:8px 12px 4px}
  @media(max-width:720px){#live{padding:6px 8px}#liveplanbox{width:150px;right:8px;bottom:8px}}`;
  css.textContent += `
  /* participant flow (10-14): link check → trip sentence → talking → browsing */
  #livestage{max-width:760px;margin:40px auto;padding:0 16px;font-family:Inter,ui-sans-serif,-apple-system,sans-serif;color:#111827}
  #livestage .card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:34px 36px;box-shadow:0 2px 12px #0000000a}
  #livestage h2{margin:0 0 14px;font-size:26px;letter-spacing:-.02em}
  #livestage p{font-size:17px;line-height:1.6;color:#475467;margin:0}
  #livestage .words{display:flex;gap:18px;flex-wrap:wrap;margin:22px 0 26px}
  #livestage .words span{font:800 38px/1 Inter,ui-sans-serif,-apple-system,sans-serif;letter-spacing:-.02em;background:#f3f4f6;border-radius:14px;padding:18px 24px}
  #livestage .sentence{font-size:24px;line-height:1.9;margin:20px 0 22px;color:#111827}
  #livestage .sentence input{font:inherit;color:#1d4ed8;border:0;border-bottom:2px solid #93c5fd;background:#eff6ff;border-radius:6px 6px 0 0;padding:0 8px;min-width:4ch;outline:none}
  #livestage .sentence input:focus{border-bottom-color:#1d4ed8;background:#dbeafe}
  #livestage .sentence input::placeholder{color:#94a3b8;font-style:italic}
  #livestage .sentence b{color:#1d4ed8;font-weight:600}
  #livestage .hint{font-size:15px;color:#6b7280}
  #livestage.wide{max-width:none;margin:0;padding:0}
  #livestage .survey .frame{background:#fff}
  #livestage iframe{display:block;width:100%;height:calc(100vh - 44px);border:0}
  #livestage .sfoot{height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px;font-size:13px;color:#6b7280;background:#f5f6f8;border-top:1px solid #e5e7eb}
  #livestage .mini{font-size:13px;padding:5px 12px;border-radius:8px;border:1px solid #cfd4dc;background:#fff;cursor:pointer}
  /* rehearsal card replicas (P21) */
  #livestage .row{display:flex;gap:18px;align-items:center;margin:16px 0}#livestage .row p{margin:0;flex:1}
  #livestage .demo{display:flex;align-items:center;gap:8px;flex:0 0 auto;background:#111827;border-radius:12px;padding:10px 12px}
  #livestage .arrow{color:#6b7280;font-size:14px}
  #livestage .rchip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px 4px 8px;font-weight:700;font-size:12px;white-space:nowrap}
  #livestage .rchip.idle{background:#1f2937;color:#9ca3af}#livestage .rchip.idle .dot{width:8px;height:8px;border-radius:50%;background:#6b7280;display:inline-block}
  #livestage .rchip.thinking{background:#2a1a00;color:#fbbf24}#livestage .rchip.speaking{background:#0b1f3a;color:#93c5fd}
  #livestage .rchip .bars{display:inline-flex;gap:2px;align-items:flex-end;height:14px}#livestage .rchip .bars i{width:3px;background:currentColor;border-radius:2px;animation:livebar .8s ease-in-out infinite}
  #livestage .rchip .bars i:nth-child(2){animation-delay:.15s}#livestage .rchip .bars i:nth-child(3){animation-delay:.3s}
  #livestage .rchip .orbit{position:relative;width:14px;height:14px;display:inline-block}#livestage .rchip .orbit i{position:absolute;width:4px;height:4px;border-radius:50%;background:currentColor;top:5px;left:5px;animation:liveorb 1.2s linear infinite}
  #livestage .rchip .orbit i:nth-child(2){animation-delay:.4s}#livestage .rchip .orbit i:nth-child(3){animation-delay:.8s}
  #livestage .rfab{display:inline-flex;align-items:center;gap:8px;border-radius:12px;padding:9px 13px;font-weight:800;font-size:13px;white-space:nowrap}
  #livestage .rfab.off{background:#374151;color:#9ca3af}#livestage .rfab.on{background:#f59e0b;color:#1f1300;animation:stoppulse 1.2s ease-in-out infinite}
  #livestage .rfab .key{font:600 10px Menlo,Consolas,monospace;border:1px solid currentColor;border-radius:4px;padding:1px 5px;opacity:.6}
  #livestage .rsw{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#cbd5e1}#livestage .rsw i{position:relative;width:30px;height:16px;border-radius:999px;background:#22c55e;display:inline-block}#livestage .rsw i:after{content:"";position:absolute;top:2px;left:16px;width:12px;height:12px;border-radius:50%;background:#fff}
  @media(max-width:640px){#livestage .row{flex-direction:column;align-items:flex-start}}
  /* the tour: a dimmed page, the target lifted above it, a card with an arrow pointing at it */
  #livetour .dim{position:fixed;inset:0;background:#0008;z-index:80}
  .spot{position:relative;z-index:85 !important;box-shadow:0 0 0 4px #fbbf24,0 0 0 9px #fbbf2444;border-radius:999px}
  #livefab.spot{position:fixed;border-radius:14px}
  #livetour .card{position:fixed;z-index:90;width:340px;background:#fff;border-radius:14px;padding:18px 20px 16px;box-shadow:0 12px 36px #0006;font-family:Inter,ui-sans-serif,-apple-system,sans-serif;color:#111827}
  #livetour .card:before{content:"";position:absolute;left:var(--ax,30px);width:16px;height:16px;background:#fff;transform:translateX(-50%) rotate(45deg)}
  #livetour .card.up:before{top:-8px}#livetour .card.down:before{bottom:-8px}
  #livetour .step{font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.04em;text-transform:uppercase}
  #livetour h3{margin:4px 0 8px;font-size:18px}#livetour p{margin:0 0 14px;font-size:15px;line-height:1.5;color:#374151}
  #livetour button{font-size:15px;padding:10px 18px;border-radius:10px;border:0;background:#111827;color:#fff;cursor:pointer}
  #livestwrap.open #livemenu{z-index:86}
  #livenotice{max-width:1180px;margin:18px auto 0;padding:0 24px}
  #livenotice .card{background:#fffbeb;border:1px solid #fcd34d;border-radius:14px;padding:16px 20px;display:flex;gap:14px;align-items:center;font-size:16px;color:#78350f}
  #livenotice .card b{font-weight:800}
  #livenotice .x{margin-left:auto;border:0;background:transparent;font-size:20px;cursor:pointer;color:#92400e}
  @media(max-width:640px){#livestage .card{padding:24px 20px}#livestage .words span{font-size:28px;padding:14px 18px}#livestage .sentence{font-size:20px}}`;
  document.head.appendChild(css);

  const strip = document.createElement('div');
  strip.id = 'live';
  strip.innerHTML =
    '<div class="hd"><span id="livestwrap"><span id="livest" class="idle"><span class="dot"></span>Your turn</span>'
    + '<div id="livemenu"><div class="box"><button id="livesnd" title="The soft trill while the assistant thinks — switch it off if you find it distracting; the short chime at the start and the amber light stay"><span class="sw"></span><span class="lbl">thinking sound on</span></button></div></div></span>'
    + '<span class="dot" id="livedot"></span><b>Mentioned by the assistant</b><span id="livenote" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">connecting…</span><span class="keys">← → to flip through them</span><span class="sp"></span>'
    + '<button class="tg" id="livetg" style="display:none">Earlier ▾</button>'
    + '</div>'
    + '<div class="row" id="liverow"><div class="none">Items the assistant names appear here as it says them — tap one to see it.</div></div>'
    + '<div class="hist" id="livehist"></div>';
  // ✋ floats bottom-left, always the same size (10-15); hovering it shows the sound switch
  const fab = document.createElement('div');
  fab.id = 'livefab';
  fab.innerHTML = '<button class="stopbtn" id="livestop" disabled title="Lights up while the assistant is working — press it, or the space bar, to cut in and keep going"><span class="lbl">✋ I wasn\'t done</span><span class="key">space</span></button>';
  document.body.appendChild(fab);
  const planbox = document.createElement('div');
  planbox.id = 'liveplanbox';
  planbox.innerHTML = '<div class="pt"><span>Your van from above</span><span id="livepn" class="x"></span><span class="sp"></span><button type="button" class="x" id="liveplanhint">Enlarge</button></div><svg id="liveplan" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet"></svg>';
  document.body.appendChild(planbox);
  const placementTools = document.createElement('div');
  placementTools.style.cssText = 'padding:8px 12px;color:#cbd5e1;font-size:12px;display:none';
  placementTools.innerHTML = '<div>Click a spot, then tell the assistant what goes there.</div><div id="placementstatus" role="status" aria-live="polite"></div><button type="button" id="placementclear">Clear location</button> <button type="button" id="placementretry" hidden>Retry</button><div style="margin-top:4px">Changes made while the assistant is thinking apply to the next turn.</div>';
  planbox.appendChild(placementTools);
  const planSvg = document.getElementById('liveplan');
  let planGeometry = null, placementState = {revision: 0, marker: null};
  let placementBusy = false, placementRequest = null, placementError = '';

  function renderPlacement() {
    const old = document.getElementById('placementpin'); if (old) old.remove();
    const draft = placementRequest && !placementRequest.clear ? placementRequest : null;
    const m = draft || (placementRequest && placementRequest.clear ? null : placementState.marker);
    if (m && planGeometry) {
      const {MX, T, MY, sz, sx, Z0, X0} = planGeometry;
      const px = MX + (m.z - Z0) * sz, py = T + MY + (m.x - X0) * sx;
      const color = draft ? '#fbbf24' : m.status === 'previous' ? '#94a3b8' : '#f59e0b';
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.id = 'placementpin'; g.style.pointerEvents = 'none';
      g.innerHTML = `<circle cx="${px}" cy="${py}" r="10" fill="${color}" stroke="white" stroke-width="3"/><path d="M ${px-16} ${py} h 32 M ${px} ${py-16} v 32" stroke="${color}" stroke-width="2"/>`;
      planSvg.appendChild(g);
    }
    const status = placementError || (placementBusy ? 'Sending…' : m ? ({pending:'Received — suggested spot for your next turn.', in_turn:'Included in the current turn.', previous:'Previous suggestion — click again for a new turn.'}[m.status] || '') : 'No location selected.');
    document.getElementById('placementstatus').textContent = status;
    document.getElementById('placementclear').disabled = placementBusy || (!m && !placementRequest);
    document.getElementById('placementretry').hidden = !placementError || !placementRequest;
  }
  function applyPlacement(value) {
    if (!value || value.revision < placementState.revision) return;
    placementState = value;
    // A poll can recover an acknowledgement lost in transit.
    if (!placementBusy && placementRequest && value.marker && value.marker.id === placementRequest.id) {
      placementRequest = null; placementError = '';
    }
    renderPlacement();
  }
  async function sendPlacement() {
    if (placementBusy || !placementRequest) return;
    placementBusy = true; placementError = ''; renderPlacement();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(`${FEED}/p/placement?key=${encodeURIComponent(KEY)}`, {
        method:'POST', body:JSON.stringify(placementRequest), signal:controller.signal
      });
      const result = await r.json();
      if (result.placement) placementState = result.placement;
      if (!r.ok) {
        placementRequest = null;
        throw new Error(result.error || 'Please select the spot again.');
      }
      placementRequest = null;
    } catch (e) {
      placementError = placementRequest ? 'Delivery unconfirmed — retry or clear before continuing.' : e.message;
    } finally {
      clearTimeout(timeout); placementBusy = false; renderPlacement();
    }
  }
  function selectPlacement(point) {
    if (placementBusy) return;
    placementRequest = {id: crypto.randomUUID(), revision: placementState.revision, ...point};
    sendPlacement();
  }
  document.getElementById('placementclear').onclick = e => { e.stopPropagation(); selectPlacement({clear:true}); };
  document.getElementById('placementretry').onclick = e => { e.stopPropagation(); sendPlacement(); };
  placementTools.onclick = e => e.stopPropagation();
  placementTools.onkeydown = e => e.stopPropagation();
  planSvg.onclick = e => {
    e.stopPropagation();
    if (!planbox.classList.contains('big')) { setPlanBig(true); return; }
    if (!planGeometry || placementBusy) return;
    const matrix = planSvg.getScreenCTM(); if (!matrix) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    const {MX, T, MY, sz, sx, Z0, Z1, X0, X1} = planGeometry;
    const x = X0 + (p.y - T - MY) / sx, z = Z0 + (p.x - MX) / sz;
    if (x < X0 || x > X1 || z < Z0 || z > Z1) return;
    selectPlacement({x, z});
  };

  // ── the flow: what the page shows is decided by the wizard (s.stage) ──
  const app = document.getElementById('app');
  const stageBox = document.createElement('div'); stageBox.id = 'livestage'; stageBox.style.display = 'none';
  app.parentNode.insertBefore(stageBox, app);
  const notice = document.createElement('div'); notice.id = 'livenotice'; notice.style.display = 'none';
  app.parentNode.insertBefore(notice, app);
  notice.innerHTML = '<div class="card"><span>👀</span><div><b>Take a moment to browse your options.</b> When you are ready to start designing, just say so.</div><button class="x" title="hide">×</button></div>';
  notice.querySelector('.x').onclick = () => { notice.style.display = 'none'; liveEvent('notice_closed', {}); };
  const FIELDS = [['from', 'where you start'], ['who', 'who'], ['where', 'where'], ['when', 'time of year'], ['activity', 'activity']];
  const LEAD = "I am ready to start designing. ";   // the fixed opening: the wizard knows this is the sentence, not a stray turn
  // what they typed survives a reload of THIS session only: the store is keyed by the
  // session's participant key, so a new session (new key) starts blank even on a device
  // that ran an earlier one (10-14: a test came up pre-filled with the previous run)
  const INTRO_KEY = 'liveintro:' + KEY;
  let intro = {};
  try { intro = JSON.parse(localStorage.getItem(INTRO_KEY) || '{}') || {}; } catch (e) {}
  try { Object.keys(localStorage).filter(k => k.startsWith('liveintro') && k !== INTRO_KEY).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  const sentenceText = v => `${LEAD}I'm going on a one-month trip from ${v.from || '___'} with ${v.who || '___'} to ${v.where || '___'} in ${v.when || '___'}. During the trip, we'll be ${v.activity || '___'}.`;
  let introTimer = null;
  function sendIntro() {
    clearTimeout(introTimer);
    introTimer = setTimeout(() => liveEvent('intro', { ...intro, text: sentenceText(intro) }), 700);
  }
  function fit(inp) { inp.style.width = Math.max((inp.value || inp.placeholder).length + 3, 5) + 'ch'; }   // 'ch' is narrower than most letters in Inter
  function introCard() {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<h2>Your trip</h2><div class="sentence"></div><p class="hint">Take a minute to fill this in. When you are ready to start designing, press the button and read the whole line aloud, starting with "I am ready".</p>'
      + '<p style="margin-top:18px"><button id="livego" style="font-size:17px;padding:13px 24px;border-radius:12px;border:0;background:#111827;color:#fff;cursor:pointer">I\'m ready — start</button></p>';
    const sen = c.querySelector('.sentence');
    const lead = document.createElement('b'); lead.textContent = LEAD; lead.style.color = '#111827'; sen.appendChild(lead);
    const parts = ["I'm going on a one-month trip from ", 'from', ' with ', 'who', ' to ', 'where', ' in ', 'when', '. During the trip, we\'ll be ', 'activity', '.'];
    for (const part of parts) {
      const f = FIELDS.find(x => x[0] === part);
      if (!f) { sen.appendChild(document.createTextNode(part)); continue; }
      const inp = document.createElement('input'); inp.placeholder = f[1]; inp.value = intro[f[0]] || ''; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.oninput = () => { intro[f[0]] = inp.value.trim(); fit(inp); try { localStorage.setItem(INTRO_KEY, JSON.stringify(intro)); } catch (e) {} sendIntro(); };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const all = [...sen.querySelectorAll('input')]; const n = all[all.indexOf(inp) + 1]; if (n) n.focus(); else inp.blur(); } };
      fit(inp); sen.appendChild(inp);
    }
    const go = c.querySelector('#livego');
    // the button stays grey until every blank is filled: the line is the context for the whole session (10-15)
    const ready = () => FIELDS.every(f => (intro[f[0]] || '').trim());
    const refresh = () => { const ok = ready(); go.disabled = !ok; go.style.opacity = ok ? '1' : '.35'; go.style.cursor = ok ? 'pointer' : 'default'; go.title = ok ? '' : 'Fill in every blank first'; };
    c.querySelectorAll('input').forEach(inp => inp.addEventListener('input', refresh));
    refresh();
    go.onclick = () => {
      if (!ready()) return;
      // the wizard starts recording on this press, so they read the line straight away
      go.disabled = true; go.textContent = 'Listening — read the line now'; go.style.background = '#f59e0b'; go.style.color = '#1f1300';
      liveEvent('start_reading', { ...intro, text: sentenceText(intro) });
    };
    return c;
  }
  let shownStage = '';
  function applyStage(st) {
    if (!st || st === shownStage) return;
    shownStage = st;
    liveEvent('stage_shown', { stage: st });
    const catalog = st === 'browse';
    const survey = st === 'consent' || st === 'questionnaire' || st === 'debrief';
    app.style.display = catalog ? '' : 'none';
    planbox.style.display = catalog ? '' : 'none';
    strip.style.display = (st === 'demo' || st === 'talk' || catalog) ? '' : 'none';   // the rehearsal needs the button in view
    fab.style.display = (st === 'demo' || st === 'talk' || catalog) ? '' : 'none';
    notice.style.display = catalog ? '' : 'none';
    stageBox.style.display = catalog ? 'none' : '';
    stageBox.classList.toggle('wide', survey);
    stageBox.innerHTML = '';
    if (st !== 'demo') endTour();
    const siteHeader = document.querySelector('header');
    if (siteHeader) siteHeader.style.display = survey ? 'none' : '';     // the form gets the whole page (10-19)
    if (survey) {
      const titles = { consent: 'Consent form', questionnaire: 'Questionnaire', debrief: 'Debrief' };
      const c = document.createElement('div'); c.className = 'survey';
      // no Done button (10-30, P24): the form's end-of-survey redirect moves the page on; a stalled form is moved on from the console
      c.innerHTML = `<div class="frame"><iframe id="livesurvey" title="${titles[st]}"></iframe></div>`
        + `<div class="sfoot"><span id="livesurveynote">${titles[st]} · the form appears here when the researcher shares it</span></div>`;
      stageBox.appendChild(c);
      surveyShown = '';
    }
    if (st === 'check') {
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = '<h2>Before we start</h2><p>Please read these three words to the researcher.</p><div class="words"></div><p class="hint">They check that this page is connected to your session.</p>';
      stageBox.appendChild(c);
    } else if (st === 'demo') {
      const c = document.createElement('div'); c.className = 'card'; c.id = 'livedemo';
      stageBox.appendChild(c);
      if (tourStep < TOUR.length) { c.innerHTML = '<h2>A quick tour</h2><p>Three things to know before we start.</p>'; setTimeout(showTour, 300); }
      else applyDemo({ state: 'idle' }, true);
    } else if (st === 'intro') {
      stageBox.appendChild(introCard());
      const first = stageBox.querySelector('input'); if (first && !first.value) first.focus();
    } else if (st === 'interview') {
      // P29 (10-30): the researcher talks with them — a quiet page, nothing to do on it
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = '<h2>Thank you</h2><p>The researcher will talk with you now.</p>';
      stageBox.appendChild(c);
    } else if (!survey && st !== 'talk') {
      // a stage this copy of the page does not know (older cached script): say so instead of a blank page
      // (10-30, P23: a form stage is known — it used to land here too and say "out of date" under every form)
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = '<h2>One moment</h2><p>This page is out of date — reload it (⌘⇧R or pull down to refresh).</p>';
      stageBox.appendChild(c);
    } else if (st === 'talk') {
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = '<h2>Your trip</h2><div class="sentence"></div><p class="hint">Talk it through with the assistant. The furniture opens once you have covered the basics.</p>';
      stageBox.appendChild(c);
    }
    if (catalog) window.scrollTo(0, 0);
  }
  // a three-step tour (P21): each card points at the real control, "Got it" moves on; then the rehearsal card
  const TOUR = [
    { target: '#livest', side: 'below', pin: false, title: 'Whose turn it is',
      html: 'This status at the top left shows what is going on: <b>Your turn</b> while you speak or browse, <b>Thinking…</b> while the assistant works on what you said, <b>Speaking</b> while it answers.' },
    { target: '#livefab', side: 'above', pin: false, title: 'Cutting in',
      html: 'This button turns <b>amber</b> while the assistant is thinking or speaking. If it starts before you have finished, press it — or the <b>space bar</b> — and keep talking.' },
    { target: '#livest', side: 'below', pin: true, title: 'The thinking sound',
      html: 'While it thinks you hear a soft trill. Hover over the status and this switch appears; turn it off if you would rather not hear it.' },
  ];
  let tourStep = 0;
  const tour = document.createElement('div'); tour.id = 'livetour'; tour.style.display = 'none';
  tour.innerHTML = '<div class="dim"></div><div class="card"><div class="step"></div><h3></h3><p></p><button id="livetourok">Got it</button></div>';
  document.body.appendChild(tour);
  function placeTour() {
    if (tour.style.display === 'none') return;
    const t = TOUR[tourStep]; const el = document.querySelector(t.target); const card = tour.querySelector('.card');
    if (!el) return;
    const r = el.getBoundingClientRect(); const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = Math.max(12, Math.min(window.innerWidth - cw - 12, r.left));
    let top = t.side === 'below' ? r.bottom + (t.pin ? 52 : 14) : r.top - ch - 14;
    card.style.left = left + 'px'; card.style.top = Math.max(12, top) + 'px';
    card.classList.toggle('up', t.side === 'below'); card.classList.toggle('down', t.side !== 'below');
    card.style.setProperty('--ax', Math.max(18, Math.min(cw - 18, r.left + r.width / 2 - left)) + 'px');
    el.classList.add('spot');
  }
  function showTour() {
    document.querySelectorAll('.spot').forEach(e => e.classList.remove('spot'));
    const t = TOUR[tourStep];
    tour.querySelector('.step').textContent = `${tourStep + 1} of ${TOUR.length}`;
    tour.querySelector('h3').textContent = t.title; tour.querySelector('p').innerHTML = t.html;
    document.getElementById('livestwrap').classList.toggle('open', !!t.pin);
    tour.style.display = ''; placeTour();
    liveEvent('tour', { step: tourStep + 1 });
  }
  function endTour() {
    tour.style.display = 'none'; document.querySelectorAll('.spot').forEach(e => e.classList.remove('spot'));
    document.getElementById('livestwrap').classList.remove('open');
  }
  document.getElementById('livetourok').onclick = () => { tourStep += 1; if (tourStep >= TOUR.length) { endTour(); applyDemo({ state: 'idle' }, true); } else showTour(); };
  window.addEventListener('resize', placeTour);
  let demoShown = '', demoArmed = false;
  function applyDemo(d, force) {
    const c = document.getElementById('livedemo'); if (!c || shownStage !== 'demo') return;
    if (tourStep < TOUR.length && !force) return;
    let st = (d && d.state) || 'idle';
    if (st === 'thinking') demoArmed = true;
    if ((st === 'done' || st === 'missed') && !demoArmed) st = 'idle';   // a result from an earlier run is not this one's
    if (st === demoShown && !force) return;
    demoShown = st;
    const btn = (id, label) => `<p style="margin-top:22px"><button id="${id}" class="primarybtn" style="font-size:16px;padding:12px 22px;border-radius:12px;border:0;background:#111827;color:#fff;cursor:pointer">${label}</button></p>`;
    // replicas of the real controls, so the card shows what they will see (P21)
    const chip = (cls, inner) => `<span class="rchip ${cls}">${inner}</span>`;
    const chips = chip('idle', '<span class="dot"></span>Your turn') + '<span class="arrow">→</span>' + chip('thinking', '<span class="orbit"><i></i><i></i><i></i></span>Thinking…') + '<span class="arrow">→</span>' + chip('speaking', '<span class="bars"><i></i><i></i><i></i></span>Speaking');
    const fabs = '<span class="rfab off">✋ I wasn\'t done <span class="key">space</span></span><span class="arrow">→</span><span class="rfab on">✋ I wasn\'t done <span class="key">space</span></span>';
    const views = {
      idle: '<h2>Try it once</h2>'
        + '<div class="row"><div class="demo">' + fabs + '</div><p>Press Start. When the button turns amber, press it — or the space bar.</p></div>'
        + btn('livedemostart', 'Start'),
      thinking: '<h2>Now</h2><p style="font-size:22px">Press the amber <b>✋</b> button, or the <b>space bar</b>.</p>',
      done: '<h2>✓ That\'s it</h2><p>Amber: press to cut in. Grey: your turn.</p>' + btn('livedemonext', 'Continue'),
      missed: '<h2>Not this time</h2><p>Try again: press the amber <b>✋</b> button, or the space bar.</p>' + btn('livedemostart', 'Try again'),
    };
    c.innerHTML = views[st] || views.idle;
    const start = c.querySelector('#livedemostart'), next = c.querySelector('#livedemonext');
    if (start) start.onclick = () => { start.disabled = true; start.textContent = 'Listen…'; liveEvent('demo_start', {}); };
    if (next) next.onclick = () => { next.disabled = true; liveEvent('advance', { from: 'demo' }); };
  }
  let surveyShown = '';
  function applySurvey(url) {
    const f = document.getElementById('livesurvey'); if (!f || !url || url === surveyShown) return;
    surveyShown = url; f.src = url;
    const n = document.getElementById('livesurveynote'); if (n) n.textContent = n.textContent.split(' · ')[0] + ' · this page moves on by itself when the form is done';
  }
  // Qualtrics' end-of-survey redirect points at survey_done.html, which tells this page the form is finished
  window.addEventListener('message', e => {
    const d = e.data || {};
    if (d.vanlife === 'survey_done' && (shownStage === 'consent' || shownStage === 'questionnaire' || shownStage === 'debrief')) liveEvent('advance', { from: shownStage });
  });
  function applyWords(words) {
    const w = stageBox.querySelector('.words'); if (!w) return;
    const txt = (words || []).join(' ');
    if (w.dataset.txt === txt) return;
    w.dataset.txt = txt; w.innerHTML = '';
    for (const word of words || []) { const sp = document.createElement('span'); sp.textContent = word; w.appendChild(sp); }
  }
  function applyTalkSentence(serverIntro) {
    const sen = stageBox.querySelector('.sentence'); if (!sen || shownStage !== 'talk') return;
    const v = (serverIntro && serverIntro.text) ? serverIntro : intro;
    sen.innerHTML = '';
    const parts = ["I'm going on a one-month trip from ", v.from || '___', ' with ', v.who || '___', ' to ', v.where || '___', ' in ', v.when || '___', '. During the trip, we\'ll be ', v.activity || '___', '.'];
    parts.forEach((t, i) => { if (i % 2) { const b = document.createElement('b'); b.textContent = t; sen.appendChild(b); } else sen.appendChild(document.createTextNode(t)); });
  }
  function setPlanBig(big) {
    if (planbox.classList.contains('big') === big) return;
    planbox.classList.toggle('big', big);
    document.getElementById('liveplanhint').textContent = big ? 'Minimize' : 'Enlarge';
    placementTools.style.display = big ? 'block' : 'none';
    planSvg.style.cursor = big ? 'crosshair' : 'zoom-in';
    liveEvent('plan_toggle', { big });
  }
  planbox.onclick = e => { e.stopPropagation(); if (!planbox.classList.contains('big')) setPlanBig(true); };
  document.getElementById('liveplanhint').onclick = e => { e.stopPropagation(); setPlanBig(!planbox.classList.contains('big')); };
  document.getElementById('liveplanhint').onkeydown = e => e.stopPropagation();
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
  // what they are doing while it is quiet (10-15): scrolling, and leaving / returning to the tab
  let scrollAt = 0;
  window.addEventListener('scroll', () => { const t = Date.now(); if (t - scrollAt > 2500) { scrollAt = t; liveEvent('scroll', { y: Math.round(window.scrollY) }); } }, { passive: true });
  document.addEventListener('visibilitychange', () => liveEvent(document.hidden ? 'hidden' : 'visible', {}));

  // ── "I wasn't done" (P3): live only while the assistant is speaking ──
  const stopBtn = document.getElementById('livestop');
  stopBtn.title = 'Lights up as soon as the assistant starts working on what you said — press it to keep going';
  stopBtn.onclick = async () => {
    stopBtn.disabled = true; stopBtn.querySelector('.lbl').textContent = '✋ …';
    holdIdleUntil = Date.now() + 2500; setState('idle');
    liveEvent('interrupt', {});
    try {
      const r = await fetch(`${FEED}/p/interrupt?key=${encodeURIComponent(KEY)}`, { method: 'POST', body: '{}' });
      const j = await r.json();
      stopBtn.classList.add('sent'); stopBtn.querySelector('.lbl').textContent = j.accepted ? '✓ go ahead' : '✋ I wasn\'t done';
    } catch (e) { stopBtn.querySelector('.lbl').textContent = '✋ I wasn\'t done'; }
    setTimeout(() => { stopBtn.classList.remove('sent'); stopBtn.querySelector('.lbl').textContent = '✋ I wasn\'t done'; }, 2500);
  };
  // the status chip (P14) and the participant's sound switch
  // the status chip (upper right): amber "Thinking…" / blue "Speaking"; hidden while it is their turn
  const stEl = document.getElementById('livest');
  const ST = { idle: ['idle', '<span class="dot"></span>Your turn'], listening: ['idle', '<span class="dot"></span>Your turn'],
               thinking: ['thinking', '<span class="orbit"><i></i><i></i><i></i></span>Thinking…'], speaking: ['speaking', '<span class="bars"><i></i><i></i><i></i></span>Speaking'] };
  let shownState = '', holdIdleUntil = 0;
  function setState(st) {
    if (Date.now() < holdIdleUntil && st !== 'idle' && st !== 'listening') st = 'idle';   // just cut in: their turn, whatever the last poll said
    const v = ST[st] || ST.idle;
    if (v[0] === shownState) return;
    shownState = v[0]; stEl.classList.remove('idle', 'thinking', 'speaking'); stEl.classList.add(v[0]); stEl.innerHTML = v[1];   // keeps the tour's spotlight class
  }
  const stWrap = document.getElementById('livestwrap');
  stEl.onclick = () => stWrap.classList.toggle('open');                       // a click pins the switch open
  document.addEventListener('click', e => { if (!stWrap.contains(e.target) && !e.target.closest('#livetour')) stWrap.classList.remove('open'); });
  // the space bar presses ✋ (not while typing)
  document.addEventListener('keydown', e => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || (t && t.isContentEditable)) return;
    e.preventDefault();
    if (!stopBtn.disabled) stopBtn.click();
  });
  const sndBtn = document.getElementById('livesnd');
  let soundOn = true;
  try { soundOn = localStorage.getItem('livesound:' + KEY) !== 'off'; } catch (e) {}
  function showSound() { sndBtn.classList.toggle('off', !soundOn); sndBtn.querySelector('.lbl').textContent = soundOn ? 'thinking sound on' : 'thinking sound off'; sndBtn.setAttribute('aria-checked', String(soundOn)); sndBtn.setAttribute('role', 'switch'); }
  sndBtn.onclick = () => { soundOn = !soundOn; try { localStorage.setItem('livesound:' + KEY, soundOn ? 'on' : 'off'); } catch (e) {} showSound(); liveEvent('sound', { on: soundOn }); };
  showSound();
  if (!soundOn) liveEvent('sound', { on: false });          // a reload keeps their choice on the wizard too
  function setSpeaking(on) {
    if (on && stopBtn.classList.contains('sent')) return;   // just pressed: stay off until the next reply
    stopBtn.disabled = !on;
  }

  // ── top-down plan (P5): the pieces on the floor, from the wizard's scene feed ──
  let planKey = '';
  function drawPlan(floor, van, chosenSet) {
    const key = JSON.stringify([floor, van]) + '|' + [...chosenSet].join(',');
    if (key === planKey) return;
    planKey = key;
    const W = 1000, H = 560, MX = 90, T = 10;
    const Z0 = van.z[0], Z1 = van.z[1], X0 = van.x[0], X1 = van.x[1];
    const sz = (W - 2 * MX) / (Z1 - Z0), sx = sz;                 // true proportions
    const vh = (X1 - X0) * sx, MY = (H - T - vh) / 2;
    planGeometry = {MX, T, MY, sz, sx, Z0, Z1, X0, X1};
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
    renderPlacement();
    document.getElementById('livepn').textContent = floor.length ? `· ${floor.length} on the floor` : '· empty';
  }

  // the code the assistant says is the LABEL on the card (K34), not DATA's internal id
  // (K36, also the picture's file name) — look items up the way the grid shows them
  const ALL = (typeof LIBRARY_ITEMS !== 'undefined' && typeof libraryItemView === 'function') ? LIBRARY_ITEMS.map(libraryItemView) : Object.values(DATA).flat();
  const byCode = code => ALL.find(x => x.id === ((typeof MODE_ALIAS !== 'undefined' && MODE_ALIAS[code]) || code));   // B09 (closed queen wall bed) opens the queen wall bed card
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

  // dev notes (10-29): when the feed has a DEV_NOTES file (the quad demo), a box to write
  // what to change about this page; it is filed on the feed with the turn and what the page shows
  let noteBox = null;
  function showNoteBox() {
    if (noteBox) return;
    noteBox = document.createElement('aside'); noteBox.id = 'livenotebox';
    noteBox.innerHTML = '<div class="nh"><span>Dev note · participant page</span><em id="livenoteok"></em></div>'
      + '<textarea id="livenotetx" placeholder="what to change here — ⌘↩ saves · 3: files it under turn 3"></textarea>'
      + '<div class="nf"><span>filed with the turn and what this page shows</span><button type="button" id="livenotebt">Save</button></div>';
    document.body.appendChild(noteBox); noteBox.style.display = 'block';
    const tx = noteBox.querySelector('#livenotetx'), ok = noteBox.querySelector('#livenoteok');
    async function save() {
      const t = tx.value.trim(); if (!t) return;
      try {
        const r = await fetch(`${FEED}/notes?key=${encodeURIComponent(KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surface: 'p', text: t }) });
        const j = await r.json(); if (!j.ok) throw new Error(j.error || r.status);
        tx.value = ''; ok.textContent = 'saved · turn ' + j.turn; setTimeout(() => { ok.textContent = ''; }, 2500);
      } catch (e) { ok.textContent = 'not saved: ' + e.message; }
    }
    noteBox.querySelector('#livenotebt').onclick = save;
    tx.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });
  }

  async function tick() {
    try {
      const r = await fetch(`${FEED}/p/state?key=${encodeURIComponent(KEY)}${SAMPLE}${STAGE}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const s = await r.json();
      failures = 0;
      applyStage(s.stage || 'browse'); applyWords(s.words); applyTalkSentence(s.intro); applyDemo(s.demo); applySurvey(s.survey);
      const ck = (s.chosen || []).join(',');
      const chosenChanged = ck !== chosenKey;
      if (chosenChanged) { chosen = new Set(s.chosen || []); chosenKey = ck; }
      document.getElementById('livedot').className = 'dot on';
      document.getElementById('livenote').textContent = (s.mentions || []).some(m => m.items && m.items.length) ? 'latest reply' : 'waiting for the first suggestion';
      render(s.mentions || [], chosenChanged);
      if (s.van && s.floor) drawPlan(s.floor, s.van, chosen);
      applyPlacement(s.placement);
      window.liveSpeaking = !!s.speaking;
      setSpeaking(!!s.speaking);
      setState(s.state || (s.speaking ? 'thinking' : 'idle'));
      if (s.dev_notes) showNoteBox();
    } catch (e) {
      if (++failures >= 3) {
        document.getElementById('livedot').className = 'dot';
        document.getElementById('livenote').textContent = 'not connected';
      }
    }
  }
  tick(); setInterval(tick, 400);                       // the button must light within half a second of the stop press
})();
