// read-only: find programs (under a folder, modified since a date) with an ENABLED macro instance whose file name matches a regex
import { readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { readPgmx, getXml } from '../../src/engine/archive';
const [root, re, since] = process.argv.slice(2); const rx = new RegExp(re, 'i'); const t0 = since ? Date.parse(since) : 0;
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.toLowerCase().endsWith('.pgmx') ? [path.join(d, e.name)] : []);
for (const f of walk(root)) {
  const st = statSync(f); if (st.mtimeMs < t0) continue;
  let t: string; try { t = getXml(readPgmx(f)); } catch { continue; }
  const hits: string[] = [];
  for (const m of t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>true<\/IsEnabled>/g)) {
    const end = t.indexOf('</FileName></Executable>', m.index!); const fn = /<FileName>([^<]*)$/.exec(t.slice(m.index!, end))?.[1] ?? '';
    if (rx.test(fn) || rx.test(m[1])) hits.push(`${m[1]} [${fn}]`);
  }
  if (hits.length) console.log(`${st.mtime.toISOString().slice(0, 16)}  ${path.relative(root, f)}\n    ${hits.join(', ')}`);
}
