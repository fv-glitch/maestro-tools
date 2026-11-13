// Set input variables and bring the STORED program up to date with them, the way Maestro would:
//   - instance placements (ModifyInfos.CoordinateX/Y): stored value + expanded geometry/toolpaths moved; features stay
//   - instance parameters named x / y (hinge macros placed by parameter): stored value + features, geometry and
//     toolpaths moved (features hold world coordinates; in a MirrorType Y instance their y runs the other way)
//   - straight saw/cut lines (GeomTrimmedCurve Start/End X/Y) that only translate: line + toolpaths moved
// Toolpaths are world coordinates: Top planes 1:1, Back plane world dX = -plane dx / dZ = plane dy, Front dZ = plane dy.
// Anything else whose value changes (sizes, depths, enabling, other parameters on enabled instances) is refused.
// The result must come out with no stale values (stale.ts) or nothing is written.
//   npx tsx scripts/job/applyvars.ts src.pgmx out.pgmx "Name" Var=value ...
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { setVariables, variableValues } from '../../src/engine/variables';
import { evaluate } from '../../src/engine/formula';
import { assertSafe } from '../../src/engine/validate';
import { stepBlocks, translateRecords, translateGeometry, translateOperation, splice, one, r6 } from './lib';
import { storedValue, vspBlock, geomBlock, paramAt, lineOf } from './exprs';

export function planeNameOf(t: string, g: string) {
  const pid = one(/<a:PlaneID[^>]*><b:ID>(\d+)/, g, 'plane id')[1];
  return one(new RegExp('<Plane[^>]*><Key[^>]*><ID>' + pid + '</ID><ObjectType>[^<]*</ObjectType></Key><Name[^>]*>([^<]*)<'), t, 'plane ' + pid)[1];
}
export function worldDelta(pl: string, dx: number, dy: number): [number, number, number] {
  if (/^Top(\(\d+\))?$/.test(pl)) return [dx, dy, 0];
  if (pl === 'Back') return [-dx, 0, dy];
  if (pl === 'Front') return [dx, 0, dy];
  throw new Error('plane ' + pl + ': toolpath move not handled');
}

export interface ApplyOptions {
  /** macro file names whose enabled instances may take a new dx1/dy1/dz1 parameter without re-expansion
   *  (checked beforehand: their expansion does not depend on the size) */
  sizeFreeMacros?: string[];
  /** allow workpiece size changes: box, planes and axis-aligned lines that only change length are updated */
  resize?: boolean;
}

