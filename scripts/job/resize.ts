// applyvars + re-expansion of macro instances whose expansion depends on the door size in known ways:
//   --size-free=A,B     macros whose expansion does not depend on dx1/dy1/dz1 (placement moves only)
//   --depth-follow=A,B  Top-plane macros whose cuts follow dz1 (e.g. 54mmHole: through pocket = dz1).
//                       When dz1 changes by d, every toolpath z moves by d except the through level (-OvercutLength),
//                       pass levels are re-derived as dz1 - k*AxialCuttingDepth, vertical line lengths and the
//                       curve's _secondParameter follow, and the features' Depth (= old dz1) becomes the new dz1.
//                       Refuses if the number of passes would change (Maestro would add or drop a pass).
// Checked against Maestro: 72199 810LH (810x38, 990) -> 705x38 and 760x36 knob 1000, saved by the owner 2026-11-11.
//   npx tsx scripts/job/resize.ts src.pgmx out.pgmx "Name" Var=value ... [--resize] [--size-free=..] [--depth-follow=..]
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { variableValues } from '../../src/engine/variables';
import { evaluate } from '../../src/engine/formula';
import { assertSafe } from '../../src/engine/validate';
import { applyVars, planeNameOf } from './applyvars';
import { stepBlocks, splice, g18, translateOperation } from './lib';
import { storedValue } from './exprs';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-7;

/** z-remap of one operation block for a dz1 change */
export function followDepth(op: string, dzOld: number, dzNew: number): string {
  const ov = +(/<(?:\w+:)?(?:OvercutLength|OverCut)>([^<]+)</.exec(op)?.[1] ?? NaN);
  const am = /<(?:\w+:)?AxialCuttingDepth>([^<]+)</.exec(op); const a = am ? +am[1] : Infinity; // saw cuts: one level
  if (!(ov >= 0) || !(a > 0)) throw new Error('operation without OvercutLength / AxialCuttingDepth');
  const passes = (dz: number) => { let n = 0; while (dz - (n + 1) * a > -ov + 1e-9) n++; return n; };
  if (passes(dzOld) !== passes(dzNew)) throw new Error(`pass count changes (${passes(dzOld)} -> ${passes(dzNew)}): not handled`);
  const d = dzNew - dzOld;
  const mapZ = (z: number) => {
    if (near(z, -ov)) return -ov;
    const k = Math.round((dzOld - z) / a);
    if (k >= 0 && near(z, dzOld - k * a)) return dzNew - k * a;
    return z + d;
  };
  const fmtZ = (z: number, like: string) => (near(z, +like) ? like : g18(z));
  // each record: "8 p0 p1\n<1|2> x y z rest\n"
  const rec = /((?:Description|string)>8 )(\S+) (\S+)\n([12]) (\S+) (\S+) (\S+) ([^\n<]*)\n/g;
  // trimmed curves: keep _secondParameter = L/2 in step with the line length
  return op.replace(/<(?:\w+:)?BasicCurve i:type="\w+:GeomTrimmedCurve".*?<\/(?:\w+:)?BasicCurve>|(?:Description|string)>8 [^<]*/gs, (blk) => {
    let Lold = NaN, Lnew = NaN;
    const out = blk.replace(rec, (_m, pre, p0, p1, typ, x, y, z, rest) => {
      const zo = +z; const zn = mapZ(zo);
      if (typ === '1') {
        const dir = rest.trim().split(/\s+/).map(Number);
        if (dir.length === 3 && near(dir[0], 0) && near(dir[1], 0) && near(Math.abs(dir[2]), 1) && near(+p0, 0)) {
          const L = +p1; const ze = zo + L * dir[2]; const zen = mapZ(ze); const Ln = Math.abs(zen - zn);
          Lold = L; Lnew = Ln;
          return `${pre}${p0} ${near(Ln, L) ? p1 : g18(Ln)}\n${typ} ${x} ${y} ${fmtZ(zn, z)} ${rest}\n`;
        }
      }
      return `${pre}${p0} ${p1}\n${typ} ${x} ${y} ${fmtZ(zn, z)} ${rest}\n`;
    });
    if (!isNaN(Lold) && !near(Lold, Lnew)) return out.replace(/(<(?:\w+:)?_secondParameter>)([^<]+)(<)/, (m, o, v, c) => (near(+v, Lold / 2) ? o + g18(Lnew / 2) + c : m));
    return out;
  });
}

