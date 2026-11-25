// read-only: list macro instances (name, enabled, file) of a program
import { readPgmx, getXml } from '../../src/engine/archive';
const t = getXml(readPgmx(process.argv[2]));
for (const m of t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>(\d+)<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)<\/IsEnabled>/g)) {
  const end = t.indexOf('</FileName></Executable>', m.index!);
  const fn = /<FileName>([^<]*)$/.exec(t.slice(m.index!, end))?.[1] ?? '';
  console.log(`${m[3].padEnd(6)} ${m[2].padEnd(36)} ${fn}`);
}
