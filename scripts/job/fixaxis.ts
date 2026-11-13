import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
const [src, out, name] = process.argv.slice(2);
const a = readPgmx(src); const t = getXml(a); let n = 0;
// every tool axis in these jamb programs is the unit vector (1,0,0); the alignment script shifted _x by mistake
const nt = t.replace(/(<b:ToolAxis[^>]*>(?:(?!<\/b:ToolAxis>).)*?<c:_x>)([^<]+)(<)/gs, (m, p, v, q) => { if (v === '1') return m; n++; return p + '1' + q; });
assertSafe(t, nt);
const axes = [...nt.matchAll(/<b:ToolAxis[^>]*>.*?<c:_x>([^<]*)<\/c:_x><c:_y>([^<]*)<\/c:_y><c:_z>([^<]*)</gs)].map((m) => m.slice(1).join(','));
const bad = axes.filter((x) => x !== '1,0,0'); if (bad.length) throw new Error('still off: ' + bad.length);
writePgmx(a, nt, out, name); console.log(name, 'tool axes reset:', n, 'of', axes.length);
