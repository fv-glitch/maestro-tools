import { contextBridge } from 'electron';

// The renderer talks to the engine only through this bridge. Tools are added here as they are built.
contextBridge.exposeInMainWorld('maestro', { version: '0.1.0' });
