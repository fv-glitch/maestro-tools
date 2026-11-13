// Set input variables on a jamb and carry the change through to macro instances placed by
// ModifyInfos.CoordinateX/Y expressions (stored value + expanded geometry/toolpaths moved; features stay macro-local).
// Any other expression that changes value is refused, so nothing is left stale.
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { setVariables, variableValues, expressions } from '../../src/engine/variables';
import { evaluate } from '../../src/engine/formula';
import { assertSafe } from '../../src/engine/validate';
import { stepBlocks, translateGeometry, translateOperation, splice, one, r6 } from './lib';

const [src, out, name, ...kv] = process.argv.slice(2);
const inputs = Object.fromEntries(kv.map((s) => { const [k, v] = s.split('='); return [k, +v]; }));
const a = readPgmx(src); const orig = getXml(a);
const before = variableValues(orig);
const t = setVariables(orig, inputs).xml; const after = variableValues(t);
const VSP = [...t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>(\d+)<\/ID>.*?<Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)/gs)];
const edits: [number, number, string][] = []; const report: string[] = [];
for (const e of expressions(t)) {
  let o: number, n: number;
  try { o = evaluate(e.formula, before); n = evaluate(e.formula, after); } catch { continue; }
  if (o === n) continue;
  if (/WorkPiece|Variable/.test(e.refType)) continue;
  const m = /^ModifyInfos\.Coordinate([XY])$/.exec(e.property);
  if (!/VisualSubProgram/.test(e.refType) || !m) throw new Error(`${e.refType} ${e.property} = ${e.formula} changes ${o} -> ${n}; not handled`);
  const i = VSP.findIndex((v) => v[1] === e.refId); const s = VSP[i].index!, end = t.indexOf('</FileName></Executable>', s);
  const inst = t.slice(s, end); const nm = VSP[i][2]; const en = VSP[i][3] === 'true';
  const fm = one(new RegExp(`(<ModifyInfos>(?:<CoordinateX>[^<]*</CoordinateX>)?${m[1] === 'X' ? '<CoordinateX>' : '<CoordinateY>'})([^<]+)(<)`), inst, nm + ' coord');
  if (Math.abs(+fm[2] - o) > 1e-6) throw new Error(`${nm}: stored ${fm[2]} is not ${o}`);
  const p = s + fm.index! + fm[1].length; edits.push([p, p + fm[2].length, r6(n)]);
  const d = n - o, dx = m[1] === 'X' ? d : 0, dy = m[1] === 'Y' ? d : 0; let k = 0;
  const es = inst.indexOf('<Elements>');
  if (es >= 0 && es < 3000) {
    const b = stepBlocks(t, inst.slice(es, inst.indexOf('</Elements>')));
    const put = (blk: string, nb: string) => { const at = t.indexOf(blk); if (at < 0 || t.indexOf(blk, at + 1) >= 0) throw new Error('block not unique'); edits.push([at, at + blk.length, nb]); };
    for (const g of b.geometries) put(g, translateGeometry(g, dx, dy));
    for (const op of b.operations) put(op, translateOperation(op, dx, dy, 0));
    k = b.steps.length;
  }
  report.push(`${nm}${en ? '' : ' (off)'}: ${e.property} ${o} -> ${n}${k ? `, ${k} steps moved` : ''}`);
}
const nt = splice(t, edits);
assertSafe(orig, nt);
writePgmx(a, nt, out, name);
console.log(name + '\n  ' + report.join('\n  '));
