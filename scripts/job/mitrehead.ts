// Mitred jamb head from a leg mitre program (JAMBCUT ... Cut Mitre): both ends 45 deg, inside face up.
//   right end = the leg's own top mitre cut, moved (part on the -X side, long point on the bottom face)
//   left end  = the same cut turned 180 deg about Z (part on the +X side), so the saw does exactly what it does
//               on the leg, only from the other side: same side-of-feature, same travel sense, same 0.7 skew
// Short points (inside face, Z top) are DoorWidth + Gap apart: the opening between the legs, as in the owner's
// 'Jamb Heads Core File' (square head = shiftcut .. shiftcut + DoorWidth + 6 + 2 JambThickness).
// The leg's line is the waste-side kerf edge on the top face, so each line sits one kerf (3.15 / sin 45) outside
// its short point. Cut = 4 turns the square foot cut off (its IsEnabled is Cut=1 Or Cut=3).
// Maestro adds the left cut's OperationGenerated plane when the file is saved (not cloned: it holds a copy of the
// geometry Key ID).
//   npx tsx scripts/job/mitrehead.ts leg-mitre.pgmx out.pgmx "Name" --door 810 [--gap 6]
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { Ids, cloneBlocks } from '../../src/engine/pgmx';
import { assertSafe } from '../../src/engine/validate';
import { setVariables, variableValues } from '../../src/engine/variables';
import { evaluate } from '../../src/engine/formula';
import { stepBlocks, splice, one, g18 } from './lib';

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => { const i = args.indexOf(f); if (i < 0) { if (d === undefined) throw new Error('missing ' + f); return d; } const v = args[i + 1]; args.splice(i, 2); return v; };
const door = +opt('--door'); const gap = opt('--gap', '6');
const [src, out, name] = args;
const a = readPgmx(src); const orig = getXml(a); let t = orig;
const ids = new Ids(t);
const esc = (s: string) => s.replace(/[()[\]+.*?^$|\\]/g, '\\$&');

// ---- DoorWidth variable (cloned from doorlength, placed before it, as in the Core File)
if (/<Name[^>]*>DoorWidth<\/Name>/.test(t)) throw new Error('already has DoorWidth');
const dl = one(/<a:Variable><Key[^>]*><ID>\d+<\/ID>(?:(?!<\/a:Variable>).)*?<Name[^>]*>doorlength<\/Name>.*?<\/a:Variable>/s, t, 'doorlength variable');
const dw = cloneBlocks(ids, [dl[0]])[0].replace(/(<Name[^>]*>)doorlength</, '$1DoorWidth<').replace(/(<a:Value i:type="b:double"[^>]*>)[^<]*(<)/, `$1${door}$2`);
t = splice(t, [[dl.index!, dl.index!, dw]]);

// ---- the leg's mitre cut
const stepRe = (nm: string) => new RegExp('<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>(\\d+)</ID><ObjectType>[^<]*</ObjectType></Key><Name[^>]*>' + esc(nm) + '</Name>.*?</Executable>', 's');
const sm = one(stepRe('Cut with blade(1)(1)'), t, 'mitre step');
const b = stepBlocks(t, sm[0]);
const st = b.steps[0], fe = b.features[0], ge = b.geometries[0], op = b.operations[0];
if (!/<a:Angle>0\.78539816339744/.test(fe) || !/<SideOfFeature>Left</.test(fe) || !/<IsGeomSameDirection>false</.test(fe)) throw new Error('mitre cut is not the 45 deg Left / reversed cut this was worked out for');
const gid = one(/<Key[^>]*><ID>(\d+)<\/ID>/, ge, 'gid')[1];
const ex = [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0]);
const refOf = (e: string) => one(/<a:ReferencedObject[^>]*><b:ID>(\d+)</, e, 'ref')[1];
const propOf = (e: string) => one(/<a:Name>([^<]*)<\/a:Name><\/a:Property>/, e, 'prop')[1];
const stepIds = [sm[1], ...[fe, ge, op].map((x) => one(/<Key[^>]*><ID>(\d+)<\/ID>/, x, 'id')[1])];
const own = ex.filter((e) => stepIds.includes(refOf(e)));
const geomExpr = (p: string) => own.find((e) => refOf(e) === gid && propOf(e) === p)!;
const val = (e: string) => one(/<a:Value>([^<]*)<\/a:Value>/, e, 'value')[1];
// line record: "8 0 L\n1 x y z dx dy dz "
const line = (g: string) => { const m = one(/Description>8 0 (\S+)\n1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) /, g, 'line'); return m.slice(1).map(Number); };
const [L, x0, y0, , ux, uy] = line(ge);
const skew = L * ux; // the leg's 0.7: EndX - StartX
if (Math.abs(skew - 0.7) > 1e-6 || Math.abs(y0 + 200) > 1e-9) throw new Error(`unexpected leg line ${x0} ${y0} skew ${skew}`);

// new formulas (StartX at y = -200, EndX at y = dy1 + 250, as on the leg)
const kerf = '3.15/Sin(45)';
const R = `shiftcut+JambThickness+DoorWidth+${gap}+${kerf}`;        // right line at the far end
const Lx = `shiftcut+JambThickness-${kerf}`;                         // left line at y = dy1+250 (its start)
const V = { ...variableValues(t), DoorWidth: door };
const rStart = evaluate(`${R}-0.7`, V), lStart = evaluate(Lx, V);
const dx = rStart - x0;

