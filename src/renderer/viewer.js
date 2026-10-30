/* global maestro */
(() => {
  const $ = (s) => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = $('#svg');
  let model = null, sel = null, view = null;
  const hidden = new Set();
  const PALETTE = ['#2f6fd0', '#d0602f', '#2f9e5a', '#9b4fd0', '#c9a227', '#1fa2b8', '#d04f8a', '#6b7a2f', '#7a4f2f', '#4f5fd0'];
  const toolColor = {};
  const colorOf = (tool) => toolColor[tool] ?? (toolColor[tool] = PALETTE[Object.keys(toolColor).length % PALETTE.length]);

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
  const visible = (s) => (s.enabled || $('#showOff').checked) && !hidden.has(s.id);

  function draw() {
    svg.innerHTML = '';
    if (!model) return;
    const { L, W, T } = model;
    const g = document.createElementNS(NS, 'g'); svg.appendChild(g);
    const faces = [['top', 0, 0, L, W], ['back', 0, -T, L, T], ['front', 0, W, L, T], ['left', -T, 0, T, W], ['right', L, 0, T, W]];
    for (const [nm, x, y, w, h] of faces) {
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
      if (sel && sel !== s.id) sg.setAttribute('class', 'dim');
      const col = s.enabled ? colorOf(s.tool) : '#888';
      const add = (pts, cls) => {
        if (pts.length < 2) return;
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', pts.map((q, i) => { const [a, b] = project(s.face, q); return (i ? 'L' : 'M') + a.toFixed(3) + ' ' + b.toFixed(3); }).join(''));
        p.setAttribute('stroke', col); p.setAttribute('stroke-width', sel === s.id ? 2.5 : 1.2); if (cls) p.setAttribute('class', cls);
        sg.appendChild(p);
      };
      s.cut.forEach((c) => add(c));
      if ($('#showMoves').checked) s.moves.forEach((m) => add(m, 'mv'));
      sg.addEventListener('click', (e) => { e.stopPropagation(); select(s.id); });
      g.appendChild(sg);
    }
    applyView();
  }

  function fit() {
    if (!model) return;
    const { L, W, T } = model;
    let x0 = -T, y0 = -T, x1 = L + T, y1 = W + T;
    for (const s of model.steps) if (visible(s)) for (const c of s.cut) for (const q of c) {
      const [a, b] = project(s.face, q); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
    }
    const pad = Math.max(x1 - x0, y1 - y0) * 0.03;
    view = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    applyView();
  }
  function applyView() {
    if (!view) return;
    const r = svg.getBoundingClientRect(); const ar = r.width / Math.max(r.height, 1);
    let { x, y, w, h } = view;
    if (w / h < ar) { const nw = h * ar; x -= (nw - w) / 2; w = nw; } else { const nh = w / ar; y -= (nh - h) / 2; h = nh; }
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }
  svg.addEventListener('wheel', (e) => {
    if (!view) return; e.preventDefault();
    const vb = svg.viewBox.baseVal; const r = svg.getBoundingClientRect();
    const mx = vb.x + (e.clientX - r.left) / r.width * vb.width, my = vb.y + (e.clientY - r.top) / r.height * vb.height;
    const k = Math.exp(e.deltaY * 0.0015);
    view = { x: mx - (mx - vb.x) * k, y: my - (my - vb.y) * k, w: vb.width * k, h: vb.height * k }; applyView();
  }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { if (!view) return; drag = { x: e.clientX, y: e.clientY, vb: { ...svg.viewBox.baseVal } }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return; const r = svg.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / r.width * drag.vb.width, dy = (e.clientY - drag.y) / r.height * drag.vb.height;
    view = { x: drag.vb.x - dx, y: drag.vb.y - dy, w: drag.vb.width, h: drag.vb.height }; applyView();
  });
  svg.addEventListener('pointerup', (e) => { if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3 && e.target === svg) select(null); drag = null; });
  window.addEventListener('resize', applyView);

  function select(id) {
    sel = sel === id ? null : id;
    document.querySelectorAll('.steps .st').forEach((el) => el.classList.toggle('sel', el.dataset.id === sel));
    const s = model.steps.find((x) => x.id === sel); const info = $('#stepInfo');
    if (s) {
      const pts = s.cut.flat(); const zs = pts.map((p) => p[2]);
      info.innerHTML = `<b>${esc(s.name)}</b>${esc(s.groups.join(' / '))}<br>tool ${esc(s.tool ?? '-')} &middot; ${esc(s.feature)} &middot; ${esc(s.face)} face<br>` +
        `depth ${s.depth ?? '-'}${zs.length ? ` &middot; Z ${Math.min(...zs).toFixed(2)} to ${Math.max(...zs).toFixed(2)}` : ' &middot; no stored toolpath'}<br>${s.macro ? 'macro ' + esc(s.macro) + '<br>' : ''}${s.enabled ? 'on' : '<i>turned off</i>'}`;
      info.style.display = 'block';
    } else info.style.display = 'none';
    draw();
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
      row.querySelector('input').addEventListener('click', (e) => { e.stopPropagation(); e.target.checked ? hidden.delete(row.dataset.id) : hidden.add(row.dataset.id); draw(); });
      row.addEventListener('click', () => select(row.dataset.id));
    });
  }

  $('#openView').addEventListener('click', async () => {
    try {
      const m = await maestro.openView(); if (!m) return;
      model = m; sel = null; hidden.clear(); $('#viewName').textContent = `${m.name}  (${m.L} x ${m.W} x ${m.T})`;
      list(); fit(); draw();
    } catch (err) { $('#viewName').textContent = err.message; }
  });
  $('#showOff').addEventListener('change', () => { if (model) { list(); draw(); } });
  $('#showMoves').addEventListener('change', draw);
  $('#fitView').addEventListener('click', fit);
  document.querySelector('nav button[data-tab=view]').addEventListener('click', () => setTimeout(applyView, 0));
})();
