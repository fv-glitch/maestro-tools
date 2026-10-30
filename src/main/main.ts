import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { generate, type Job } from '../ops/generate';
import { alignDoorJamb } from '../check/alignment';
import { readPgmx, getXml } from '../engine/archive';

interface Settings { door: string; jambLH: string; jambRH: string; outDir: string; heightHand: 'LH' | 'RH' }
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS: Settings = { door: '', jambLH: '', jambRH: '', outDir: 'C:\\Users\\Public\\Documents\\SCM Group\\MaestroLab\\Projects\\2026\\Generated', heightHand: 'LH' };
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
ipcMain.handle('shell:show', (_e, p: string) => shell.showItemInFolder(p));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