// ---- right end: move the leg cut
const fmtRec = (r: number[]) => r.map((v) => g18(v)).join(' ');
const moveRecs = (s: string, f: (r: number[]) => number[]) => s.replace(/((?:Description>|string>)8 \S+ \S+\n)1 ((?:\S+ ){6})/g, (_m, h, body) => h + '1 ' + fmtRec(f(body.trim().split(' ').map(Number))) + ' ');
const shift = (r: number[]) => [r[0] + dx, r[1], r[2], r[3], r[4], r[5]];
const geR = moveRecs(ge, shift), opR = moveRecs(op, shift);
const setVal = (e: string, v: string) => e.replace(/(<a:Value>)[^<]*(<\/a:Value>)/, `$1${v}$2`);
const exR = new Map([[geomExpr('StartX'), setVal(geomExpr('StartX'), `${R}-0.7`)], [geomExpr('EndX'), setVal(geomExpr('EndX'), R)]]);
// its generated plane (Maestro would move it on save; keep it with the cut)
const gp = one(new RegExp('<Plane i:type="PlaneGenerated"[^>]*><Key[^>]*><ID>\\d+</ID>(?:(?!</Plane>).)*?<GeneratorKey[^>]*><a:ID>' + sm[1] + '</a:ID>.*?</Plane>', 's'), t, 'generated plane');
const gpR = moveRecs(gp[0], shift).replace(/(<a:_xP>)([^<]+)(<)/, (_m, p, v, q) => p + String(+v + dx) + q);

// ---- left end: the right end turned 180 deg about Z through (cx, cy)
const cy = (y0 + (y0 + L * uy)) / 2, cx = (lStart + rStart) / 2;
const turn = (r: number[]) => [2 * cx - r[0], 2 * cy - r[1], r[2], -r[3], -r[4], r[5]];
const [sL, fL, gL, oL, ...eL] = cloneBlocks(ids, [st, fe, geR, opR, ...own.map((e) => exR.get(e) ?? e)]);
// the turned line runs from y = dy1+250 to y = -200: swap the Y formulas, new X formulas
const gidL = one(/<Key[^>]*><ID>(\d+)<\/ID>/, gL, 'gidL')[1];
const yS = val(geomExpr('StartY')), yE = val(geomExpr('EndY'));
let en = Math.max(0, ...[...t.matchAll(/>\[Expression\]\((\d+)\)</g)].map((m) => +m[1]));
const exL = eL.map((e) => {
  if (refOf(e) === gidL) {
    const p = propOf(e);
    e = setVal(e, { StartX: Lx, EndX: `${Lx}-0.7`, StartY: yE, EndY: yS }[p] ?? val(e));
  }
  return e.replace(/\[Expression\](\(\d+\))?/, `[Expression](${++en})`);
});
if (exL.filter((e) => refOf(e) === gidL).length !== 4) throw new Error('left line: expected 4 expressions');
// the turned line's record: the right line's start turned is the left line's start (y = dy1+250)
const gLt = moveRecs(gL, turn);
const oLt = moveRecs(oL, turn);
const nameStep = (s: string, nm: string) => s.replace(/(<Name[^>]*>)[^<]*(<\/Name><Description\/>)/, `$1${nm}$2`);

// ---- splice
const at = (tag: string) => t.indexOf(`</${tag}>`);
const edits: [number, number, string][] = [
  [sm.index!, sm.index! + sm[0].length, nameStep(sL, 'Head Mitre Left') + nameStep(st, 'Head Mitre Right')],
  [t.indexOf(ge), t.indexOf(ge) + ge.length, geR],
  [t.indexOf(op), t.indexOf(op) + op.length, opR],
  [gp.index!, gp.index! + gp[0].length, gpR],
  ...[...exR].map(([o, n]) => [t.indexOf(o), t.indexOf(o) + o.length, n] as [number, number, string]),
  [at('Features'), at('Features'), fL], [at('Geometries'), at('Geometries'), gLt], [at('Operations'), at('Operations'), oLt],
  [at('Expressions'), at('Expressions'), exL.join('')],
];
t = splice(t, edits);
// Cut = 4: mitre cuts only (the square foot cut is Cut=1 Or Cut=3)
const sv = setVariables(t, { Cut: 4 }); t = sv.xml;
const foot = one(stepRe('Cut with blade'), t, 'foot cut');
if (!foot[0].includes('<IsEnabled>true</IsEnabled>')) throw new Error('foot cut already off');
t = splice(t, [[foot.index!, foot.index! + foot[0].length, foot[0].replace('<IsEnabled>true</IsEnabled>', '<IsEnabled>false</IsEnabled>')]]);
assertSafe(orig, t);
writePgmx(a, t, out, name);
const k = 3.15 / Math.sin(Math.PI / 4);
console.log(`${name}: DoorWidth ${door}, left line ${g18(lStart)} (y ${yE}), right line ${g18(rStart)} (y -200); short points ${g18(lStart + k)} .. ${g18(rStart + 0.7 - k)} = ${g18(rStart + 0.7 - k - lStart - k)}`);
