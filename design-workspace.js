export function createWorkspace(catalog, plan, tools) {
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = new URL('./design-workspace.css', import.meta.url);
  document.head.append(sheet);
  const root = document.createElement('div');
  root.id = 'design-workspace';
  root.hidden = true;
  root.innerHTML = `<button class="splitter" role="separator" aria-label="Catalog width" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50"><span>↔</span></button>
    <aside class="van-views"><section class="perspective"><div class="view-heading"><h2>Your van in 3D</h2><div class="zoom-controls" role="group" aria-label="3D view controls">
      <button type="button" data-view="out" aria-label="Zoom out" disabled>−</button>
      <button type="button" data-view="in" aria-label="Zoom in" disabled>+</button>
      <button type="button" data-view="reset" aria-label="Reset 3D view" disabled>Reset</button>
    </div></div><div class="van-canvas"><span role="status">Loading van…</span></div></section></aside>`;
  catalog.before(root);
  const divider = root.querySelector('.splitter');
  const views = root.querySelector('aside');
  const panel = views.querySelector('.van-canvas');
  const status = panel.querySelector('span');
  let width = 50;
  function resize(value) {
    width = Math.round(Math.max(25, Math.min(75, value)));
    root.style.setProperty('--catalog', width + '%');
    divider.setAttribute('aria-valuenow', width);
  }
  divider.onpointerdown = e => divider.setPointerCapture(e.pointerId);
  divider.onpointermove = e => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const box = root.getBoundingClientRect();
    resize((e.clientX - box.left) / box.width * 100);
  };
  divider.onkeydown = e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    resize(width + (e.key === 'ArrowLeft' ? -2 : 2));
  };
  let viewer, latest;
  function update() {
    viewer.then(render => render(latest)).catch(() => { status.textContent = '3D view unavailable. Reload to retry.'; });
  }
  return {
    show(scene) {
      if (root.hidden) {
        root.prepend(catalog);
        views.append(plan);
        plan.classList.add('docked');
        tools.style.display = 'block';
        root.hidden = false;
      }
      latest = scene;
      viewer ||= import('./van-viewer.js').then(module => module.createViewer(panel, status));
      update();
    },
    close() {
      if (root.hidden) return;
      root.after(catalog);
      document.body.append(plan);
      plan.classList.remove('docked');
      tools.style.display = 'none';
      root.hidden = true;
    }
  };
}
