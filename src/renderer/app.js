/* global maestro */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n2 = (x) => (Math.abs(x) < 0.005 ? 0 : Number(x)).toFixed(2);

$$('nav button').forEach((b) => b.addEventListener('click', () => {
  $$('nav button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
}));

// ---------- setup
let settings;
const WEB = !!maestro.web;
const fileName = (p) => (WEB ? decodeURIComponent(String(p).split('/').pop()) : p);
if (WEB) {
  document.querySelectorAll('[data-pick-dir]').forEach((b) => b.closest('.row').remove());
  document.querySelectorAll('[data-pick]').forEach((b) => { b.textContent = b.textContent.replace('...', ' (upload)...'); });
  const intro = document.querySelector('#tab-setup p'); if (intro) intro.textContent = 'Masters are uploaded once and kept on the server, never changed. Generated programs download from the job page.';
}
async function loadSettings() {
  settings = await maestro.getSettings();
  $$('[data-show]').forEach((el) => { el.textContent = settings[el.dataset.show] || 'not set'; });
  $('#heightHand').value = settings.heightHand;
}
async function save() { settings = await maestro.setSettings(settings); await loadSettings(); }
$$('[data-pick]').forEach((b) => b.addEventListener('click', async () => { const p = await maestro.pickFile(); if (p) { settings[b.dataset.pick] = p; await save(); } }));
$$('[data-pick-dir]').forEach((b) => b.addEventListener('click', async () => { const p = await maestro.pickDir(); if (p) { settings[b.dataset.pickDir] = p; await save(); } }));
$('#heightHand').addEventListener('change', async (e) => { settings.heightHand = e.target.value; await save(); });

// ---------- report rendering
function report(r) {
  const row = (x, a, b) => `<tr><td>${esc(x.item)}</td><td>${n2(a)}</td><td>${n2(b)}</td><td>${(Math.abs(x.diff) < 0.005 || x.diff > 0 ? '+' : '') + n2(x.diff)}</td><td class="${x.grade}">${x.grade === 'out' ? 'OUT' : x.grade}</td></tr>`;
  return `<table><tr><th>Door vs jamb</th><th>door</th><th>jamb</th><th>diff</th><th></th></tr>${r.rows.map((x) => row(x, x.door, x.jamb)).join('')}</table>` +
    (r.intent.length ? `<table><tr><th>Against the job</th><th>want</th><th>got</th><th>diff</th><th></th></tr>${r.intent.map((x) => row(x, x.want, x.got)).join('')}</table>` : '') +
    (r.notes.length ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '') +
    `<p class="status ${r.ok ? 'final' : 'error'}">${r.ok ? 'ALIGNED' : 'NOT ALIGNED'}</p>`;
}
const changes = (list) => list.length ? `<ul>${list.map((c) => `<li>${esc(c.name)}: ${esc(c.from)} &rarr; ${esc(c.to)}${c.derived ? ' <span class="hint">(calculated)</span>' : ''}</li>`).join('')}</ul>` : '<p class="hint">no changes from the master</p>';

// ---------- generate
let last;
$('#job').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target); const num = (k) => parseFloat(f.get(k));
  const job = {
    jobNo: f.get('jobNo').trim(), customer: f.get('customer').trim(), quantity: num('quantity'), hand: f.get('hand'),
    length: num('length'), width: num('width'), thickness: num('thickness'), solidCore: f.get('solidCore') === 'on',
    range: f.get('range'), handleHeight: num('handleHeight'),
    jamb: { width: num('jambWidth'), thickness: num('jambThickness'), footClearance: num('footClearance'), mitre: f.get('mitre') === 'on' },
  };
  const out = $('#result');
  try {
    const g = await maestro.generate(job);
    last = { g, job, x0: job.hand === settings.heightHand ? 'bottom' : 'top' };
    out.innerHTML = `<div class="panel">
      <p class="status ${g.status}">${g.status === 'final' ? 'FINAL - ready to cut' : 'PROVISIONAL - open both files in Maestro, save them, then Re-check'}</p>
      <div class="row"><button id="showDoor">${WEB ? 'Download door' : 'Show door'}</button><span class="path">${esc(fileName(g.doorPath))}</span></div>${changes(g.doorChanges)}
      <div class="row"><button id="showJamb">${WEB ? 'Download jamb' : 'Show jamb'}</button><span class="path">${esc(fileName(g.jambPath))}</span></div>${changes(g.jambChanges)}
      ${g.status === 'provisional' ? `<p class="hint">${g.pendingInMaestro.door + g.pendingInMaestro.jamb} formulas in the programs depend on these values; Maestro applies them when it opens the files.</p>` : ''}
      <div class="row"><button id="recheck" class="primary">Re-check</button></div>
      <div id="rep">${report(g.alignment)}</div></div>`;
    $('#showDoor').onclick = () => maestro.showInFolder(g.doorPath);
    $('#showJamb').onclick = () => maestro.showInFolder(g.jambPath);
    $('#recheck').onclick = async () => { $('#rep').innerHTML = report(await maestro.check(g.doorPath, g.jambPath, last.x0, job.handleHeight)); };
  } catch (err) { out.innerHTML = `<div class="panel"><p class="status error">${esc(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</p></div>`; }
});

// ---------- check tab
let cd, cj;
const label = (x) => (x ? (maestro.nameOf ? maestro.nameOf(x) : x) : '-');
$('#pickDoor').onclick = async () => { cd = await maestro.pickFile(); $('#checkDoor').textContent = label(cd); };
$('#pickJamb').onclick = async () => { cj = await maestro.pickFile(); $('#checkJamb').textContent = label(cj); };
$('#runCheck').onclick = async () => {
  if (!cd || !cj) return;
  const h = parseFloat($('#checkHeight').value);
  try { $('#checkResult').innerHTML = `<div class="panel">${report(await maestro.check(cd, cj, $('#checkX0').value, Number.isFinite(h) ? h : undefined))}</div>`; }
  catch (err) { $('#checkResult').innerHTML = `<div class="panel"><p class="status error">${esc(err.message)}</p></div>`; }
};

loadSettings();
