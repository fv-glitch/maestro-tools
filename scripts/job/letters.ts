// Pocketed letter programs on a square blank, from letters.json (scripts/job/letters/glyphs.py).
// Built on the emptied TestingDoorReal (cabinet.blankProgram) with clones of its proven 'Pocket' (E016 ContourParallel
// ClosedPocket) and 'Routing' (E017 corner pass, GeneralProfileFeature) and their depth expressions
// (Pocket: DummyDep, Routing: DummyDep-0.1 -> here LetterDepth, LetterDepth-0.1).
// A letter with counters is pocketed as overlapping island-free pieces (ClosedPocket with no bosses, the only form
// proven so far); the E017 pass then runs once round the letter and once round each counter, so walls and corners
// come out of one clean pass.
//   npx tsx scripts/job/letters.ts TestingDoorReal.pgmx letters.json outDir [--thick 18] [--depth 3] [--name "LETTER {ch} ITM 200x200"]
import { readFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { Ids, blocks, cloneBlocks, renameStep, ln, setMembers, setTrajectory, setDesc, setGeoName, setDepth, splice, NS_PROJECT } from '../../src/engine/pgmx';
import { blankProgram } from '../../src/ops/cabinet';
import { assertSafe } from '../../src/engine/validate';
import { pyRepr as r } from '../../src/engine/pyfmt';

type Pt = [number, number];
interface Node { ring: Pt[]; kids: Node[] }
interface Letter { outline: Pt[][]; profile: Pt[][]; pieces: { boundary: Pt[]; tree: Node[] }[] }

const args = process.argv.slice(2);
const opt = (f: string, d: string) => { const i = args.indexOf(f); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const T = +opt('--thick', '18'), D = +opt('--depth', '3'), nameFmt = opt('--name', 'LETTER {ch} ITM 200x200');
const [basePath, jsonPath, outDir] = args;
const A = readPgmx(basePath); const base = getXml(A);
const J = JSON.parse(readFileSync(jsonPath, 'utf8')) as { blank: number; height: number; letters: Record<string, Letter> };
const UTIL = 'http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Utility';

const tplPocket = blocks(base, 'Pocket'), tplRout = blocks(base, 'Routing');
const keyOf = (b: string) => /<Key[^>]*><ID>(\d+)<\/ID>/.exec(b)![1];
const depthExprs = (featId: string) => [...base.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0])
  .filter((e) => e.includes(`<b:ID>${featId}</b:ID>`) && /<a:Name>Depth<\/a:Name>/.test(e));
const exPocket = depthExprs(keyOf(tplPocket[1])), exRout = depthExprs(keyOf(tplRout[1]));
if (exPocket.length !== 2 || exRout.length !== 2) throw new Error('template depth expressions not found');

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** closed ring -> line records at height z (start form), from p0 round and back to p0 */
function ringRecs(ring: Pt[], z: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]; const L = dist(a, b); if (L < 1e-6) continue;
    out.push(ln(a[0], a[1], z, (b[0] - a[0]) / L, (b[1] - a[1]) / L, 0, L));
  }
  return out;
}
/** rotate a ring so it starts at the point on it nearest to p (inserting that point) */
function startNear(ring: Pt[], p: Pt): Pt[] {
  let best = { d: Infinity, i: 0, q: ring[0] as Pt };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]; const vx = b[0] - a[0], vy = b[1] - a[1]; const L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
    const q: Pt = [a[0] + t * vx, a[1] + t * vy]; const d = dist(p, q); if (d < best.d) best = { d, i, q };
  }
  const rest = [...ring.slice(best.i + 1), ...ring.slice(0, best.i + 1)];
  return [best.q, ...rest.filter((x) => dist(x, best.q) > 1e-6)];
}
function contains(ring: Pt[], p: Pt) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Inside-to-outside contour-parallel path for one piece: straight links into the enclosing ring, lifts between
 *  separate branches (a straight link there could leave the pocket). */
