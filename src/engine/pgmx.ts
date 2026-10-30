/**
 * Exact-text editing of Maestro program XML.
 *
 * RULE: the XML is never parsed and re-serialised. Maestro's DataContract reader is strict about
 * element order and refuses any stray text ("Expecting state 'Element'.. Encountered 'Text'").
 * Every change is a surgical regex/text splice on the original string, and everything else is
 * left byte-for-byte as Maestro wrote it.
 *
 * This file is a line-by-line port of the Python helpers that built and verified real programs
 * in Oct 2026 (TestingDoorReal flush pull, dummy + latch handle sets, TestingJamb strike).
 * Keep behaviour identical: the parity tests compare output byte-for-byte with those builds.
 */
import { pyRepr } from './pyfmt';

export const NS_PROJECT = 'http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.ProjectModule';

/** Allocates fresh Key IDs above everything already in the file(s). */
export class Ids {
  next: number;
  constructor(...texts: string[]) {
    let max = 0;
    for (const t of texts) for (const m of t.matchAll(/>(\d{6,})</g)) max = Math.max(max, parseInt(m[1], 10));
    this.next = max + 1;
  }
  take(): number { return this.next++; }
}

export interface Span { start: number; end: number; text: string }
export interface StepParts { step: Span; feature: Span; geometry: Span; operation: Span; fid: string; oid: string; gid: string }

