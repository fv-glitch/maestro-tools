/**
 * Door vs jamb alignment, from the machining stored in both programs.
 *
 * Coordinates: jamb X runs from the foot; door X0 is the bottom for the "height" hand and the top
 * for the "dx1 - height" hand (Shane machines both hands from one LH-hinge door program, turning
 * the door end for end). Jamb X = floor height + footclearance + shiftcut.
 */
import { machiningOf, type Machining } from './machining';
import { variableValues } from '../engine/variables';

export type DoorEnd = 'bottom' | 'top';   // which end of the door is X0
export type Grade = 'ok' | 'near' | 'out';
export interface Row { item: string; door: number; jamb: number; diff: number; ok: boolean; grade: Grade }
export interface IntentRow { item: string; want: number; got: number; diff: number; grade: Grade }
export interface AlignmentReport { rows: Row[]; intent: IntentRow[]; ok: boolean; notes: string[] }
/** What the job asked for - catches stored machining that Maestro has not re-evaluated yet. */
export interface Intent { handleHeight?: number }

const TOL = 0.05;   // ok
const NEAR = 0.25;  // near: within deliberate trims, worth knowing

export function alignDoorJamb(doorXml: string, jambXml: string, doorX0: DoorEnd = 'bottom', want: Intent = {}): AlignmentReport {
  const dv = variableValues(doorXml), jv = variableValues(jambXml);
  const L = dv.dx1, off = (jv.footclearance ?? 0) + (jv.shiftcut ?? 0);
  const door = machiningOf(doorXml).filter((m) => m.enabled), jamb = machiningOf(jambXml).filter((m) => m.enabled);
  const notes: string[] = [];
  const fromFloor = (x: number) => (doorX0 === 'bottom' ? x : L - x);
  const span = (m: Machining): [number, number] => { const a = fromFloor(m.box!.x0), b = fromFloor(m.box!.x1); return [Math.min(a, b), Math.max(a, b)]; };
  const rows: Row[] = []; const intent: IntentRow[] = [];
  const grade = (a: number): Grade => (a <= TOL ? 'ok' : a <= NEAR ? 'near' : 'out');
  const expectRow = (item: string, w: number, got: number) => intent.push({ item, want: w, got, diff: got - w, grade: grade(Math.abs(got - w)) });
  const push = (item: string, d: number, j: number) => {
    const diff = j - d; const a = Math.abs(diff);
    rows.push({ item, door: d, jamb: j, diff, ok: a <= TOL, grade: a <= TOL ? 'ok' : a <= NEAR ? 'near' : 'out' });
  };

  const isHinge = (m: Machining) => /hinge/i.test(m.macro ?? '') && !/holes/i.test(m.macro ?? '') && m.feature === 'ClosedPocket' && m.box;
  const dh = door.filter(isHinge).map(span).sort((a, b) => a[0] - b[0]);
  const jh = jamb.filter(isHinge).map((m) => [m.box!.x0 - off, m.box!.x1 - off] as [number, number]).sort((a, b) => a[0] - b[0]);
  if (dh.length !== jh.length) notes.push(`hinge count differs: door ${dh.length}, jamb ${jh.length}`);
  const names = dh.length === 3 ? ['bottom', 'centre', 'top'] : dh.map((_, i) => String(i + 1));
  dh.forEach((d, i) => { if (jh[i]) push(`hinge ${names[i]} pocket start`, d[0], jh[i][0]); });
  // door length: the end hinges sit the same distance from both ends on Shane's doors
  if (dh.length >= 2) expectRow('door: top hinge gap = bottom gap', dh[0][0], L - dh[dh.length - 1][1]);

  const isHole = (m: Machining) => /hingehole/i.test(m.macro ?? '') && m.feature === 'RoundHole' && m.center;
  const dho = door.filter(isHole).map((m) => fromFloor(m.center![0])).sort((a, b) => a - b);
  const jho = jamb.filter(isHole).map((m) => m.center![0] - off).sort((a, b) => a - b);
  if (dho.length !== jho.length) notes.push(`hinge screw hole count differs: door ${dho.length}, jamb ${jho.length}`);
  for (let i = 0; i < Math.min(dho.length, jho.length); i++) {
    const set = names[Math.floor(i / 3)] ?? String(Math.floor(i / 3) + 1);
    push(`hinge ${set} screw ${['low', 'centre', 'high'][i % 3]}`, dho[i], jho[i]);
  }

  // latch: circle bore on an edge plane under a latch macro; Back plane x is reversed (plane x = dx1 - X)
  const bore = door.find((m) => /latch/i.test((m.macro ?? '') + m.step) && m.geometry === 'GeomCircle' && /Back|Front/.test(m.plane) && m.center);
  const strike = jamb.filter((m) => /strik/i.test(m.macro ?? '') && m.box);
  if (bore && strike.length) {
    const xw = bore.plane === 'Back' ? L - bore.center![0] : bore.center![0];
    const plate = strike.reduce((a, b) => ((b.box!.x1 - b.box!.x0) * (b.box!.y1 - b.box!.y0) > (a.box!.x1 - a.box!.x0) * (a.box!.y1 - a.box!.y0) ? b : a));
    const sc = (plate.box!.x0 + plate.box!.x1) / 2 - off;
    push('latch / strike centre', fromFloor(xw), sc);
    if (want.handleHeight !== undefined) { expectRow('door latch at job height', want.handleHeight, fromFloor(xw)); expectRow('jamb strike at job height', want.handleHeight, sc); }
  } else notes.push(bore ? 'no enabled strike found on the jamb' : 'no latch bore found on the door');

  if (dv.dz1 !== undefined) notes.push(`door ${L} x ${dv.dy1} x ${dv.dz1}; jamb offset ${off} (footclearance + shiftcut)`);
  return { rows, intent, ok: rows.length > 0 && rows.every((r) => r.ok) && intent.every((r) => r.grade !== 'out') && !notes.some((n) => n.includes('differs') || n.startsWith('no ')), notes };
}

export function formatReport(r: AlignmentReport): string {
  const z = (n: number) => (Math.abs(n) < 0.005 ? 0 : n);
  const f = (n: number) => z(n).toFixed(2).padStart(8);
  const sd = (d: number) => (z(d) >= 0 ? '+' : '') + z(d).toFixed(2).padStart(7);
  const lines = ['item                              door     jamb     diff', ...r.rows.map((x) => `${x.item.padEnd(30)}${f(x.door)} ${f(x.jamb)} ${sd(x.diff)}  ${x.grade === 'out' ? 'OUT' : x.grade}`)];
  const il = r.intent.length ? ['', 'against the job                    want      got     diff', ...r.intent.map((x) => `${x.item.padEnd(30)}${f(x.want)} ${f(x.got)} ${sd(x.diff)}  ${x.grade === 'out' ? 'OUT' : x.grade}`)] : [];
  return [...lines, ...il, ...r.notes.map((n) => '- ' + n), r.ok ? 'ALIGNED' : 'NOT ALIGNED'].join('\n');
}
