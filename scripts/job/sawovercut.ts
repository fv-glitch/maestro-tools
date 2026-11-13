// Change the overcut (how far a saw cut runs past the bottom of the part, measured along the blade) of named saw cuts,
// keeping the stored toolpath in step: the cut moves along its plunge direction, the approach and lift get longer by
// the same amount and still start / end at the same height. For a 45 deg mitre the overcut has to cover T / sin 45,
// so the owner's JambThickness+9 (right for 19) is short for thicker jambs.
//   npx tsx scripts/job/sawovercut.ts src.pgmx out.pgmx "Name" "JambThickness/Sin(45)+2" "Step A" ["Step B" ...]
//   [Var=value ...] sets variables first (no derived variable may depend on them)
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
import { setVariables, variableValues } from '../../src/engine/variables';
import { evaluate } from '../../src/engine/formula';
import { stepBlocks, splice, g18 } from './lib';

const args = process.argv.slice(2);
const sets = Object.fromEntries(args.filter((x) => /^\w+=[-\d.]+$/.test(x)).map((x) => { const [k, v] = x.split('='); return [k, +v]; }));
const [src, out, name, formula, ...names] = args.filter((x) => !/^\w+=[-\d.]+$/.test(x));
const a = readPgmx(src); const orig = getXml(a); let t = orig;
if (Object.keys(sets).length) t = setVariables(t, sets).xml;
const V = variableValues(t);
const ov = evaluate(formula, V);
const enc = formula.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const edits: [number, number, string][] = [];
const exprs = [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)];
for (const nm of names) {
  const ms = [...t.matchAll(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>(\d+)<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name>.*?<\/Executable>/gs)].filter((m) => m[2] === nm);
  if (ms.length !== 1) throw new Error(`${nm}: ${ms.length} found`);
  const o = stepBlocks(t, ms[0][0]).operations[0];
  const oid = /<Key[^>]*><ID>(\d+)<\/ID>/.exec(o)![1];
  const old = +/<OvercutLength>([^<]+)</.exec(o)![1]; const d = ov - old;
  // records: approach (start fixed, longer), cut (moves along the plunge), lift (start moves, longer)
  const recs = [...o.matchAll(/Description>8 0 (\S+)\n1 ((?:\S+ ){6})/g)];
  if (recs.length !== 3) throw new Error(`${nm}: toolpath is not approach / cut / lift`);
  const ap = recs[0][2].trim().split(' ').map(Number); const dir = ap.slice(3, 6);
  let k = 0;
  const no = o.replace(/<OvercutLength>[^<]+</, `<OvercutLength>${g18(ov)}<`)
    .replace(/Description>8 0 (\S+)\n1 ((?:\S+ ){6})/g, (_m, L, body) => {
      const r = body.trim().split(' ').map(Number); const i = k++;
      if (i === 0) return `Description>8 0 ${g18(+L + d)}\n1 ${body}`;
      const p = [r[0] + d * dir[0], r[1] + d * dir[1], r[2] + d * dir[2]];
      return `Description>8 0 ${i === 1 ? L : g18(+L + d)}\n1 ${[...p, ...r.slice(3)].map(g18).join(' ')} `;
    });
  k = 0;
  const no2 = no.replace(/(<c:_secondParameter>)([^<]+)(<)/g, (m, p, v, q) => { const i = k++; return i === 1 ? m : p + g18((+recs[i === 0 ? 0 : 2][1] + d) / 2) + q; });
  const at = t.indexOf(o); edits.push([at, at + o.length, no2]);
  const ex = exprs.filter((e) => e[0].includes(`<b:ID>${oid}</b:ID>`) && e[0].includes('<a:Name>OvercutLength</a:Name>'));
  if (ex.length !== 1) throw new Error(`${nm}: overcut expression ${ex.length}`);
  edits.push([ex[0].index!, ex[0].index! + ex[0][0].length, ex[0][0].replace(/(<a:Value>)[^<]*(<\/a:Value>)/, `$1${enc}$2`)]);
  console.log(`${nm}: overcut ${old} -> ${g18(ov)} (cut moves ${g18(d)} along the plunge, ${g18(d * dir[2])} in Z)`);
}
const nt = splice(t, edits);
assertSafe(orig, nt);
writePgmx(a, nt, out, name);
