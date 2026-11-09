// Copy an enabled macro instance (its expanded steps, features, geometry, toolpaths and its expressions) from one
// program into another of the same master (same workpiece / plane / layer IDs, checked), with fresh IDs.
// Placed right after the top-level executable named --after. Optionally turns instances off first (--off a,b).
//   npx tsx scripts/job/cloneinst.ts target.pgmx source.pgmx out.pgmx "Name" InstanceName --after PhoenixDummy [--off PhoenixDummy]
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { Ids, cloneBlocks } from '../../src/engine/pgmx';
import { assertSafe } from '../../src/engine/validate';
import { stepBlocks, disableEdits, checkGone, splice, one } from './lib';
import { vspBlock } from './exprs';

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const after = opt('--after'); const off = opt('--off')?.split(',') ?? [];
const [tgtPath, srcPath, out, name, instName] = args;
const a = readPgmx(tgtPath); const orig = getXml(a); let t = orig;
if (off.length) { const d = disableEdits(t, off); t = splice(t, d.edits); checkGone(t, d.gone); }
const src = getXml(readPgmx(srcPath));

const sm = [...src.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>(\d+)<\/ID>.*?<Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)/gs)].filter((m) => m[2] === instName);
if (sm.length !== 1 || sm[0][3] !== 'true') throw new Error(`${instName}: not one enabled instance in the source`);
const sb = vspBlock(src, sm[0][1])!;
const b = stepBlocks(src, sb.text.slice(sb.text.indexOf('<Elements>'), sb.text.indexOf('</Elements>')));
const exprs = [...src.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0]).filter((e) => e.includes(`<b:ID>${sm[0][1]}</b:ID>`));
// same master: every plane, layer and workpiece the copy points at must exist in the target
// (a reference that is dangling in the source too - macro-internal layers - is carried as it is)
for (const g of [...b.geometries, ...b.operations, ...b.features]) for (const m of g.matchAll(/<(?:a:|b:)?(?:PlaneID|LayerID|WorkPieceID|WorkpieceID)[^>]*><(?:\w+:)?ID>(\d+)</g)) {
  if (m[1] !== '0' && src.includes(`<ID>${m[1]}</ID>`) && !t.includes(`<ID>${m[1]}</ID>`)) throw new Error(`${instName}: refers to ${m[1]}, not in the target`);
}
const ids = new Ids(t, src);
const parts = cloneBlocks(ids, [sb.text, ...b.features, ...b.geometries, ...b.operations, ...exprs]);
const nf = b.features.length, ng = b.geometries.length, no = b.operations.length;
const inst = parts[0], feats = parts.slice(1, 1 + nf), geos = parts.slice(1 + nf, 1 + nf + ng), ops = parts.slice(1 + nf + ng, 1 + nf + ng + no);
let en = Math.max(0, ...[...t.matchAll(/>\[Expression\]\((\d+)\)</g)].map((m) => +m[1]));
const ex = parts.slice(1 + nf + ng + no).map((e) => e.replace(/\[Expression\](\(\d+\))?/, `[Expression](${++en})`));
// the step blocks inside the instance were cloned as part of it (cloneBlocks maps the whole instance text)
const tm = [...t.matchAll(/<Executable i:type="[^"]+"[^>]*><Key[^>]*><ID>(\d+)<\/ID>.*?<Name[^>]*>([^<]*)<\/Name>/gs)].filter((m) => m[2] === after);
if (tm.length !== 1) throw new Error(`--after ${after}: ${tm.length} found`);
const at0 = tm[0].index!; const isVsp = t.startsWith('<Executable i:type="VisualSubProgram"', at0);
const atEnd = isVsp ? t.indexOf('</FileName></Executable>', at0) + '</FileName></Executable>'.length : t.indexOf('</Executable>', at0) + '</Executable>'.length;
const at = (tag: string) => t.indexOf(`</${tag}>`);
const nt = splice(t, [[atEnd, atEnd, inst], [at('Features'), at('Features'), feats.join('')], [at('Geometries'), at('Geometries'), geos.join('')],
  [at('Operations'), at('Operations'), ops.join('')], [at('Expressions'), at('Expressions'), ex.join('')]]);
assertSafe(orig, nt);
writePgmx(a, nt, out, name);
console.log(`${name}: ${instName} copied (${b.steps.length} steps, ${ex.length} expressions) after ${after}${off.length ? '; off: ' + off.join(', ') : ''}`);
void one;
