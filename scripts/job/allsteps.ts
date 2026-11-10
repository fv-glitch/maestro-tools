// read-only: every working step name with enabled flag, and every macro instance
import { readPgmx, getXml } from '../../src/engine/archive';
const t = getXml(readPgmx(process.argv[2]));
for (const m of t.matchAll(/<Executable i:type="([^"]+)"[^>]*><Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)</g)) console.log(`${m[3].padEnd(6)} ${m[1].padEnd(26)} ${m[2]}`);
console.log('variables Cirque*:', [...t.matchAll(/<Name[^>]*>(Cirque[^<]*)<\/Name>/g)].map((m) => m[1]).join(', '));
