// Move plain saw cuts along X (geometry line and stored toolpath), e.g. an architrave leg program for a different
// floor clearance. Refuses a cut whose geometry has an expression (it would be stale) or a generated plane.
//   npx tsx scripts/job/shiftcuts.ts src.pgmx out.pgmx "Name" --dx -10 "Step name" ["Step name" ...]
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
import { stepBlocks, splice, translateRecords } from './lib';

const args = process.argv.slice(2);
const i = args.indexOf('--dx'); const dx = +args[i + 1]; args.splice(i, 2);
const [src, out, name, ...names] = args;
const a = readPgmx(src); const t = getXml(a);
const edits: [number, number, string][] = [];
for (const nm of names) {
  const ms = [...t.matchAll(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>(\d+)<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name>.*?<\/Executable>/gs)].filter((m) => m[2] === nm);
  if (ms.length !== 1) throw new Error(`${nm}: ${ms.length} found`);
  const b = stepBlocks(t, ms[0][0]);
  if (!/SawCutFeature/.test(b.features[0])) throw new Error(`${nm}: not a saw cut`);
  const g = b.geometries[0], o = b.operations[0];
  const gid = /<Key[^>]*><ID>(\d+)<\/ID>/.exec(g)![1];
  if ([...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].some((e) => e[0].includes(`<b:ID>${gid}</b:ID>`))) throw new Error(`${nm}: geometry has an expression`);
  if (new RegExp(`<GeneratorKey[^>]*><a:ID>${ms[0][1]}<`).test(t)) throw new Error(`${nm}: has a generated plane`);
  for (const [blk, nb] of [[g, translateRecords(g, dx, 0, 0)], [o, translateRecords(o, dx, 0, 0)]]) {
    const at = t.indexOf(blk); if (at < 0 || t.indexOf(blk, at + 1) >= 0) throw new Error(`${nm}: block not unique`);
    edits.push([at, at + blk.length, nb]);
  }
}
const nt = splice(t, edits);
assertSafe(t, nt);
writePgmx(a, nt, out, name);
console.log(`${name}: moved ${names.join(', ')} by ${dx} in X`);
