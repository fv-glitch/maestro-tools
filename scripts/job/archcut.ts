// Parametric architrave cutting: ARCH Leg Right, ARCH Leg Left, ARCH Head, in the EF field (jamb side). Each run cuts
// one piece off the end of the bar, pushed to the X stops, and leaves the bar end square for the next run. E015 saw,
// vertical blade; mitres are 45 deg across the face.
// Built on the owner's EF jamb program '112x19 28mm CUt Only No Park' emptied (its setup, field EF, planes, park), with
// its own saw cut 'Cut with blade' (Top(1), jamb Z: part modelled 0.1 thick, cut to Z -overcut) as the template.
//
// Setup: architrave face up, THICK (square) edge against the metal fence between the jamb lanes, bevelled edge to the
// rubber clamps, bar pushed to the X stops. Long points are on the thick edge, short points on the thin edge.
//   Leg Right: RH lane (Y 0..dy1), foot at the stops.   Leg Left: LH lane (Y -25-dy1..-25), foot at the stops.
//   Head: RH lane, the first mitre kept HeadStart in from the stops.
// Seen from the face of the door, Leg Right / Leg Left are the right / left legs. One door face = one of each + a head.
// Only one piece on the table: the 45 deg cuts run on across the other lane.
//
// Variables (change them in Maestro; every cut line is an expression):
//   DoorHeight, DoorWidth, Leaves (1, or 2 for a pair), FloorGap, Reveal, Trim (the legs' foot cut, as the jamb's 10),
//   HeadStart (the head's first mitre, thick-edge point; 95 keeps the blade 10 clear of the stops)
//   ArchThickness (overcut = ArchThickness+2 below the 0.1 model), dy1 = architrave width, dx1 = bar on the table
// Lengths: leg short = FloorGap + DoorHeight + 3 + Reveal, long = short + dy1
//          head short = Leaves * DoorWidth + 3 * (Leaves + 1) + 2 * Reveal, long = short + 2 * dy1   (gaps are always 3)
// Geometry line = kerf edge on the piece side; the blade (3.15) is on the left of the line's direction (template
// 'Cut with blade': SideOfFeature Left, IsGeomSameDirection true). A mitre cut is followed by a square cut one kerf
// past it so the next run starts from a square end.
//   npx tsx scripts/job/archcut.ts "112x19 28mm CUt Only No Park.pgmx" outDir [--width 60] [--thick 10] [--bar 2400]
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { blocks, cloneBlocks, ln, renameStep, setDepth, setDesc, setGeoName } from '../../src/engine/pgmx';
import { Builder } from '../../src/ops/cabinet';
import { makeVariable } from '../../src/engine/params';
import { Ids } from '../../src/engine/pgmx';
import { evaluate } from '../../src/engine/formula';
import { variableValues } from '../../src/engine/variables';
import { assertSafe } from '../../src/engine/validate';
import { pyRepr as r } from '../../src/engine/pyfmt';

const args = process.argv.slice(2);
const opt = (f: string, d: string) => { const i = args.indexOf(f); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const W = +opt('--width', '60'), T = +opt('--thick', '10'), BAR = +opt('--bar', '2400');
const [basePath, outDir] = args;
const A = readPgmx(basePath); const base = getXml(A); const saw = base;
const sawY = blocks(saw, 'Cut with blade');
const keyOf = (b: string) => /<Key[^>]*><ID>(\d+)<\/ID>/.exec(b)![1];
const allEx = [...saw.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0]);
const depthEx = allEx.filter((e) => e.includes(`<b:ID>${keyOf(sawY[1])}</b:ID>`) && /<a:Name>Depth<\/a:Name>/.test(e));
const overEx = allEx.find((e) => e.includes(`<b:ID>${keyOf(sawY[3])}</b:ID>`) && /<a:Name>OvercutLength<\/a:Name>/.test(e))!;
const lineEx = allEx.find((e) => /GeomTrimmedCurve/.test(e) && /<a:Name>StartX<\/a:Name>/.test(e))!;
if (depthEx.length !== 2 || !lineEx || !overEx) throw new Error('template expressions not found');

const VARS: [string, number][] = [['DoorHeight', 1980], ['DoorWidth', 810], ['Leaves', 1], ['FloorGap', 25], ['Reveal', 3], ['Trim', 10], ['HeadStart', 95], ['ArchThickness', T]];

