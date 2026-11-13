// Parametric architrave cutting: ARCH Leg Right, ARCH Leg Left, ARCH Head. Each run cuts one piece off the end of the
// bar, pushed to the X stops, and leaves the bar end square for the next run. E015 saw, vertical blade; mitres are
// 45 deg across the face.
//
// Setup: architrave face up, THICK (outer) edge on the front stops (Y0), thin edge (reveal side) at the back (Y = dy1).
// So every long point is on the front edge and every short point on the back edge. Seen from the face of the door,
// 'Leg Right' is the right-hand leg (foot at the stops, top away from them) and 'Leg Left' is the left-hand leg
// (top at the stops). One door face = one Left, one Right, one Head.
//
// Variables (change them in Maestro; every cut line is an expression):
//   DoorHeight, DoorWidth, Leaves (1, or 2 for a pair), FloorGap, Reveal, Trim (taken off a square bar end)
//   dy1 = architrave width, dz1 = thickness (cut depth dz1 / Sin(90.000) like Maestro's own saw cuts), dx1 = bar on the table
// Lengths: leg short = FloorGap + DoorHeight + 3 + Reveal, long = short + dy1
//          head short = Leaves * DoorWidth + 3 * (Leaves + 1) + 2 * Reveal, long = short + 2 * dy1   (gaps are always 3)
// Geometry line = kerf edge on the piece side; the blade (3.15) is on the left of the line's direction (template
// 'Cut Side LH(1)': SideOfFeature Left, IsGeomSameDirection true). A mitre cut is followed by a square cut one kerf
// past it so the next run starts from a square end.
//   npx tsx scripts/job/archcut.ts TestingDoorReal.pgmx "810 Cut x6.pgmx" outDir [--width 60] [--thick 10] [--bar 2400]
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { blocks, cloneBlocks, ln, renameStep, setDepth, setDesc, setGeoName } from '../../src/engine/pgmx';
import { blankProgram, Builder } from '../../src/ops/cabinet';
import { evaluate } from '../../src/engine/formula';
import { variableValues } from '../../src/engine/variables';
import { assertSafe } from '../../src/engine/validate';
import { pyRepr as r } from '../../src/engine/pyfmt';

const args = process.argv.slice(2);
const opt = (f: string, d: string) => { const i = args.indexOf(f); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const W = +opt('--width', '60'), T = +opt('--thick', '10'), BAR = +opt('--bar', '2400');
const [basePath, sawPath, outDir] = args;
const A = readPgmx(basePath); const base = getXml(A); const saw = getXml(readPgmx(sawPath));
const sawY = blocks(saw, 'Cut Side LH(1)');
const keyOf = (b: string) => /<Key[^>]*><ID>(\d+)<\/ID>/.exec(b)![1];
const allEx = [...saw.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0]);
const depthEx = allEx.filter((e) => e.includes(`<b:ID>${keyOf(sawY[1])}</b:ID>`) && /<a:Name>Depth<\/a:Name>/.test(e));
const lineEx = allEx.find((e) => /GeomTrimmedCurve/.test(e) && /<a:Name>StartX<\/a:Name>/.test(e))!;
if (depthEx.length !== 2 || !lineEx) throw new Error('template expressions not found');

const VARS: [string, number][] = [['DoorHeight', 1980], ['DoorWidth', 810], ['Leaves', 1], ['FloorGap', 25], ['Reveal', 3], ['Trim', 5]];
const E = 70.711;        // 100 mm along a 45 deg line, each way past the bar
const K = 3.15, HK = K / 2, MK = '4.455';   // kerf, half kerf, kerf measured along X on a 45 deg cut
const LEG = 'FloorGap+DoorHeight+3+Reveal';                       // leg short point
const HEAD = 'Leaves*DoorWidth+3*(Leaves+1)+2*Reveal';            // head short point
type Cut = { name: string; sx: string; sy: string; ex: string; ey: string };
const square = (name: string, x: string, bladeX: '-' | '+'): Cut => bladeX === '-'
  ? { name, sx: x, sy: '-100', ex: x, ey: 'dy1+100' }          // +Y: blade on -X
  : { name, sx: x, sy: 'dy1+100', ex: x, ey: '-100' };         // -Y: blade on +X
