// RH 8423 dummy door = the LH door with its Nido8423LH instance switched to Nido8423RHv2: same rose, pilots mirrored
// about the handle centre (expanded pilot geometry/toolpaths moved: Boring(3) +270, Boring(4) -130).
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { assertSafe } from '../../src/engine/validate';
import { stepBlocks, translateGeometry, translateOperation, splice, one, r6 } from './lib';
const [src, out, name] = process.argv.slice(2);
const a = readPgmx(src); const t = getXml(a);
const s = t.lastIndexOf('<Executable i:type="VisualSubProgram">', t.indexOf('>Nido8423LH</Name>'));
const e = t.indexOf('<FileName>Nido8423LH</FileName></Executable>', s) + '<FileName>Nido8423LH</FileName></Executable>'.length;
const inst = t.slice(s, e);
const cx = +one(/<ModifyInfos><CoordinateX>([^<]+)</, inst, 'x')[1];
const steps = [...inst.slice(inst.indexOf('<Elements>'), inst.indexOf('</Elements>')).matchAll(/<Executable i:type="a:MachiningWorkingStep".*?<\/a:OperationID>.*?<\/Executable>/gs)].map((m) => m[0]);
const edits: [number, number, string][] = [[s, e, inst.replace('>Nido8423LH</Name>', '>Nido8423RHv2</Name>').replace('<FileName>Nido8423LH</FileName>', '<FileName>Nido8423RHv2</FileName>')]];
for (const [nm, from, to] of [['Boring(3)', -135, 135], ['Boring(4)', 65, -65]] as const) {
  const st = steps.filter((x) => x.includes(`>${nm}</Name>`)); if (st.length !== 1) throw new Error(nm);
  const b = stepBlocks(t, st[0]); const g = b.geometries[0];
  const x = +one(/<a:_x>([^<]+)</, g, 'x')[1]; if (Math.abs(x - (cx + from)) > 1e-6) throw new Error(`${nm} at ${x}`);
  for (const [blk, nb] of [[g, translateGeometry(g, to - from, 0)], [b.operations[0], translateOperation(b.operations[0], to - from, 0, 0)]]) {
    const at = t.indexOf(blk); if (at < 0 || t.indexOf(blk, at + 1) >= 0) throw new Error('not unique'); edits.push([at, at + blk.length, nb]);
  }
  console.log(nm, r6(cx + from), '->', r6(cx + to));
}
const nt = splice(t, edits);
assertSafe(t, nt);
writePgmx(a, nt, out, name);