export function resize(orig: string, inputs: Record<string, number>, opt: { resize?: boolean; sizeFree?: string[]; depthFollow?: string[]; depthSteps?: string[] }) {
  const follow = opt.depthFollow ?? [];
  // plain (top-level) steps whose depth = dz1 formula: their feature depth follows, their toolpath is re-derived below
  const plain = (opt.depthSteps ?? []).map((nm) => {
    const ms = [...orig.matchAll(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name>.*?<\/Executable>/gs)].filter((m) => m[1] === nm);
    if (ms.length !== 1) throw new Error(`plain step ${nm}: ${ms.length} found`);
    const sb = stepBlocks(orig, ms[0][0]);
    return { nm, sid: /<Key[^>]*><ID>(\d+)<\/ID>/.exec(ms[0][0])![1], fid: /<Key[^>]*><ID>(\d+)<\/ID>/.exec(sb.features[0])![1], opId: /<Key[^>]*><ID>(\d+)<\/ID>/.exec(sb.operations[0])![1] };
  });
  const r = applyVars(orig, inputs, { resize: opt.resize, sizeFreeMacros: [...(opt.sizeFree ?? []), ...follow], depthFeatures: new Set(plain.map((p) => p.fid)) });
  let t = r.xml; const log = [...r.log];
  if (plain.length) {
    const b0 = variableValues(orig).dz1, b1 = variableValues(t).dz1;
    if (!near(b0, b1)) {
      const edits: [number, number, string][] = [];
      for (const p of plain) {
        const m = new RegExp('<Operation i:type="[^"]+"[^>]*><Key[^>]*><ID>' + p.opId + '</ID>.*?</Operation>', 's').exec(t)!;
        edits.push([m.index, m.index + m[0].length, followDepth(m[0], b0, b1)]); log.push(`step ${p.nm}: toolpath follows dz1 ${b0} -> ${b1}`);
        // the saw's generated plane (Maestro adds one per saw cut): Depth = dz1, YDimension and its line's z follow
        for (const g of t.matchAll(/<Plane i:type="[^"]*PlaneGenerated"[^>]*>.*?<\/Plane>/gs)) {
          if (!g[0].includes(`<b:ID>${p.sid}</b:ID>`) && !g[0].includes(`<ID>${p.sid}</ID>`)) continue;
          const np = g[0].replace(/(<(?:\w+:)?(?:YDimension|Depth)>)([^<]+)(<)/g, (x, o, v, c) => (near(+v, b0) ? o + String(b1) + c : x))
            .replace(/(Description>8 \S+ \S+\n1 \S+ \S+ )(\S+)( )/g, (x, o, z, c) => (near(+z, b0) ? o + String(b1) + c : x));
          if (np === g[0]) throw new Error(`generated plane of ${p.nm}: nothing to update`);
          edits.push([g.index!, g.index! + g[0].length, np]); log.push(`step ${p.nm}: generated plane depth ${b0} -> ${b1}`);
        }
      }
      t = splice(t, edits);
    }
  }
  const before = variableValues(orig), after = variableValues(t);
  const dzOld = before.dz1, dzNew = after.dz1;
  // far-edge planes move with the workpiece: Back (y = dy1) and Right (x = dx1). Expanded steps of size-free macros on
  // them keep their plane geometry; their world toolpaths move with the plane (checked: CirqueLock 810 -> 705).
  const ddy = after.dy1 - before.dy1, ddx = after.dx1 - before.dx1;
  if (!near(ddy, 0) || !near(ddx, 0)) {
    const edits: [number, number, string][] = [];
    for (const m of t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>true<\/IsEnabled>/g)) {
      const end = t.indexOf('</FileName></Executable>', m.index!);
      const blk = t.slice(m.index!, end); const fn = /<FileName>([^<]*)$/.exec(blk)?.[1] ?? '';
      if (![...(opt.sizeFree ?? []), ...follow].includes(fn)) continue;
      const es = blk.indexOf('<Elements>'); if (es < 0) continue;
      const sb = stepBlocks(t, blk.slice(es, blk.indexOf('</Elements>'))); if (!sb.geometries.length) continue;
      const planes = new Set(sb.geometries.map((g) => planeNameOf(t, g)));
      const mv = (p: string): [number, number] => (p === 'Back' ? [0, ddy] : p === 'Right' ? [ddx, 0] : [0, 0]);
      for (const p of planes) if ((p === 'Back' || p === 'Right') && planes.size > 1) throw new Error(`${m[1]}: mixed planes with ${p}`);
      const [wx, wy] = mv([...planes][0]); if (near(wx, 0) && near(wy, 0)) continue;
      for (const op of sb.operations) { const at = t.indexOf(op); edits.push([at, at + op.length, translateOperation(op, wx, wy, 0)]); }
      log.push(`${m[1]} [${fn}] on ${[...planes][0]}: toolpaths moved ${wx} / ${wy} with the plane`);
    }
    t = splice(t, edits);
  }
  if (follow.length && !near(dzOld, dzNew)) {
    const edits: [number, number, string][] = [];
    for (const m of t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>true<\/IsEnabled>/g)) {
      const end = t.indexOf('</FileName></Executable>', m.index!);
      const blk = t.slice(m.index!, end); const fn = /<FileName>([^<]*)$/.exec(blk)?.[1] ?? '';
      if (!follow.includes(fn)) continue;
      const es = blk.indexOf('<Elements>'); if (es < 0) continue;
      const sb = stepBlocks(t, blk.slice(es, blk.indexOf('</Elements>')));
      for (const op of sb.operations) { const at = t.indexOf(op); edits.push([at, at + op.length, followDepth(op, dzOld, dzNew)]); }
      for (const f of sb.features) {
        const at = t.indexOf(f);
        const nf = f.replace(/(<(StartDepth|EndDepth)>)([^<]+)(<)/g, (x, o, _n, v, c) => (near(+v, dzOld) ? o + (Number.isInteger(dzNew) ? String(dzNew) : g18(dzNew)) + c : x));
        if (nf !== f) edits.push([at, at + f.length, nf]);
      }
      log.push(`${m[1]} [${fn}]: ${sb.operations.length} toolpaths and feature depths follow dz1 ${dzOld} -> ${dzNew}`);
    }
    t = splice(t, edits);
  }
  return { xml: t, log };
}

