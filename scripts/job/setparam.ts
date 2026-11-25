// Set macro instance parameters (by instance name and parameter name) with a surgical splice.
// The instance's expanded steps are NOT recomputed: the output must be opened and saved in Maestro, which re-expands
// the instance from the macro with the new parameters. Refuses parameters driven by an expression (Maestro would
// overwrite them).
//   npx tsx scripts/job/setparam.ts src.pgmx out.pgmx "Name" "Instance" Param=value ...
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
import { splice } from './lib';
import { vspBlock } from './exprs';
const [src, out, name, inst, ...kv] = process.argv.slice(2);
const a = readPgmx(src); const t = getXml(a);
const ms = [...t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>(\d+)<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name>/g)].filter((m) => m[2] === inst);
if (ms.length !== 1) throw new Error(`${inst}: ${ms.length} instances`);
const b = vspBlock(t, ms[0][1])!;
const ps = b.text.indexOf('<Parameters>'); const pe = b.text.indexOf('</Parameters>', ps);
const items = [...b.text.slice(ps, pe).matchAll(/<SubProgramParameter>.*?<\/SubProgramParameter>/gs)];
const edits: [number, number, string][] = []; const log: string[] = [];
for (const s of kv) {
  const [k, v] = s.split('=');
  const idx = items.findIndex((it) => new RegExp(`<Name>${k}</Name>`).test(it[0])); if (idx < 0) throw new Error(`no parameter ${k}`);
  const driven = [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].some((e) => e[0].includes(`<b:ID>${ms[0][1]}</b:ID>`) && new RegExp(`<a:Index>${idx}</a:Index>`).test(e[0]) && /Parameters/.test(e[0]));
  if (driven) throw new Error(`${k} is driven by an expression`);
  const it = items[idx]; const vm = /(<_serializedValue[^>]*>)([^<]*)</.exec(it[0])!;
  const at = b.start + ps + it.index! + vm.index + vm[1].length; edits.push([at, at + vm[2].length, v]); log.push(`${k}: ${vm[2]} -> ${v}`);
}
const x = splice(t, edits); assertSafe(t, x); writePgmx(a, x, out, name);
console.log(`${name}: ${inst} ${log.join(', ')} (REBUILD IN MAESTRO: expanded steps still the old size)`);
