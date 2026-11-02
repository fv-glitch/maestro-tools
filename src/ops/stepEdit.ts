/**
 * Changing steps that are already in a program: move (Top face), hole depth, delete.
 * Surgical splices only - each change rewrites numbers inside the step's own feature, geometry and
 * operation blocks, or removes whole blocks the way blankProgram does. Nothing is rebuilt.
 *
 * Refused rather than guessed:
 *  - steps whose geometry / feature / operation is driven by an expression (Maestro would put it back)
 *  - steps that are not on the Top plane (move) or are not a single straight plunge (depth)
 *  - anything inside a macro instance, macro instances themselves, park moves, messages
 */
import { splice, setDepth, setDesc, setMembers, Ids } from '../engine/pgmx';
import { pyRepr } from '../engine/pyfmt';
import { workplan, type ExecInfo } from '../engine/workplan';
import { recordsBox } from '../check/machining';

export interface Span { start: number; end: number }
export interface StepBlocks { feature: Span; geometry: Span; operation: Span; fid: string; gid: string; oid: string; ftype: string; plane: string }

const one = (re: RegExp, s: string, what: string) => { const m = re.exec(s); if (!m) throw new Error('cannot find ' + what); return m; };

/** Feature, geometry and operation of a MachiningWorkingStep, by the IDs in its own executable. */
export function stepBlocks(t: string, x: ExecInfo): StepBlocks {
  const st = t.slice(x.start, x.end);
  const fid = one(/ManufacturingFeatureID[^>]*><\w+:ID>(\d+)/, st, 'feature of ' + x.name)[1];
  const oid = one(/OperationID[^>]*><\w+:ID>(\d+)/, st, 'operation of ' + x.name)[1];
  const fm = one(new RegExp('<ManufacturingFeature i:type="(?:\\w+:)?(\\w+)"[^>]*><Key[^>]*><ID>' + fid + '</ID>.*?</ManufacturingFeature>', 's'), t, 'feature ' + fid);
  const gid = one(/<GeometryID[^>]*><\w+:ID>(\d+)/, fm[0], 'geometry of ' + x.name)[1];
  const gm = one(new RegExp('<a:GeomGeometry i:type="a:\\w+"[^>]*><Key[^>]*><ID>' + gid + '</ID>.*?</a:GeomGeometry>', 's'), t, 'geometry ' + gid);
  const om = one(new RegExp('<Operation i:type="[^"]+"[^>]*><Key[^>]*><ID>' + oid + '</ID>.*?</Operation>', 's'), t, 'operation ' + oid);
  const pid = /<a:PlaneID[^>]*><\w+:ID>(\d+)/.exec(gm[0])?.[1];
  const plane = pid ? new RegExp(`<Plane><Key[^>]*><ID>${pid}</ID>.{0,200}?Utility">([^<]*)</Name>`, 's').exec(t)?.[1] ?? '?' : '?';
  const sp = (m: RegExpExecArray): Span => ({ start: m.index, end: m.index + m[0].length });
  return { feature: sp(fm), geometry: sp(gm), operation: sp(om), fid, gid, oid, ftype: fm[1], plane };
}

/** Expressions that point at any of `ids`, with their spans and formulas. */
export function expressionsOn(t: string, ids: Set<string>): (Span & { formula: string; id: string })[] {
  const out: (Span & { formula: string; id: string })[] = [];
  for (const m of t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)) {
    const id = /<a:ReferencedObject[^>]*><\w+:ID>(\d+)/.exec(m[0])?.[1];
    if (id && ids.has(id)) out.push({ start: m.index!, end: m.index! + m[0].length, id, formula: /<a:Value>([^<]*)</.exec(m[0])?.[1] ?? '' });
  }
  return out;
}

const shiftNum = (s: string, d: number) => (d === 0 ? s : pyRepr(parseFloat(s) + d));
/** Move every line / arc record (`1 x y ...`, `2 cx cy ...`) in a text by dx, dy. Other fields are kept as written. */
export function shiftRecords(rec: string, dx: number, dy: number): string {
  return rec.split('\n').map((line) => {
    if (!/^[12] /.test(line)) return line;
    const tk = line.split(' '); tk[1] = shiftNum(tk[1], dx); tk[2] = shiftNum(tk[2], dy); return tk.join(' ');
  }).join('\n');
}
/** Shift the records of every single curve (opening tag only) and every composite member in a block. */
function shiftBlock(b: string, dx: number, dy: number): string {
  return b.replace(/(<\w+:_serializationGeometryDescription>)([^<]*)/g, (_m, a, r) => a + shiftRecords(r, dx, dy))
    .replace(/(<\w+:string>)([^<]*)/g, (_m, a, r) => a + shiftRecords(r, dx, dy));
}

function geometryRecords(gm: string): string[] {
  const out: string[] = [];
  for (const m of gm.matchAll(/<\w+:_serializationGeometryDescription>([^<]*)/g)) out.push(m[1]);
  for (const m of gm.matchAll(/<\w+:string>([^<]*)/g)) out.push(m[1]);
  const px = /<a:_x>([^<]*)<\/a:_x><a:_y>([^<]*)</.exec(gm);
  if (px) out.push(`8 0 0\n1 ${px[1]} ${px[2]} 0 1 0 0 \n`);
  return out;
}

