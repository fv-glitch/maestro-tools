/**
 * Maestro Tools as a web service (homelab / Docker). Same UI as the desktop app; files move by
 * upload and download. Masters are uploaded once and kept in DATA_DIR/masters, never modified.
 *
 *   PORT        default 8080
 *   DATA_DIR    default ./data   (masters/, uploads/, out/, settings.json)
 *   MT_PASSWORD optional - require HTTP basic auth (any user name, this password)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as path from 'node:path';
import { readPgmx, getXml } from '../engine/archive';
import { viewModel } from '../view/model';
import { alignDoorJamb } from '../check/alignment';
import { generate, type Job } from '../ops/generate';

const PORT = Number(process.env.PORT ?? 8080);
const DATA = path.resolve(process.env.DATA_DIR ?? 'data');
const PASSWORD = process.env.MT_PASSWORD ?? '';
const STATIC = path.join(__dirname, '..', 'renderer');
const MAX_UPLOAD = 60 * 1024 * 1024;
const KEEP_MS = 7 * 24 * 3600 * 1000;           // uploads and outputs are cleaned after a week
for (const d of ['masters', 'uploads', 'out']) mkdirSync(path.join(DATA, d), { recursive: true });

type Slot = 'door' | 'jambLH' | 'jambRH';
const SLOTS: Slot[] = ['door', 'jambLH', 'jambRH'];
interface Settings { heightHand: 'LH' | 'RH'; masters: Partial<Record<Slot, string>> }
const settingsFile = path.join(DATA, 'settings.json');
const loadSettings = (): Settings => { try { return { heightHand: 'LH', masters: {}, ...JSON.parse(readFileSync(settingsFile, 'utf8')) }; } catch { return { heightHand: 'LH', masters: {} }; } };
const saveSettings = (s: Settings) => writeFileSync(settingsFile, JSON.stringify(s, null, 2));

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
const ID = /^[0-9a-f-]{36}$/;

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(data);
}
function body(req: IncomingMessage, limit = MAX_UPLOAD): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > limit) { reject(new Error('file too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
const json = async <T>(req: IncomingMessage): Promise<T> => JSON.parse((await body(req, 1024 * 1024)).toString('utf8') || '{}');
const safeName = (s: string) => path.basename(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 160) || 'program.pgmx';

/** Path of an uploaded file by id (uploads/<id>/<name>). */
function uploaded(id: string): string {
  if (!ID.test(id)) throw new Error('bad upload id');
  const dir = path.join(DATA, 'uploads', id);
  const f = existsSync(dir) ? readdirSync(dir)[0] : undefined;
  if (!f) throw new Error('upload not found (expired?) - upload the file again');
  return path.join(dir, f);
}
function cleanup() {
  for (const d of ['uploads', 'out']) for (const e of readdirSync(path.join(DATA, d))) {
    const p = path.join(DATA, d, e);
    try { if (Date.now() - statSync(p).mtimeMs > KEEP_MS) rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
setInterval(cleanup, 3600 * 1000).unref(); cleanup();

function authorised(req: IncomingMessage): boolean {
  if (!PASSWORD) return true;
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer(async (req, res) => {
  try {
    if (!authorised(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Maestro Tools"' }); res.end('password required'); return; }
    const url = new URL(req.url ?? '/', 'http://x'); const p = url.pathname;

    if (req.method === 'GET' && !p.startsWith('/api/')) {
      const rel = p === '/' ? 'index.html' : p.slice(1);
      const f = path.join(STATIC, rel);
      if (!f.startsWith(STATIC + path.sep) || !existsSync(f) || statSync(f).isDirectory()) return send(res, 404, 'not found', 'text/plain');
      if (rel === 'index.html') {  // load the web bridge before the app scripts
        return send(res, 200, readFileSync(f, 'utf8').replace('<script src="app.js"></script>', '<script src="web-bridge.js"></script>\n  <script src="app.js"></script>'), MIME['.html']);
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' }); createReadStream(f).pipe(res); return;
    }

    if (req.method === 'POST' && p === '/api/upload') {
      const name = safeName(url.searchParams.get('name') ?? 'program.pgmx');
      if (!/\.pgmx$/i.test(name)) return send(res, 400, { error: 'only .pgmx files' });
      const data = await body(req);
      const id = randomUUID(); const dir = path.join(DATA, 'uploads', id); mkdirSync(dir);
      writeFileSync(path.join(dir, name), data);
      try { readPgmx(path.join(dir, name)); } catch (e) { rmSync(dir, { recursive: true, force: true }); return send(res, 400, { error: 'not a Maestro program: ' + (e as Error).message }); }
      return send(res, 200, { id, name });
    }
    if (req.method === 'GET' && p === '/api/settings') {
      const s = loadSettings();
      return send(res, 200, { heightHand: s.heightHand, ...Object.fromEntries(SLOTS.map((k) => [k, s.masters[k] ? path.basename(s.masters[k]!) : ''])) });
    }
    if (req.method === 'POST' && p === '/api/settings') {
      const inp = await json<Record<string, string>>(req); const s = loadSettings();
      if (inp.heightHand === 'LH' || inp.heightHand === 'RH') s.heightHand = inp.heightHand;
      for (const k of SLOTS) {
        const v = inp[k];
        if (v && ID.test(v)) {   // an upload id: keep it as this master
          const src = uploaded(v); const dir = path.join(DATA, 'masters', k);
          rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
          const dst = path.join(dir, path.basename(src)); renameSync(src, dst); s.masters[k] = dst;
        }
      }
      saveSettings(s);
      return send(res, 200, { heightHand: s.heightHand, ...Object.fromEntries(SLOTS.map((k) => [k, s.masters[k] ? path.basename(s.masters[k]!) : ''])) });
    }
    if (req.method === 'POST' && p === '/api/view') {
      const { id } = await json<{ id: string }>(req); const f = uploaded(id);
      return send(res, 200, viewModel(getXml(readPgmx(f)), path.basename(f, '.pgmx')));
    }
    if (req.method === 'POST' && p === '/api/check') {
      const q = await json<{ door: string; jamb: string; doorX0: 'bottom' | 'top'; handleHeight?: number }>(req);
      const file = (x: string) => (x.startsWith('/api/download/') ? outFile(x) : uploaded(x));
      return send(res, 200, alignDoorJamb(getXml(readPgmx(file(q.door))), getXml(readPgmx(file(q.jamb))), q.doorX0 === 'top' ? 'top' : 'bottom', { handleHeight: q.handleHeight }));
    }
    if (req.method === 'POST' && p === '/api/generate') {
      const job = await json<Job>(req); const s = loadSettings();
      for (const k of SLOTS) if (!s.masters[k] || !existsSync(s.masters[k]!)) return send(res, 400, { error: `Upload the ${k} master in Setup first` });
      const id = randomUUID(); const outDir = path.join(DATA, 'out', id); mkdirSync(outDir);
      const g = generate(job, { door: s.masters.door!, jambLH: s.masters.jambLH!, jambRH: s.masters.jambRH! }, { outDir, heightHand: s.heightHand });
      const dl = (f: string) => `/api/download/${id}/${encodeURIComponent(path.basename(f))}`;
      return send(res, 200, { ...g, doorPath: dl(g.doorPath), jambPath: dl(g.jambPath) });
    }
    if (req.method === 'GET' && p.startsWith('/api/download/')) {
      const f = outFile(p);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` });
      createReadStream(f).pipe(res); return;
    }
    if (req.method === 'GET' && p === '/api/masters/download') {   // get a master back
      const k = url.searchParams.get('slot') as Slot; const f = loadSettings().masters[k];
      if (!SLOTS.includes(k) || !f || !existsSync(f)) return send(res, 404, { error: 'no such master' });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` });
      createReadStream(f).pipe(res); return;
    }
    if (p === '/api/health') return send(res, 200, { ok: true });
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: (e as Error).message });
  }
});

function outFile(urlPath: string): string {
  const m = /^\/api\/download\/([0-9a-f-]{36})\/(.+)$/.exec(urlPath);
  if (!m) throw new Error('bad download link');
  const f = path.join(DATA, 'out', m[1], safeName(decodeURIComponent(m[2])));
  if (!existsSync(f)) throw new Error('file expired - generate again');
  return f;
}

server.listen(PORT, () => console.log(`Maestro Tools web: http://0.0.0.0:${PORT}  data: ${DATA}${PASSWORD ? '  (password on)' : ''}`));
