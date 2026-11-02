/**
 * Program editing: open any program, add proven step types, switch steps on/off, rename, and save
 * the result as a NEW file. Shared by the CLI (`edit`) and the app's Program tab.
 *
 * Every added step is a clone of a proven template through `Builder` (src/ops/cabinet.ts) - the
 * same code the panel jobs use - so nothing new is invented here:
 *   pocket     show door 'E016 8mm - Pocket(3)-1143main7_1(1)(1)'   rectangle, Top face
 *   drill      TDR  'E022 3mm Drill - Dummy pilot 1 RH hung' / 'E024 8mm Drill - QF stud 1 RH hung'
 *   edgeDrill  APEX 'Boring' with the tool swapped to E024
 *   saw        APEX 'Cut Side LH' / 'Cut Side LH(1)'
 * Toolpaths are computed here (the owner, 2 Nov 2026: "we compute, Maestro re-checks"). Every result is
 * PROVISIONAL until the file has been opened and saved in Maestro and checked again.
 */
import { Builder, type Templates, type Edge } from './cabinet';
import { workplan, escXml } from '../engine/workplan';
import { moveSteps, setHoleDepth, deleteSteps, stepBlocks } from './stepEdit';
import { splice } from '../engine/pgmx';
import { evaluate, references } from '../engine/formula';
import { variableValues, setVariables, dependents, readVariables } from '../engine/variables';
import { assertSafe } from '../engine/validate';
import { readPgmx, getXml, writePgmx } from '../engine/archive';
import * as path from 'node:path';

/** A number, or a Maestro formula over the program's variables (e.g. "dx1-150"). */
export type Num = number | string;

export type Edit =
  | { op: 'pocket'; name?: string; group?: string; x0: Num; y0: Num; x1: Num; y1: Num; depth: number }
  | { op: 'drill'; name?: string; group?: string; x: Num; y: Num; dia: 3 | 8; depth: number }
  | { op: 'edgeDrill'; name?: string; group?: string; edge: Edge; pos: number; z: number; depth: number }
  | { op: 'saw'; name?: string; group?: string; axis: 'x' | 'y'; at: number; run?: number }
  | { op: 'enable'; step: string; on: boolean }
  | { op: 'rename'; step: string; to: string }
  | { op: 'move'; step: string; dx: number; dy: number }
  | { op: 'depth'; step: string; depth: number }
  | { op: 'delete'; step: string }
  | { op: 'variable'; name: string; value: number };

export interface EditResult {
  xml: string;
  /** one line per edit, in order */
  log: string[];
  /** what to check in Maestro before cutting */
  notes: string[];
}

const ADD_OPS = new Set(['pocket', 'drill', 'edgeDrill', 'saw']);
export const needsTemplates = (edits: Edit[]) => edits.some((e) => ADD_OPS.has(e.op));

const DEFAULT_NAME: Record<string, (e: Edit) => string> = {
  pocket: () => 'E016 8mm - Pocket',
  drill: (e) => ((e as { dia: number }).dia === 3 ? 'E022 3mm Drill - Hole' : 'E024 8mm Drill - Hole'),
  edgeDrill: (e) => `E024 8mm Drill - Edge hole ${(e as { edge: string }).edge}`,
  saw: (e) => `E015 Saw - Cut along ${(e as { axis: string }).axis.toUpperCase()}`,
};
const DEFAULT_GROUP = 'Added in Maestro Tools';

/**
 * Every Plane / WorkPiece / Layer a template step points at (that exists in its source program)
 * must exist in the target under the same ID, and planes must carry the same name. The door-family
 * programs (TDR, the show door, APEX Passage, the door masters) share these IDs; the jamb masters do not, so
 * adding steps to a jamb is refused until the references are remapped and machine-tested.
 */
export function templateProblems(t: string, tp: Templates): string[] {
  const keyNames = (x: string) => {
    const m = new Map<string, string>();
    for (const k of x.matchAll(/<Key[^>]*><ID>(\d+)<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)</g)) m.set(k[1], k[2]);
    for (const k of x.matchAll(/<Key[^>]*><ID>(\d+)<\/ID>/g)) if (!m.has(k[1])) m.set(k[1], '');
    return m;
  };
  const target = keyNames(t); const srcs = tp.src.map(keyNames);
  const out = new Set<string>();
  for (const [k, bl] of Object.entries(tp)) {
    if (k === 'src') continue;
    for (const b of bl as string[]) {
      for (const m of b.matchAll(/<(?:\w+:)?(\w+)[^>]*>\s*<\w+:ID>(\d+)<\/\w+:ID>\s*<\w+:ObjectType>[^<]*\.(Plane|WorkPiece|Layer)<\/\w+:ObjectType>/g)) {
        const id = m[2]; const src = srcs.find((s) => s.has(id));
        if (!src) continue;                       // dangling in the template's own program too (inline polyline copies)
        if (!target.has(id)) out.add(`${m[3]} ${src.get(id) || id} (${id}) is not in this program`);
        else if (m[3] === 'Plane' && src.get(id) !== target.get(id)) out.add(`plane ${id} is '${target.get(id)}' here but '${src.get(id)}' in the template`);
      }
    }
  }
  return [...out];
}

