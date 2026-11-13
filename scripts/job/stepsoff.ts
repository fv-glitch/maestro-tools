// Turn plain (top-level, non-macro) machining steps off, e.g. saw cuts that run as a separate program, or a magnet bore.
// Refuses a step whose IsEnabled is driven by an expression (Maestro would turn it back on).
//   npx tsx scripts/job/stepsoff.ts src.pgmx out.pgmx "Name" "Step name" ["Step name" ...]
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
import { splice } from './lib';

export function stepsOff(t: string, names: string[]) {
  const vsp = [...t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>\d+<\/ID>/g)].map((m) => [m.index!, t.indexOf('</FileName></Executable>', m.index!)] as const);
  const edits: [number, number, string][] = [];
  for (const nm of names) {
    const ms = [...t.matchAll(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>(\d+)<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)<\/IsEnabled>/g)]
      .filter((m) => m[2] === nm && !vsp.some(([a, b]) => a < m.index! && m.index! < b));
    if (ms.length !== 1) throw new Error(`plain step ${nm}: ${ms.length} found`);
    const m = ms[0];
    if ([...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].some((e) => e[0].includes(`<b:ID>${m[1]}</b:ID>`) && e[0].includes('<a:Name>IsEnabled</a:Name>'))) throw new Error(`${nm}: IsEnabled is driven by an expression`);
    if (m[3] === 'false') continue;
    const p = m.index! + m[0].length - '</IsEnabled>'.length - 4; edits.push([p, p + 4, 'false'.slice(0, 5)]);
  }
  // 'true' (4) -> 'false' (5)
  return splice(t, edits.map(([a, b]) => [a, b, 'false']));
}

if (process.argv[1]?.endsWith('stepsoff.ts')) {
  const [src, out, name, ...names] = process.argv.slice(2);
  const a = readPgmx(src); const t = getXml(a); const nt = stepsOff(t, names);
  assertSafe(t, nt); writePgmx(a, nt, out, name); console.log(name, 'off:', names.join(', '));
}
