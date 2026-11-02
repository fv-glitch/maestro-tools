/* global maestro */
/* Program tab: open a program, queue edits (add proven steps, steps on/off, rename), preview them in
 * the viewer, save as a new file. The engine does all the work (src/ops/edit.ts); this only builds the list. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const WEB = !!maestro.web;
  let cur = null;          // { path, name, model, tree }
  let edits = [];
  const TYPES = { MachiningWorkingStep: 'step', ExecutableGroup: 'group', VisualSubProgram: 'macro', Xn: 'park', Xmsg: 'msg' };

  const errText = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const showError = (e) => { $('#editResult').innerHTML = `<p class="status error">${esc(errText(e))}</p>`; };

  function load(p) {
    cur = p; edits = [];
    $('#programName').textContent = `${p.name}  (${p.model.L} x ${p.model.W} x ${p.model.T})`;
    $('#editor').hidden = false; $('#editResult').innerHTML = '';
    render();
  }

  // ---------- steps tree
  const pendingEnable = (id) => edits.find((e) => e.op === 'enable' && e.step === id);
  const pendingName = (id) => edits.find((e) => e.op === 'rename' && e.step === id);
  const pendingOf = (id, op) => edits.find((e) => e.op === op && e.step === id);
  const deletedRows = () => {   // rows hidden by a pending delete (the row itself and everything under it)
    const out = new Set(); let cut = null;
    for (const r of cur.tree) {
      if (cut !== null && r.depth > cut) { out.add(r.id); continue; }
      cut = null;
      if (pendingOf(r.id, 'delete')) { out.add(r.id); cut = r.depth; }
    }
    return out;
  };
  /** what each row offers: groups and Top-face steps move, Top holes change depth */
  function actions(r) {
    if (r.locked) return [];
    const a = [];
    if (!r.noRename) a.push(['rename', 'Rename']);
    if (r.type === 'ExecutableGroup' || (r.type === 'MachiningWorkingStep' && r.plane === 'Top')) a.push(['move', 'Move...']);
    if (r.feature === 'RoundHole' && r.plane === 'Top') a.push(['depth', 'Depth...']);
    if (r.type === 'ExecutableGroup' || r.type === 'MachiningWorkingStep') a.push(['delete', 'Delete']);
    return a;
  }
  function renderTree() {
    const el = $('#programTree'); const gone = deletedRows();
    el.innerHTML = cur.tree.map((r) => {
      const en = pendingEnable(r.id); const nm = pendingName(r.id);
      const on = en ? en.on : r.enabled;
      const tags = ['move', 'depth'].map((op) => pendingOf(r.id, op)).filter(Boolean)
        .map((e) => e.op === 'move' ? `moved ${e.dx}, ${e.dy}` : `depth ${e.depth}`).join(', ');
      const changed = en || nm || tags;
      const acts = actions(r);
      const btns = r.locked ? '' : `<button data-act="toggle">${on ? 'Turn off' : 'Turn on'}</button>` +
        (acts.length ? `<select data-act="menu"><option value="">Change</option>${acts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` : '');
      return `<div class="tr ${on ? '' : 'off'} ${r.locked ? 'locked' : ''} ${changed ? 'changed' : ''} ${gone.has(r.id) ? 'gone' : ''}" data-id="${esc(r.id)}" style="padding-left:${r.depth * 14}px"
        title="${esc(r.locked ? 'locked: ' + r.locked : r.type + (r.feature ? ' / ' + r.feature + ' on ' + r.plane : ''))}"><span class="ty">${esc(TYPES[r.type] || r.type)}</span><span class="nm">${esc(nm ? nm.to : r.name)}${tags ? ` <i class="hint">(${esc(tags)})</i>` : ''}</span>${gone.has(r.id) ? '' : btns}</div>`;
    }).join('') || '<p class="hint">empty workplan</p>';
    el.querySelectorAll('.tr button[data-act=toggle]').forEach((b) => b.addEventListener('click', () => {
      const r = cur.tree.find((x) => x.id === b.closest('.tr').dataset.id);
      const en = pendingEnable(r.id);
      if (en) edits = edits.filter((e) => e !== en);       // back to how the file has it
      else edits.push({ op: 'enable', step: r.id, on: !r.enabled });
      render();
    }));
    el.querySelectorAll('.tr select[data-act=menu]').forEach((sel) => sel.addEventListener('change', () => {
      const row = sel.closest('.tr'); const r = cur.tree.find((x) => x.id === row.dataset.id); const act = sel.value; sel.value = '';
      if (act === 'delete') { edits = edits.filter((e) => e.step !== r.id); edits.push({ op: 'delete', step: r.id }); render(); return; }
      if (act === 'rename') return renameInline(row, r);
      inlineForm(row, r, act);
    }));
  }
  function renameInline(row, r) {
    const nmEl = row.querySelector('.nm'); const old = pendingName(r.id);
    const inp = document.createElement('input'); inp.value = old ? old.to : r.name; nmEl.replaceWith(inp); inp.focus(); inp.select();
    const done = (keep) => {
      const v = inp.value.trim(); edits = edits.filter((e) => e !== old);
      if (keep && v && v !== r.name) edits.push({ op: 'rename', step: r.id, to: v });
      render();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
  }
  /** a small form under the row: move dx / dy, or a new hole depth */
  function inlineForm(row, r, act) {
    $('#programTree').querySelectorAll('.inl').forEach((x) => x.remove());
    const old = pendingOf(r.id, act);
    const f = document.createElement('form'); f.className = 'inl'; f.style.paddingLeft = (r.depth * 14 + 20) + 'px';
    f.innerHTML = act === 'move'
      ? `<label>dX <input name="dx" type="number" step="0.01" value="${old ? old.dx : 0}" /></label><label>dY <input name="dy" type="number" step="0.01" value="${old ? old.dy : 0}" /></label><button>OK</button><button type="button" data-x>Cancel</button>`
      : `<label>Depth <input name="depth" type="number" step="0.1" value="${old ? old.depth : ''}" /></label><button>OK</button><button type="button" data-x>Cancel</button>`;
    row.after(f); f.querySelector('input').focus();
    f.querySelector('[data-x]').onclick = () => f.remove();
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = (n) => parseFloat(f.querySelector(`[name=${n}]`).value);
      edits = edits.filter((e) => e !== old);
      if (act === 'move') { const dx = v('dx') || 0, dy = v('dy') || 0; if (dx || dy) edits.push({ op: 'move', step: r.id, dx, dy }); }
      else { const d = v('depth'); if (d > 0) edits.push({ op: 'depth', step: r.id, depth: d }); }
      render();
    });
  }

  // ---------- edit list
  const nameOf = (id) => (cur.tree.find((r) => r.id === id) || {}).name || id;
  function describe(e) {
    switch (e.op) {
      case 'pocket': return `Pocket ${e.name ? `'${e.name}' ` : ''}X ${e.x0}..${e.x1}, Y ${e.y0}..${e.y1}, ${e.depth} deep`;
      case 'drill': return `${e.dia} mm hole ${e.name ? `'${e.name}' ` : ''}at ${e.x}, ${e.y}, ${e.depth} deep`;
      case 'edgeDrill': return `8 mm edge hole ${e.name ? `'${e.name}' ` : ''}in ${e.edge} at ${e.pos}, ${e.z} up, ${e.depth} deep`;
      case 'saw': return `Saw cut ${e.name ? `'${e.name}' ` : ''}along ${e.axis.toUpperCase()} at ${e.at}`;
      case 'enable': return `Turn ${e.on ? 'on' : 'off'}: ${nameOf(e.step)}`;
      case 'rename': return `Rename: ${nameOf(e.step)} -> ${e.to}`;
      case 'move': return `Move ${nameOf(e.step)} by ${e.dx} in X, ${e.dy} in Y`;
      case 'depth': return `Depth ${e.depth}: ${nameOf(e.step)}`;
      case 'delete': return `Delete ${nameOf(e.step)}`;
      case 'variable': return `Set ${e.name} = ${e.value}`;
      default: return e.op;
    }
  }
  function renderList() {
    $('#editList').innerHTML = edits.map((e, i) => `<li>${esc(describe(e))}<button data-i="${i}" title="remove">x</button></li>`).join('') || '<p class="hint">no edits yet</p>';
    $('#editList').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { edits.splice(+b.dataset.i, 1); render(); }));
    $('#previewEdits').disabled = $('#saveEdits').disabled = !edits.length;
  }
  function renderVars() {
    const el = $('#programVars'); const vs = cur.vars || [];
    el.innerHTML = vs.length ? `<table class="vars">${vs.map((v) => {
      const pe = edits.find((e) => e.op === 'variable' && e.name === v.name);
      return `<tr><td>${esc(v.name)}</td><td>${v.formula ? `${esc(v.value)} <span class="hint">= ${esc(v.formula)}</span>`
        : `<input data-var="${esc(v.name)}" type="number" step="any" value="${esc(pe ? pe.value : v.value)}" class="${pe ? 'changed' : ''}" />`}</td></tr>`;
    }).join('')}</table>` : '<p class="hint">no variables</p>';
    el.querySelectorAll('input[data-var]').forEach((inp) => inp.addEventListener('change', () => {
      const name = inp.dataset.var; const v = cur.vars.find((x) => x.name === name); const n = parseFloat(inp.value);
      edits = edits.filter((e) => !(e.op === 'variable' && e.name === name));
      if (Number.isFinite(n) && n !== parseFloat(v.value)) edits.push({ op: 'variable', name, value: n });
      render();
    }));
  }
  function render() { renderTree(); renderVars(); renderList(); }

  // ---------- add-step form
  const form = $('#addStep');
  const F = (n) => form.querySelector(`[name="${n}"]`);   // first match: the shared op / name / group fields
  const showFields = () => form.querySelectorAll('[data-for]').forEach((d) => { d.hidden = d.dataset.for !== F('op').value; });
  F('op').addEventListener('change', showFields);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const op = F('op').value; const box = form.querySelector(`[data-for="${op}"]`);
      const val = (n) => box.querySelector(`[name="${n}"]`).value.trim();
      const need = (n, label) => { const v = val(n); if (v === '') throw new Error(`${label} is needed`); return v; };
      const numOrFormula = (n, label) => { const v = need(n, label); return /^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : v; };
      const number = (n, label) => { const v = parseFloat(need(n, label)); if (!Number.isFinite(v)) throw new Error(`${label} must be a number`); return v; };
      const e = { op };
      const nm = F('name').value.trim(); if (nm) e.name = nm;
      const gp = F('group').value.trim(); if (gp) e.group = gp;
      if (op === 'pocket') Object.assign(e, { x0: numOrFormula('x0', 'X from'), x1: numOrFormula('x1', 'X to'), y0: numOrFormula('y0', 'Y from'), y1: numOrFormula('y1', 'Y to'), depth: number('depth', 'Depth') });
      if (op === 'drill') Object.assign(e, { x: numOrFormula('x', 'X'), y: numOrFormula('y', 'Y'), dia: +val('dia'), depth: number('depth', 'Depth') });
      if (op === 'edgeDrill') Object.assign(e, { edge: val('edge'), pos: number('pos', 'Position'), z: number('z', 'Height'), depth: number('depth', 'Depth') });
      if (op === 'saw') Object.assign(e, { axis: val('axis'), at: number('at', 'Blade centre'), run: number('run', 'Run past the ends') });
      edits.push(e); F('name').value = ''; $('#editResult').innerHTML = ''; render();
    } catch (err) { showError(err); }
  });

  // ---------- preview / save
  const resultHtml = (r, saved) => `<p class="status provisional">${saved ? 'SAVED - PROVISIONAL' : 'PREVIEW - not saved'}: open it in Maestro, check the steps, save, then view it again before cutting</p>` +
    `<ul>${r.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` + (r.notes.length ? `<ul class="hint">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '');
  const toViewer = (model) => { window.mtViewer.load(model); document.querySelector('nav button[data-tab=view]').click(); };

  $('#openProgram').addEventListener('click', async () => {
    try { const p = await maestro.openProgram(); if (p) load(p); } catch (err) { $('#programName').textContent = errText(err); }
  });
  $('#previewEdits').addEventListener('click', async () => {
    try { const r = await maestro.previewProgram(cur.path, edits); $('#editResult').innerHTML = resultHtml(r, false); toViewer(r.model); }
    catch (err) { showError(err); }
  });
  $('#saveEdits').addEventListener('click', async () => {
    try {
      const r = await maestro.saveProgram(cur.path, edits); if (!r) return;
      const html = resultHtml(r, true);
      load({ path: r.path, name: r.name, model: r.model, tree: r.tree, vars: r.vars });   // keep editing the new file
      $('#editResult').innerHTML = `${html}<div class="row"><button id="savedShow">${WEB ? 'Download' : 'Show in folder'}</button><span class="path">${esc(WEB ? r.name + '.pgmx' : r.path)}</span></div>`;
      $('#savedShow').onclick = () => maestro.showInFolder(r.path);
    } catch (err) { showError(err); }
  });
  $('#clearEdits').addEventListener('click', () => { edits = []; $('#editResult').innerHTML = ''; render(); });
  showFields();
})();
