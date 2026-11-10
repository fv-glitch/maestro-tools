// turn off a plain step whose IsEnabled formula already evaluates false (stored value is stale): flip the stored flag only
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
import { splice } from './lib';
const [src, out, name, step] = process.argv.slice(2);
const a = readPgmx(src); const t = getXml(a);
const ms = [...t.matchAll(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>true<\/IsEnabled>/g)].filter((m) => m[1] === step);
if (ms.length !== 1) throw new Error(`${step}: ${ms.length} enabled`);
const p = ms[0].index! + ms[0][0].length - '</IsEnabled>'.length - 4;
const x = splice(t, [[p, p + 4, 'false']]); assertSafe(t, x); writePgmx(a, x, out, name); console.log(`${name}: off ${step}`);