export function applyVars(orig: string, inputs: Record<string, number>, opt: ApplyOptions = {}) {
  const t = setVariables(orig, inputs).xml;
  const before = variableValues(orig), after = variableValues(t);
  const edits: [number, number, string][] = []; const log: string[] = []; const touched = new Set<number>();
  const put = (blk: string, nb: string) => {
    const at = t.indexOf(blk); if (at < 0 || t.indexOf(blk, at + 1) >= 0) throw new Error('block not unique');
    if (touched.has(at)) throw new Error('block moved twice'); touched.add(at); edits.push([at, at + blk.length, nb]);
  };
  const lines = new Map<string, Record<string, [number, number]>>();
  const wp: [string, string, number, number][] = [];
  for (const e of [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0])) {
    const s = storedValue(t, e);
    if (s.kind === 'variable') continue;
    if (s.kind === 'unknown') {
      // unknown kinds are fine as long as their formula does not change value
      const f = /<a:Value>([^<]*)<\/a:Value>/.exec(e)?.[1] ?? '';
      let o: number, n: number; try { o = evaluate(f, before); n = evaluate(f, after); } catch { continue; }
      if (Math.abs(o - n) > 1e-9) throw new Error(`${s.what} = ${f} changes ${o} -> ${n}; not handled`);
      continue;
    }
    const o = evaluate(s.formula, before), n = evaluate(s.formula, after);
    if (Math.abs(o - n) < 1e-9) continue;
    if (s.kind === 'bool') throw new Error(`${s.what} (${s.formula}) changes; not handled`);
    if (Math.abs(s.value - o) > 1e-6) throw new Error(`${s.what}: stored ${s.value} is not ${o} before the change`);
    const d = n - o;
    if (s.refType === 'VisualSubProgram') {
      const b = vspBlock(t, s.refId)!; const enabled = /<IsEnabled>true/.test(b.text.slice(0, 3000));
      const es = b.text.indexOf('<Elements>'); const exp = enabled && es >= 0 && es < 3000 ? stepBlocks(t, b.text.slice(es, b.text.indexOf('</Elements>'))) : null;
      let dx = 0, dy = 0, fdx = 0, fdy = 0, movesFeatures = false;
      if (s.prop === 'ModifyInfos.CoordinateX' || s.prop === 'ModifyInfos.CoordinateY') {
        const tag = s.prop.split('.')[1]; const mi = b.text.indexOf('<ModifyInfos>');
        const m = new RegExp(`(<${tag}>)([^<]+)(<)`).exec(b.text.slice(mi))!;
        const p = b.start + mi + m.index + m[1].length; edits.push([p, p + m[2].length, pyLen(n, m[2])]);
        if (tag === 'CoordinateX') dx = d; else dy = d;
      } else if (s.prop === 'Parameters.Item.Value') {
        const p = paramAt(b.text, s.index!)!;
        edits.push([b.start + p.at, b.start + p.at + p.valueText.length, pyLen(n, p.valueText)]);
        const fileName = /<FileName>([^<]*)<\/FileName><\/Executable>$/.exec(b.text)?.[1] ?? '';
        if (exp && /^d[xyz]1$/.test(p.name) && (opt.sizeFreeMacros ?? []).includes(fileName)) { log.push(`${s.what}: ${o} -> ${n} (size-free macro ${fileName})`); continue; }
        if (exp) {
          if (p.name !== 'x' && p.name !== 'y') throw new Error(`${s.what}: parameter ${p.name} of an enabled instance (${fileName}) changes; not handled`);
          const mirrorY = /<MirrorType>[^<]*Y/.test(b.text.slice(b.text.indexOf('<ModifyInfos>')));
          if (p.name === 'x') { dx = d; fdx = d; } else { dy = d; fdy = mirrorY ? -d : d; }
          movesFeatures = true;
        }
      } else throw new Error(`${s.what}: not handled`);
      if (exp && (dx || dy)) {
        const pl = planeNameOf(t, exp.geometries[0]); const [wx, wy, wz] = worldDelta(pl, dx, dy);
        for (const g of exp.geometries) { if (planeNameOf(t, g) !== pl) throw new Error('mixed planes in ' + s.what); put(g, translateGeometry(g, dx, dy)); }
        for (const op of exp.operations) put(op, translateOperation(op, wx, wy, wz));
        if (movesFeatures) for (const f of exp.features) put(f, translateRecords(f, fdx, fdy, 0));
      }
      log.push(`${s.what}: ${o} -> ${n}${exp ? `, ${exp.steps.length} steps moved` : enabled ? '' : ' (off)'}`);
    } else if (s.refType === 'WorkPiece' && opt.resize) {
      wp.push([s.refId, s.prop, o, n]);
    } else if (s.refType === 'GeomCartesianPoint') {
      // only for points used by steps that are off (their toolpath does not run; Maestro recomputes it on save)
      const users = [...t.matchAll(new RegExp('<ManufacturingFeature i:type="[^"]+"[^>]*><Key[^>]*><ID>(\\d+)</ID>(?:(?!</ManufacturingFeature>).)*?<GeometryID[^>]*><b:ID>' + s.refId + '<', 'gs'))]
        .flatMap((f) => [...t.matchAll(new RegExp('<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>\\d+</ID><ObjectType>[^<]*</ObjectType></Key><Name[^>]*>([^<]*)</Name><Description/><IsEnabled>(\\w+)(?:(?!</Executable>).)*?ManufacturingFeatureID[^>]*><b:ID>' + f[1] + '<', 'gs'))]);
      if (!users.length || users.some((u) => u[2] === 'true')) throw new Error(`${s.what} = ${s.formula} changes on a step that runs; not handled`);
      const g = geomBlock(t, s.refId)!; const tag = s.prop === 'X' ? 'a:_x' : 'a:_y';
      const m = new RegExp(`(<${tag}>)([^<]+)(<)`).exec(g.text)!; const p = g.start + m.index + m[1].length;
      edits.push([p, p + m[2].length, pyLen(n, m[2])]);
      log.push(`${s.what}: ${o} -> ${n} (step ${users.map((u) => u[1]).join(', ')} is off; its toolpath is left for Maestro)`);
    } else if (s.refType === 'GeomTrimmedCurve') {
      const r = lines.get(s.refId) ?? {}; r[s.prop] = [o, n]; lines.set(s.refId, r);
    } else throw new Error(`${s.what} = ${s.formula} changes ${o} -> ${n}; not handled`);
  }
  // straight lines: must translate (start and end move by the same amount)
  const lengthChanges: { gid: string; oldL: number; newL: number; axis: string; oldEnd: number; newEnd: number }[] = [];
  for (const [gid, ch] of lines) {
    const g = geomBlock(t, gid)!; const l = lineOf(g.text)!;
    const now = { StartX: l.sx, StartY: l.sy, EndX: l.ex, EndY: l.ey } as Record<string, number>;
    const want = { ...now }; for (const [k, [, n]] of Object.entries(ch)) want[k] = n;
    const dx = want.StartX - now.StartX, dy = want.StartY - now.StartY;
    if (Math.abs(want.EndX - now.EndX - dx) > 1e-6 || Math.abs(want.EndY - now.EndY - dy) > 1e-6) {
      // only the far end moves along an axis-aligned line: the line gets longer or shorter
      const axis = Math.abs(l.dx) < 1e-12 && Math.abs(Math.abs(l.dy) - 1) < 1e-12 ? 'y' : Math.abs(l.dy) < 1e-12 && Math.abs(Math.abs(l.dx) - 1) < 1e-12 ? 'x' : null;
      if (!opt.resize || !axis || Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) throw new Error(`line ${gid}: length or direction changes; not handled`);
      const dL = axis === 'y' ? (want.EndY - now.EndY) * Math.sign(l.dy) : (want.EndX - now.EndX) * Math.sign(l.dx);
      if (Math.abs(axis === 'y' ? want.EndX - now.EndX : want.EndY - now.EndY) > 1e-9) throw new Error(`line ${gid}: end moves off the line`);
      const oldL = r6(l.L), newL = r6(l.L + dL), oldEnd = axis === 'y' ? now.EndY : now.EndX, newEnd = axis === 'y' ? want.EndY : want.EndX;
      lengthChanges.push({ gid, oldL: l.L, newL: l.L + dL, axis, oldEnd, newEnd });
      put(g.text, g.text.replace(/(Description>8 0 )(\S+)(\n)/, (_m, a, _b, c) => a + pyLen(l.L + dL, _b) + c));
      for (const f of t.matchAll(new RegExp('<ManufacturingFeature i:type="[^"]+"[^>]*><Key[^>]*><ID>(\\d+)</ID>(?:(?!</ManufacturingFeature>).)*?<GeometryID[^>]*><b:ID>' + gid + '<', 'gs'))) {
        for (const st of t.matchAll(new RegExp('<Executable i:type="a:MachiningWorkingStep"(?:(?!</Executable>).)*?ManufacturingFeatureID[^>]*><b:ID>' + f[1] + '<(?:(?!</Executable>).)*?OperationID[^>]*><b:ID>(\\d+)', 'gs'))) {
          const op = one(new RegExp('<Operation i:type="[^"]+"[^>]*><Key[^>]*><ID>' + st[1] + '</ID>.*?</Operation>', 's'), t, 'op')[0];
          // the toolpath's copy of the line and the point where the tool leaves at the far end
          const k = axis === 'y' ? 2 : 1;
          let no = op.replace(new RegExp('(Description>8 0 )' + reEsc(String(l.L)) + '(\\n)', 'g'), (_m, a, c) => a + pyLen(l.L + dL, String(l.L)) + c);
          no = no.replace(/(\n1 )(\S+) (\S+) /g, (m0, a, x, y) => (k === 2 ? Math.abs(+y - oldEnd) < 1e-9 ? `${a}${x} ${pyLen(newEnd, y)} ` : m0 : Math.abs(+x - oldEnd) < 1e-9 ? `${a}${pyLen(newEnd, x)} ${y} ` : m0));
          // no stored toolpath, or a disabled step whose stored toolpath Maestro already left stale (it does not recompute them)
          if (no === op && (!/Description>8 /.test(op) || /<IsEnabled>false<\/IsEnabled>/.test(st[0].slice(0, 2000)))) continue;
          if (no === op) throw new Error(`line ${gid}: toolpath not updated`);
          put(op, no);
        }
      }
      log.push(`line ${gid}: length ${oldL} -> ${newL}`);
      continue;
    }
    put(g.text, translateGeometry(g.text, dx, dy));
    const pl = planeNameOf(t, g.text); const [wx, wy, wz] = worldDelta(pl, dx, dy);
    // every step whose feature uses this line
    for (const f of t.matchAll(new RegExp('<ManufacturingFeature i:type="[^"]+"[^>]*><Key[^>]*><ID>(\\d+)</ID>(?:(?!</ManufacturingFeature>).)*?<GeometryID[^>]*><b:ID>' + gid + '<', 'gs'))) {
      for (const st of t.matchAll(new RegExp('<Executable i:type="a:MachiningWorkingStep"(?:(?!</Executable>).)*?ManufacturingFeatureID[^>]*><b:ID>' + f[1] + '<(?:(?!</Executable>).)*?OperationID[^>]*><b:ID>(\\d+)', 'gs'))) {
        const op = one(new RegExp('<Operation i:type="[^"]+"[^>]*><Key[^>]*><ID>' + st[1] + '</ID>.*?</Operation>', 's'), t, 'op')[0];
        put(op, translateOperation(op, wx, wy, wz));
      }
    }
    log.push(`line ${gid} (${pl}): moved ${r6(dx)} / ${r6(dy)}`);
  }
  if (wp.length) {
    for (const [id, prop, o, n] of wp) {
      const m = new RegExp('<WorkPiece><Key[^>]*><ID>' + id + '</ID>').exec(t)!; const end = t.indexOf('</WorkPiece>', m.index);
      const blk = t.slice(m.index, end); let k = 0;
      for (const f of blk.matchAll(new RegExp(`(<(?:a:)?${prop}>)([^<]+)(<)`, 'g'))) {
        if (Math.abs(+f[2] - o) > 1e-9) continue;
        const p = m.index + f.index! + f[1].length; edits.push([p, p + f[2].length, pyLen(n, f[2])]); k++;
      }
      if (!k) throw new Error(`workpiece ${prop} ${o} not found`);
      log.push(`workpiece ${prop}: ${o} -> ${n} (${k})`);
      // planes: sizes / far-side origins that equal the old size, and the saw planes that copy a line that changed length
      const planesAt = t.indexOf('<Planes>'), planesEnd = t.indexOf('</Planes>');
      const pl = t.slice(planesAt, planesEnd);
      for (const f of pl.matchAll(/(<(XDimension|YDimension|a:_xP|a:_yP|a:_zP)>)([^<]+)(<)/g)) {  // saw planes keep their <Width> (Maestro leaves it)
        const v = +f[3]; let nv: number | null = null;
        if (Math.abs(v - o) < 1e-9 && f[2] !== 'a:_zP') nv = n;
        for (const c of lengthChanges) if (f[2] === 'XDimension' && Math.abs(v - c.oldL) < 1e-9) nv = c.newL;
        if (nv === null) continue;
        const p = planesAt + f.index! + f[1].length; edits.push([p, p + f[3].length, pyLen(nv, f[3])]);
      }
      for (const c of lengthChanges) for (const f of pl.matchAll(new RegExp('(Description>8 0 )(' + reEsc(String(c.oldL)) + ')(\\n)', 'g'))) {
        const p = planesAt + f.index! + f[1].length; edits.push([p, p + f[2].length, pyLen(c.newL, f[2])]);
      }
    }
  }
  return { xml: splice(t, edits), log };
}
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** keep the look of the number we replace: Maestro writes integers bare in these fields */
const pyLen = (v: number, like: string) => (/^-?\d+$/.test(like) && Number.isInteger(Math.round(v * 1e6) / 1e6) ? String(Math.round(v)) : r6(v));

if (process.argv[1]?.endsWith('applyvars.ts')) {
  const [src, out, name, ...kv] = process.argv.slice(2);
  const a = readPgmx(src); const orig = getXml(a);
  const flags = kv.filter((s) => s.startsWith('--')); const kvs = kv.filter((s) => !s.startsWith('--'));
  const sizeFree = flags.find((f) => f.startsWith('--size-free='))?.slice(12).split(',') ?? [];
  const { xml, log } = applyVars(orig, Object.fromEntries(kvs.map((s) => { const [k, v] = s.split('='); return [k, +v]; })), { resize: flags.includes('--resize'), sizeFreeMacros: sizeFree });
  assertSafe(orig, xml);
  // nothing stale afterwards
  const V = variableValues(xml); const stale: string[] = [];
  for (const e of [...xml.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0])) {
    const s = storedValue(xml, e); if (s.kind !== 'num') continue;
    const v = evaluate(s.formula, V); if (Math.abs(v - s.value) > 1e-6) stale.push(`${s.what}: ${s.value} vs ${v}`);
  }
  if (stale.length) throw new Error('stale after the change:\n  ' + stale.join('\n  '));
  writePgmx(a, xml, out, name);
  console.log(name + '\n  ' + log.join('\n  '));
}
