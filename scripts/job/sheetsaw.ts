// M100 saw programs for a sheet cut plan (scripts/cutplan plan.json): rip program + one crosscut program per strip,
// via panelJob.sawPrograms on the emptied TestingDoorReal, with the saw steps cloned from a door cut program
// ('Cut Side LH' along X, 'Cut Side LH(1)' along Y, E015). The cut depth follows the board like Maestro's own saw cuts:
// Depth = dz1 / Sin(90.000) (expressions cloned from the same door cut program).
//   npx tsx scripts/job/sheetsaw.ts TestingDoorReal.pgmx "810 Cut x6.pgmx" plan.json outDir [prefix]
import { readFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { blocks, cloneBlocks, Ids } from '../../src/engine/pgmx';
import { sawPrograms, type PlanJSON } from '../../src/ops/panelJob';
import { assertSafe } from '../../src/engine/validate';

const [basePath, sawPath, planPath, outDir, prefix = ''] = process.argv.slice(2);
const A = readPgmx(basePath); const base = getXml(A); const saw = getXml(readPgmx(sawPath));
const sawX = blocks(saw, 'Cut Side LH'), sawY = blocks(saw, 'Cut Side LH(1)');
const tp = { pocket: [], drill3: [], drill8: [], edge: [], sawX, sawY, src: [base, saw] } as never;
const plan = JSON.parse(readFileSync(planPath, 'utf8')) as PlanJSON;
// depth expressions of the template saw cut (StartDepth / EndDepth = dz1 / Sin(90.000))
const fid = /<Key[^>]*><ID>(\d+)<\/ID>/.exec(sawX[1])![1];
const tplEx = [...saw.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0]).filter((e) => e.includes(`<b:ID>${fid}</b:ID>`) && /<a:Name>Depth<\/a:Name>/.test(e));
if (tplEx.length !== 2) throw new Error('saw depth expressions not found');
mkdirSync(outDir, { recursive: true });
for (const p of sawPrograms(plan, base, tp)) {
  let t = p.xml; const ids = new Ids(t, base, saw);
  let en = Math.max(0, ...[...t.matchAll(/\[Expression\]\((\d+)\)/g)].map((m) => +m[1]));
  const feats = [...t.matchAll(/<ManufacturingFeature i:type="a:SawCutFeature"[^>]*><Key[^>]*><ID>(\d+)<\/ID>/g)].map((m) => m[1]);
  const ex = feats.flatMap((f) => tplEx.map((e) => cloneBlocks(ids, [e])[0].replace(/(<a:ReferencedObject[^>]*><b:ID>)\d+(<)/, `$1${f}$2`).replace(/\[Expression\]\(\d+\)/, () => `[Expression](${++en})`)));
  const at = t.indexOf('</Expressions>'); const nt = t.slice(0, at) + ex.join('') + t.slice(at);
  assertSafe(base, nt);
  const name = prefix + p.name;
  writePgmx(A, nt, path.join(outDir, name + '.pgmx'), name);
  console.log(`${name}: ${p.summary} (${feats.length} cuts)`);
}