function locked(x: ExecInfo): string | undefined {
  const mac = x.parents.find((p) => p.type === 'VisualSubProgram');
  if (mac) return `'${x.name}' is inside macro instance '${mac.name}' - Maestro rebuilds those from the macro`;
  if (x.type === 'VisualSubProgram') return `'${x.name}' is a macro instance - change its parameters in Maestro (macro editing comes later)`;
  if (x.type === 'Xn' || x.type === 'Xmsg') return `'${x.name}' is a ${x.type === 'Xn' ? 'park move' : 'message'}`;
  return undefined;
}

/** The steps an executable stands for: itself, or every step inside a group. */
function stepsOf(t: string, x: ExecInfo): ExecInfo[] {
  const why = locked(x); if (why) throw new Error(why);
  if (x.type === 'MachiningWorkingStep') return [x];
  if (x.type !== 'ExecutableGroup') throw new Error(`'${x.name}' (${x.type}) cannot be changed here`);
  const inside = workplan(t).execs.filter((e) => e.start > x.start && e.end <= x.end);
  const bad = inside.find((e) => ['VisualSubProgram', 'Xn', 'Xmsg'].includes(e.type));
  if (bad) throw new Error(`group '${x.name}' holds ${locked(bad)}`);
  return inside.filter((e) => e.type === 'MachiningWorkingStep');
}

/** Move a step (or every step in a group) on the Top face by dx, dy. */
export function moveSteps(t: string, x: ExecInfo, dx: number, dy: number, L: number, W: number): { xml: string; moved: string[] } {
  const steps = stepsOf(t, x); const edits: [number, number, string][] = []; const moved: string[] = [];
  const done = new Set<string>();
  for (const s of steps) {
    const b = stepBlocks(t, s);
    if (b.plane !== 'Top') throw new Error(`'${s.name}' is cut on the ${b.plane} plane - only Top-face steps can be moved so far`);
    const ex = expressionsOn(t, new Set([b.gid, b.fid, b.oid]));
    if (ex.length) throw new Error(`'${s.name}' is placed by a formula (${ex.slice(0, 2).map((e) => e.formula).join(', ')}) - change the variable instead, or Maestro would move it back`);
    const gm = t.slice(b.geometry.start, b.geometry.end);
    const before = recordsBox(geometryRecords(gm)).box; const nb = recordsBox(geometryRecords(shiftBlock(gm, dx, dy)
      .replace(/(<a:_x>)([^<]*)(<\/a:_x><a:_y>)([^<]*)(<)/, (_m, a, px, c, py, e) => a + shiftNum(px, dx) + c + shiftNum(py, dy) + e))).box;
    const inside = (bx?: { x0: number; x1: number; y0: number; y1: number }) => !!bx && bx.x0 >= -1e-6 && bx.y0 >= -1e-6 && bx.x1 <= L + 1e-6 && bx.y1 <= W + 1e-6;
    if (inside(before) && !inside(nb)) throw new Error(`'${s.name}' would end up outside the part (x ${nb!.x0.toFixed(2)}..${nb!.x1.toFixed(2)}, y ${nb!.y0.toFixed(2)}..${nb!.y1.toFixed(2)})`);
    for (const [k, sp] of [['g' + b.gid, b.geometry], ['f' + b.fid, b.feature], ['o' + b.oid, b.operation]] as const) {
      if (done.has(k)) continue; done.add(k);
      let blk = shiftBlock(t.slice(sp.start, sp.end), dx, dy);
      if (k[0] === 'g') blk = blk.replace(/(<a:_x>)([^<]*)(<\/a:_x><a:_y>)([^<]*)(<)/, (_m, a, px, c, py, e) => a + shiftNum(px, dx) + c + shiftNum(py, dy) + e);
      edits.push([sp.start, sp.end, blk]);
    }
    moved.push(s.name);
  }
  return { xml: splice(t, edits), moved };
}

