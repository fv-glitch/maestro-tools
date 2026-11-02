import { contextBridge, ipcRenderer } from 'electron';

// The renderer reaches the engine only through this bridge.
contextBridge.exposeInMainWorld('maestro', {
  version: '0.5.0',
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s: unknown) => ipcRenderer.invoke('settings:set', s),
  pickFile: () => ipcRenderer.invoke('pick:file'),
  pickDir: () => ipcRenderer.invoke('pick:dir'),
  generate: (job: unknown) => ipcRenderer.invoke('job:generate', job),
  check: (door: string, jamb: string, doorX0: string, handleHeight?: number) => ipcRenderer.invoke('job:check', door, jamb, doorX0, handleHeight),
  openView: () => ipcRenderer.invoke('view:open'),
  openProgram: () => ipcRenderer.invoke('program:open'),
  previewProgram: (p: string, edits: unknown) => ipcRenderer.invoke('program:preview', p, edits),
  saveProgram: (p: string, edits: unknown) => ipcRenderer.invoke('program:save', p, edits),
  showInFolder: (p: string) => ipcRenderer.invoke('shell:show', p),
});
