import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { generate, type Job } from '../ops/generate';
import { alignDoorJamb } from '../check/alignment';
import { readPgmx, getXml } from '../engine/archive';
import { viewModelOf, viewModel } from '../view/model';
import { applyEdits, editFile, needsTemplates, programTree, programVars, type Edit } from '../ops/edit';
import { loadTemplates } from '../ops/cabinet';

interface Settings { door: string; jambLH: string; jambRH: string; outDir: string; heightHand: 'LH' | 'RH'; itm: string; tdr: string; apex: string }
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS: Settings = { door: '', jambLH: '', jambRH: '', outDir: 'C:\\Users\\Public\\Documents\\SCM Group\\MaestroLab\\Projects\\2026\\Generated', heightHand: 'LH', itm: '', tdr: '', apex: '' };
function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180, height: 820, title: 'Maestro Tools',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, s: Settings) => { mkdirSync(path.dirname(settingsFile()), { recursive: true }); writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); return s; });
ipcMain.handle('pick:file', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Maestro program', extensions: ['pgmx'] }] });
  return r.canceled ? undefined : r.filePaths[0];
});
ipcMain.handle('pick:dir', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? undefined : r.filePaths[0];
});
ipcMain.handle('job:generate', (_e, job: Job) => {
  const s = loadSettings();
  for (const k of ['door', 'jambLH', 'jambRH'] as const) if (!s[k] || !existsSync(s[k])) throw new Error(`Set the ${k} master in Setup first`);
  mkdirSync(s.outDir, { recursive: true });
  return generate(job, { door: s.door, jambLH: s.jambLH, jambRH: s.jambRH }, { outDir: s.outDir, heightHand: s.heightHand });
});
ipcMain.handle('job:check', (_e, doorPath: string, jambPath: string, doorX0: 'bottom' | 'top', handleHeight?: number) =>
  alignDoorJamb(getXml(readPgmx(doorPath)), getXml(readPgmx(jambPath)), doorX0, { handleHeight }));
ipcMain.handle('view:open', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Maestro program', extensions: ['pgmx'] }] });
  if (r.canceled) return undefined;
  return viewModelOf(readPgmx(r.filePaths[0]), path.basename(r.filePaths[0], '.pgmx'));
});
// ---- program editing (Program tab)
const xmlOf = (p: string) => getXml(readPgmx(p));
function templates(edits: Edit[]) {
  if (!needsTemplates(edits)) return undefined;
  const s = loadSettings();
  for (const k of ['itm', 'tdr', 'apex'] as const) if (!s[k] || !existsSync(s[k])) throw new Error('Set the ITM, TestingDoorReal and APEX Passage template programs in Setup first');
  return loadTemplates(xmlOf(s.itm), xmlOf(s.tdr), xmlOf(s.apex));
}
const toolsOf = (p: string) => { const a = readPgmx(p); const e = a.entries.find((x) => /\.tlgx$/i.test(x.name)); return e ? new TextDecoder().decode(e.data) : undefined; };
ipcMain.handle('program:open', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Maestro program', extensions: ['pgmx'] }] });
  if (r.canceled) return undefined;
  const p = r.filePaths[0]; const name = path.basename(p, '.pgmx');
  return { path: p, name, model: viewModelOf(readPgmx(p), name), tree: programTree(xmlOf(p)), vars: programVars(xmlOf(p)) };
});
ipcMain.handle('program:preview', (_e, p: string, edits: Edit[]) => {
  const r = applyEdits(xmlOf(p), edits, templates(edits));
  return { ...r, xml: undefined, model: viewModel(r.xml, path.basename(p, '.pgmx') + ' (preview - not saved)', toolsOf(p)), tree: programTree(r.xml), vars: programVars(r.xml) };
});
ipcMain.handle('program:save', async (_e, p: string, edits: Edit[]) => {
  const stem = path.basename(p, '.pgmx');
  const r = await dialog.showSaveDialog({ defaultPath: path.join(path.dirname(p), stem + ' edited.pgmx'), filters: [{ name: 'Maestro program', extensions: ['pgmx'] }] });
  if (r.canceled || !r.filePath) return undefined;
  const out = /\.pgmx$/i.test(r.filePath) ? r.filePath : r.filePath + '.pgmx';
  const res = editFile(p, edits, out, templates(edits));
  const name = path.basename(out, '.pgmx');
  return { path: out, name, log: res.log, notes: res.notes, model: viewModelOf(readPgmx(out), name), tree: programTree(xmlOf(out)), vars: programVars(xmlOf(out)) };
});
ipcMain.handle('shell:show', (_e, p: string) => shell.showItemInFolder(p));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
