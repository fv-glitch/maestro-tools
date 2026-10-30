/* global maestro */
/* 2D viewer: faces unfolded around the top. Shares its state with the 3D viewer via window.mtViewer
 * and 'mt:*' events (model loaded, state changed, mode changed). */
(() => {
  const $ = (s) => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = $('#svg');
  let model = null, sel = null, view = null, mode = '2d';
  const hidden = new Set();
  const PALETTE = ['#2f6fd0', '#d0602f', '#2f9e5a', '#9b4fd0', '#c9a227', '#1fa2b8', '#d04f8a', '#6b7a2f', '#7a4f2f', '#4f5fd0'];
  const toolColor = {};
  const colorOf = (tool) => toolColor[tool] ?? (toolColor[tool] = PALETTE[Object.keys(toolColor).length % PALETTE.length]);
  const visible = (s) => (s.enabled || $('#showOff').checked) && !hidden.has(s.id);
  const emit = (name) => window.dispatchEvent(new CustomEvent(name));

  window.mtViewer = {
    get model() { return model; }, get sel() { return sel; }, get mode() { return mode; },
    visible, colorOf, showMoves: () => $('#showMoves').checked, select: (id) => select(id, true),
  };

  // unfolded box: top face in the middle, edges folded out around it (all in mm)
  function project(face, [x, y, z]) {
    const { L, W, T } = model;
    switch (face) {
      case 'back': return [x, -(T - z)];
      case 'front': return [x, W + (T - z)];
      case 'left': return [-(T - z), W - y];
      case 'right': return [L + (T - z), W - y];
      default: return [x, W - y];
    }
  }

  function draw() {
    svg.innerHTML = '';
    if (!model) return;
    const { L, W, T } = model;
    const g = document.createElementNS(NS, 'g'); svg.appendChild(g);
    for (const [nm, x, y, w, h] of [['top', 0, 0, L, W], ['back', 0, -T, L, T], ['front', 0, W, L, T], ['left', -T, 0, T, W], ['right', L, 0, T, W]]) {
      const r = document.createElementNS(NS, 'rect');
      Object.entries({ x, y, width: w, height: h, class: 'face', 'vector-effect': 'non-scaling-stroke' }).forEach(([k, v]) => r.setAttribute(k, v));
      g.appendChild(r);
      const t = document.createElementNS(NS, 'text'); t.setAttribute('class', 'facelbl'); t.textContent = nm;
      t.setAttribute('x', x + 4); t.setAttribute('y', y + Math.min(h, 14) - 2); t.setAttribute('font-size', Math.max(T * 0.35, 8));
      g.appendChild(t);
    }
    for (const s of model.steps) {
      if (!visible(s)) continue;
      const sg = document.createElementNS(NS, 'g'); sg.dataset.id = s.id;
      const col = s.enabled ? colorOf(s.tool) : '#888';
      const add = (pts, cls) => {
        if (pts.length < 2) return;
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', pts.map((q, i) => { const [a, b] = project(s.face, q); return (i ? 'L' : 'M') + a.toFixed(3) + ' ' + b.toFixed(3); }).join(''));
        p.setAttribute('stroke', col); p.setAttribute('stroke-width', 1.2); if (cls) p.setAttribute('class', cls);
        sg.appendChild(p);
      };
      s.cut.forEach((c) => add(c));
      if ($('#showMoves').checked) s.moves.forEach((m) => add(m, 'mv'));
      g.appendChild(sg);
    }
    highlight(); applyView();
  }

  /** Selection only restyles - no redraw, so a click never rebuilds the drawing mid-gesture. */
  function highlight() {
    svg.querySelectorAll('g[data-id]').forEach((el) => {
      const on = el.dataset.id === sel;
      el.classList.toggle('dim', !!sel && !on);
      el.querySelectorAll('path').forEach((p) => p.setAttribute('stroke-width', on ? 2.5 : 1.2));
    });
  }

  function extents() {
    const { L, W, T } = model;
    let x0 = -T, y0 = -T, x1 = L + T, y1 = W + T;
    for (const s of model.steps) if (visible(s)) for (const c of s.cut) for (const q of c) {
      const [a, b] = project(s.face, q); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
    }
    return { x0, y0, x1, y1 };
  }
  function fit() {
    if (!model) return;
    if (mode === '3d') return emit('mt:fit');
    const { x0, y0, x1, y1 } = extents(); const pad = Math.max(x1 - x0, y1 - y0) * 0.03;
    view = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    applyView();
  }
  function applyView() {
    if (!view || !model) return;
    const r = svg.getBoundingClientRect(); if (!r.width || !r.height) return;
    const ar = r.width / r.height;
    let { x, y, w, h } = view;
    if (w / h < ar) { const nw = h * ar; x -= (nw - w) / 2; w = nw; } else { const nh = w / ar; y -= (nh - h) / 2; h = nh; }
    view = { x, y, w, h };
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }
  /** Zoom by factor k about a screen point, within limits (0.5 mm .. 4x the part). */
  function zoomAt(clientX, clientY, k) {
    if (!view) return;
    const r = svg.getBoundingClientRect();
    const { x0, y0, x1, y1 } = extents(); const maxW = (x1 - x0) * 4, minW = 0.5;
    const nw = Math.min(maxW, Math.max(minW, view.w * k)); k = nw / view.w;
    const mx = view.x + (clientX - r.left) / r.width * view.w, my = view.y + (clientY - r.top) / r.height * view.h;
    view = { x: mx - (mx - view.x) * k, y: my - (my - view.y) * k, w: view.w * k, h: view.h * k }; applyView();
  }

  // ---------- input: mouse, pen and touch through pointer events
  svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp((e.ctrlKey ? 3 : 1) * e.deltaY * 0.0015)); }, { passive: false });
  const pts = new Map();          // active pointers
  let gesture = null;             // { kind: 'pan'|'pinch', ... }
  let downAt = null, lastTap = 0;
  const reset = () => { pts.clear(); gesture = null; };
  svg.addEventListener('pointerdown', (e) => {
    if (!view) return;
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { gesture = { kind: 'pan', x: e.clientX, y: e.clientY, v: { ...view } }; downAt = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target }; }
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; downAt = null;
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) { reset(); return; }   // button released outside: never stay "stuck" panning
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = svg.getBoundingClientRect();
    if (gesture?.kind === 'pan' && pts.size === 1) {
      const dx = (e.clientX - gesture.x) / r.width * gesture.v.w, dy = (e.clientY - gesture.y) / r.height * gesture.v.h;
      view = { ...gesture.v, x: gesture.v.x - dx, y: gesture.v.y - dy }; applyView();
    } else if (gesture?.kind === 'pinch' && pts.size === 2) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (d > 0 && gesture.d > 0) zoomAt(gesture.cx, gesture.cy, gesture.d / d);
      view = { ...view, x: view.x - (cx - gesture.cx) / r.width * view.w, y: view.y - (cy - gesture.cy) / r.height * view.h }; applyView();
      Object.assign(gesture, { d, cx, cy });
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4 && Date.now() - downAt.t < 600) {
      const now = Date.now();
      if (now - lastTap < 350) { fit(); lastTap = 0; }                 // double click / double tap: fit
      else {
        lastTap = now;
        const g = downAt.target instanceof Element ? downAt.target.closest('g[data-id]') : null;
        select(g ? g.dataset.id : null);
      }
    }
    downAt = null;
    if (pts.size === 1) { const [p] = [...pts.values()]; gesture = { kind: 'pan', x: p.x, y: p.y, v: { ...view } }; } else if (!pts.size) gesture = null;
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); if (!pts.size) gesture = null; downAt = null; });
  svg.addEventListener('lostpointercapture', (e) => { pts.delete(e.pointerId); if (!pts.size) gesture = null; });
  window.addEventListener('blur', reset);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel) select(null); });
  new ResizeObserver(applyView).observe(svg);

  function select(id, fromOutside) {
    sel = id && id !== sel ? id : (fromOutside && id ? id : null);
    document.querySelectorAll('.steps .st').forEach((el) => el.classList.toggle('sel', el.dataset.id === sel));
    const s = model?.steps.find((x) => x.id === sel); const info = $('#stepInfo');
    if (s) {
      const zs = s.cut.flat().map((p) => p[2]);
      info.innerHTML = `<b>${esc(s.name)}</b>${esc(s.groups.join(' / '))}<br>tool ${esc(s.tool ?? '-')} &middot; ${esc(s.feature)} &middot; ${esc(s.face)} face<br>` +
        `depth ${s.depth ?? '-'}${zs.length ? ` &middot; Z ${Math.min(...zs).toFixed(2)} to ${Math.max(...zs).toFixed(2)}` : ' &middot; no stored toolpath'}<br>${s.macro ? 'macro ' + esc(s.macro) + '<br>' : ''}${s.enabled ? 'on' : '<i>turned off</i>'}`;
      info.style.display = 'block';
      document.querySelector(`.steps .st[data-id="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'nearest' });
    } else info.style.display = 'none';
    highlight(); emit('mt:state');
  }

  function list() {
    const el = $('#stepList'); let html = ''; let lastG = null;
    for (const s of model.steps) {
      if (!s.enabled && !$('#showOff').checked) continue;
      const g = s.groups.join(' / ');
      if (g !== lastG) { html += `<div class="grp">${esc(g || 'program')}</div>`; lastG = g; }
      html += `<div class="st ${s.enabled ? '' : 'off'} ${sel === s.id ? 'sel' : ''}" data-id="${esc(s.id)}"><input type="checkbox" ${hidden.has(s.id) ? '' : 'checked'} />` +
        `<span class="sw" style="background:${s.enabled ? colorOf(s.tool) : '#888'}"></span><span class="nm" title="${esc(s.name)}">${esc(s.name)}</span><span class="tl">${esc(s.tool ?? '')}</span></div>`;
    }
    el.innerHTML = html || '<p class="hint" style="padding:8px">no machining</p>';
    el.querySelectorAll('.st').forEach((row) => {
      row.querySelector('input').addEventListener('click', (e) => { e.stopPropagation(); e.target.checked ? hidden.delete(row.dataset.id) : hidden.add(row.dataset.id); draw(); emit('mt:state'); });
      row.addEventListener('click', () => select(row.dataset.id));
    });
  }

  function setMode(m) {
    mode = m;
    $('#mode2d').classList.toggle('on', m === '2d'); $('#mode3d').classList.toggle('on', m === '3d');
    svg.hidden = m !== '2d'; $('#three').hidden = m !== '3d';
    $('#viewHelp').innerHTML = m === '2d' ? 'wheel / pinch: zoom &middot; drag: pan &middot; double-click: fit &middot; Esc: clear selection'
      : 'drag: orbit &middot; right-drag / two fingers: pan &middot; wheel / pinch: zoom &middot; double-click: fit &middot; Esc: clear selection';
    emit('mt:mode'); if (m === '2d') applyView();
  }

  $('#openView').addEventListener('click', async () => {
    try {
      const m = await maestro.openView(); if (!m) return;
      model = m; sel = null; hidden.clear(); $('#viewName').textContent = `${m.name}  (${m.L} x ${m.W} x ${m.T})`;
      $('#stepInfo').style.display = 'none';
      list(); draw(); fit(); emit('mt:model');
    } catch (err) { $('#viewName').textContent = err.message; }
  });
  $('#showOff').addEventListener('change', () => { if (model) { list(); draw(); emit('mt:state'); } });
  $('#showMoves').addEventListener('change', () => { draw(); emit('mt:state'); });
  $('#fitView').addEventListener('click', fit);
  $('#mode2d').addEventListener('click', () => setMode('2d'));
  $('#mode3d').addEventListener('click', () => setMode('3d'));
  document.querySelector('nav button[data-tab=view]').addEventListener('click', () => setTimeout(() => { applyView(); emit('mt:mode'); }, 0));
})();