if (process.argv[1]?.endsWith('resize.ts')) {
  const [src, out, name, ...kv] = process.argv.slice(2);
  const a = readPgmx(src); const orig = getXml(a);
  const flags = kv.filter((s) => s.startsWith('--')); const kvs = kv.filter((s) => !s.startsWith('--'));
  const list = (f: string) => flags.find((x) => x.startsWith(f + '='))?.slice(f.length + 1).split(',') ?? [];
  const { xml, log } = resize(orig, Object.fromEntries(kvs.map((s) => { const [k, v] = s.split('='); return [k, +v]; })),
    { resize: flags.includes('--resize'), sizeFree: list('--size-free'), depthFollow: list('--depth-follow'), depthSteps: list('--depth-steps') });
  assertSafe(orig, xml);
  const V = variableValues(xml); const stale: string[] = [];
  for (const e of [...xml.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0])) {
    const s = storedValue(xml, e); if (s.kind !== 'num') continue;
    const v = evaluate(s.formula, V); if (Math.abs(v - s.value) > 1e-6) stale.push(`${s.what}: ${s.value} vs ${v}`);
  }
  if (stale.length) throw new Error('stale after the change:\n  ' + stale.join('\n  '));
  writePgmx(a, xml, out, name);
  console.log(name + '\n  ' + log.join('\n  '));
}