export function applyEdits(xml: string, edits: Edit[], tp?: Templates): EditResult {
  const log: string[] = []; const notes = new Set<string>();
  // ---- 0. variables first, so the positions and formulas below see the new values
  let t = xml;
  const varIn: Record<string, number> = {};
  edits.forEach((e, i) => {
    if (e.op !== 'variable') return;
    if (!Number.isFinite(e.value)) throw new Error(`edit ${i + 1}: ${e.name} needs a number`);
    varIn[e.name] = e.value;
  });
  if (Object.keys(varIn).length) {
    let r;
    try { r = setVariables(t, varIn); } catch (ex) { throw new Error('variables: ' + (ex as Error).message); }
    t = r.xml;
    for (const c of r.changes) log.push(`${c.name}: ${c.from} -> ${c.to}${c.derived ? ' (calculated)' : ''}`);
    const dep = dependents(t, r.changes.map((c) => c.name));
    if (dep.length) notes.add(`${dep.length} formula${dep.length > 1 ? 's' : ''} on steps / macros read the changed variables: Maestro applies them when it opens the file, so the stored machining (and this viewer) shows the old positions until it has been opened and saved in Maestro`);
    if (r.changes.some((c) => ['dx1', 'dy1', 'dz1'].includes(c.name))) notes.add('the part size changed: Maestro updates the workpiece and faces from dx1 / dy1 / dz1 when it opens the file');
  }
  const vars = variableValues(t);
  const L = vars.dx1, W = vars.dy1, T = vars.dz1;
  if (![L, W, T].every((v) => Number.isFinite(v) && v > 0)) throw new Error('program has no dx1 / dy1 / dz1');
  const num = (v: Num, what: string): { v: number; f?: string } => {
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`${what}: not a number`); return { v }; }
    const s = String(v).trim(); if (/^-?\d+(\.\d+)?$/.test(s)) return { v: parseFloat(s) };
    const unknown = references(s).filter((r) => !(r in vars));
    if (unknown.length) throw new Error(`${what}: unknown variable ${unknown.join(', ')} in "${s}"`);
    return { v: evaluate(s, vars), f: s };
  };
  const err = (i: number, msg: string) => new Error(`edit ${i + 1}: ${msg}`);

  // ---- 1. changes to executables already in the program (by Key ID or exact name), in order
  const find = (i: number, ref: string) => {
    const wp = workplan(t);
    const hit = wp.execs.filter((e) => e.id === ref);
    const byName = hit.length ? hit : wp.execs.filter((e) => e.name === ref);
    if (!byName.length) throw err(i, `no step '${ref}'`);
    if (byName.length > 1) throw err(i, `'${ref}' matches ${byName.length} steps - use its ID (${byName.map((e) => e.id).join(', ')})`);
    return byName[0];
  };
  const touched = new Set<string>(); const deleted = new Set<string>();
  edits.forEach((e, i) => {
    if (ADD_OPS.has(e.op) || e.op === 'variable') return;
    if (!('step' in e)) throw err(i, `unknown edit '${(e as { op: string }).op}'`);
    if (deleted.has(e.step)) throw err(i, `'${e.step}' was deleted by an earlier edit`);
    const x = find(i, e.step);
    const key = e.op + x.id; if (touched.has(key)) throw err(i, `'${x.name}' is edited twice the same way`); touched.add(key);
    try {
      if (e.op === 'move' || e.op === 'depth' || e.op === 'delete') {
        if (e.op === 'move') {
          if (!Number.isFinite(e.dx) || !Number.isFinite(e.dy) || (e.dx === 0 && e.dy === 0)) throw new Error('move needs dx and/or dy');
          const r = moveSteps(t, x, e.dx, e.dy, L, W); t = r.xml;
          log.push(`moved ${e.dx >= 0 ? '+' : ''}${e.dx} in X, ${e.dy >= 0 ? '+' : ''}${e.dy} in Y: ${r.moved.join(', ')}`);
          notes.add('moved steps keep their own toolpaths shifted by the same amount: check them in Maestro before cutting');
        } else if (e.op === 'depth') {
          if (!(e.depth > 0 && e.depth <= T + 0.5)) throw new Error(`depth ${e.depth} must be > 0 and at most ${T + 0.5}`);
          t = setHoleDepth(t, x, e.depth, T); log.push(`hole depth ${e.depth}: ${x.name}`);
        } else {
          const r = deleteSteps(t, x); t = r.xml; deleted.add(x.id).add(x.name);
          log.push(`deleted ${x.type === 'ExecutableGroup' ? `group '${x.name}' (${r.removed.length} steps)` : x.name}`);
        }
        return;
      }
      const why = x.parents.find((p) => p.type === 'VisualSubProgram');
      if (why) throw new Error(`'${x.name}' is inside macro instance '${why.name}' - Maestro rebuilds those from the macro; change the instance instead`);
      if (x.type === 'Xn' || x.type === 'Xmsg') throw new Error(`'${x.name}' is a ${x.type === 'Xn' ? 'park move' : 'message'} - not editable here`);
      if (e.op === 'enable') {
        if (x.enabledAt < 0) throw new Error(`cannot find the on/off flag of '${x.name}'`);
        if (x.enabled === e.on) { log.push(`'${x.name}' already ${e.on ? 'on' : 'off'}`); return; }
        t = splice(t, [[x.enabledAt, x.enabledAt + x.enabledLen, e.on ? 'true' : 'false']]);
        log.push(`turned ${e.on ? 'on' : 'off'}: ${x.name}`);
        if (x.type === 'VisualSubProgram' && e.on && !/<Elements>\s*<Executable/.test(t.slice(x.start, x.end))) {
          notes.add(`macro instance '${x.name}' was off and holds no steps: Maestro must expand it from its macro file on open - check it is there before cutting`);
        }
      } else if (e.op === 'rename') {
        if (x.type === 'VisualSubProgram') throw new Error(`'${x.name}' is a macro instance - its name is tied to the planes Maestro generates for it, so it is not renamed here`);
        const to = e.to.trim(); if (!to) throw new Error('empty name');
        if (x.nameAt < 0) throw new Error(`cannot find the name of '${x.name}'`);
        t = splice(t, [[x.nameAt, x.nameAt + x.nameLen, escXml(to)]]);
        log.push(`renamed: ${x.name} -> ${to}`);
      }
    } catch (ex) { throw err(i, (ex as Error).message.replace(/^edit \d+: /, '')); }
  });

  // ---- 2. new steps, cloned through Builder
  const adds = edits.map((e, i) => [e, i] as const).filter(([e]) => ADD_OPS.has(e.op));
  if (adds.length) {
    if (!tp) throw new Error('adding steps needs the template programs (show door "Beta-Optimised - Final", TestingDoorReal, APEX Passage)');
    const probs = templateProblems(t, tp);
    if (probs.length) throw new Error('this program does not share the templates\' planes/workpiece, so steps cannot be added yet: ' + probs.slice(0, 4).join('; '));
    const b = new Builder(t, tp);
    const taken = new Set(workplan(t).execs.map((x) => x.name));
    const unique = (n: string) => { let u = n, k = 1; while (taken.has(u)) u = `${n}(${k++})`; taken.add(u); return u; };
    const eps = 1e-6;
    for (const [e, i] of adds) {
      const name = unique(((e as { name?: string }).name ?? '').trim() || DEFAULT_NAME[e.op](e));
      const group = ((e as { group?: string }).group ?? '').trim() || DEFAULT_GROUP;
      if (e.op === 'pocket') {
        const x0 = num(e.x0, 'x0'), y0 = num(e.y0, 'y0'), x1 = num(e.x1, 'x1'), y1 = num(e.y1, 'y1');
        if (!(x1.v > x0.v && y1.v > y0.v)) throw err(i, 'pocket needs x0 < x1 and y0 < y1');
        if (x0.v < -eps || y0.v < -eps || x1.v > L + eps || y1.v > W + eps) throw err(i, `pocket ${x0.v},${y0.v} - ${x1.v},${y1.v} is outside the part (${L} x ${W})`);
        if (x1.v - x0.v < 8.5 - eps || y1.v - y0.v < 8.5 - eps) throw err(i, 'pocket narrower than the 8 mm cutter (8.5 minimum)');
        if (!(e.depth > 0 && e.depth <= T + 0.5)) throw err(i, `depth ${e.depth} must be > 0 and at most ${T + 0.5}`);
        const ex = { x0: x0.f, y0: y0.f, x1: x1.f, y1: y1.f };
        b.pocket(group, name, x0.v, y0.v, x1.v, y1.v, e.depth, Object.values(ex).some(Boolean) ? ex : undefined);
        log.push(`added pocket '${name}': x ${x0.v}..${x1.v}, y ${y0.v}..${y1.v}, ${e.depth} deep (E016)`);
        if (e.depth >= T) notes.add(`'${name}' goes through the part - check the spoilboard / pods under it`);
      } else if (e.op === 'drill') {
        const x = num(e.x, 'x'), y = num(e.y, 'y');
        if (e.dia !== 3 && e.dia !== 8) throw err(i, 'drill diameter must be 3 (E022) or 8 (E024)');
        if (x.v < -eps || y.v < -eps || x.v > L + eps || y.v > W + eps) throw err(i, `hole ${x.v},${y.v} is outside the part`);
        if (!(e.depth > 0 && e.depth <= T + 0.5)) throw err(i, `depth ${e.depth} must be > 0 and at most ${T + 0.5}`);
        b.drill(group, name, x.v, y.v, e.dia, e.depth, x.f || y.f ? { x: x.f, y: y.f } : undefined);
        log.push(`added ${e.dia} mm hole '${name}' at ${x.v}, ${y.v}, ${e.depth} deep (${e.dia === 3 ? 'E022' : 'E024'})`);
      } else if (e.op === 'edgeDrill') {
        if (!['X0', 'X1', 'Y0', 'Y1'].includes(e.edge)) throw err(i, 'edge must be X0, X1, Y0 or Y1');
        const along = e.edge[0] === 'X' ? W : L;
        if (e.pos < 4 || e.pos > along - 4) throw err(i, `position ${e.pos} must be 4..${along - 4} along that edge`);
        if (e.z < 4 || e.z > T - 4) throw err(i, `height ${e.z} must keep the 8 mm drill inside the thickness (4..${T - 4})`);
        if (!(e.depth > 0 && e.depth <= 60)) throw err(i, 'edge depth must be > 0 and at most 60');
        b.edgeDrill(group, name, e.edge, e.pos, e.z, e.depth);
        log.push(`added 8 mm edge hole '${name}' in ${e.edge} at ${e.pos}, ${e.z} up, ${e.depth} deep (E024)`);
      } else if (e.op === 'saw') {
        const span = e.axis === 'x' ? W : L;
        if (e.axis !== 'x' && e.axis !== 'y') throw err(i, "saw axis must be 'x' or 'y'");
        if (e.at < 0 || e.at > span) throw err(i, `saw position ${e.at} must be 0..${span}`);
        b.saw(group, name, e.axis, e.at, e.run ?? 100);
        log.push(`added saw cut '${name}' along ${e.axis.toUpperCase()} at ${e.at} (E015, through)`);
        notes.add('saw cuts are through cuts - check the bars/pods are clear of the kerf');
      }
    }
    t = b.finish();
    notes.add('added steps carry toolpaths computed by Maestro Tools: open the file in Maestro, check the steps, save, then view it again before cutting');
  }
  assertSafe(xml, t);
  return { xml: t, log, notes: [...notes] };
}

