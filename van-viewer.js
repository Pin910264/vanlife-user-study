import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const assets = 'https://pub-f24619125cd545cbad22bea9cebcd8fe.r2.dev/';
const normalize = name => name.replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase();

export async function createViewer(panel, status) {
  const response = await fetch(assets + 'furniture_manifest.json');
  if (!response.ok) throw new Error('Model catalog unavailable');
  const manifest = await response.json();
  const files = new Map(manifest.items.map(item => [normalize(item.name), item.glb]));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const models = new Map();
  function model(file) {
    if (!models.has(file)) models.set(file, loader.loadAsync(assets + 'glb/' + encodeURIComponent(file)).then(gltf => gltf.scene));
    return models.get(file);
  }
  const shell = await model(manifest.van.glb);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  panel.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9edf2);
  scene.add(shell, new THREE.HemisphereLight(0xffffff, 0xabb6bf, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(-3, 6, -2);
  scene.add(light);
  shell.traverse(part => {
    if (part.isMesh && /^(Ceiling|Outside_C|Right_Wall|Outside_A)(_|$)/.test(part.name)) part.visible = false;
  });
  shell.updateMatrixWorld(true);
  const floor = shell.getObjectByName('Floor') || shell;
  const center = new THREE.Box3().setFromObject(floor).getCenter(new THREE.Vector3());
  const body = new THREE.Box3();
  shell.traverse(part => {
    if (!part.isMesh || !part.visible) return;
    const bounds = new THREE.Box3().setFromObject(part);
    if (bounds.getCenter(new THREE.Vector3()).distanceTo(center) < 4) body.union(bounds);
  });
  if (!body.isEmpty()) body.getCenter(center);
  const camera = new THREE.PerspectiveCamera(33, 1, 0.05, 100);
  camera.position.copy(center).add(new THREE.Vector3(-5, 3, -3));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.update();
  const draw = () => renderer.render(scene, camera);
  controls.addEventListener('change', draw);
  controls.saveState();
  // Fit the visible shell silhouette in the initial view. The corners of its
  // world-space bounding box include empty space above and beside the cab.
  const projected = new THREE.Vector3();
  let halfWidth = 0.1, halfHeight = 0.1;
  shell.traverseVisible(part => {
    if (!part.isMesh) return;
    const bounds = new THREE.Box3().setFromObject(part);
    if (bounds.getCenter(new THREE.Vector3()).distanceTo(center) >= 4) return;
    const vertices = part.geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      projected.fromBufferAttribute(vertices, i).applyMatrix4(part.matrixWorld).project(camera);
      halfWidth = Math.max(halfWidth, Math.abs(projected.x));
      halfHeight = Math.max(halfHeight, Math.abs(projected.y));
    }
  });
  let magnification = 1;
  function frame() {
    const {clientWidth: w, clientHeight: h} = panel;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.zoom = magnification * 0.96 * Math.min(camera.aspect / halfWidth, 1 / halfHeight);
    camera.updateProjectionMatrix();
    draw();
  }
  const buttons = panel.parentElement.querySelectorAll('[data-view]');
  function updateButtons() {
    for (const button of buttons) {
      const action = button.dataset.view;
      button.disabled = (action === 'in' && magnification >= 4) || (action === 'out' && magnification <= 0.4);
    }
  }
  for (const button of buttons) {
    button.onclick = () => {
      const action = button.dataset.view;
      if (action === 'reset') {
        controls.reset();
        magnification = 1;
      } else {
        magnification = THREE.MathUtils.clamp(magnification * (action === 'in' ? 1.25 : 0.8), 0.4, 4);
      }
      updateButtons();
      frame();
    };
  }
  updateButtons();
  new ResizeObserver(frame).observe(panel);

  let furniture = new THREE.Group();
  scene.add(furniture);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial({color:0xffa94d}));
  let signature, revision = 0;
  return async function render(items) {
    const key = JSON.stringify(items ?? null);
    if (key === signature) return;
    signature = key;
    const current = ++revision;
    const next = new THREE.Group();
    status.textContent = 'Updating van…';
    const results = await Promise.allSettled((items || []).map(async item => {
      const name = normalize(item.Name);
      const file = files.get(name);
      if (name !== 'cube' && !file) throw new Error(item.Name);
      const object = (name === 'cube' ? cube : await model(file)).clone();
      const p = item.Position || {x:0,y:0,z:0};
      const r = item.Rotation || {x:0,y:0,z:0,w:1};
      const s = item.Scale || {x:1,y:1,z:1};
      // VanSpace saves use 10 cm units and a mirrored X axis.
      object.position.set(-p.x * .1, p.y * .1, p.z * .1);
      object.quaternion.set(r.x, -r.y, -r.z, r.w);
      object.scale.set(s.x, s.y, s.z);
      next.add(object);
    }));
    if (current !== revision) return;
    scene.remove(furniture);
    furniture = next;
    scene.add(next);
    status.textContent = results.some(r => r.status === 'rejected') ? 'Some furniture models are unavailable.' : items ? '' : 'Waiting for 3D scene data…';
    draw();
  };
}
