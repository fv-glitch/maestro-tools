import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readPgmx, getEntryText } from '../src/engine/archive';
import { readTools } from '../src/engine/tools';
import { viewModelOf, type ViewModel } from '../src/view/model';
// @ts-ignore - plain JS renderer module
import { simulate } from '../src/renderer/cutsim.mjs';

const have = ['tdr-latest', 'apex-passage', 'apex-jamb-lh'].every((f) => existsSync(`fixtures/${f}.pgmx`));
const vm = (f: string) => viewModelOf(readPgmx(`fixtures/${f}.pgmx`), f);
const step = (m: ViewModel, re: RegExp) => m.steps.find((s) => s.enabled && re.test(s.name))!;

/** extent of the cells a single step cuts in the simulation */
function simExtent(m: ViewModel, s: ViewModel['steps'][number]) {
  const r = simulate(m, [s]); let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, d = 0;
  for (const t of r.tiles) for (let j = 0; j <= t.n; j++) for (let i = 0; i <= t.n; i++) {
    const h = t.h[j * (t.n + 1) + i]; if (!(h > 0)) continue;
    const a = t.a0 + i * r.cell, b = t.b0 + j * r.cell;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); d = Math.max(d, h);
  }
  return { a: a1 - a0, b: b1 - b0, depth: d, cell: r.cell };
}

describe.skipIf(!have)('cut size', () => {
  it('reads tool widths from def.tlgx (saw = blade thickness)', () => {
    const t = readTools(getEntryText(readPgmx('fixtures/itm-final.pgmx'), 'def.tlgx'));
    expect(t.E019).toMatchObject({ diameter: 16, width: 16, saw: false });
    expect(t.E017.width).toBe(3);
    expect(t.E015).toMatchObject({ diameter: 249, width: 3.15, saw: true });
  });

  it('sizes the latch set cuts we fitted by hand', () => {
    const m = vm('tdr-latest');
    expect(step(m, /faceplate pocket/).size).toMatchObject({ a: 57.33, b: 25.44, depth: 3.06, through: false, open: false });
    expect(step(m, /spindle hole/).size).toMatchObject({ a: 25, b: 25 });
    expect(step(m, /barrel bore/).size).toMatchObject({ a: 25, b: 25, depth: 85 });
    expect(step(m, /QF stud 1/).size).toMatchObject({ a: 8, b: 8, depth: 20 });
  });

  it('clips a hinge mortise that runs off the door face', () => {
    const s = step(vm('apex-passage'), /^Pocket forming$/);
    expect(s.size).toMatchObject({ a: 89.2, b: 23.5, depth: 2.95, open: true });
  });

  it('never clips jamb programs (0.1 thick, several pieces)', () => {
    const m = vm('apex-jamb-lh');
    for (const s of m.steps.filter((x) => x.enabled && x.size)) { expect(s.size!.open).toBe(false); expect(s.size!.through).toBe(false); }
  });

  it('the simulation removes the same size as the stored toolpath + tool', () => {
    for (const [f, re] of [['tdr-latest', /faceplate pocket/], ['tdr-latest', /barrel bore/], ['apex-passage', /^Pocket forming$/]] as const) {
      const m = vm(f); const s = step(m, re); const e = simExtent(m, s);
      expect(Math.abs(e.a - s.size!.a)).toBeLessThanOrEqual(e.cell * 2);
      expect(Math.abs(e.b - s.size!.b)).toBeLessThanOrEqual(e.cell * 2);
      expect(e.depth).toBeCloseTo(s.size!.depth, 1);
    }
  });
});
