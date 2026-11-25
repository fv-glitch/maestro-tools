// read-only: for each enabled saw step, the geometry line and the stored toolpath points (x y z)
import { readPgmx, getXml } from '../../src/engine/archive';
import { stepBlocks } from './lib';
const t = getXml(readPgmx(process.argv[2]));
for (const m of t.matchAll(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>true<\/IsEnabled>.*?<\/Executable>/gs)) {
  const b = stepBlocks(t, m[0]);
  const fe = b.features[0] ?? ''; if (!/SawCut/.test(fe)) continue;
  const g = b.geometries[0] ?? ''; const op = b.operations[0] ?? '';
  const gl = /Description>8 0 (\S+)\n1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) /.exec(g);
  const side = /<SideOfFeature>(\w+)</.exec(fe)?.[1]; const ang = /<a:Angle>([^<]+)</.exec(fe)?.[1];
  const ov = /<OverCut>([^<]+)</.exec(op)?.[1] ?? /Overcut[^>]*>([^<]+)</i.exec(op)?.[1];
  console.log(`== ${m[1]}  side ${side} angle ${ang} overcut ${ov}`);
  if (gl) { const [L, x, y, z, dx, dy] = gl.slice(1).map(Number); console.log(`  line start ${x.toFixed(3)},${y.toFixed(3)} end ${(x + L * dx).toFixed(3)},${(y + L * dy).toFixed(3)} z ${z}`); }
  const pts = [...op.matchAll(/\n1 (\S+) (\S+) (\S+) /g)].map((p) => p.slice(1, 4).map(Number));
  for (const p of pts) console.log('  tp ' + p.map((v) => v.toFixed(3)).join(' '));
}