const sect = (t: string, tag: string) => {
  const m = new RegExp(`<${tag}(?: [^>]*)?>`).exec(t); if (!m) throw new Error('no <' + tag + '>');
  return { start: m.index + m[0].length, end: t.indexOf(`</${tag}>`, m.index) };
};
/** The EF jamb program emptied: park move, setup, planes (generated ones dropped), both workpieces (Jamb 1 / Jamb 2: dx/dy/dz 1 and 2),
 *  workpiece expressions, plus our variables (cloned from doorlength); width W, model thickness 0.1, bar L. */
function efBlank(src: string, L: number, W: number): string {
  let t = src;
  const mw = t.indexOf('<MainWorkplan>'); const open = t.indexOf('<Elements', mw); const start = t.indexOf('>', open) + 1;
  const close = t.lastIndexOf('</Elements>', t.indexOf('</MainWorkplan>'));
  // top-level executables only (macro instances hold their own Xn steps)
  const top: string[] = []; { const re = /<(\/?)Executable[ >]/g; re.lastIndex = start; let depth = 0, s0 = -1; let m: RegExpExecArray | null;
    while ((m = re.exec(t)) && m.index < close) {
      if (!m[1]) { if (depth === 0) s0 = m.index; depth++; }
      else { depth--; if (depth === 0) top.push(t.slice(s0, t.indexOf('>', m.index) + 1)); }
    } }
  const xns = top.filter((x) => x.startsWith('<Executable i:type="Xn">') && /<IsEnabled>true<\/IsEnabled>/.test(x.slice(0, 600)));
  if (xns.length !== 1) throw new Error(`expected one enabled top-level park move, found ${xns.length}`);
  t = t.slice(0, start) + xns[0] + t.slice(close);
  for (const tag of ['Features', 'Geometries', 'Operations']) { const s = sect(t, tag); t = t.slice(0, s.start) + t.slice(s.end); }
  t = t.replace(/<Plane i:type="PlaneGenerated".*?<\/Plane>/gs, '');
  { const s = sect(t, 'Expressions'); const keep = [...t.slice(s.start, s.end).matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0]).filter((e) => e.includes('ProjectModule.WorkPiece</b:ObjectType>'));
    if (keep.length !== 6) throw new Error('expected 6 workpiece expressions (Jamb 1 and Jamb 2)'); t = t.slice(0, s.start) + keep.join('') + t.slice(s.end); }
  { const s = sect(t, 'Variables'); const all = [...t.slice(s.start, s.end).matchAll(/<a:Variable>.*?<\/a:Variable>/gs)].map((m) => m[0]);
    const name = (v: string) => /<Name xmlns="[^"]*">([^<]*)</.exec(v)![1];
    const keep = all.filter((v) => ['dx1', 'dy1', 'dz1', 'dx2', 'dy2', 'dz2'].includes(name(v)));
    const ids = new Ids(t);
    const extra = VARS.map(([n, v]) => makeVariable(ids, t, 'doorlength', n, r(v)));
    t = t.slice(0, s.start) + keep.join('') + extra.join('') + t.slice(s.end); }
  const setVar = (s: string, n: string, v: number) => s.replace(new RegExp(`(<Name xmlns="[^"]*">${n}</Name>.*?<a:Value[^>]*>)[^<]*(<)`, 's'), (_m, a, b) => a + r(v) + b);
  for (const [n, v] of [['dx1', L], ['dx2', L], ['dy1', W], ['dy2', W]] as const) t = setVar(t, n, v);
  t = t.replace(/(<WorkPiece>.*?<\/WorkPiece>)/gs, (wp) => wp.replace(/(<a:Length>)[^<]*(<\/a:Length><a:Width>)[^<]*(<)/, (_m, a, b, c) => a + r(L) + b + r(W) + c)
    .replace(/(<\/Geometry><Length>)[^<]*(<)/, (_m, a, b) => a + r(L) + b).replace(/(<\/State><Width>)[^<]*(<)/, (_m, a, b) => a + r(W) + b));
  // face planes: the jamb width 112 -> W (Y extents and the Left / Back / Bottom origins)
  return t.replace(/<Plane>.*?<\/Plane>/gs, (p) => p.replace(/(<a:_yP>)112(<)/, `$1${r(W)}$2`).replace(/(<YDimension>)112(<)/, `$1${r(W)}$2`).replace(/(<XDimension>)112(<)/, `$1${r(W)}$2`));
}
// Lanes (from the jamb programs: hinge pockets overrun 7 mm past the fence edges at Y0 and Y-25):
//   RH lane Y 0 .. dy1 (thick edge on the fence at Y0), LH lane Y -25-dy1 .. -25 (thick edge on the fence at Y-25).
// Nothing (blade path or the blade's chord at the top of the bar, Ø249 dipped 12 below it) comes nearer the X stops
// than the jamb programs' own trim cut (blade face at X 6.85). Mitre start cuts are kept HeadStart in for that.
const RUN_SQ = 100;                       // straight cuts run 100 past each edge, like the jamb template
const RUN_45 = 60;                        // 45 deg cuts run 60 along the line past each edge (> 53.5 chord at the top)
const K = 3.15, HK = K / 2, MK = '4.455'; // kerf, half kerf, kerf measured along X on a 45 deg cut
const LEG = 'FloorGap+DoorHeight+3+Reveal';                       // leg short point
const HEAD = 'Leaves*DoorWidth+3*(Leaves+1)+2*Reveal';            // head short point
const LANE = { RH: { thick: '0', thin: 'dy1' }, LH: { thick: '-25', thin: '-25-dy1' } };
/** a cut through two points on the bar's edges, blade (waste) on the -X or +X side */
type Cut = { name: string; a: [string, string]; b: [string, string]; waste: '-X' | '+X' };
const sq = (name: string, x: string, lane: keyof typeof LANE, waste: '-X' | '+X'): Cut => ({ name, a: [x, LANE[lane].thick], b: [x, LANE[lane].thin], waste });
/** 45 deg: thin-edge point at x, thick-edge point at x + dy1 (long point on the thick edge) or x - dy1 */
const m45 = (name: string, xThin: string, xThick: string, lane: keyof typeof LANE, waste: '-X' | '+X'): Cut =>
  ({ name, a: [xThin, LANE[lane].thin], b: [xThick, LANE[lane].thick], waste });