function find(re: RegExp, s: string): RegExpExecArray {
  const m = re.exec(s);
  if (!m) throw new Error('pattern not found: ' + re.source.slice(0, 120));
  return m;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The MachiningWorkingStep named `name` (first match), plus its feature, geometry and operation. */
export function stepParts(t: string, name: string): StepParts {
  const h = t.indexOf('Utility">' + name + '</Name>');
  if (h < 0) throw new Error('step not found: ' + name);
  const a0 = t.lastIndexOf('<Executable', h);
  const b0 = t.indexOf('</Executable>', h) + 13;
  const st = t.slice(a0, b0);
  const fid = find(/ManufacturingFeatureID[^>]*><b:ID>(\d+)/, st)[1];
  const oid = find(/OperationID[^>]*><b:ID>(\d+)/, st)[1];
  const fm = find(new RegExp('<ManufacturingFeature i:type="[^"]+"[^>]*><Key[^>]*><ID>' + fid + '</ID>.*?</ManufacturingFeature>', 's'), t);
  const gid = find(/<GeometryID[^>]*><b:ID>(\d+)/, fm[0])[1];
  const gm = find(new RegExp('<a:GeomGeometry i:type="a:\\w+"[^>]*><Key[^>]*><ID>' + gid + '</ID>.*?</a:GeomGeometry>', 's'), t);
  const om = find(new RegExp('<Operation i:type="[^"]+"[^>]*><Key[^>]*><ID>' + oid + '</ID>.*?</Operation>', 's'), t);
  const span = (m: RegExpExecArray): Span => ({ start: m.index, end: m.index + m[0].length, text: m[0] });
  return { step: { start: a0, end: b0, text: st }, feature: span(fm), geometry: span(gm), operation: span(om), fid, oid, gid };
}

/** Python blocks(): [step, feature, geometry, operation] texts. */
export function blocks(t: string, name: string): string[] {
  const p = stepParts(t, name);
  return [p.step.text, p.feature.text, p.geometry.text, p.operation.text];
}

/** Clone blocks with every Key ID / composite key remapped to fresh IDs (sorted as strings, like Python). */
export function cloneBlocks(ids: Ids, bl: string[]): string[] {
  const set = new Set<string>();
  for (const b of bl) {
    for (const m of b.matchAll(/<Key[^>]*><ID>(\d+)<\/ID>/g)) set.add(m[1]);
    for (const m of b.matchAll(/<\w+:unsignedInt>(\d+)<\/\w+:unsignedInt>/g)) set.add(m[1]);
  }
  set.delete('0');
  const mp = new Map<string, string>();
  for (const i of [...set].sort()) mp.set(i, String(ids.take()));
  return bl.map((b) => b.replace(/>(\d{6,})</g, (_m, g1) => '>' + (mp.get(g1) ?? g1) + '<'));
}

/** Rename a step, set its enabled flag, and make sure a top-level step declares the ProjectModule namespace. */
export function renameStep(st: string, name: string, enabled: boolean): string {
  st = st.replace(/(Utility">)[^<]*(<\/Name><Description\/><IsEnabled>)\w+/, (_m, a, b) => a + name + b + (enabled ? 'true' : 'false'));
  if (!st.slice(0, 300).includes('xmlns:a=')) {
    st = st.replace('<Executable i:type="a:MachiningWorkingStep">', `<Executable i:type="a:MachiningWorkingStep" xmlns:a="${NS_PROJECT}">`);
  }
  return st;
}

/** Line record. neg=true writes the end-point form `8 -L -0` used by profile (finish) toolpaths. */
export function ln(x: number, y: number, z: number, dx: number, dy: number, dz: number, L: number, neg = false): string {
  return (neg ? `8 ${pyRepr(-L)} -0\n` : `8 0 ${pyRepr(L)}\n`) +
    `1 ${pyRepr(x)} ${pyRepr(y)} ${pyRepr(z)} ${pyRepr(dx)} ${pyRepr(dy)} ${pyRepr(dz)} \n`;
}

/** Vertical line (Top-plane drills / plunges): `8 0 L / 1 x y z 0 0 dz`. */
export function vline(x: number, y: number, z: number, dz: number, L: number): string {
  return `8 0 ${pyRepr(L)}\n1 ${pyRepr(x)} ${pyRepr(y)} ${pyRepr(z)} 0 0 ${pyRepr(dz)} \n`;
}

/** Replace an Approach/Lift single-curve description and its _secondParameter (= L/2). */
export function setDesc(block: string, kind: 'Approach' | 'Lift', desc: string, L: number): string {
  const re = new RegExp('(<b:Type>' + kind + '</b:Type>.*?_serializationGeometryDescription>)[^<]*(<.*?_secondParameter>)[^<]*(<)', 's');
  const m = find(re, block);
  return block.slice(0, m.index) + m[1] + desc + m[2] + pyRepr(L / 2) + m[3] + block.slice(m.index + m[0].length);
}

/**
 * Replace the members of every composite curve in a block.
 * keepKeys=true reuses the existing element keys (needed when an operation's StartMachiningPoint
 * ElementKey points at an element - new keys orphan it and Maestro starts the profile somewhere else).
 */
export function setMembers(ids: Ids, block: string, recs: string[], keepKeys = false): string {
  const re = /(<(\w+):_serializingKeys[^>]*>)(.*?)(<\/\2:_serializingKeys>\s*<(\w+):_serializingMembers[^>]*>)(.*?)(<\/\5:_serializingMembers>)/gs;
  return block.replace(re, (_m, g1, _g2, g3, g4, _g5, g6, g7) => {
    const kp = find(/<(\w+):unsignedInt>/, g3)[1];
    const mp = find(/<(\w+):string>/, g6)[1];
    let keys: string;
    const old = [...g3.matchAll(/<\w+:unsignedInt>(\d+)<\/\w+:unsignedInt>/g)].map((x) => x[1]);
    if (keepKeys && old.length === recs.length) keys = g3;
    else {
      keys = '';
      const base = ids.next;
      for (let i = 0; i < recs.length; i++) keys += `<${kp}:unsignedInt>${base + i}</${kp}:unsignedInt>`;
      ids.next += recs.length;
    }
    return g1 + keys + g4 + recs.map((r) => `<${mp}:string>${r}</${mp}:string>`).join('') + g7;
  });
}

/** Replace the TrajectoryPath composite of an operation. */
export function setTrajectory(ids: Ids, om: string, recs: string[]): string {
  const m = find(/<b:Type>TrajectoryPath<\/b:Type>.*?<\/b:Toolpath>/s, om);
  return om.slice(0, m.index) + setMembers(ids, m[0], recs) + om.slice(m.index + m[0].length);
}

export function trajectoryRecords(om: string): string[] {
  const m = find(/<b:Type>TrajectoryPath<\/b:Type>.*?<\/b:Toolpath>/s, om);
  return [...m[0].matchAll(/string>(8 [^<]+)</g)].map((x) => x[1]);
}

/** Replace a single-curve geometry description (circles). Only the opening tag - never the closing one. */
export function setGeoDesc(gm: string, desc: string): string {
  return gm.replace(/(_serializationGeometryDescription>)[^<]*(<)/, (_m, a, b) => a + desc + b);
}

export function setGeoName(gm: string, name: string): string {
  return gm.replace(/(<\/Key><Name[^>]*>)[^<]*(<\/Name>)/, (_m, a, b) => a + name + b);
}

export function setDepth(fm: string, d: number): string {
  return fm.replace(/(<(?:Start|End)Depth>)[^<]*(<)/g, (_m, a, b) => a + pyRepr(d) + b);
}

/** Set the first occurrence of `<b:TAG>value<` in an operation. */
export function setOpValue(om: string, tag: string, value: string): string {
  return om.replace(new RegExp('(<b:' + esc(tag) + '>)[^<]*(<)'), (_m, a, b) => a + value + b);
}

/** Splice a batch of non-overlapping edits [start, end, text] into t. */
export function splice(t: string, edits: [number, number, string][]): string {
  const sorted = [...edits].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = ''; let last = 0;
  for (const [a, b, s] of sorted) {
    if (a < last) throw new Error('overlapping edits');
    out += t.slice(last, a) + s; last = b;
  }
  return out + t.slice(last);
}

/** Step names and enabled flags in file order. */
export function stepList(t: string): [string, string][] {
  return [...t.matchAll(/Utility">([^<]*)<\/Name><Description\/><IsEnabled>(\w+)/g)].map((m) => [m[1], m[2]]);
}

/** Project variable value by name. */
export function variable(t: string, name: string): number {
  const m = find(new RegExp('<Name xmlns="[^"]*">' + esc(name) + '</Name>.*?<a:Value[^>]*>([^<]*)', 's'), t);
  return parseFloat(m[1]);
}
