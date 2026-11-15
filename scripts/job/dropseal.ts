// Raven RP8Si concealed drop seal: a door program that cuts the 34 x 15 mortice in the bottom end of the door and the
// two 22 mm escutcheon plate rebates (1.2 deep, 57 tall, round top) on the hinge and latch edges.
// Built on the emptied TestingDoorReal (cabinet.blankProgram, field LK) with clones of its proven 'Pocket' (E016
// ContourParallel ClosedPocket, multi-pass, depth expressions) moved to the edge / end planes (geometry PlaneID only,
// as the hinge and faceplate pockets on the Front / Back planes) and the tool swapped to E018 12.5 (the hinge-pocket
// cutter, RadialCuttingDepth 6.25 as in its hinge pockets).
//
// Setup: door face up, TOP to the X stops, so the bottom end is the far end (X = dx1, plane Right) and the spindle
// works out past the end of the door. Both edges get the same rebate and the mortice is centred on the thickness, so
// the program is the same for LH and RH doors and either face up.
//   Right plane: plane x = world Y, plane y = world Z.  Front (Y0 edge): x = X.  Back (Y1 edge): x = dx1 - X.
// Every pocket runs 14.5 past the edges / end it opens onto, so the E018 plunges in the air (centre 8.25 out) and
// each depth level of the mortice steps down outside the door.
//
// Variables: dx1 dy1 dz1 (door), SealDepth 34, SealWidth 15, PlateWidth 22.2, PlateHeight 57.1 (plate 22 x 57 + 0.1 a side,
// the shop's fit clearance), PlateDepth 1.2. Door size is fixed per program: Maestro does not move the planes when
// dx1/dy1/dz1 change, so build a program per size.
// Every boundary corner is an expression (the round tops are 16 straight segments, 0.05 off the true arc), so the
// cuts follow the Seal* / Plate* variables when Maestro recomputes. Stored toolpaths are for the build values.
//   npx tsx scripts/job/dropseal.ts TestingDoorReal.pgmx outDir [--length 1980] [--width 810] [--thick 38] [--name "..."]
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { Ids, blocks, cloneBlocks, renameStep, ln, setMembers, setTrajectory, setDesc, setGeoName, setDepth, setOpValue, splice, NS_PROJECT } from '../../src/engine/pgmx';
import { Expressions, geometryRef } from '../../src/engine/params';
import { blankProgram, planeId } from '../../src/ops/cabinet';
import { variableValues } from '../../src/engine/variables';
import { evaluate } from '../../src/engine/formula';
import { assertSafe } from '../../src/engine/validate';
import { pyRepr as r } from '../../src/engine/pyfmt';

const args = process.argv.slice(2);
const opt = (f: string, d: string) => { const i = args.indexOf(f); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const L = +opt('--length', '1980'), W = +opt('--width', '810'), T = +opt('--thick', '38');
const name = opt('--name', `DROP SEAL RP8Si ${L}x${W}x${T}`);
const [basePath, outDir] = args;
const A = readPgmx(basePath); const base = getXml(A);
const UTIL = 'http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Utility';

const VARS: [string, number][] = [['SealDepth', 34], ['SealWidth', 15], ['PlateWidth', 22.2], ['PlateHeight', 57.1], ['PlateDepth', 1.2]];
const E018 = { id: '2149904462', r: 6.25 };
const OUT = 14.5;            // boundary past the open edge: 2 * 6.25 + 2, so the cutter centre plunges 8.25 out
const SAFE = 50;             // template ApproachSecurityPlane / RetractSecurityPlane
const LEVEL = 8.5;           // mortice depth per level (34 in 4)
const N = 16;                // segments in a round top

const t0 = blankProgram(base, L, W, T, VARS);
const ids = new Ids(t0, base); const ex = new Expressions(t0, ids);
const V = variableValues(t0);
const tpl = blocks(base, 'Pocket');
const keyOf = (b: string) => /<Key[^>]*><ID>(\d+)<\/ID>/.exec(b)![1];
const depthEx = [...base.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0])
  .filter((e) => e.includes(`<b:ID>${keyOf(tpl[1])}</b:ID>`) && /<a:Name>(Start|End)Depth<\/a:Name>/.test(e));
if (depthEx.length !== 2) throw new Error('template depth expressions not found');
let en = Math.max(0, ...[...t0.matchAll(/\[Expression\]\((\d+)\)/g)].map((m) => +m[1])) + 1000;
const exprs: string[] = [];

