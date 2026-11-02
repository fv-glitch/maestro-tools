/**
 * Stringer programs. The template is the first stair test (fixtures/stair-test.pgmx, made in Maestro from
 * test-stringer-3R-v2.dxf): step 'Outline Pocket' = every tread and riser housing as ONE ClosedPocket on the
 * Top plane, E019, 12 deep, 2 levels of 6, with the toolpath Maestro computed.
 *
 * That project has no bars/cups and no Xn park move, so the M100 rejects it. Here the step is cloned onto the
 * emptied TestingDoorReal (blankProgram), which carries TDR's setup. The operator sets the bars and cups by hand at the
 * machine, so the setup is only there to keep the machine happy.
 *
 * testStringerProgram clones the step unchanged (Maestro's own toolpath, only the 540-rise 3R test stair).
 * stringerProgram writes any housed stair: the outline and a tool-centre contour of our own (stringerPocket),
 * checked against Maestro's toolpath for the test stair in tests/stair.test.ts.
 */
import { Ids, blocks, cloneBlocks, renameStep, splice, setMembers, setTrajectory, setDesc, setDepth, ln, NS_PROJECT } from '../engine/pgmx';
import { pyRepr as r } from '../engine/pyfmt';
import { blankProgram, planeId } from './cabinet';
import { housedStringer, type StairInput, type StringerLayout, type Pt } from './stair';

const UTIL = 'http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Utility';

/** The stair the template pocket was drawn for (test-stringer-3R-v2.dxf). */
export const TEST_STAIR: StairInput = { totalRise: 540, treadT: 32, riserT: 18, stringerW: 290, stringerT: 42 };
export const TEST_STEP = 'Outline Pocket';

const idOf = (t: string, objectType: string, re = ''): string => {
  const m = new RegExp(`<Key[^>]*><ID>(\\d+)</ID><ObjectType>ScmGroup\\.XCam\\.MachiningDataModel\\.${objectType}</ObjectType></Key>${re}`, 's').exec(t);
  if (!m) throw new Error('no ' + objectType); return m[1];
};

/**
 * Test stringer: TDR blank of L x 290 x 42 plus the cloned housing pocket. L is the stringer length rounded
 * up to the next whole mm (the level end cuts are not machined).
 */
export function testStringerProgram(tdr: string, stairPgmxXml: string): { xml: string; L: number; W: number; T: number } {
  const lay = housedStringer(TEST_STAIR);
  const L = Math.ceil(lay.length), W = TEST_STAIR.stringerW, T = TEST_STAIR.stringerT;
  const base = blankProgram(tdr, L, W, T);
  const src = blocks(stairPgmxXml, TEST_STEP);
  // external refs of the template step -> the blank's own objects
  const geo = src[2];
  const refs: [string, string][] = [
    [/<a:WorkPieceID[^>]*><b:ID>(\d+)/.exec(geo)![1], idOf(base, 'ProjectModule\\.WorkPiece')],
    [/<a:PlaneID[^>]*><b:ID>(\d+)/.exec(geo)![1], planeId(base, 'Top')],
    [/<a:LayerID[^>]*><b:ID>(\d+)/.exec(geo)![1], idOf(base, 'Layers\\.Layer')],
  ];
  if (planeId(stairPgmxXml, 'Top') !== refs[1][0]) throw new Error('template pocket is not on the Top plane');
  const ids = new Ids(base, stairPgmxXml);
  let [st, fm, gm, om] = cloneBlocks(ids, src).map((b) => refs.reduce((s, [a, z]) => s.split('>' + a + '<').join('>' + z + '<'), b));
  st = renameStep(st, 'E019 16mm - Stringer housings', true);
  const group = `<Executable i:type="a:ExecutableGroup" xmlns:a="${NS_PROJECT}"><Key xmlns="${UTIL}"><ID>${ids.take()}</ID>` +
    `<ObjectType>ScmGroup.XCam.MachiningDataModel.ProjectModule.ExecutableGroup</ObjectType></Key><Name xmlns="${UTIL}">Stringer</Name>` +
    `<Description/><IsEnabled>true</IsEnabled><Priority>0</Priority><Elements>${st}</Elements></Executable>`;
  const park = base.indexOf('<Executable i:type="Xn">');
  const at = (tag: string) => base.indexOf(`</${tag}>`);
  const xml = splice(base, [[park, park, group], [at('Features'), at('Features'), fm], [at('Geometries'), at('Geometries'), gm], [at('Operations'), at('Operations'), om]]);
  return { xml, L, W, T };
}

