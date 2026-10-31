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
  const showCut = () => $('#showCut').checked;
  /** steps that remove material in the cut view: turned-off steps cut nothing */
  const cutting = (s) => visible(s) && s.enabled && s.toolDia > 0 && s.size;
  // depth colour: light = shallow, dark = deep (square-root scale so a 3 mm lip and a 90 mm bore both read)
  const STOPS = [[0, [251, 227, 176]], [0.35, [244, 162, 89]], [0.7, [209, 73, 91]], [1, [92, 26, 51]]];
  function depthRGB(d) {
    const t = Math.min(1, Math.sqrt(Math.max(0, d) / (maxDepth || 1)));
    for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i]; const k = (t - t0) / (t1 - t0);
      return c0.map((c, j) => Math.round(c + (c1[j] - c) * k));
    }
    return STOPS[STOPS.length - 1][1];
  }
  const depthColor = (d) => `rgb(${depthRGB(d).join(',')})`;
  let maxDepth = 1;
  const emit = (name) => window.dispatchEvent(new CustomEvent(name));

  window.mtViewer = {
    get model() { return model; }, get sel() { return sel; }, get mode() { return mode; },
    visible, colorOf, showMoves: () => $('#showMoves').checked, select: (id) => select(id, true),
    showCut, cutting, depthRGB, get maxDepth() { return maxDepth; },
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

  /** face rectangles of the unfolded box: [name, x, y, w, h] in mm */
  const FACES = () => { const { L, W, T } = model; return [['top', 0, 0, L, W], ['back', 0, -T, L, T], ['front', 0, W, L, T], ['left', -T, 0, T, W], ['right', L, 0, T, W]]; };

  function draw() {
    svg.innerHTML = '';
    if (!model) return;
    const { L, W, T } = model;
    const g = document.createElementNS(NS, 'g'); svg.appendChild(g);
    const defs = document.createElementNS(NS, 'defs'); g.appendChild(defs);
    for (const [nm, x, y, w, h] of FACES()) {
      const r = document.createElementNS(NS, 'rect');
      Object.entries({ x, y, width: w, height: h, class: 'face', 'vector-effect': 'non-scaling-stroke' }).forEach(([k, v]) => r.setAttribute(k, v));
      g.appendChild(r);
      // the cut view only shows what is inside the part: clip each face's cuts to its rectangle
      const cp = document.createElementNS(NS, 'clipPath'); cp.id = 'clip-' + nm;
      const cr = document.createElementNS(NS, 'rect'); Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => cr.setAttribute(k, v));
      cp.appendChild(cr); defs.appendChild(cp);
      const t = document.createElementNS(NS, 'text'); t.setAttribute('class', 'facelbl'); t.textContent = nm;
      t.setAttribute('x', x + 4); t.setAttribute('y', y + Math.min(h, 14) - 2); t.setAttribute('font-size', Math.max(T * 0.35, 8));
      g.appendChild(t);
    }
    // cut size: every cutting step's in-material path stroked at the real tool width, deepest on top
    const cuts = model.steps.filter(cutting);
    maxDepth = Math.max(1, ...cuts.map((s) => s.size.depth));
    if (showCut()) {
      for (const s of [...cuts].sort((a, b) => a.size.depth - b.size.depth)) {
        const sg = document.createElementNS(NS, 'g'); sg.dataset.id = s.id; sg.setAttribute('class', 'cutg');
        if (model.T >= 1 && s.face !== 'bottom') sg.setAttribute('clip-path', `url(#clip-${s.face})`);
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', s.sweep.map((poly) => poly.map((q, i) => { const [a, b] = project(s.face, q); return (i ? 'L' : 'M') + a.toFixed(3) + ' ' + b.toFixed(3); }).join('')).join(''));
        p.setAttribute('class', 'cutw'); p.setAttribute('stroke', depthColor(s.size.depth)); p.setAttribute('stroke-width', s.toolDia);
        sg.appendChild(p); g.appendChild(sg);
      }
    }
    updateLegend(cuts.length);
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
    dims = document.createElementNS(NS, 'g'); dims.setAttribute('class', 'dims'); g.appendChild(dims);
    highlight(); applyView();
  }
  let dims = null;

  function updateLegend(n) {
    const el = $('#cutLegend'); if (!el) return;
    el.hidden = !(model && showCut() && n);
    if (el.hidden) return;
    const stops = [0, 0.0625, 0.25, 0.5625, 1].map((f) => depthColor(f * maxDepth));
    el.innerHTML = `<span>cut depth</span><i style="background:linear-gradient(90deg,${stops.join(',')})"></i>` +
      `<span class="ticks"><b>0</b><b>${(maxDepth / 4).toFixed(maxDepth < 8 ? 1 : 0)}</b><b>${maxDepth.toFixed(maxDepth < 8 ? 1 : 0)} mm</b></span>`;
  }

  const fmt = (x) => (Math.round(x * 100) / 100).toString();
  /** "57.33 x 25.44 (X x Z), 3.06 deep" */
  function sizeText(s) {
    if (!s.size) return '';
    const z = s.size; return `${fmt(z.a)} x ${fmt(z.b)} (${z.axes[0]} x ${z.axes[1]}), ${z.through ? 'through' : fmt(z.depth) + ' deep'}${z.open ? ', runs off the face' : ''}`;
  }

  /** Dimension box + label round the selected cut (2D, cut view). */
  function drawDims() {
    if (!dims) return; dims.innerHTML = '';
    const s = model?.steps.find((x) => x.id === sel);
    if (!s || !showCut() || !cutting(s)) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const r = s.toolDia / 2;
    for (const poly of s.sweep) for (const q of poly) { const [a, b] = project(s.face, q); x0 = Math.min(x0, a - r); x1 = Math.max(x1, a + r); y0 = Math.min(y0, b - r); y1 = Math.max(y1, b + r); }
    const fr = FACES().find((f) => f[0] === s.face);
    if (fr && model.T >= 1) { x0 = Math.max(x0, fr[1]); y0 = Math.max(y0, fr[2]); x1 = Math.min(x1, fr[1] + fr[3]); y1 = Math.min(y1, fr[2] + fr[4]); }
    const fs = Math.max(0.6, (view ? view.w : 100) / 60);
    const rect = document.createElementNS(NS, 'rect');
    Object.entries({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'dimbox', 'vector-effect': 'non-scaling-stroke' }).forEach(([k, v]) => rect.setAttribute(k, v));
    const t = document.createElementNS(NS, 'text'); t.setAttribute('class', 'dimtxt');
    t.setAttribute('x', x0); t.setAttribute('y', y0 - fs * 0.4); t.setAttribute('font-size', fs); t.textContent = sizeText(s);
    dims.append(rect, t);
  }

  /** Selection only restyles - no redraw, so a click never rebuilds the drawing mid-gesture. */
  function highlight() {
    svg.querySelectorAll('g[data-id]').forEach((el) => {
      const on = el.dataset.id === sel;
      el.classList.toggle('dim', !!sel && !on);
      el.querySelectorAll('path:not(.cutw)').forEach((p) => p.setAttribute('stroke-width', on ? 2.5 : 1.2));
    });
    drawDims();
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
    // with a step selected, Fit (and double-click on it) zooms to that step
    const s = model.steps.find((x) => x.id === sel && visible(x));
    if (s && (s.cut.length || s.sweep?.length)) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const r = (s.toolDia || 0) / 2;
      for (const poly of [...s.cut, ...(s.sweep || [])]) for (const q of poly) { const [a, b] = project(s.face, q); x0 = Math.min(x0, a - r); x1 = Math.max(x1, a + r); y0 = Math.min(y0, b - r); y1 = Math.max(y1, b + r); }
      const pad = Math.max(x1 - x0, y1 - y0) * 0.5 + 5;
      view = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
      applyView(); drawDims(); return;
    }
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
      info.innerHTML = `<b>${esc(s.name)}</b>${esc(s.groups.join(' / '))}<br>tool ${esc(s.tool ?? '-')}${s.toolDia ? ` (&Oslash;${fmt(s.toolDia)}${s.toolDesc ? ' ' + esc(s.toolDesc) : ''})` : ''} &middot; ${esc(s.feature)} &middot; ${esc(s.face)} face<br>` +
        (s.size ? `<span class="cutsz">cut ${esc(sizeText(s))}</span><br>` : '') +
        `depth ${s.depth === undefined ? '-' : fmt(s.depth)}${zs.length ? ` &middot; Z ${Math.min(...zs).toFixed(2)} to ${Math.max(...zs).toFixed(2)}` : ' &middot; no stored toolpath'}<br>${s.macro ? 'macro ' + esc(s.macro) + '<br>' : ''}${s.enabled ? 'on' : '<i>turned off</i>'}`;
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
        `<span class="sw" style="background:${s.enabled ? colorOf(s.tool) : '#888'}"></span><span class="nm" title="${esc(s.name + (s.size ? '\n' + sizeText(s) : ''))}">${esc(s.name)}</span><span class="tl">${esc(s.tool ?? '')}</span></div>`;
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
    $('#viewHelp').innerHTML = m === '2d' ? 'wheel / pinch: zoom &middot; drag: pan &middot; double-click: fit (a cut: zoom to it) &middot; Esc: clear selection'
      : 'drag: orbit &middot; right-drag / two fingers: pan &middot; wheel / pinch: zoom &middot; double-click: fit (a cut: zoom to it) &middot; Esc: clear selection';
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
  $('#showCut').addEventListener('change', () => { draw(); emit('mt:state'); });
  $('#fitView').addEventListener('click', fit);
  $('#mode2d').addEventListener('click', () => setMode('2d'));
  $('#mode3d').addEventListener('click', () => setMode('3d'));
  document.querySelector('nav button[data-tab=view]').addEventListener('click', () => setTimeout(() => { applyView(); emit('mt:mode'); }, 0));
})();
