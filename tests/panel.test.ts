import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readPgmx, getXml, getEntryText } from '../src/engine/archive';
import { assertSafe } from '../src/engine/validate';
import { stepList } from '../src/engine/pgmx';
import { readVariables } from '../src/engine/variables';
import { loadTemplates, blankProgram } from '../src/ops/cabinet';
import { partPrograms, notchRects, pocketRects, sawPrograms, type Part, type PlanJSON } from '../src/ops/panelJob';
import { viewModel } from '../src/view/model';

const F = ['tdr-latest', 'itm-final', 'apex-passage'].map((f) => `fixtures/${f}.pgmx`);
const have = F.every(existsSync);
const xml = (f: string) => getXml(readPgmx(f));

// a side with the comb pocket (rebate + housings), a shelf with corner notches, screws and edge dowels
const side: Part = { id: 'S', names: ['Side'], qty: 1, L: 902.6, W: 280, T: 18, setups: ['F1', 'F0'], outline: [[0, 0], [902.6, 0], [902.6, 280], [0, 280]], ops: [
  { type: 'pocket', face: 'F1', depth: 6, polygon: [[0, 0], [0, 9.5], [282.9, 9.5], [282.9, 270], [300.9, 270], [300.9, 9.5], [902.6, 9.5], [902.6, 0]] },
  { type: 'drill', face: 'F0', dia: 3, depth: 2, x: 291.9, y: 60 },
  { type: 'edge_drill', edge: 'X0', pos: 40, z: 9, dia: 8, depth: 20 },
] };
const shelf: Part = { id: 'H', names: ['Shelf'], qty: 6, L: 271, W: 143, T: 18, setups: ['F1'],
  outline: [[271, 0], [271, 143], [15, 143], [15, 137], [0, 137], [0, 6], [15, 6], [15, 0]], ops: [] };

describe('panel geometry', () => {
  it('splits a comb pocket into the rebate and a full-height housing', () => {
    expect(pocketRects(side.ops[0].polygon!).map((r) => r.map((v) => Math.round(v * 10) / 10))).toEqual([[0, 0, 902.6, 9.5], [282.9, 0, 300.9, 270]]);
  });
  it('finds corner notches from the outline', () => {
    expect(notchRects(shelf)).toEqual([[0, 0, 15, 6], [0, 137, 15, 143]]);
  });
});

describe.skipIf(!have)('panel programs', () => {
  const [tdr, itm, apex] = F.map(xml); const tp = loadTemplates(itm, tdr, apex);
  const tools = getEntryText(readPgmx(F[0]), 'def.tlgx'); const view = (x: string) => viewModel(x, '', tools);
  it('empties TestingDoorReal to a bare workpiece', () => {
    const b = blankProgram(tdr, 500, 300, 18, [['BoardT', 18]]);
    assertSafe(tdr, b);
    expect(stepList(b)).toEqual([['Park Right(2)(1)', 'true']]);
    expect(Object.fromEntries(readVariables(b).map((v) => [v.name, v.value]))).toEqual({ dx1: 500, dy1: 300, dz1: 18, BoardT: 18 });
  });
  it('builds the side: F1 rebate, housing (BoardT), edge dowel; F0 screw mark flipped', () => {
    const [f1, f0] = partPrograms(side, tdr, tp);
    assertSafe(tdr, f1.xml); assertSafe(tdr, f0.xml);
    const m1 = view(f1.xml); const by = (re: RegExp) => m1.steps.find((s) => re.test(s.name))!;
    expect(by(/Rebate 1/).size).toMatchObject({ a: 902.6, b: 9.5, depth: 6 });
    expect(by(/Housing 1/).size).toMatchObject({ a: 18.2, b: 270, depth: 6 });           // BoardT 18 -> 18.2
    expect(by(/Edge dowel X0/)).toMatchObject({ face: 'left', tool: 'E024' });
    expect(by(/Edge dowel X0/).cut[0][0]).toEqual([0, 40, 9]);
    expect((f1.xml.match(/BoardT\+0\.2-18/g) ?? []).length).toBe(8);                     // two housing walls x 4 element ends
    const spot = view(f0.xml).steps.find((s) => /Screw mark/.test(s.name))!;
    expect(spot.cut[0][0]).toEqual([291.9, 220, 18]);                                     // y -> W - y
  });
  it('cuts shelf notches through, run out past the edges', () => {
    const [p] = partPrograms(shelf, tdr, tp); const m = view(p.xml);
    const n = m.steps.filter((s) => /Notch/.test(s.name));
    expect(n).toHaveLength(2); for (const s of n) expect(s.size).toMatchObject({ a: 15, b: 6, depth: 18.2, open: true });
  });
  it('saw programs: rips along X, crosscuts along Y, blade centres where the plan says', () => {
    const plan: PlanJSON = { sheet: [2400, 1200], trim: 5, kerf: 3.15, narrow: 100, plans: { 18: { sheets: [[{ w: 280, pieces: [{ id: 'A', along: 1000, across: 280, turned: false }] }]] } } };
    const [rip, cross] = sawPrograms(plan, tdr, tp);
    const r = view(rip.xml).steps.map((s) => s.cut[0][0][1]); expect(r).toEqual([6.575, 289.725]);
    const c = view(cross.xml).steps.map((s) => s.cut[0][0][0]); expect(c).toEqual([6.575, 1009.725]);
  });
});