/** New depth for a straight vertical hole on the Top face (feature depth, plunge length and lift). */
export function setHoleDepth(t: string, x: ExecInfo, depth: number, T: number): string {
  if (x.type !== 'MachiningWorkingStep') throw new Error(`'${x.name}' is not a step`);
  const why = locked(x); if (why) throw new Error(why);
  const b = stepBlocks(t, x);
  if (b.ftype !== 'RoundHole' || b.plane !== 'Top') throw new Error(`'${x.name}' is a ${b.ftype} on ${b.plane} - only Top-face holes can change depth so far`);
  if (expressionsOn(t, new Set([b.fid, b.oid])).length) throw new Error(`'${x.name}' has its depth on a formula - change the variable instead`);
  let om = t.slice(b.operation.start, b.operation.end);
  const tp = one(/<\w+:Type>TrajectoryPath<\/\w+:Type>.*?<\/\w+:Toolpath>/s, om, 'toolpath of ' + x.name)[0];
  const recs = [...tp.matchAll(/<\w+:string>([^<]*)</g)].map((m) => m[1]);
  const pl = recs.length === 1 ? /^8 0 (\S+)\n1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) \n$/.exec(recs[0]) : null;
  if (!pl || +pl[5] !== 0 || +pl[6] !== 0 || +pl[7] !== -1) throw new Error(`'${x.name}' is not a single straight plunge`);
  if (Math.abs(+pl[4] - T) > 1e-6) throw new Error(`'${x.name}' does not start on the top face`);
  const lift = one(/<\w+:Type>Lift<\/\w+:Type>.*?<\w+:_serializationGeometryDescription>([^<]*)/s, om, 'lift of ' + x.name)[1];
  const lm = /^8 0 (\S+)\n1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) \n$/.exec(lift);
  if (!lm || +lm[7] !== 1) throw new Error(`'${x.name}' lift is not straight up`);
  const top = +lm[4] + +lm[1];                       // where the lift ends (clearance height)
  const z = T - depth, Ll = top - z;
  const plunge = `8 0 ${pyRepr(depth)}\n1 ${pl[2]} ${pl[3]} ${pl[4]} ${pl[5]} ${pl[6]} ${pl[7]} \n`;
  const up = `8 0 ${pyRepr(Ll)}\n1 ${lm[2]} ${lm[3]} ${pyRepr(z)} ${lm[5]} ${lm[6]} ${lm[7]} \n`;
  const tpi = om.indexOf(tp);
  om = om.slice(0, tpi) + setMembers(new Ids(''), tp, [plunge], true) + om.slice(tpi + tp.length);
  om = setDesc(om, 'Lift', up, Ll);
  const fm = setDepth(t.slice(b.feature.start, b.feature.end), depth);
  return splice(t, [[b.feature.start, b.feature.end, fm], [b.operation.start, b.operation.end, om]]);
}

/**
 * Delete a step or a group with all its steps: the executables, their features, geometries
 * (unless another feature still uses one), operations and the expressions on them. A group left
 * empty by this is removed too. Refuses if anything left in the file still points at a removed ID.
 */
export function deleteSteps(t: string, x: ExecInfo): { xml: string; removed: string[] } {
  const steps = stepsOf(t, x); const wp = workplan(t);
  const execSpans: Span[] = []; const blocks: Span[] = []; const ids = new Set<string>();
  // the executable(s) to cut: x itself, then any ancestor group that would be left empty
  let cut: ExecInfo = x;
  for (;;) {
    const parent = [...wp.execs].reverse().find((e) => e.start < cut.start && e.end >= cut.end && e.depth === cut.depth - 1);
    if (!parent || parent.type !== 'ExecutableGroup') break;
    const kids = wp.execs.filter((e) => e.depth === parent.depth + 1 && e.start > parent.start && e.end <= parent.end);
    if (kids.length !== 1) break;
    cut = parent;
  }
  execSpans.push({ start: cut.start, end: cut.end });
  for (const e of wp.execs) if (e.start >= cut.start && e.end <= cut.end && e.id) ids.add(e.id);
  const geos = new Map<string, Span>();
  for (const s of steps) {
    const b = stepBlocks(t, s);
    blocks.push(b.feature, b.operation); ids.add(b.fid).add(b.oid);
    for (const m of t.slice(b.operation.start, b.operation.end).matchAll(/<Key[^>]*><ID>(\d+)<\/ID>|<\w+:unsignedInt>(\d+)</g)) ids.add(m[1] ?? m[2]);
    for (const m of t.slice(b.feature.start, b.feature.end).matchAll(/<\w+:unsignedInt>(\d+)</g)) ids.add(m[1]);
    geos.set(b.gid, b.geometry);
  }
  for (const [gid, gs] of geos) {
    // keep a geometry that a feature we are not deleting still uses
    const used = [...t.matchAll(new RegExp(`<GeometryID[^>]*><\\w+:ID>${gid}<`, 'g'))].some((m) => !blocks.some((s) => m.index! >= s.start && m.index! < s.end));
    if (used) continue;
    blocks.push(gs); ids.add(gid);
    for (const m of t.slice(gs.start, gs.end).matchAll(/<\w+:unsignedInt>(\d+)</g)) ids.add(m[1]);
  }
  const ex = expressionsOn(t, ids);
  ids.delete('0');
  const seen = new Set<number>();
  const all = [...execSpans, ...blocks, ...ex].filter((s) => !seen.has(s.start) && seen.add(s.start)).sort((a, b) => a.start - b.start);
  const out = splice(t, all.map((s) => [s.start, s.end, ''] as [number, number, string]));
  const left = [...ids].filter((id) => new RegExp(`>${id}<`).test(out));
  if (left.length) throw new Error(`cannot delete '${x.name}': something else in the program still points at it (IDs ${left.slice(0, 3).join(', ')})`);
  return { xml: out, removed: steps.map((s) => s.name) };
}