type P = [number, number]; type Plane = 'Right' | 'Front' | 'Back';
/** plane point at depth d below the face -> world; and the inward direction */
const world = (pl: Plane, [x, y]: P, d: number): [number, number, number] =>
  pl === 'Right' ? [L - d, x, y] : pl === 'Front' ? [x, d, y] : [L - x, W - d, y];
const inward: Record<Plane, [number, number, number]> = { Right: [-1, 0, 0], Front: [0, 1, 0], Back: [0, -1, 0] };
const seg = (a: number[], b: number[]) => { const v = b.map((q, i) => q - a[i]); const n = Math.hypot(...v); return ln(a[0], a[1], a[2], v[0] / n, v[1] / n, v[2] / n, n); };

/** ring of [x expr, y expr] in plane coordinates (CCW) -> geometry records + element expressions */
function boundary(ring: [string, string][]) {
  const pts = ring.map(([x, y]) => [evaluate(x, V), evaluate(y, V)] as P);
  const recs: string[] = [];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; recs.push(seg([a[0], a[1], 0], [b[0], b[1], 0])); }
  return { pts, recs };
}

const steps: string[] = [], feats: string[] = [], geos: string[] = [], ops: string[] = [];
function pocket(step: string, geoName: string, pl: Plane, ring: [string, string][], depthVar: string, path: P[], levels: number[]) {
  let [st, fm, gm, om] = cloneBlocks(ids, tpl);
  const b = boundary(ring);
  gm = setGeoName(setMembers(ids, gm, b.recs), geoName).replace(/(<a:PlaneID[^>]*><b:ID>)\d+(<)/, `$1${planeId(t0, pl)}$2`);
  const depth = V[depthVar];
  fm = setDepth(setMembers(ids, fm, b.recs), depth);
  om = om.replace(/(<ToolKey[^>]*><b:ID>)\d+(<\/b:ID><b:ObjectType>[^<]*<\/b:ObjectType><b:Name>)E016(<)/, `$1${E018.id}$2E018$3`);
  if (!om.includes('<b:Name>E018<')) throw new Error('tool swap failed');
  om = setOpValue(setOpValue(om, 'RadialCuttingDepth', r(E018.r)), 'AxialCuttingDepth', r(levels[0]));
  // toolpath: the ring at each level, stepping down at its start point (outside the part)
  const recs: string[] = [];
  levels.forEach((d, i) => {
    if (i) recs.push(seg(world(pl, path[0], levels[i - 1]), world(pl, path[0], d)));
    for (let k = 0; k < path.length; k++) recs.push(seg(world(pl, path[k], d), world(pl, path[(k + 1) % path.length], d)));
  });
  om = setTrajectory(ids, om, recs);
  const n = inward[pl]; const s0 = world(pl, path[0], -SAFE), dl = levels[levels.length - 1];
  om = setDesc(om, 'Approach', ln(s0[0], s0[1], s0[2], n[0], n[1], n[2], SAFE + levels[0]), SAFE + levels[0]);
  const e0 = world(pl, path[0], dl);
  om = setDesc(om, 'TrajectoryPath' as 'Lift', ln(e0[0], e0[1], e0[2], -n[0], -n[1], -n[2], SAFE + dl), SAFE + dl);
  steps.push(renameStep(st, step, true)); feats.push(fm); geos.push(gm); ops.push(om);
  // expressions: depth, and every element's start / end
  for (const e of depthEx) {
    const [c] = cloneBlocks(ids, [e]);
    exprs.push(c.replace(/(<a:ReferencedObject[^>]*><b:ID>)\d+(<)/, `$1${keyOf(fm)}$2`).replace(/(<a:Value>)[^<]*(<)/, `$1${depthVar}$2`)
      .replace(/\[Expression\]\(\d+\)/, `[Expression](${en++})`));
  }
  const [gid, gtype] = geometryRef(gm);
  ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length];
    ex.element(i, 'StartX', gid, gtype, p[0]); ex.element(i, 'StartY', gid, gtype, p[1]);
    ex.element(i, 'EndX', gid, gtype, q[0]); ex.element(i, 'EndY', gid, gtype, q[1]); });
  return b.pts;
}

