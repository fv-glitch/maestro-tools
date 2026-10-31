/* Web version of the desktop bridge: same window.maestro API, backed by the HTTP server.
 * "Paths" are upload ids (files you pick) or download links (generated files). */
(() => {
  const api = async (url, opts = {}) => {
    const r = await fetch(url, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  };
  const post = (url, data) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const names = new Map();   // upload id -> file name (for display)
  function pickAndUpload() {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pgmx';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return resolve(undefined);
        try {
          const r = await api('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
          names.set(r.id, r.name); resolve(r.id);
        } catch (e) { reject(e); }
      };
      inp.click();
    });
  }
  window.maestro = {
    version: '0.5.0', web: true,
    nameOf: (id) => names.get(id) || id,
    getSettings: async () => ({ ...(await api('/api/settings')), outDir: 'downloads (web)' }),
    setSettings: async (s) => ({ ...(await post('/api/settings', s)), outDir: 'downloads (web)' }),
    pickFile: pickAndUpload,
    pickDir: async () => undefined,
    generate: (job) => post('/api/generate', job),
    check: (door, jamb, doorX0, handleHeight) => post('/api/check', { door, jamb, doorX0, handleHeight }),
    openView: async () => { const id = await pickAndUpload(); return id ? post('/api/view', { id }) : undefined; },
    showInFolder: async (link) => { const a = document.createElement('a'); a.href = link; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); },
  };
})();
