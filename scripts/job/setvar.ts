// set input variables only (no geometry moves); assertSafe; for flags whose effect is already stored (e.g. instances turned off)
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { setVariables } from '../../src/engine/variables';
import { assertSafe } from '../../src/engine/validate';
const [src, out, name, ...kv] = process.argv.slice(2);
const a = readPgmx(src); const t = getXml(a);
const x = setVariables(t, Object.fromEntries(kv.map((s) => { const [k, v] = s.split('='); return [k, +v]; }))).xml;
assertSafe(t, x); writePgmx(a, x, out, name); console.log(name + ': ' + kv.join(' '));