function pocketPath(tree: Node[], z: number, safe: number) {
  const recs: string[] = []; let cur: Pt | null = null; let start: Pt | null = null;
  const ringAt = (ring: Pt[], from: Pt | null) => startNear(ring, from ?? ring[0]);
  function visit(n: Node, parentDone: boolean) {
    void parentDone;
    n.kids.forEach((k) => visit(k, false));
    // reaching this ring: from its own last child (it encloses it) -> straight link; else from elsewhere -> lift
    const fromChild = cur !== null && n.kids.length > 0 && contains(n.ring, cur);
    const ring = ringAt(n.ring, cur);
    if (cur === null) start = ring[0];
    else if (fromChild) { const L = dist(cur, ring[0]); if (L > 1e-6) recs.push(ln(cur[0], cur[1], z, (ring[0][0] - cur[0]) / L, (ring[0][1] - cur[1]) / L, 0, L)); }
    else {
      const up = safe - z; recs.push(ln(cur[0], cur[1], z, 0, 0, 1, up));
      const L = dist(cur, ring[0]); if (L > 1e-6) recs.push(ln(cur[0], cur[1], safe, (ring[0][0] - cur[0]) / L, (ring[0][1] - cur[1]) / L, 0, L));
      recs.push(ln(ring[0][0], ring[0][1], safe, 0, 0, -1, up));
    }
    recs.push(...ringRecs(ring, z)); cur = ring[0];
  }
  tree.forEach((n) => visit(n, true));
  return { recs, start: start!, end: cur! };
}

/** TrajectoryPath's own description = the lift at the end (as in the TestingDoorReal pocket / routing). */
function setTrajDesc(om: string, desc: string, L: number) {
  return setDesc(om, 'TrajectoryPath' as 'Lift', desc, L);
}

