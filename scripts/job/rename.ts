import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
const [src, dir, stem] = process.argv.slice(2); const a = readPgmx(src); writePgmx(a, getXml(a), `${dir}/${stem}.pgmx`, stem);
