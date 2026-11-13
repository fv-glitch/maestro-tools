// Read-only: every expression whose stored value we can read is compared with its formula evaluated on the current
// variables. A mismatch means the stored program (what the machine runs until Maestro recomputes) is out of date.
//   npx tsx scripts/job/stale.ts file.pgmx [--all]
import { readPgmx, getXml } from '../../src/engine/archive';
import { variableValues } from '../../src/engine/variables';
import { evaluate } from '../../src/engine/formula';
import { storedValue } from './exprs';

const [p, ...rest] = process.argv.slice(2);
const t = getXml(readPgmx(p)); const V = variableValues(t);
let ok = 0, bad = 0; const unchecked = new Map<string, number>();
for (const e of [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0])) {
  const s = storedValue(t, e);
  if (s.kind === 'variable') continue;
  if (s.kind === 'unknown') { unchecked.set(s.what, (unchecked.get(s.what) ?? 0) + 1); continue; }
  let v: number; try { v = evaluate(s.formula, V); } catch { unchecked.set('formula error: ' + s.what, 1); continue; }
  if (s.kind === 'bool') { const want = v !== 0; if (want === s.value) ok++; else { bad++; console.log(`STALE ${s.what}: stored ${s.value}, formula ${s.formula} = ${want}`); } continue; }
  if (Math.abs(v - s.value) < 1e-6) ok++;
  else { bad++; console.log(`STALE ${s.what}: stored ${s.value}, ${s.formula} = ${v}`); }
}
console.log(`${ok} up to date, ${bad} stale${rest.includes('--all') ? '; not checked: ' + [...unchecked].map(([k, n]) => `${k} x${n}`).join(', ') : `, ${[...unchecked.values()].reduce((a, b) => a + b, 0)} not checked`}`);
process.exitCode = bad ? 1 : 0;