const PROGRAMS: { name: string; cuts: Cut[] }[] = [
  { name: 'ARCH Leg Right', cuts: [          // RH lane, foot at the stops
    sq('Trim', 'Trim', 'RH', '-X'),
    m45('Mitre top', `Trim+${LEG}`, `Trim+${LEG}+dy1`, 'RH', '+X'),
    sq('Square the bar', `Trim+${LEG}+dy1+${MK}+${K}+1`, 'RH', '-X'),
  ] },
  { name: 'ARCH Leg Left', cuts: [           // LH lane, foot at the stops (the mirror of Leg Right)
    sq('Trim', 'Trim', 'LH', '-X'),
    m45('Mitre top', `Trim+${LEG}`, `Trim+${LEG}+dy1`, 'LH', '+X'),
    sq('Square the bar', `Trim+${LEG}+dy1+${MK}+${K}+1`, 'LH', '-X'),
  ] },
  { name: 'ARCH Head', cuts: [               // RH lane
    m45('Mitre left', 'HeadStart+dy1', 'HeadStart', 'RH', '-X'),
    m45('Mitre right', `HeadStart+dy1+${HEAD}`, `HeadStart+2*dy1+${HEAD}`, 'RH', '+X'),
    sq('Square the bar', `HeadStart+2*dy1+${HEAD}+${MK}+${K}+1`, 'RH', '-X'),
  ] },
];