const f = (v: number) => v.toFixed(3);
// --- mortice in the bottom end (Right plane): open past both edges --------------------------------------------------
const mid = 'dz1/2';
pocket('E018 12.5mm - Drop seal mortice', 'RP8SiMortice', 'Right',
  [[`-${OUT}`, `${mid}-SealWidth/2`], [`dy1+${OUT}`, `${mid}-SealWidth/2`], [`dy1+${OUT}`, `${mid}+SealWidth/2`], [`-${OUT}`, `${mid}+SealWidth/2`]],
  'SealDepth',
  (() => { const o = OUT - E018.r, h = V.SealWidth / 2 - E018.r; return [[-o, T / 2 - h], [W + o, T / 2 - h], [W + o, T / 2 + h], [-o, T / 2 + h]] as P[]; })(),
  (() => { const n = Math.ceil(V.SealDepth / LEVEL - 1e-9); return Array.from({ length: n }, (_, i) => V.SealDepth * (i + 1) / n); })());

// --- escutcheon rebates: round top PlateHeight up from the bottom end, open past the end ---------------------------
function rebate(pl: 'Front' | 'Back') {
  // Front: plane x = X, the end is at dx1 and the plate runs to -x.  Back: plane x = dx1 - X, the end is at 0, plate to +x.
  const R = 'PlateWidth/2';
  const cx = pl === 'Front' ? 'dx1-PlateHeight+PlateWidth/2' : 'PlateHeight-PlateWidth/2';
  const open = pl === 'Front' ? `dx1+${OUT}` : `-${OUT}`;
  const a0 = pl === 'Front' ? 90 : 270;                 // CCW from the top (Front) / bottom (Back) round the far end
  const ring: [string, string][] = [];
  const yA = pl === 'Front' ? `${mid}+${R}` : `${mid}-${R}`, yB = pl === 'Front' ? `${mid}-${R}` : `${mid}+${R}`;
  ring.push([open, yA], [cx, yA]);
  for (let k = 1; k < N; k++) { const a = a0 + 180 * k / N; ring.push([`${cx}+${R}*Cos(${f(a)})`, `${mid}+${R}*Sin(${f(a)})`]); }
  ring.push([cx, yB], [open, yB]);
  // tool centre path: same shape inset by the cutter radius
  const rho = V.PlateWidth / 2 - E018.r, c = evaluate(cx, V), o = (pl === 'Front' ? L : 0) + (pl === 'Front' ? 1 : -1) * (OUT - E018.r);
  const ys = pl === 'Front' ? 1 : -1;
  const p: P[] = [[o, T / 2 + ys * rho], [c, T / 2 + ys * rho]];
  for (let k = 1; k < N; k++) { const a = (a0 + 180 * k / N) * Math.PI / 180; p.push([c + rho * Math.cos(a), T / 2 + rho * Math.sin(a)]); }
  p.push([c, T / 2 - ys * rho], [o, T / 2 - ys * rho]);
  pocket(`E018 12.5mm - Escutcheon rebate ${pl === 'Front' ? 'Y0' : 'Y1'} edge`, `RP8SiPlate${pl === 'Front' ? 'Y0' : 'Y1'}`, pl, ring, 'PlateDepth', p, [V.PlateDepth]);
}
rebate('Front'); rebate('Back');

const group = `<Executable i:type="a:ExecutableGroup" xmlns:a="${NS_PROJECT}"><Key xmlns="${UTIL}"><ID>${ids.take()}</ID>` +
  `<ObjectType>ScmGroup.XCam.MachiningDataModel.ProjectModule.ExecutableGroup</ObjectType></Key><Name xmlns="${UTIL}">RP8Si drop seal</Name>` +
  `<Description/><IsEnabled>true</IsEnabled><Priority>0</Priority><Elements>${steps.join('')}</Elements></Executable>`;
const park = t0.indexOf('<Executable i:type="Xn">'); const at = (tag: string) => t0.indexOf(`</${tag}>`);
const t1 = splice(t0, [[park, park, group], [at('Features'), at('Features'), feats.join('')], [at('Geometries'), at('Geometries'), geos.join('')],
  [at('Operations'), at('Operations'), ops.join('')], [at('Expressions'), at('Expressions'), exprs.join('') + ex.items.join('')]]);
assertSafe(t0, t1);
mkdirSync(outDir, { recursive: true });
writePgmx(A, t1, path.join(outDir, name + '.pgmx'), name);
console.log(`${name}: mortice ${V.SealWidth} x ${V.SealDepth} in the bottom end (X ${L}), rebates ${V.PlateWidth} x ${V.PlateHeight} x ${V.PlateDepth} on both edges; door ${L} x ${W} x ${T}`);
