// Engrave unprogrammed drawing geometry: one centre-line routing per curve, cloned from a routing step already in the
// program (same operation settings), with the tool swapped and the toolpath built the way Maestro stores a centre-line
// routing with no lead-in: plunge from the approach plane, the curve itself at depth, straight lift.
// Steps go in before the final park, in the order given.
//   npx tsx scripts/job/engrave.ts in.pgmx out.pgmx "Name" --template "Routing(19)" --tool E017=2149904436 --width 3
//        --depth 1 --layers CENTERLINE,FILL_OUTSIDE
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { Ids, cloneBlocks } from '../../src/engine/pgmx';
import { assertSafe } from '../../src/engine/validate';
import { variableValues } from '../../src/engine/variables';
import { stepBlocks, splice, one, r6, g18 } from './lib';

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(f); if (i < 0) throw new Error('missing ' + f); const v = args[i + 1]; args.splice(i, 2); return v; };
const tplName = opt('--template'); const [toolName, toolId] = opt('--tool').split('='); const width = opt('--width');
const depth = +opt('--depth'); const layers = opt('--layers').split(',');
const [src, out, name] = args;
const a = readPgmx(src); const t = getXml(a);
const V = variableValues(t);

const layerIds = new Map([...t.matchAll(/<a:Layer><Key[^>]*><ID>(\d+)<\/ID>.*?<Name[^>]*>([^<]*)</gs)].map((m) => [m[2], m[1]]));
const used = new Set([...t.matchAll(/<GeometryID[^>]*><b:ID>(\d+)/g)].map((m) => m[1]));
const top = one(/<Plane[^>]*><Key[^>]*><ID>(\d+)<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>Top</, t, 'Top plane')[1];

// template routing
const tm = one(new RegExp('<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>\\d+</ID><ObjectType>[^<]*</ObjectType></Key><Name[^>]*>' + tplName.replace(/[()]/g, '\\$&') + '</Name>.*?</Executable>', 's'), t, 'template');
const tb = stepBlocks(t, tm[0]);
const tf = tb.features[0], to = tb.operations[0];
if (!/<SideOfFeature>Center</.test(tf)) throw new Error('template is not a centre-line routing');
if (!/<StartMachiningPoint i:nil="true"/.test(to) || !/<Approach [^>]*>(?:(?!<\/Approach>).)*<b:IsEnabled>false<\/b:IsEnabled>/s.test(to) || !/<Retract [^>]*>(?:(?!<\/Retract>).)*<b:IsEnabled>false<\/b:IsEnabled>/s.test(to)) throw new Error('template has a start point or lead-in');
const approach = +one(/<ApproachSecurityPlane>([^<]+)</, to, 'approach plane')[1];
const z = V.dz1 - depth, zTop = V.dz1 + approach, L = zTop - z;
const tplDepth = +one(/<EndDepth>([^<]+)</, tf, 'template depth')[1];

// evaluate a member record at a parameter
function at(rec: number[], tt: number): [number, number] {
  if (rec[0] === 1) return [rec[1] + tt * rec[4], rec[2] + tt * rec[5]];
  const [cx, cy, , , , , ux, uy, , vx, vy, , r] = rec.slice(1);
  return [cx + r * (Math.cos(tt) * ux + Math.sin(tt) * vx), cy + r * (Math.cos(tt) * uy + Math.sin(tt) * vy)];
}
const num = (v: number) => g18(v);

const selftest = process.env.SELFTEST === '1';
const tplGid = one(/<GeometryID[^>]*><b:ID>(\d+)/, tf, 'template geometry')[1];
const targets = [...t.matchAll(/<a:GeomGeometry i:type="a:GeomCompositeCurve"[^>]*><Key[^>]*><ID>(\d+)<\/ID>.*?<\/a:GeomGeometry>/gs)]
  .filter((m) => selftest ? m[1] === tplGid : !used.has(m[1]) && layers.some((l) => new RegExp(`<a:LayerID[^>]*><b:ID>${layerIds.get(l)}</b:ID>`).test(m[0])));
