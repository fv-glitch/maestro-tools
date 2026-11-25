// Turn plain (top-level, non-macro) machining steps off, e.g. saw cuts that run as a separate program, or a magnet bore.
// Refuses a step whose IsEnabled is driven by an expression (Maestro would turn it back on) unless --expr-off,
// which sets that formula to 0=1 (always false, the owner's own idiom).
//   npx tsx scripts/job/stepsoff.ts src.pgmx out.pgmx "Name" "Step name" ["Step name" ...] [--expr-off]
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
import { splice } from './lib';

export function stepsOff(t: string, names: string[], exprOff = false) {
  const vsp = [...t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>\d+<\/ID>/g)].map((m) => [m.index!, t.indexOf('</FileName></Executable>', m.index!)] as const);
  const edits: [number, number, string][] = [];
  for (const nm of names) {
    const ms = [...t.matchAll(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>(\d+)<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)<\/IsEnabled>/g)]
      .filter((m) => m[2] === nm && !vsp.some(([a, b]) => a < m.index! && m.index! < b));
    if (ms.length !== 1) throw new Error(`plain step ${nm}: ${ms.length} found`);
    const m = ms[0];
    const ex = [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].filter((e) => e[0].includes(`<b:ID>${m[1]}</b:ID>`) && e[0].includes('<a:Name>IsEnabled</a:Name>'));
    if (ex.length && !exprOff) throw new Error(`${nm}: IsEnabled is driven by an expression (--expr-off sets its formula to 0=1)`);
    for (const e of ex) {
      // the owner's own idiom for a step that is never on: a formula that is always false
      const v = /<a:Value>([^<]*)<\/a:Value>/.exec(e[0]); if (!v) throw new Error(`${nm}: expression has no value`);
      const p = e.index! + v.index! + '<a:Value>'.length; edits.push([p, p + v[1].length, '0=1']);
    }
    if (m[3] === 'false') continue;
    const p = m.index! + m[0].length - '</IsEnabled>'.length - 4; edits.push([p, p + 4, 'false']);
  }
  return splice(t, edits);
}

if (process.argv[1]?.endsWith('stepsoff.ts')) {
  const args = process.argv.slice(2); const exprOff = args.includes('--expr-off');
  const [src, out, name, ...names] = args.filter((x) => x !== '--expr-off');
  const a = readPgmx(src); const t = getXml(a); const nt = stepsOff(t, names, exprOff);
  assertSafe(t, nt); writePgmx(a, nt, out, name); console.log(name, 'off:', names.join(', '));
}