/** Read `src`, apply the edits, write a NEW file `out` (never the source). */
export function editFile(src: string, edits: Edit[], out: string, tp?: Templates): EditResult {
  if (path.resolve(src) === path.resolve(out)) throw new Error('refusing to overwrite the source program - choose a new file name');
  const a = readPgmx(src);
  const r = applyEdits(getXml(a), edits, tp);
  writePgmx(a, r.xml, out, path.basename(out).replace(/\.pgmx$/i, ''));
  return r;
}

export interface TreeRow { id: string; type: string; name: string; enabled: boolean; depth: number; locked?: string; noRename?: boolean; feature?: string; plane?: string }

/** The workplan as rows for the editor: what can be changed, and why not when locked. */
export function programTree(xml: string): TreeRow[] {
  return workplan(xml).execs.filter((e) => e.id).map((e) => {
    const mac = e.parents.find((p) => p.type === 'VisualSubProgram');
    const locked = mac ? `inside macro instance '${mac.name}'` : e.type === 'Xn' ? 'park move' : e.type === 'Xmsg' ? 'message' : undefined;
    const row: TreeRow = { id: e.id, type: e.type, name: e.name, enabled: e.enabled, depth: e.depth, ...(locked ? { locked } : {}), ...(e.type === 'VisualSubProgram' ? { noRename: true } : {}) };
    if (e.type === 'MachiningWorkingStep' && !locked) {
      try { const b = stepBlocks(xml, e); row.feature = b.ftype; row.plane = b.plane; } catch { /* unreadable step: offer on/off only */ }
    }
    return row;
  });
}

/** Variables for the editor: inputs can be set, calculated ones show their formula. */
export function programVars(xml: string): { name: string; value: string; formula?: string }[] {
  return readVariables(xml).map((v) => ({ name: v.name, value: v.valueText, ...(v.formula ? { formula: v.formula } : {}) }));
}
