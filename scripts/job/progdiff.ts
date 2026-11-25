// read-only: compare the stored machining of two programs (ours vs Maestro's): per enabled step (by name, in order),
// every toolpath record (x y z), line lengths, feature depths; plus variables, workpiece box and planes. Numeric tolerance 1e-6.
import { readPgmx, getXml } from '../../src/engine/archive';
import { variableValues } from '../../src/engine/variables';
import { stepBlocks } from './lib';
const [fa, fb] = process.argv.slice(2);
function load(f: string) {
  const t = getXml(readPgmx(f));
  const steps: { name: string; recs: number[][]; depth: string; geom: number[] }[] = [];
  for (const m of t.matchAll(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>true<\/IsEnabled>.*?<\/Executable>/gs)) {
    const b = stepBlocks(t, m[0]); if (!b.operations.length) continue;
    const op = b.operations[0];
    const recs = [...op.matchAll(/(?:Description|string)>8 (\S+) (\S+)\n([12]) (\S+) (\S+) (\S+) /g)].map((r) => [+r[1], +r[2], +r[4], +r[5], +r[6]]);
    const depth = (/<Depth>.*?<\/Depth>/s.exec(b.features[0] ?? '')?.[0] ?? '').replace(/<[^>]+>/g, ' ').trim().replace(/\s+/g, ' ');
    const geom = [...(b.geometries[0] ?? '').matchAll(/Description>[^<]*/g)].flatMap((g) => g[0].split(/[\s>]+/).slice(1).map(Number).filter((x) => !isNaN(x)));
    steps.push({ name: m[1], recs, depth, geom });
  }
  const wp = (/<WorkPiece>.*?<\/WorkPiece>/s.exec(t)?.[0] ?? '').match(/<(?:\w+:)?(Length|Width|Depth)>[^<]+/g)?.join(' ');
  const planes = [...t.slice(t.indexOf('<Planes>'), t.indexOf('</Planes>')).matchAll(/<(XDimension|YDimension|a:_xP|a:_yP|a:_zP)>([^<]+)</g)].map((x) => `${x[1]}=${x[2]}`).join(' ');
  return { steps, vars: variableValues(t), wp, planes };
}
const A = load(fa), B = load(fb); let bad = 0;
const say = (s: string) => { bad++; console.log(s); };
if (A.steps.length !== B.steps.length) say(`enabled steps ${A.steps.length} vs ${B.steps.length}`);
A.steps.forEach((s, i) => {
  const o = B.steps[i]; if (!o) return; if (s.name !== o.name) say(`step ${i}: ${s.name} vs ${o.name}`);
  if (s.depth !== o.depth) say(`${s.name}: depth ${s.depth} vs ${o.depth}`);
  if (s.recs.length !== o.recs.length) { say(`${s.name}: ${s.recs.length} vs ${o.recs.length} toolpath records`); return; }
  let w = 0; s.recs.forEach((r, j) => r.forEach((v, k) => { w = Math.max(w, Math.abs(v - o.recs[j][k])); }));
  if (w > 1e-6) say(`${s.name}: toolpath max diff ${w}`);
  let g = 0; if (s.geom.length === o.geom.length) s.geom.forEach((v, k) => { g = Math.max(g, Math.abs(v - o.geom[k])); }); else g = Infinity;
  if (g > 1e-6) say(`${s.name}: geometry max diff ${g}`);
});
for (const k of new Set([...Object.keys(A.vars), ...Object.keys(B.vars)])) if (Math.abs((A.vars[k] ?? NaN) - (B.vars[k] ?? NaN)) > 1e-9 && !(isNaN(A.vars[k]) && isNaN(B.vars[k]))) say(`var ${k}: ${A.vars[k]} vs ${B.vars[k]}`);
if (A.wp !== B.wp) say(`workpiece ${A.wp} | ${B.wp}`);
if (A.planes !== B.planes) say(`planes differ:\n  ${A.planes}\n  ${B.planes}`);
console.log(bad ? `${bad} differences` : `MATCH: ${A.steps.length} enabled steps, all toolpaths/geometry/depths within 1e-6, variables, box and planes equal`);