mkdirSync(outDir, { recursive: true });
for (const P of PROGRAMS) {
  const t0 = efBlank(base, BAR, W);
  const V = variableValues(t0);
  const b = new Builder(t0, { sawY, sawX: sawY, pocket: [], drill3: [], drill8: [], edge: [], src: [base, saw] } as never);
  const ids = b.ids; let en = Math.max(0, ...[...t0.matchAll(/\[Expression\]\((\d+)\)/g)].map((m) => +m[1]));
  const Z = -(T + 2), CL = 100.1;   // as the template: approach from 100.1 (0.1 top + security plane 100)
  for (const c of P.cuts) {
    let [st, fm, gm, om] = cloneBlocks(ids, sawY);
    const ev = (p: [string, string]) => p.map((f) => evaluate(f, V)) as [number, number];
    let [p1, p2] = [c.a, c.b]; let [q1, q2] = [ev(p1), ev(p2)];
    let ux = q2[0] - q1[0], uy = q2[1] - q1[1]; const n = Math.hypot(ux, uy); ux /= n; uy /= n;
    if (Math.sign(-uy) !== (c.waste === '+X' ? 1 : -1)) { [p1, p2] = [p2, p1]; [q1, q2] = [q2, q1]; ux = -ux; uy = -uy; }   // blade on the left of travel
    const lx = -uy, ly = ux;
    const run = Math.abs(ux) < 1e-9 ? RUN_SQ : RUN_45;
    const off = (v: number) => (v >= 0 ? `+${r(v)}` : `-${r(-v)}`);
    const f = { sx: `${p1[0]}${off(-run * ux)}`, sy: `${p1[1]}${off(-run * uy)}`, ex: `${p2[0]}${off(run * ux)}`, ey: `${p2[1]}${off(run * uy)}` };
    const sx = q1[0] - run * ux, sy = q1[1] - run * uy, ex = q2[0] + run * ux, ey = q2[1] + run * uy;
    const L = Math.hypot(ex - sx, ey - sy);
    const cx = sx + HK * lx, cy = sy + HK * ly;                  // blade centre line
    gm = gm.replace(/(_serializationGeometryDescription>)[^<]*(<)/, (_m, p, q) => p + `8 0 ${r(L)}\n1 ${r(sx)} ${r(sy)} 0 ${r(ux)} ${r(uy)} 0 \n` + q);
    gm = setGeoName(gm, `${P.name} ${c.name}`.replace(/ /g, ''));
    fm = setDepth(fm, 0.1);
    om = om.replace(/(<b:Type>TrajectoryPath<\/b:Type>.*?_serializationGeometryDescription>)[^<]*(<)/s, (_m, p, q) => p + `8 0 ${r(L)}\n1 ${r(cx)} ${r(cy)} ${r(Z)} ${r(ux)} ${r(uy)} 0 \n` + q);
    om = setDesc(om, 'Approach', ln(cx, cy, CL, 0, 0, -1, CL - Z), CL - Z);
    om = setDesc(om, 'Lift', ln(cx + L * ux, cy + L * uy, Z, 0, 0, 1, CL - Z), CL - Z);
    om = om.replace(/<OvercutLength>[^<]*</, `<OvercutLength>${r(T + 2)}<`);
    (b as unknown as { add: (g: string, ...x: string[]) => void }).add(P.name, renameStep(st, `E015 Saw - ${c.name}`, true), fm, gm, om);
    const gid = keyOf(gm), fid = keyOf(fm), oid = keyOf(om);
    { const [e] = cloneBlocks(ids, [overEx]);
      b.ex.items.push(e.replace(/(<a:ReferencedObject[^>]*><b:ID>)\d+(<)/, `$1${oid}$2`).replace(/(<a:Value>)[^<]*(<)/, '$1ArchThickness+2$2').replace(/\[Expression\]\(\d+\)/, `[Expression](${++en})`)); }
    for (const [prop, fx] of [['StartX', f.sx], ['StartY', f.sy], ['EndX', f.ex], ['EndY', f.ey]] as const) {
      const [e] = cloneBlocks(ids, [lineEx]);
      b.ex.items.push(e.replace(/(<a:ReferencedObject[^>]*><b:ID>)\d+(<)/, `$1${gid}$2`).replace(/<a:Name>StartX<\/a:Name>/, `<a:Name>${prop}</a:Name>`)
        .replace(/(<a:Value>)[^<]*(<)/, `$1${fx}$2`).replace(/\[Expression\]\(\d+\)/, `[Expression](${++en})`));
    }
    for (const de of depthEx) {
      const [e] = cloneBlocks(ids, [de]);
      b.ex.items.push(e.replace(/(<a:ReferencedObject[^>]*><b:ID>)\d+(<)/, `$1${fid}$2`).replace(/\[Expression\]\(\d+\)/, `[Expression](${++en})`));
    }
  }
  const t1 = b.finish();
  assertSafe(base, t1);
  writePgmx(A, t1, path.join(outDir, P.name + '.pgmx'), P.name);
  console.log(`${P.name}: ${P.cuts.map((c) => c.name).join(', ')}`);
}