mkdirSync(outDir, { recursive: true });
for (const [ch, Lt] of Object.entries(J.letters)) {
  const t0 = blankProgram(base, J.blank, J.blank, T, [['LetterDepth', D]]);
  const ids = new Ids(t0, base);
  let en = Math.max(0, ...[...t0.matchAll(/\[Expression\]\((\d+)\)/g)].map((m) => +m[1]));
  const steps: string[] = [], feats: string[] = [], geos: string[] = [], ops: string[] = [], exprs: string[] = [];
  const CLR = T + 50, safe = T + 5;
  const addExprs = (tpl: string[], featId: string, value: string) => {
    for (const e of tpl) {
      const [c] = cloneBlocks(ids, [e]);
      exprs.push(c.replace(/(<a:ReferencedObject[^>]*><b:ID>)\d+(<)/, `$1${featId}$2`).replace(/(<a:Value>)[^<]*(<)/, `$1${value}$2`)
        .replace(/\[Expression\]\(\d+\)/, `[Expression](${++en})`));
    }
  };
  // E016 pockets, one per island-free piece
  const z = T - D;
  Lt.pieces.forEach((pc, i) => {
    let [st, fm, gm, om] = cloneBlocks(ids, tplPocket);
    const recs = ringRecs(pc.boundary, 0);
    gm = setGeoName(setMembers(ids, gm, recs), `Letter${ch}Piece${i + 1}`);
    fm = setDepth(setMembers(ids, fm, recs), D);
    const p = pocketPath(pc.tree, z, safe);
    om = setTrajectory(ids, om, p.recs);
    om = setDesc(om, 'Approach', ln(p.start[0], p.start[1], CLR, 0, 0, -1, CLR - z), CLR - z);
    om = setTrajDesc(om, ln(p.end[0], p.end[1], z, 0, 0, 1, CLR - z), CLR - z);
    steps.push(renameStep(st, `E016 8mm - Pocket ${ch}${i + 1}`, true)); feats.push(fm); geos.push(gm); ops.push(om);
    addExprs(exPocket, keyOf(fm), 'LetterDepth');
  });
  // E017 pass round the letter and each counter (tool on the letter side: outline CCW / counters CW, side Left)
  const zp = T - (D - 0.1);
  Lt.outline.forEach((ring, j) => {
    let [st, fm, gm, om] = cloneBlocks(ids, tplRout);
    const recs = ringRecs(ring, 0);
    gm = setGeoName(setMembers(ids, gm, recs), `Letter${ch}Edge${j + 1}`);
    const keys = [.../_serializingKeys[^>]*>(.*?)<\/\w+:_serializingKeys>/s.exec(gm)![1].matchAll(/>(\d+)</g)].map((m) => m[1]);
    // longest element = where Maestro starts (MiddleOfMostLengthElement)
    let k = 0, best = -1;
    for (let i = 0; i < ring.length; i++) { const L = dist(ring[i], ring[(i + 1) % ring.length]); if (L > best) { best = L; k = i; } }
    const mid: Pt = [(ring[k][0] + ring[(k + 1) % ring.length][0]) / 2, (ring[k][1] + ring[(k + 1) % ring.length][1]) / 2];
    // its tool path: the profile ring nearest this outline ring, started opposite the middle of the longest element
    const bb = (q: Pt[]) => [Math.min(...q.map((x) => x[0])), Math.min(...q.map((x) => x[1])), Math.max(...q.map((x) => x[0])), Math.max(...q.map((x) => x[1]))];
    const rb = bb(ring);
    const prof = Lt.profile.map((q) => ({ q, d: bb(q).reduce((s, v, i) => s + Math.abs(v - rb[i]), 0) })).sort((a, b) => a.d - b.d)[0].q;
    const pr = startNear(prof, mid);
    om = om.replace(/(<(StartMachiningPoint|EndMachiningPoint)[^>]*>(?:(?!<\/\2>).)*?<\w+:ElementKey[^>]*><\w+:ID>)\d+(<)/gs, `$1${keys[k]}$3`)
      .replace(/<StartMachiningPointPosition>\w+</, '<StartMachiningPointPosition>MiddleOfMostLengthElement<');
    om = setTrajectory(ids, om, ringRecs(pr, zp));
    om = setDesc(om, 'Approach', ln(pr[0][0], pr[0][1], CLR, 0, 0, -1, CLR - zp), CLR - zp);
    om = setTrajDesc(om, ln(pr[0][0], pr[0][1], zp, 0, 0, 1, CLR - zp), CLR - zp);
    fm = setDepth(fm, D - 0.1);
    if ((om.match(new RegExp(`ElementKey[^>]*><\\w+:ID>${keys[k]}<`, 'g')) ?? []).length !== 2) throw new Error('start / end point keys not set');
    steps.push(renameStep(st, `E017 3mm - ${j ? 'Counter' : 'Outline'} ${ch}${j ? j : ''}`, true)); feats.push(fm); geos.push(gm); ops.push(om);
    addExprs(exRout, keyOf(fm), 'LetterDepth-0.1');
  });
  const group = `<Executable i:type="a:ExecutableGroup" xmlns:a="${NS_PROJECT}"><Key xmlns="${UTIL}"><ID>${ids.take()}</ID>` +
    `<ObjectType>ScmGroup.XCam.MachiningDataModel.ProjectModule.ExecutableGroup</ObjectType></Key><Name xmlns="${UTIL}">Letter ${ch}</Name>` +
    `<Description/><IsEnabled>true</IsEnabled><Priority>0</Priority><Elements>${steps.join('')}</Elements></Executable>`;
  const park = t0.indexOf('<Executable i:type="Xn">'); const at = (tag: string) => t0.indexOf(`</${tag}>`);
  const t1 = splice(t0, [[park, park, group], [at('Features'), at('Features'), feats.join('')], [at('Geometries'), at('Geometries'), geos.join('')],
    [at('Operations'), at('Operations'), ops.join('')], [at('Expressions'), at('Expressions'), exprs.join('')]]);
  assertSafe(t0, t1);
  const name = nameFmt.replace('{ch}', ch);
  writePgmx(A, t1, path.join(outDir, name + '.pgmx'), name);
  console.log(`${name}: ${Lt.pieces.length} pocket piece(s), ${Lt.outline.length} E017 pass(es); ${J.height} tall, depth LetterDepth ${D}, board ${T}`);
}
void r;
