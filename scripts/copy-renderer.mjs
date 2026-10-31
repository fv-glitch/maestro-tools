import { cpSync, mkdirSync } from 'node:fs';
import { buildSync } from 'esbuild';
mkdirSync('dist/renderer', { recursive: true });
cpSync('src/renderer', 'dist/renderer', { recursive: true, filter: (p) => !p.endsWith('.ts') && !p.endsWith('viewer3d.js') && !p.endsWith('cutsim.mjs') });
// 3D viewer + three.js bundled into one classic script: works from file:// (Electron) and under the strict CSP
buildSync({ entryPoints: ['src/renderer/viewer3d.js'], bundle: true, format: 'iife', minify: true, target: 'es2020',
  outfile: 'dist/renderer/viewer3d.js', legalComments: 'eof', logLevel: 'warning' });