// mitre with the piece on -X: back (short) point at x, front (long) point at x+dy1; runs back -> front, blade on +X
const mitreEnd = (name: string, x: string): Cut => ({ name, sx: `${x}-${E}`, sy: `dy1+${E}`, ex: `${x}+dy1+${E}`, ey: `-${E}` });
// mitre with the piece on +X: front (long) point at x, back (short) point at x+dy1; runs front -> back, blade on -X
const mitreStart = (name: string, x: string): Cut => ({ name, sx: `${x}-${E}`, sy: `-${E}`, ex: `${x}+dy1+${E}`, ey: `dy1+${E}` });

const PROGRAMS: { name: string; cuts: Cut[] }[] = [
  { name: 'ARCH Leg Right', cuts: [
    square('Trim', 'Trim', '-'),
    mitreEnd('Mitre top', `Trim+${LEG}`),
    square('Square the bar', `Trim+${LEG}+dy1+${MK}+${K}+1`, '-'),
  ] },
  { name: 'ARCH Leg Left', cuts: [
    mitreStart('Mitre top', 'Trim'),
    square('Foot', `Trim+${LEG}+dy1`, '+'),
  ] },
  { name: 'ARCH Head', cuts: [
    mitreStart('Mitre left', 'Trim'),
    mitreEnd('Mitre right', `Trim+${HEAD}+dy1`),
    square('Square the bar', `Trim+${HEAD}+2*dy1+${MK}+${K}+1`, '-'),
  ] },
];

mkdirSync(outDir, { recursive: true });
for (const P of PROGRAMS) {
  const t0 = blankProgram(base, BAR, W, T, VARS);
  const V = variableValues(t0);
  const b = new Builder(t0, { sawY, sawX: sawY, pocket: [], drill3: [], drill8: [], edge: [], src: [base, saw] } as never);
  const ids = b.ids; let en = Math.max(0, ...[...t0.matchAll(/\[Expression\]\((\d+)\)/g)].map((m) => +m[1]));
  const Z = -0.2, CL = T + 52;
  for (const c of P.cuts) {
    let [st, fm, gm, om] = cloneBlocks(ids, sawY);
    const [sx, sy, ex, ey] = [c.sx, c.sy, c.ex, c.ey].map((f) => evaluate(f, V));
    const L = Math.hypot(ex - sx, ey - sy), ux = (ex - sx) / L, uy = (ey - sy) / L;
    const lx = -uy, ly = ux;                                     // left of travel = the blade side
    const cx = sx + HK * lx, cy = sy + HK * ly;                  // blade centre line
    gm = gm.replace(/(_serializationGeometryDescription>)[^<]*(<)/, (_m, p, q) => p + `8 0 ${r(L)}\n1 ${r(sx)} ${r(sy)} 0 ${r(ux)} ${r(uy)} 0 \n` + q);
    gm = setGeoName(gm, `${P.name} ${c.name}`.replace(/ /g, ''));
    fm = setDepth(fm, T);
    om = om.replace(/(<b:Type>TrajectoryPath<\/b:Type>.*?_serializationGeometryDescription>)[^<]*(<)/s, (_m, p, q) => p + `8 0 ${r(L)}\n1 ${r(cx)} ${r(cy)} ${r(Z)} ${r(ux)} ${r(uy)} 0 \n` + q);
    om = setDesc(om, 'Approach', ln(cx, cy, CL, 0, 0, -1, CL - Z), CL - Z);
    om = setDesc(om, 'Lift', ln(cx + L * ux, cy + L * uy, Z, 0, 0, 1, CL - Z), CL - Z);
    (b as unknown as { add: (g: string, ...x: string[]) => void }).add(P.name, renameStep(st, `E015 Saw - ${c.name}`, true), fm, gm, om);
    const gid = keyOf(gm), fid = keyOf(fm);
    for (const [prop, f] of [['StartX', c.sx], ['StartY', c.sy], ['EndX', c.ex], ['EndY', c.ey]] as const) {
      const [e] = cloneBlocks(ids, [lineEx]);
      b.ex.items.push(e.replace(/(<a:ReferencedObject[^>]*><b:ID>)\d+(<)/, `$1${gid}$2`).replace(/<a:Name>StartX<\/a:Name>/, `<a:Name>${prop}</a:Name>`)
        .replace(/(<a:Value>)[^<]*(<)/, `$1${f}$2`).replace(/\[Expression\]\(\d+\)/, `[Expression](${++en})`));
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