type Rect = [number, number, number, number];

/** Outline of a union of axis-aligned rectangles: one counter-clockwise loop of corner points (throws on holes / pieces). */
export function rectUnionOutline(rects: Rect[]): Pt[] {
  const uniq = (a: number[]) => [...new Set(a)].sort((x, y) => x - y);
  const us = uniq(rects.flatMap((q) => [q[0], q[2]])), vs = uniq(rects.flatMap((q) => [q[1], q[3]]));
  const inCell = (i: number, j: number) => i >= 0 && j >= 0 && i < us.length - 1 && j < vs.length - 1 &&
    rects.some((q) => q[0] <= us[i] && us[i + 1] <= q[2] && q[1] <= vs[j] && vs[j + 1] <= q[3]);
  // directed boundary edges with the inside on the left (CCW): key = start "i,j" (grid node) -> end
  const next = new Map<string, string[]>();
  const add = (a: [number, number], b: [number, number]) => { const k = a.join(','); next.set(k, [...(next.get(k) ?? []), b.join(',')]); };
  for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
    if (!inCell(i, j)) continue;
    if (!inCell(i, j - 1)) add([i, j], [i + 1, j]);
    if (!inCell(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
    if (!inCell(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
    if (!inCell(i - 1, j)) add([i, j + 1], [i, j]);
  }
  const total = [...next.values()].reduce((n, a) => n + a.length, 0);
  if ([...next.values()].some((a) => a.length > 1)) throw new Error('housing outline touches itself at a corner');
  const start = [...next.keys()][0]; const nodes: string[] = []; let k = start;
  do { nodes.push(k); k = next.get(k)![0]; } while (k !== start && nodes.length <= total);
  if (nodes.length !== total) throw new Error('housings do not form one connected pocket without islands');
  const pts = nodes.map((n) => { const [i, j] = n.split(',').map(Number); return [us[i], vs[j]] as Pt; });
  // drop collinear points
  return pts.filter((p, i) => { const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9; });
}

export type Seg = { kind: 'line'; a: Pt; b: Pt } | { kind: 'arc'; c: Pt; a: Pt; b: Pt; r: number };   // arcs run clockwise (reflex corners)

/**
 * Tool-centre loop at `d` inside a CCW rectilinear outline: edges shifted in by d, sharp at convex corners,
 * a clockwise arc of radius d round each reflex corner. Valid while every housing is at least 2d wide;
 * checked by requiring every shifted edge to keep its direction and no two segments to cross.
 */
export function offsetLoop(poly: Pt[], d: number): Seg[] {
  const n = poly.length, out: Seg[] = [];
  const dir = (i: number): Pt => { const a = poly[i], b = poly[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const left = (t: Pt): Pt => [-t[1], t[0]];
  const convex = (i: number) => { const t0 = dir((i + n - 1) % n), t1 = dir(i); return t0[0] * t1[1] - t0[1] * t1[0] > 0; };
  // shifted edge i runs from s_i to e_i
  const s: Pt[] = [], e: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = dir(i), m = left(t), a = poly[i], b = poly[(i + 1) % n];
    const cs = convex(i), ce = convex((i + 1) % n);
    s.push([a[0] + m[0] * d + (cs ? t[0] * d : 0), a[1] + m[1] * d + (cs ? t[1] * d : 0)]);
    e.push([b[0] + m[0] * d - (ce ? t[0] * d : 0), b[1] + m[1] * d - (ce ? t[1] * d : 0)]);
    const back = (e[i][0] - s[i][0]) * t[0] + (e[i][1] - s[i][1]) * t[1];
    if (back < -1e-9) throw new Error(`pocket edge ${i} too short for the cutter (${back.toFixed(2)})`);
  }
  for (let i = 0; i < n; i++) {
    if (Math.hypot(e[i][0] - s[i][0], e[i][1] - s[i][1]) > 1e-9) out.push({ kind: 'line', a: s[i], b: e[i] });
    const j = (i + 1) % n;
    if (!convex(j)) out.push({ kind: 'arc', c: poly[j], a: e[i], b: s[j], r: d });
  }
  return out;
}

/** Record for a segment at height z. Arcs use Maestro's clockwise form (normal -Z, u = +X, v = -Y), as in its own pockets. */
function segRecord(g: Seg, z: number): string {
  if (g.kind === 'line') { const L = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]); return ln(g.a[0], g.a[1], z, (g.b[0] - g.a[0]) / L, (g.b[1] - g.a[1]) / L, 0, L); }
  const ang = (p: Pt) => { let t = Math.atan2(-(p[1] - g.c[1]), p[0] - g.c[0]); if (t < 0) t += 2 * Math.PI; return t; };
  const t0 = ang(g.a); let t1 = ang(g.b); if (t1 <= t0) t1 += 2 * Math.PI;
  return `8 ${r(t0)} ${r(t1)}\n2 ${r(g.c[0])} ${r(g.c[1])} ${r(z)} 0 0 -1 1 0 0 0 -1 0 ${r(g.r)}\n`;
}

function crosses(p: Seg[]): boolean {
  // sample arcs as chords; adjacent segments share an end and are skipped
  const chords = p.flatMap((g, i) => g.kind === 'line' ? [[g.a, g.b, i]] : [[g.a, g.b, i]]) as [Pt, Pt, number][];
  const o = (a: Pt, b: Pt, c: Pt) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let x = 0; x < chords.length; x++) for (let y = x + 2; y < chords.length; y++) {
    if (x === 0 && y === chords.length - 1) continue;
    const [a, b] = chords[x], [c, d] = chords[y];
    if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true;
  }
  return false;
}

export interface StringerPocket { outline: Pt[]; loop: Seg[]; geometry: string[]; path: string[]; start: [number, number, number]; end: [number, number, number] }

/**
 * All housings of a layout as one pocket on the top face (Z = T): outline records and the tool-centre path
 * (one contour at the tool radius per level, levels of at most `step`, plunging at the loop start between levels).
 * Worked in the elevation frame (where the housings are axis-aligned) and mapped onto the stringer.
 */
export function stringerPocket(lay: StringerLayout, T: number, step = 6): StringerPocket {
  const rects = lay.housings.map((h) => h.elev);
  const ring = rectUnionOutline(rects);
  const outline = ring.map(lay.toStringer);
  const d = lay.toolR;
  for (const h of lay.housings) { const w = h.kind === 'tread' ? h.elev[3] - h.elev[1] : h.elev[2] - h.elev[0];
    if (w < 2 * d - 1e-9 || w > 4 * d + 1e-9) throw new Error(`${h.kind} housing ${w} wide: this path needs 2 to 4 cutter radii`); }
  const loopE = offsetLoop(ring, d);
  if (crosses(loopE)) throw new Error('tool path crosses itself: a housing is narrower than the cutter');
  // The contour covers 2d in from every wall. Where a riser meets a tread there is no tread wall, which leaves
  // an island in the middle of the tread band (Maestro clears it with a second loop). So at each tread's front
  // the path runs out along the tread centre line to the back and returns.
  for (const h of lay.housings.filter((x) => x.kind === 'tread')) {
    const [u1, v1, u2, v2] = h.elev, vm = (v1 + v2) / 2, F: Pt = [u1 + d, vm], B: Pt = [u2 - d, vm];
    const at = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
    let i = loopE.findIndex((g) => g.kind === 'line' && Math.abs(g.a[0] - F[0]) < 1e-6 && Math.abs(g.b[0] - F[0]) < 1e-6 &&
      Math.min(g.a[1], g.b[1]) - 1e-6 <= vm && vm <= Math.max(g.a[1], g.b[1]) + 1e-6);
    const out: Seg[] = [{ kind: 'line', a: F, b: B }, { kind: 'line', a: B, b: F }];
    if (i >= 0) {
      const g = loopE[i] as Extract<Seg, { kind: 'line' }>;
      const parts: Seg[] = [...(at(g.a, F) ? [] : [{ kind: 'line', a: g.a, b: F } as Seg]), ...out, ...(at(g.b, F) ? [] : [{ kind: 'line', a: F, b: g.b } as Seg])];
      loopE.splice(i, 1, ...parts);
    } else {
      i = loopE.findIndex((g) => at(g.b, F));
      if (i < 0) throw new Error('tread front not on the contour');
      loopE.splice(i + 1, 0, ...out);
    }
  }
  const map = (g: Seg): Seg => g.kind === 'line' ? { kind: 'line', a: lay.toStringer(g.a), b: lay.toStringer(g.b) }
    : { kind: 'arc', c: lay.toStringer(g.c), a: lay.toStringer(g.a), b: lay.toStringer(g.b), r: g.r };
  const loop = loopE.map(map);
  const geometry = outline.map((a, i) => { const b = outline[(i + 1) % outline.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return `8 0 ${r(L)}\n1 ${r(a[0])} ${r(a[1])} 0 ${r((b[0] - a[0]) / L)} ${r((b[1] - a[1]) / L)} 0 \n`; });
  const D = lay.plan.housingDepth, n = Math.max(1, Math.ceil(D / step - 1e-9));
  const zs = Array.from({ length: n }, (_, k) => T - D * (k + 1) / n);
  const st = loop[0].a; const path: string[] = [];
  zs.forEach((z, k) => {
    for (const g of loop) path.push(segRecord(g, z));
    if (k < n - 1) path.push(ln(st[0], st[1], z, 0, 0, -1, z - zs[k + 1]));
  });
  return { outline, loop, geometry, path, start: [st[0], st[1], zs[0]], end: [st[0], st[1], zs[n - 1]] };
}

/** setDepth only when the template's depth differs (keeps Maestro's own '42' rather than rewriting it as '42.0'). */
function keepOrSetDepth(fm: string, d: number): string {
  const m = /<EndDepth>([^<]*)<\/EndDepth><StartDepth>([^<]*)</.exec(fm);
  return m && +m[1] === d && +m[2] === d ? fm : setDepth(fm, d);
}

/** Re-point a cloned step's workpiece / plane / layer references at the blank's own (plane matched by name). */
function retarget(bl: string[], src: string, base: string): string[] {
  const geo = bl[2];
  const wp = /<a:WorkPieceID[^>]*><b:ID>(\d+)/.exec(geo)![1], pl = /<a:PlaneID[^>]*><b:ID>(\d+)/.exec(geo)![1], la = /<a:LayerID[^>]*><b:ID>(\d+)/.exec(geo)![1];
  const plName = new RegExp(`<Plane><Key[^>]*><ID>${pl}</ID>.{0,200}?Utility">([^<]*)</Name>`, 's').exec(src);
  if (!plName) throw new Error('template plane not found');
  const refs: [string, string][] = [[wp, idOf(base, 'ProjectModule\\.WorkPiece')], [pl, planeId(base, plName[1])], [la, idOf(base, 'Layers\\.Layer')]];
  return bl.map((b) => refs.reduce((x, [a, z]) => x.split('>' + a + '<').join('>' + z + '<'), b));
}

export const SAW_FILE_STEPS = { Right: 'Cut with blade', Left: 'Cut with blade(1)' } as const;   // in fixtures/stair-sawcuts.pgmx
const KERF = 3.15, SAW_Z = -0.2;

/**
 * One E015 through cut along `from` -> `to` (the finished face), extended `run` past both ends so the saw is in
 * position before it reaches the board. Clones the hand-drawn cut (SideOfFeature Right / Left = blade on the right / left
 * of travel); the geometry line is the kerf edge and the blade centre runs half a kerf to the blade side, Z -0.2.
 * Maestro adds an OperationGenerated plane per saw cut when it saves; it is not cloned (nothing references it).
 */
export function endSaw(ids: Ids, tpl: string[], from: Pt, to: Pt, side: 'Left' | 'Right', T: number, run = 100): string[] {
  let [st, fm, gm, om] = cloneBlocks(ids, tpl);
  if (!new RegExp(`<SideOfFeature>${side}</SideOfFeature>`).test(fm)) throw new Error('saw template is not ' + side);
  const l0 = Math.hypot(to[0] - from[0], to[1] - from[1]), d: Pt = [(to[0] - from[0]) / l0, (to[1] - from[1]) / l0];
  const len = l0 + 2 * run, a: Pt = [from[0] - d[0] * run, from[1] - d[1] * run];
  const n: Pt = side === 'Right' ? [d[1], -d[0]] : [-d[1], d[0]];
  const c: Pt = [a[0] + n[0] * KERF / 2, a[1] + n[1] * KERF / 2], e: Pt = [c[0] + d[0] * len, c[1] + d[1] * len];
  // geometry: only the first description / second parameter (rule 4)
  gm = gm.replace(/(_serializationGeometryDescription>)[^<]*(<)/, (_m, p, q) => p + `8 0 ${r(len)}\n1 ${r(a[0])} ${r(a[1])} 0 ${r(d[0])} ${r(d[1])} 0 \n` + q)
    .replace(/(_secondParameter>)[^<]*(<)/, (_m, p, q) => p + r(len / 2) + q);
  fm = keepOrSetDepth(fm, T);
  om = om.replace(/(<b:Type>TrajectoryPath<\/b:Type>.*?_serializationGeometryDescription>)[^<]*(<)/s,
    (_m, p, q) => p + `8 0 ${r(len)}\n1 ${r(c[0])} ${r(c[1])} ${r(SAW_Z)} ${r(d[0])} ${r(d[1])} 0 \n` + q);
  const CLR = T + 50;
  om = setDesc(om, 'Approach', ln(c[0], c[1], CLR, 0, 0, -1, CLR - SAW_Z), CLR - SAW_Z);
  om = setDesc(om, 'Lift', ln(e[0], e[1], SAW_Z, 0, 0, 1, CLR - SAW_Z), CLR - SAW_Z);
  return [st, fm, gm, om];
}

/**
 * Stringer program for any housed stair: TDR blank of length x stringerW x stringerT (length rounded up to the
 * mm), the template's one-pocket step with our outline and toolpath, then (with sawXml) the level floor and top end
 * cuts on the E015 saw. Provisional until opened + saved in Maestro.
 */
export function stringerProgram(tdr: string, stairPgmxXml: string, s: StairInput, name = 'E019 16mm - Stringer housings', sawXml?: string) {
  const lay = housedStringer(s);
  if (lay.problems.length) throw new Error('stair problems: ' + lay.problems.join('; '));
  const L = Math.ceil(lay.length - 1e-9), W = s.stringerW, T = s.stringerT;
  const pk = stringerPocket(lay, T);
  const base = blankProgram(tdr, L, W, T);
  const ids = new Ids(base, stairPgmxXml, ...(sawXml ? [sawXml] : []));
  let [st, fm, gm, om] = cloneBlocks(ids, retarget(blocks(stairPgmxXml, TEST_STEP), stairPgmxXml, base));
  gm = setMembers(ids, gm, pk.geometry);
  fm = keepOrSetDepth(setMembers(ids, fm, pk.geometry), lay.plan.housingDepth);
  om = setTrajectory(ids, om, pk.path);
  const CLR = T + 50;
  om = setDesc(om, 'Approach', ln(pk.start[0], pk.start[1], CLR, 0, 0, -1, CLR - pk.start[2]), CLR - pk.start[2]);
  om = setDesc(om, 'Lift', ln(pk.end[0], pk.end[1], pk.end[2], 0, 0, 1, CLR - pk.end[2]), CLR - pk.end[2]);
  const steps = [renameStep(st, name, true)], feats = [fm], geos = [gm], ops = [om];
  if (sawXml) {
    const tpl = (side: 'Left' | 'Right') => retarget(blocks(sawXml, SAW_FILE_STEPS[side]), sawXml, base);
    // both cut lines run from the top edge (Y = W) to the bottom edge; the stringer is on the left of the floor
    // cut's travel and on the right of the top cut's, so the blade goes Right and Left respectively
    const [[f0, f1], [t0, t1]] = lay.endCuts;
    for (const [nm, a, b, side] of [['E015 Saw - Floor cut', f0, f1, 'Right'], ['E015 Saw - Top cut', t0, t1, 'Left']] as const) {
      const [s2, f2, g2, o2] = endSaw(ids, tpl(side), a, b, side, T);
      steps.push(renameStep(s2, nm, true)); feats.push(f2); geos.push(g2); ops.push(o2);
    }
  }
  const group = `<Executable i:type="a:ExecutableGroup" xmlns:a="${NS_PROJECT}"><Key xmlns="${UTIL}"><ID>${ids.take()}</ID>` +
    `<ObjectType>ScmGroup.XCam.MachiningDataModel.ProjectModule.ExecutableGroup</ObjectType></Key><Name xmlns="${UTIL}">Stringer</Name>` +
    `<Description/><IsEnabled>true</IsEnabled><Priority>0</Priority><Elements>${steps.join('')}</Elements></Executable>`;
  const park = base.indexOf('<Executable i:type="Xn">');
  const at = (tag: string) => base.indexOf(`</${tag}>`);
  const xml = splice(base, [[park, park, group], [at('Features'), at('Features'), feats.join('')], [at('Geometries'), at('Geometries'), geos.join('')], [at('Operations'), at('Operations'), ops.join('')]]);
  return { xml, L, W, T, layout: lay, pocket: pk };
}
