import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { readPgmx, getXml, getEntryText } from '../src/engine/archive';
import { loadTemplates, blankProgram } from '../src/ops/cabinet';
import { applyEdits, editFile, templateProblems, type Edit } from '../src/ops/edit';
import { workplan, insertPoint } from '../src/engine/workplan';
import { expressions } from '../src/engine/variables';
import { viewModel } from '../src/view/model';

const F = ['tdr-latest', 'itm-final', 'apex-passage', 'apex-jamb-lh'].map((f) => `fixtures/${f}.pgmx`);
const have = F.every(existsSync);
const xml = (f: string) => getXml(readPgmx(f));

describe.skipIf(!have)('program editing', () => {
  const [tdr, itm, apex, jamb] = F.map(xml); const tp = loadTemplates(itm, tdr, apex);
  const tools = getEntryText(readPgmx(F[0]), 'def.tlgx');
  const added = (x: string) => viewModel(x, '', tools).steps.filter((s) => s.groups.includes('Added in Maestro Tools'));

  it('maps the workplan: top-level steps, groups, macro instances and the park move', () => {
    const top = workplan(tdr).execs.filter((e) => e.depth === 0);
    expect(top.map((e) => e.type)).toEqual(['VisualSubProgram', 'VisualSubProgram', 'MachiningWorkingStep', 'MachiningWorkingStep',
      'ExecutableGroup', 'ExecutableGroup', 'ExecutableGroup', 'ExecutableGroup', 'Xn']);
    expect(top[2]).toMatchObject({ name: 'Pocket', enabled: false });
  });

  it('a blank program still gets its steps where the panel jobs put them (ahead of the park move)', () => {
    const b = blankProgram(tdr, 500, 300, 18);
    expect(insertPoint(b)).toBe(b.indexOf('<Executable i:type="Xn">'));
  });

  it('adds pocket, holes, edge hole and saw cut to an existing door program, before the park move', () => {
    const edits: Edit[] = [
      { op: 'pocket', x0: 'dx1-300', y0: 100, x1: 'dx1-200', y1: 160, depth: 5 },
      { op: 'drill', x: 500, y: 'dy1/2', dia: 8, depth: 12 },
      { op: 'drill', x: 600, y: 50, dia: 3, depth: 2 },
      { op: 'edgeDrill', edge: 'Y0', pos: 400, z: 18, depth: 20 },
      { op: 'saw', axis: 'y', at: 300 },
    ];
    const r = applyEdits(tdr, edits, tp);
    const top = workplan(r.xml).execs.filter((e) => e.depth === 0);
    expect(top.at(-1)!.type).toBe('Xn');
    expect(top.at(-2)).toMatchObject({ type: 'ExecutableGroup', name: 'Added in Maestro Tools' });
    const s = added(r.xml); const L = 1980, W = 810;
    expect(s.map((x) => [x.name, x.tool, x.face])).toEqual([
      ['E016 8mm - Pocket', 'E016', 'top'], ['E024 8mm Drill - Hole', 'E024', 'top'], ['E022 3mm Drill - Hole', 'E022', 'top'],
      ['E024 8mm Drill - Edge hole Y0', 'E024', 'front'], ['E015 Saw - Cut along Y', 'E015', 'top']]);
    expect(s[0].size).toMatchObject({ a: 100, b: 60, depth: 5 });
    expect(s[1].cut[0][0]).toEqual([500, W / 2, expect.any(Number)]);
    expect(s[3].cut[0][0]).toEqual([400, 0, 18]);
    expect(L).toBe(viewModel(r.xml, '', tools).L);
    // formulas become expressions on the new geometry (pocket sides, hole Y)
    const ex = expressions(r.xml).map((e) => e.formula);
    expect(ex.filter((f) => f === 'dx1-300')).toHaveLength(4);
    expect(ex.filter((f) => f === 'dx1-200')).toHaveLength(4);
    expect(ex).toContain('dy1/2');
    expect(r.notes.join(' ')).toMatch(/open the file in Maestro/);
  });

  it('turns a step on/off by flipping only its own flag, and renames with XML escaping', () => {
    const r = applyEdits(tdr, [{ op: 'enable', step: 'Pocket', on: true }], tp);
    expect(r.xml.length).toBe(tdr.length - 1);                                  // false -> true
    expect(workplan(r.xml).execs.find((e) => e.name === 'Pocket')!.enabled).toBe(true);
    const n = applyEdits(tdr, [{ op: 'rename', step: 'Pocket', to: 'Pocket <A&B>' }]);
    expect(n.xml).toContain('>Pocket &lt;A&amp;B&gt;</Name>');
    expect(workplan(n.xml).execs.some((e) => e.name === 'Pocket <A&B>')).toBe(true);
  });

  it('gives a repeated default name a (n) suffix like Maestro', () => {
    const r = applyEdits(tdr, [{ op: 'drill', x: 100, y: 100, dia: 3, depth: 2 }, { op: 'drill', x: 120, y: 100, dia: 3, depth: 2 }], tp);
    expect(added(r.xml).map((s) => s.name)).toEqual(['E022 3mm Drill - Hole', 'E022 3mm Drill - Hole(1)']);
  });

  it('refuses edits that would be unsafe or lost', () => {
    expect(() => applyEdits(apex, [{ op: 'enable', step: 'Routing', on: true }])).toThrow(/inside macro instance/);
    expect(() => applyEdits(apex, [{ op: 'rename', step: 'Hinge 1 Left', to: 'H1' }])).toThrow(/macro instance/);
    expect(() => applyEdits(tdr, [{ op: 'drill', x: 5000, y: 10, dia: 8, depth: 5 }], tp)).toThrow(/outside the part/);
    expect(() => applyEdits(tdr, [{ op: 'pocket', x0: 0, y0: 0, x1: 5, y1: 100, depth: 5 }], tp)).toThrow(/narrower/);
    expect(() => applyEdits(tdr, [{ op: 'drill', x: 'nope+1', y: 10, dia: 8, depth: 5 }], tp)).toThrow(/unknown variable/);
    expect(() => applyEdits(tdr, [{ op: 'drill', x: 10, y: 10, dia: 8, depth: 5 }])).toThrow(/template programs/);
  });

  it('refuses to add steps to a jamb master (different plane / workpiece IDs)', () => {
    expect(templateProblems(tdr, tp)).toEqual([]);
    expect(templateProblems(apex, tp)).toEqual([]);
    expect(templateProblems(jamb, tp).join(' ')).toMatch(/Plane Top/);
    expect(() => applyEdits(jamb, [{ op: 'drill', x: 10, y: 10, dia: 3, depth: 2 }], tp)).toThrow(/does not share/);
  });

  it('never writes over the source program', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mt-edit-'));
    expect(() => editFile(F[0], [], F[0])).toThrow(/overwrite/);
    const out = path.join(dir, 'Edited.pgmx');
    editFile(F[0], [{ op: 'drill', x: 100, y: 100, dia: 3, depth: 2 }], out, tp);
    const a = readPgmx(out);
    expect(a.xmlName).toBe('Edited.xml');
    expect(added(getXml(a))).toHaveLength(1);
  });
});
