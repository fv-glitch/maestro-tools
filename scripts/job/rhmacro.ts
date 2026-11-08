// Nido8423RHv2.xsp: the Nido8423LH macro (same rose, pocket, routing and fixing holes) with the two plate pilots
// mirrored in X about the handle centre (LH -135 / +65 -> RH +135 / -65). Everything else byte-identical.
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { stepBlocks, translateGeometry, translateOperation, one } from './lib';
import { assertSafe } from '../../src/engine/validate';

const [src, out] = process.argv.slice(2);
const OLD = 'Nido8423LH', NEW = 'Nido8423RHv2';
const z = unzipSync(readFileSync(src));
const xmlName = OLD + '.xml'; const t = strFromU8(z[xmlName]);
const w = t.indexOf('<MainWorkplan>'); const es = t.indexOf('<Elements', w); const ee = t.indexOf('</Elements>', es);
const steps = [...t.slice(es, ee).matchAll(/<Executable i:type="a:MachiningWorkingStep".*?<\/a:OperationID>.*?<\/Executable>/gs)].map((m) => m[0]);
const pick = (nm: string) => { const s = steps.filter((x) => x.includes(`>${nm}</Name>`)); if (s.length !== 1) throw new Error(nm); return stepBlocks(t, s[0]); };
const edits: [number, number, string][] = [];
const put = (blk: string, nb: string) => { const at = t.indexOf(blk); if (at < 0 || t.indexOf(blk, at + 1) >= 0) throw new Error('not unique'); edits.push([at, at + blk.length, nb]); };
for (const [nm, from, to] of [['Boring(3)', -135, 135], ['Boring(4)', 65, -65]] as const) {
  const b = pick(nm); const g = b.geometries[0];
  const x = +one(/<a:_x>([^<]+)</, g, 'x')[1]; if (Math.abs(x - from) > 1e-6) throw new Error(`${nm} at ${x}`);
  put(g, translateGeometry(g, to - from, 0)); put(b.operations[0], translateOperation(b.operations[0], to - from, 0, 0));
}
edits.sort((a, b) => b[0] - a[0]); let nt = t; for (const [s, e, r] of edits) nt = nt.slice(0, s) + r + nt.slice(e);
const before = nt;
nt = nt.replace(`<ButtonName>${OLD}</ButtonName>`, `<ButtonName>${NEW}</ButtonName>`).replace(`<Name>${OLD}</Name><TabName>`, `<Name>${NEW}</Name><TabName>`);
if (nt === before || nt.includes(`<ButtonName>${OLD}<`)) throw new Error('info not renamed');
assertSafe(t, nt);
const o: Record<string, Uint8Array> = {};
for (const [k, v] of Object.entries(z)) {
  const nk = k.replace(OLD + '.', NEW + '.');
  o[nk] = k === xmlName ? strToU8(nt) : k.endsWith('.xaml') ? strToU8(strFromU8(v).replace(`>${OLD}</s:String>`, `>${NEW}</s:String>`)) : v;
}
writeFileSync(out, zipSync(o, { level: 6 }));
console.log('written', out, Object.keys(o).length, 'entries');
