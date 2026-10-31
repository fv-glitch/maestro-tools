/* 3D viewer: the part as a translucent block with every stored toolpath at its real X, Y, Z.
 * Uses the 2D viewer's state (window.mtViewer): same steps, colours, hiding and selection. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { simulate } from './cutsim.mjs';

const host = document.getElementById('three');
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#fff';
let renderer, scene, camera, controls, content, built = null, dirty = true;

function init() {
  if (renderer) return true;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
  catch { host.innerHTML = '<p class="hint" style="padding:12px">3D needs WebGL, which is not available here.</p>'; return false; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-0.4, -0.8, 1); scene.add(sun);
  camera = new THREE.PerspectiveCamera(40, 1, 0.5, 200000);
  camera.up.set(0, 0, 1);                       // Maestro: Z up
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false; controls.screenSpacePanning = true; controls.zoomToCursor = true;
  controls.addEventListener('change', render);
  new ResizeObserver(resize).observe(host);
  // click (not drag) picks a toolpath; double-click fits
  let down = null, lastTap = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || Date.now() - down.t > 600) { down = null; return; }
    down = null;
    const now = Date.now(); if (now - lastTap < 350) { fit(); lastTap = 0; return; } lastTap = now;
    pick(e);
  });
  return true;
}

function resize() {
  if (!renderer) return;
  const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
}
function render() { if (renderer && !host.hidden) renderer.render(scene, camera); }

function build() {
  const v = window.mtViewer; const m = v.model; if (!m) return;
  scene.background = new THREE.Color(css('--card'));
  if (content) { scene.remove(content); content.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
  content = new THREE.Group(); scene.add(content);
  const { L, W, T } = m;
  // the part
  const box = new THREE.BoxGeometry(L, W, Math.max(T, 0.1)); box.translate(L / 2, W / 2, Math.max(T, 0.1) / 2);
  content.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: css('--muted'), transparent: true, opacity: 0.08, depthWrite: false })));
  content.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: css('--muted') })));
  content.userData.cut = v.showCut();
  if (v.showCut()) { const mesh = cutMesh(m, v); if (mesh) content.add(mesh); }
  // toolpaths
  for (const s of m.steps) {
    if (!v.visible(s)) continue;
    const g = new THREE.Group(); g.userData.id = s.id;
    const color = new THREE.Color(s.enabled ? v.colorOf(s.tool) : '#888888');
    const line = (pts, dashed) => {
      if (pts.length < 2) return;
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
      const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 4, transparent: true, opacity: 0.5 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
      const l = new THREE.Line(geo, mat); if (dashed) l.computeLineDistances(); l.userData.id = s.id; l.userData.dashed = dashed; g.add(l);
    };
    s.cut.forEach((c) => line(c, false));
    if (v.showMoves()) s.moves.forEach((mv) => line(mv, true));
    content.add(g);
  }
  built = m; highlight();
}

/** The simulated cut surface: one mesh over every height-map tile, coloured by depth. */
function cutMesh(m, v) {
  const sim = simulate(m, m.steps.filter(v.cutting));
  if (!sim.tiles.length) return null;
  const lut = []; for (let i = 0; i <= 255; i++) lut.push(v.depthRGB(v.maxDepth * (i / 255) ** 2).map((c) => c / 255));
  const pos = [], col = [], idx = [];
  for (const t of sim.tiles) {
    const { o, u, v: w, n: nn, thick } = t.frame; const N = t.n + 1, h = t.h, cell = sim.cell;
    const through = thick >= 1 ? thick - 1e-3 : Infinity;
    const map = new Int32Array(N * N).fill(-1);
    const vert = (i, j) => {
      const k = j * N + i; if (map[k] >= 0) return map[k];
      const a = t.a0 + i * cell, b = t.b0 + j * cell, d = h[k];
      pos.push(o[0] + a * u[0] + b * w[0] + d * nn[0], o[1] + a * u[1] + b * w[1] + d * nn[1], o[2] + a * u[2] + b * w[2] + d * nn[2]);
      const c = lut[Math.min(255, Math.round(Math.sqrt(d / (v.maxDepth || 1)) * 255))]; col.push(c[0], c[1], c[2]);
      return (map[k] = pos.length / 3 - 1);
    };
    for (let j = 0; j < t.n; j++) for (let i = 0; i < t.n; i++) {
      const k = j * N + i, d00 = h[k], d10 = h[k + 1], d01 = h[k + N], d11 = h[k + N + 1];
      if (Number.isNaN(d00 + d10 + d01 + d11)) continue;                                // off the face
      if (d00 <= 0 && d10 <= 0 && d01 <= 0 && d11 <= 0) continue;                       // untouched
      if (d00 >= through && d10 >= through && d01 >= through && d11 >= through) continue; // hole right through
      const A = vert(i, j), B = vert(i + 1, j), C = vert(i + 1, j + 1), D = vert(i, j + 1);
      idx.push(A, B, C, A, C, D);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  mesh.userData.cutMesh = true;
  return mesh;
}

function highlight() {
  if (!content) return;
  const sel = window.mtViewer.sel;
  content.children.forEach((g) => {
    if (!g.userData.id) return;
    const on = g.userData.id === sel;
    g.children.forEach((l) => { l.material.opacity = sel && !on ? 0.12 : l.userData.dashed ? 0.5 : 1; });
    g.renderOrder = on ? 2 : 1;
  });
  render();
}

function fit() {
  if (!content) return;
  const sel = window.mtViewer.sel; const g = sel && content.children.find((x) => x.userData.id === sel);
  const b = new THREE.Box3().setFromObject(g && g.children.length ? g : content);
  if (g && g.children.length) { const s = window.mtViewer.model.steps.find((x) => x.id === sel); const sz = b.getSize(new THREE.Vector3()); b.expandByScalar((s?.toolDia || 0) / 2 + Math.max(sz.x, sz.y, sz.z) * 0.4 + 5); }
  const c = b.getCenter(new THREE.Vector3()); const r = b.getSize(new THREE.Vector3()).length() / 2 || 100;
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.9;
  camera.position.copy(c).add(new THREE.Vector3(-0.35, -0.75, 0.55).normalize().multiplyScalar(dist));
  camera.near = dist / 1000; camera.far = dist * 20; camera.updateProjectionMatrix();
  controls.target.copy(c); controls.update(); render();
}

function pick(e) {
  const rc = new THREE.Raycaster(); const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  rc.setFromCamera(ndc, camera);
  rc.params.Line.threshold = camera.position.distanceTo(controls.target) * 0.006;
  const lines = []; content.traverse((o) => { if (o.isLine && o.userData.id && !o.userData.dashed) lines.push(o); });
  const hit = rc.intersectObjects(lines, false)[0];
  window.mtViewer.select(hit ? hit.object.userData.id : null);
}

function show() {
  if (window.mtViewer.mode !== '3d' || host.hidden) return;
  if (!init()) return;
  resize();
  if (built !== window.mtViewer.model || dirty) { build(); dirty = false; if (built) fit(); }
  render();
}

window.addEventListener('mt:model', () => { dirty = true; built = null; show(); });
window.addEventListener('mt:state', () => {
  if (!renderer) return;
  // selection only restyles; hide/show/moves rebuilds
  const v = window.mtViewer; const ids = new Set(); content?.children.forEach((g) => g.userData.id && ids.add(g.userData.id));
  const want = new Set(v.model ? v.model.steps.filter(v.visible).map((s) => s.id) : []);
  const same = ids.size === want.size && [...want].every((id) => ids.has(id));
  const moves = content ? content.children.some((g) => g.children.some((l) => l.userData.dashed)) : false;
  if (!same || moves !== v.showMoves() || (content && content.userData.cut !== v.showCut())) { if (window.mtViewer.mode === '3d') build(); else dirty = true; } else highlight();
});
window.addEventListener('mt:mode', show);
window.addEventListener('mt:fit', fit);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') highlight(); });