if (!targets.length) throw new Error('nothing to program on ' + layers.join(', '));
const ids = new Ids(t);
const steps: string[] = [], feats: string[] = [], ops: string[] = [];
let k = 0;
for (const g of targets) {
  const gid = g[1], gx = g[0];
  if (!new RegExp(`<a:PlaneID[^>]*><b:ID>${top}</b:ID>`).test(gx)) throw new Error(`geometry ${gid} is not on the Top plane`);
  const keys = [...one(/<a:_serializingKeys[^>]*>(.*?)<\/a:_serializingKeys>/s, gx, 'keys')[1].matchAll(/>(\d+)</g)].map((m) => m[1]);
  const members = [...one(/<a:_serializingMembers[^>]*>(.*?)<\/a:_serializingMembers>/s, gx, 'members')[1].matchAll(/<b:string>([^<]*)<\/b:string>/g)].map((m) => m[1]);
  if (keys.length !== members.length) throw new Error(`geometry ${gid}: keys/members`);
  const recs = members.map((m) => { const [h, r] = m.split('\n'); return { h: h.split(' ').slice(1).map(Number), r: r.trim().split(' ').map(Number), raw: m }; });
  for (const x of recs) if (x.r[3] !== 0 || (x.r[0] !== 1 && x.r[0] !== 2)) throw new Error(`geometry ${gid}: unexpected member ${x.raw}`);
  const p0 = at(recs[0].r, recs[0].h[0]); const last = recs[recs.length - 1]; const p1 = at(last.r, last.h[1]);
  // the curve at depth: same members, z = dz1 - depth
  const atDepth = recs.map((x) => { const [h, r] = x.raw.split('\n'); const tok = r.split(' '); tok[3] = num(z); return h + '\n' + tok.join(' ') + '\n'; });
  const [s, f, o] = cloneBlocks(ids, [tb.steps[0], tf, to]);
  steps.push(s.replace(/(<Name[^>]*>)[^<]*(<\/Name>)/, `$1Engrave(${k++})$2`));
  feats.push(f.replace(/(<GeometryID[^>]*><b:ID>)\d+(<)/, `$1${gid}$2`)
    .replace(/(<EndDepth>)[^<]*(<\/EndDepth><StartDepth>)[^<]*(<)/, `$1${num(depth)}$2${num(depth)}$3`)
    .replace(/(<a:Width>)[^<]*(<\/a:Width><\/SweptShape>)/, `$1${width}$2`));
  const tp = o.match(/<ToolpathList[^>]*>.*<\/ToolpathList>/s)![0];
  const parts = [...tp.matchAll(/<b:Toolpath i:type="b:CutterLocationTrajectory"[^>]*>.*?<\/b:Toolpath>/gs)].map((m) => m[0]);
  if (parts.length !== 3) throw new Error('template toolpath is not approach / path / lift');
  const line = (p: [number, number], zz: number, dir: number) => `8 0 ${num(L)}\n1 ${num(p[0])} ${num(p[1])} ${num(zz)} 0 0 ${dir} \n`;
  const appr = parts[0].replace(/(_serializationGeometryDescription>)[^<]*(<)/, `$1${line(p0, zTop, -1)}$2`).replace(/(<c:_secondParameter>)[^<]*(<)/, `$1${num(L / 2)}$2`);
  const path = parts[1].replace(/(<c:_serializingKeys[^>]*>).*?<\/c:_serializingKeys>/s, `$1${keys.map((x) => `<d:unsignedInt>${x}</d:unsignedInt>`).join('')}</c:_serializingKeys>`)
    .replace(/(<c:_serializingMembers[^>]*>).*?<\/c:_serializingMembers>/s, `$1${atDepth.map((x) => `<d:string>${x}</d:string>`).join('')}</c:_serializingMembers>`);
  const lift = parts[2].replace(/(_serializationGeometryDescription>)[^<]*(<)/, `$1${line(p1, z, 1)}$2`).replace(/(<c:_secondParameter>)[^<]*(<)/, `$1${num(L / 2)}$2`);
  ops.push(o.replace(tp, tp.replace(parts[0], appr).replace(parts[1], path).replace(parts[2], lift))
    .replace(/(<ToolKey[^>]*><b:ID>)\d+(<\/b:ID><b:ObjectType>[^<]*<\/b:ObjectType><b:Name>)\w+(<)/, `$1${toolId}$2${toolName}$3`));
}
void tplDepth; void r6;
if (selftest) {
  // our toolpath for the template's own curve against the one Maestro stored
  const nums = (x: string) => [...x.replace(/<Key>.*?<\/Key>/gs, '').matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)].map((m) => +m[0]);
  const A = nums(to.match(/<ToolpathList[^>]*>.*<\/ToolpathList>/s)![0]), B = nums(ops[0].match(/<ToolpathList[^>]*>.*<\/ToolpathList>/s)![0]);
  const bad = A.length !== B.length ? -1 : A.findIndex((v, i) => Math.abs(v - B[i]) > 1e-9);
  const strip = (x: string) => x.match(/<ToolpathList[^>]*>.*<\/ToolpathList>/s)![0].replace(/<Key>.*?<\/Key>/gs, '').replace(/<b:ID>\d+<\/b:ID>/g, '');
  const sa = strip(to), sb = strip(ops[0]); let d = 0; while (d < sa.length && sa[d] === sb[d]) d++;
  console.log('text identical (ids aside):', sa === sb, sa === sb ? '' : JSON.stringify([sa.slice(d - 80, d + 80), sb.slice(d - 80, d + 80)]));
  console.log(bad === -1 && A.length === B.length ? `selftest: toolpath matches Maestro's (${A.length} numbers)` : `selftest: DIFFERENT at ${bad} (${A.length} vs ${B.length})`);
  process.exit(0);
}
// before the final park
const parks = [...t.matchAll(/<Executable i:type="Xn"/g)]; const park = parks[parks.length - 1].index!;
const at2 = (tag: string) => t.indexOf(`</${tag}>`);
const nt = splice(t, [[park, park, steps.join('')], [at2('Features'), at2('Features'), feats.join('')], [at2('Operations'), at2('Operations'), ops.join('')]]);
assertSafe(t, nt);
writePgmx(a, nt, out, name);
console.log(`${name}: ${steps.length} engraving steps (${toolName}, ${width} wide, ${depth} deep, toolpath z ${z}) on ${layers.join(', ')}`);
