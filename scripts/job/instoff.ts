// Turn macro instances off the way Maestro stores a disabled instance (IsEnabled false, no expanded steps), e.g. the
// other hand's hinges on a jamb master that has both legs hinged.
//   npx tsx scripts/job/instoff.ts src.pgmx out.pgmx "Name" "Inst A,Inst B"
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
import { disableEdits, checkGone, splice } from './lib';

const [src, out, name, list] = process.argv.slice(2);
const a = readPgmx(src); const t = getXml(a);
const names = list.split(',').map((s) => s.trim());
const d = disableEdits(t, names); const nt = splice(t, d.edits); checkGone(nt, d.gone);
assertSafe(t, nt);
writePgmx(a, nt, out, name);
console.log(`${name}: off ${names.join(', ')}`);
