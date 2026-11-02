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
  function renderTree() {
    const el = $('#programTree');
    el.innerHTML = cur.tree.map((r) => {
      const en = pendingEnable(r.id); const nm = pendingName(r.id);
      const on = en ? en.on : r.enabled; const changed = en || nm;
      const btns = r.locked ? '' : `<button data-act="toggle">${on ? 'Turn off' : 'Turn on'}</button>${r.noRename ? '' : '<button data-act="rename">Rename</button>'}`;
      return `<div class="tr ${on ? '' : 'off'} ${r.locked ? 'locked' : ''} ${changed ? 'changed' : ''}" data-id="${esc(r.id)}" style="padding-left:${r.depth * 14}px"
        title="${esc(r.locked ? 'locked: ' + r.locked : r.type)}"><span class="ty">${esc(TYPES[r.type] || r.type)}</span><span class="nm">${esc(nm ? nm.to : r.name)}</span>${btns}</div>`;
    }).join('') || '<p class="hint">empty workplan</p>';
    el.querySelectorAll('.tr button').forEach((b) => b.addEventListener('click', () => {
      const row = b.closest('.tr'); const r = cur.tree.find((x) => x.id === row.dataset.id);
      if (b.dataset.act === 'toggle') {
        const en = pendingEnable(r.id);
        if (en) edits = edits.filter((e) => e !== en);       // back to how the file has it
        else edits.push({ op: 'enable', step: r.id, on: !r.enabled });
        render();
      } else {
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
    }));
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
      default: return e.op;
    }
  }
  function renderList() {
    $('#editList').innerHTML = edits.map((e, i) => `<li>${esc(describe(e))}<button data-i="${i}" title="remove">x</button></li>`).join('') || '<p class="hint">no edits yet</p>';
    $('#editList').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { edits.splice(+b.dataset.i, 1); render(); }));
    $('#previewEdits').disabled = $('#saveEdits').disabled = !edits.length;
  }
  function render() { renderTree(); renderList(); }

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
      load({ path: r.path, name: r.name, model: r.model, tree: r.tree });   // keep editing the new file
      $('#editResult').innerHTML = `${html}<div class="row"><button id="savedShow">${WEB ? 'Download' : 'Show in folder'}</button><span class="path">${esc(WEB ? r.name + '.pgmx' : r.path)}</span></div>`;
      $('#savedShow').onclick = () => maestro.showInFolder(r.path);
    } catch (err) { showError(err); }
  });
  $('#clearEdits').addEventListener('click', () => { edits = []; $('#editResult').innerHTML = ''; render(); });
  showFields();
})();
