// Turn on disabled macro instances (hinge holes) by taking the expanded steps of the same, enabled instance in another
// program of the same master (same instance ID, same parameters/placement): fresh step/feature/geometry/operation IDs.
// Also: --disable name,name  turns instances off the way Maestro stores them.
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { Ids, cloneBlocks } from '../../src/engine/pgmx';
import { assertSafe } from '../../src/engine/validate';
import { stepBlocks, disableEdits, checkGone, splice, one } from './lib';

const args = process.argv.slice(2);
let disable: string[] = []; { const i = args.indexOf('--disable'); if (i >= 0) { disable = args[i + 1].split(','); args.splice(i, 2); } }
const [tgtPath, srcPath, out, name, namesS] = args;
const a = readPgmx(tgtPath); const orig = getXml(a); let t = orig;
if (disable.length) { const d = disableEdits(t, disable); t = splice(t, d.edits); checkGone(t, d.gone); }
const src = srcPath === '-' ? '' : getXml(readPgmx(srcPath));
const names = namesS ? namesS.split(',') : [];
const block = (s: string, nm: string) => {
  const m = [...s.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>(\d+)<\/ID>.*?<Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)/gs)].filter((v) => v[2] === nm);
  if (m.length !== 1) throw new Error(`${nm}: ${m.length}`);
  const end = s.indexOf('</FileName></Executable>', m[0].index!) + '</FileName></Executable>'.length;
  return { id: m[0][1], enabled: m[0][3] === 'true', start: m[0].index!, end, text: s.slice(m[0].index!, end) };
};
const norm = (x: string) => x.replace(/<Elements>.*?<\/Elements>|<Elements\/>/s, '<Elements/>').replace('<IsEnabled>true', '<IsEnabled>false').replace(/>(-?\d+)\.0</g, '>$1<');
const ids = new Ids(t, src);
const edits: [number, number, string][] = []; const add = { f: [] as string[], g: [] as string[], o: [] as string[] };
const report: string[] = [];
for (const nm of names) {
  const T = block(t, nm), S = block(src, nm);
  if (T.enabled) { report.push(`${nm}: already on`); continue; }
  if (!S.enabled) throw new Error(`${nm} is off in the source`);
  if (T.id !== S.id || norm(T.text) !== norm(S.text)) throw new Error(`${nm}: instance differs from the source`);
  const es = S.text.indexOf('<Elements>'); const b = stepBlocks(src, S.text.slice(es, S.text.indexOf('</Elements>')));
  const sids = new Set([...b.steps, ...b.features, ...b.geometries, ...b.operations].map((x) => one(/<Key[^>]*><ID>(\d+)/, x, 'id')[1]));
  if ([...src.matchAll(/<a:ReferencedObject[^>]*><b:ID>(\d+)/g)].some((m) => sids.has(m[1]))) throw new Error(`${nm}: expressions on expanded steps`);
  for (const g of b.geometries) for (const r of [/<a:PlaneID[^>]*><b:ID>(\d+)/, /<a:LayerID[^>]*><b:ID>(\d+)/]) { const id = one(r, g, 'ref')[1]; if (!t.includes(`<ID>${id}</ID>`)) throw new Error(`${nm}: plane/layer ${id} not in target`); }
  const c = cloneBlocks(ids, [...b.steps, ...b.features, ...b.geometries, ...b.operations]);
  const n1 = b.steps.length, n2 = n1 + b.features.length, n3 = n2 + b.geometries.length;
  edits.push([T.start, T.end, T.text.replace('<IsEnabled>false', '<IsEnabled>true').replace('<Elements/>', '<Elements>' + c.slice(0, n1).join('') + '</Elements>')]);
  add.f.push(...c.slice(n1, n2)); add.g.push(...c.slice(n2, n3)); add.o.push(...c.slice(n3));
  report.push(`${nm}: on, ${n1} steps`);
}
const at = (tag: string) => t.indexOf(`</${tag}>`);
if (names.length) edits.push([at('Features'), at('Features'), add.f.join('')], [at('Geometries'), at('Geometries'), add.g.join('')], [at('Operations'), at('Operations'), add.o.join('')]);
t = splice(t, edits);
assertSafe(orig, t);
writePgmx(a, t, out, name);
console.log(name + (disable.length ? '\n  off: ' + disable.join(', ') : '') + '\n  ' + report.join('\n  '));
