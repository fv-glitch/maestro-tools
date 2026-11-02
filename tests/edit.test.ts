import { it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { describeWithFixtures } from './needs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { readPgmx, getXml, getEntryText } from '../src/engine/archive';
import { loadTemplates, blankProgram } from '../src/ops/cabinet';
import { applyEdits, editFile, templateProblems, type Edit } from '../src/ops/edit';
import { workplan, insertPoint } from '../src/engine/workplan';
import { expressions } from '../src/engine/variables';
import { viewModel } from '../src/view/model';

const F = ['tdr-latest', 'template-final', 'apex-passage', 'apex-jamb-lh'].map((f) => `fixtures/${f}.pgmx`);
const describeF = describeWithFixtures([...F, 'fixtures/door-lt1.pgmx']);
const xml = (f: string) => getXml(readPgmx(f));

describeF('program editing', () => {
  const [tdr, show, apex, jamb] = F.map(xml); const tp = loadTemplates(show, tdr, apex);
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

describeF('changing existing steps', () => {
  const [tdr, show, apex] = F.map(xml); const tp = loadTemplates(show, tdr, apex);
  const tools = getEntryText(readPgmx(F[0]), 'def.tlgx');
  const step = (x: string, name: string) => viewModel(x, '', tools).steps.find((s) => s.name === name)!;
  const QF = 'E024 8mm Drill - QF stud 1 RH hung';
  const lt1 = xml('fixtures/door-lt1.pgmx');

  it('moves a hole: geometry point, plunge, approach and lift all shift by the same amount', () => {
    const base = applyEdits(lt1, [{ op: 'drill', name: 'H', x: 700, y: 300, dia: 8, depth: 12 }], tp).xml;
    const before = step(base, 'H'); const r = applyEdits(base, [{ op: 'move', step: 'H', dx: 10, dy: -5 }]);
    const after = step(r.xml, 'H');
    expect(after.cut[0][0]).toEqual([710, 295, 38]);
    const sh = (p: number[]) => [+(p[0] + 10).toFixed(6), +(p[1] - 5).toFixed(6), p[2]];
    expect(after.cut[0].map((p) => p.map((v) => +v.toFixed(3)))).toEqual(before.cut[0].map((p) => sh(p).map((v) => +v.toFixed(3))));
    expect(after.moves.flat().length).toBe(before.moves.flat().length);
    expect(after.size).toEqual(before.size);
    expect(r.xml.length).toBeGreaterThan(0);
  });

  it('moves a whole group (pocket + finish profile) and keeps the cut sizes', () => {
    const r1 = applyEdits(tdr, [{ op: 'pocket', group: 'G', x0: 300, y0: 100, x1: 400, y1: 160, depth: 5 }], tp);
    const r2 = applyEdits(r1.xml, [{ op: 'move', step: 'G', dx: 50, dy: 20 }]);
    const a = step(r1.xml, 'E016 8mm - Pocket'), b = step(r2.xml, 'E016 8mm - Pocket');
    expect(b.size).toEqual(a.size);
    expect(b.cut[0][0][0]).toBeCloseTo(a.cut[0][0][0] + 50, 9);
    expect(b.cut[0][0][1]).toBeCloseTo(a.cut[0][0][1] + 20, 9);
  });

  it('refuses to move a step placed by a formula, off the Top face, or out of the part', () => {
    const r = applyEdits(tdr, [{ op: 'drill', name: 'F', x: 'dx1/2', y: 100, dia: 3, depth: 2 }], tp);
    expect(() => applyEdits(r.xml, [{ op: 'move', step: 'F', dx: 5, dy: 0 }])).toThrow(/formula/);
    const e = applyEdits(tdr, [{ op: 'edgeDrill', name: 'E', edge: 'Y0', pos: 300, z: 18, depth: 20 }], tp);
    expect(() => applyEdits(e.xml, [{ op: 'move', step: 'E', dx: 5, dy: 0 }])).toThrow(/Front plane/);
    expect(() => applyEdits(lt1, [{ op: 'move', step: QF, dx: 5, dy: 0 }])).toThrow(/LatchHandleX/);
    expect(() => applyEdits(r.xml, [{ op: 'move', step: 'E022 3mm Drill - Hole', dx: 5000, dy: 0 }])).toThrow(/no step|outside/);
    const n = applyEdits(tdr, [{ op: 'drill', name: 'N', x: 100, y: 100, dia: 3, depth: 2 }], tp);
    expect(() => applyEdits(n.xml, [{ op: 'move', step: 'N', dx: 5000, dy: 0 }])).toThrow(/outside the part/);
  });

  it('changes a hole depth: feature depth, plunge length and lift start', () => {
    const r = applyEdits(lt1, [{ op: 'depth', step: QF, depth: 30 }]);
    const s = step(r.xml, QF);
    expect(s.depth).toBe(30); expect(s.size!.depth).toBe(30);
    const lift = s.moves[1]; expect(lift[0][2]).toBeCloseTo(38 - 30, 9); expect(lift.at(-1)![2]).toBeCloseTo(step(lt1, QF).moves[1].at(-1)![2], 9);
    expect(() => applyEdits(lt1, [{ op: 'depth', step: 'E016 8mm - Latch faceplate pocket', depth: 5 }])).toThrow(/only Top-face holes/);
  });

  it('deletes a step with its feature, geometry, operation and expressions, and nothing else', () => {
    const r = applyEdits(tdr, [{ op: 'drill', name: 'D', x: 'dx1/2', y: 100, dia: 3, depth: 2 }], tp);
    const d = applyEdits(r.xml, [{ op: 'delete', step: 'D' }]);
    expect(d.xml).toBe(tdr);                                                // add then delete = the original file
    expect(d.log).toEqual(['deleted D']);
  });

  it('deletes a step out of a group and leaves the rest of the group', () => {
    const r = applyEdits(tdr, [{ op: 'drill', name: 'A', x: 100, y: 100, dia: 3, depth: 2 }, { op: 'drill', name: 'B', x: 200, y: 100, dia: 3, depth: 2 }], tp);
    const d = applyEdits(r.xml, [{ op: 'delete', step: 'A' }]);
    expect(viewModel(d.xml, '', tools).steps.filter((s) => s.groups.includes('Added in Maestro Tools')).map((s) => s.name)).toEqual(['B']);
    expect(templateProblems(d.xml, tp)).toEqual([]);
    expect(expressions(d.xml)).toEqual(expressions(tdr));
  });

  it('deletes an existing group of the door program and keeps the file safe', () => {
    const d = applyEdits(tdr, [{ op: 'delete', step: 'Dummy handle' }]);
    expect(workplan(d.xml).execs.some((e) => e.name === 'Dummy handle')).toBe(false);
    expect(d.xml.length).toBeLessThan(tdr.length);
  });

  it('refuses to delete macro instances, or a step another step still uses', () => {
    expect(() => applyEdits(apex, [{ op: 'delete', step: 'Hinge 1 Left' }])).toThrow(/macro instance/);
    expect(() => applyEdits(tdr, [{ op: 'delete', step: 'Dummy handle' }, { op: 'delete', step: 'Dummy handle' }])).toThrow(/deleted by an earlier edit|edited twice/);
  });
});

describeF('variables', () => {
  const [tdr] = F.map(xml);
  it('sets a variable, recomputes calculated ones, and says Maestro must apply the formulas', () => {
    const r = applyEdits(tdr, [{ op: 'variable', name: 'dx1', value: 2040 }, { op: 'variable', name: 'LatchHandleX', value: 1000 }]);
    expect(r.log).toEqual(expect.arrayContaining(['dx1: 1980 -> 2040', 'LatchHandleX: 990 -> 1000', 'DummyHandleX: 780 -> 840 (calculated)']));
    expect(() => applyEdits(tdr, [{ op: 'variable', name: 'DummyHandleX', value: 1 }])).toThrow(/calculated/);
    expect(r.notes.join(' ')).toMatch(/formulas on steps/);
    expect(() => applyEdits(tdr, [{ op: 'variable', name: 'nope', value: 1 }])).toThrow(/no variable nope/);
  });
});
