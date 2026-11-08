// Put enabled hinge instances back on the standard hinge line: ModifyInfos.CoordinateY -> 0, expanded
// geometry/toolpaths moved to match (world dy = -change when the instance is mirrored in Y). Features stay macro-local.
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
import { stepBlocks, translateGeometry, translateOperation, splice, one } from './lib';

const [src, out, name] = process.argv.slice(2);
const a = readPgmx(src); const t = getXml(a);
const edits: [number, number, string][] = []; const report: string[] = [];
for (const m of [...t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>(\d+)<\/ID>.*?<Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)/gs)].filter((v) => /^Hinge /.test(v[2]) && v[3] === 'true')) {
  const s = m.index!, inst = t.slice(s, t.indexOf('</FileName></Executable>', s));
  if ([...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].some((e) => e[0].includes(`<b:ID>${m[1]}</b:ID>`) && e[0].includes('<a:Name>CoordinateY</a:Name>'))) throw new Error(m[2] + ': CoordinateY has an expression');
  const fm = one(/(<ModifyInfos><CoordinateX>[^<]*<\/CoordinateX><CoordinateY>)([^<]+)(<)/, inst, 'y');
  const o = +fm[2]; if (o === 0) continue;
  const mirror = one(/<MirrorType>(\w+)</, inst, 'mirror')[1];
  const dy = /Y/.test(mirror) ? o : -o;
  const p = s + fm.index! + fm[1].length; edits.push([p, p + fm[2].length, '0']);
  const b = stepBlocks(t, inst.slice(inst.indexOf('<Elements>'), inst.indexOf('</Elements>')));
  const put = (blk: string, nb: string) => { const at = t.indexOf(blk); if (at < 0 || t.indexOf(blk, at + 1) >= 0) throw new Error('block not unique'); edits.push([at, at + blk.length, nb]); };
  for (const g of b.geometries) put(g, translateGeometry(g, 0, dy));
  for (const op of b.operations) put(op, translateOperation(op, 0, dy, 0));
  report.push(`${m[2]} (mirror ${mirror}): CoordinateY ${o} -> 0, ${b.steps.length} steps moved ${dy} in Y`);
}
const nt = splice(t, edits);
assertSafe(t, nt);
writePgmx(a, nt, out, name);
console.log(name + '\n  ' + report.join('\n  '));
