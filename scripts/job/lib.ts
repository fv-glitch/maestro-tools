// Helpers for job 72427: expand a user macro (.xsp) into a host program the way Maestro stores an
// enabled VisualSubProgram instance, and turn existing instances off the way Maestro stores a disabled one.
import { Ids, cloneBlocks, splice } from '../../src/engine/pgmx';
import { pyRepr } from '../../src/engine/pyfmt';

export const r6 = (v: number) => pyRepr(Math.round(v * 1e6) / 1e6);
export const one = (re: RegExp, s: string, what: string) => { const m = re.exec(s); if (!m) throw new Error('not found: ' + what); return m; };

export interface StepBlocks { steps: string[]; features: string[]; geometries: string[]; operations: string[] }

/** Feature / geometry / operation blocks for a list of step executables found in `src` (the whole file). */
export function stepBlocks(src: string, elems: string): StepBlocks {
  const out: StepBlocks = { steps: [], features: [], geometries: [], operations: [] };
  for (const st of elems.matchAll(/<Executable i:type="a:MachiningWorkingStep".*?<\/a:OperationID>.*?<\/Executable>/gs)) {
    const s = st[0];
    const fid = one(/ManufacturingFeatureID[^>]*><b:ID>(\d+)</, s, 'fid')[1];
    const oid = one(/OperationID[^>]*><b:ID>(\d+)/, s, 'oid')[1];
    const f = one(new RegExp('<ManufacturingFeature i:type="[^"]+"[^>]*><Key[^>]*><ID>' + fid + '</ID>.*?</ManufacturingFeature>', 's'), src, 'feature ' + fid)[0];
    const gid = one(/<GeometryID[^>]*><b:ID>(\d+)/, f, 'gid')[1];
    const g = one(new RegExp('<a:GeomGeometry i:type="a:\\w+"[^>]*><Key[^>]*><ID>' + gid + '</ID>.*?</a:GeomGeometry>', 's'), src, 'geometry ' + gid)[0];
    const o = one(new RegExp('<Operation i:type="[^"]+"[^>]*><Key[^>]*><ID>' + oid + '</ID>.*?</Operation>', 's'), src, 'operation ' + oid)[0];
    out.steps.push(s); out.features.push(f);
    if (!out.geometries.includes(g)) out.geometries.push(g);
    out.operations.push(o);
  }
  return out;
}

/** Move the line/arc records (start point / arc centre) in a block. Vectors (_x/_y/_z ToolAxis etc.) are left alone. */
export function translateRecords(block: string, dx: number, dy: number, dz: number): string {
  return block.replace(/(\n[12] |Description>[12] |string>[12] )(\S+) (\S+) (\S+)( )/g, (_m, a, x, y, z, b) => a + r6(+x + dx) + ' ' + r6(+y + dy) + ' ' + r6(+z + dz) + b);
}
/** Geometry as Maestro expands a macro: plane-coordinate records and cartesian points move in x/y only. */
export function translateGeometry(block: string, dx: number, dy: number): string {
  return translateRecords(block, dx, dy, 0)
    .replace(/(<(\w+:)?_x>)([^<]+)(<)/g, (_m, a, _p, v, b) => a + r6(+v + dx) + b)
    .replace(/(<(\w+:)?_y>)([^<]+)(<)/g, (_m, a, _p, v, b) => a + r6(+v + dy) + b);
}
/** Operation toolpaths as Maestro expands a macro: world records move in x/y/z; ToolAxis and other vectors don't. */
export function translateOperation(block: string, dx: number, dy: number, dz: number): string {
  return translateRecords(block, dx, dy, dz);
}

/** The macro's own steps (MainWorkplan) cloned with fresh IDs, its Top plane mapped to the host's, moved by (dx,dy,dz). */
export function expandMacro(ids: Ids, xsp: string, xspTop: string, hostTop: string, dx: number, dy: number, dz: number): StepBlocks {
  const w = xsp.indexOf('<MainWorkplan>'); const es = xsp.indexOf('<Elements', w); const ee = xsp.indexOf('</Elements>', es);
  const b = stepBlocks(xsp, xsp.slice(es, ee));
  const all = [...b.steps, ...b.features, ...b.geometries, ...b.operations];
  const c = cloneBlocks(ids, all).map((x) => x.split(`>${xspTop}<`).join(`>${hostTop}<`));
  const n1 = b.steps.length, n2 = n1 + b.features.length, n3 = n2 + b.geometries.length;
  // features keep the macro-local boundary copy (that is how Maestro stores expanded steps)
  return { steps: c.slice(0, n1), features: c.slice(n1, n2),
    geometries: c.slice(n2, n3).map((x) => translateGeometry(x, dx, dy)), operations: c.slice(n3).map((x) => translateOperation(x, dx, dy, dz)) };
}

/** Edits that turn named instances off the way Maestro stores a disabled instance. */
export function disableEdits(t: string, names: string[]): { edits: [number, number, string][]; gone: Set<string> } {
  const edits: [number, number, string][] = []; const gone = new Set<string>();
  const VSP = [...t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>(\d+)<\/ID>.*?<Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)<\/IsEnabled><Priority>\d+<\/Priority>(<Elements>|<Elements\/>)/gs)];
  const has = (p: number) => edits.some((x) => x[0] === p);
  for (const nm of names) {
    const m = VSP.filter((v) => v[2] === nm); if (m.length !== 1) throw new Error(`${nm}: ${m.length} instances`);
    const v = m[0]; if (v[3] !== 'true' || v[4] !== '<Elements>') throw new Error(`${nm} is not an enabled, expanded instance`);
    const en = v.index! + v[0].indexOf('<IsEnabled>true') + 11; edits.push([en, en + 4, 'false']);
    const es = v.index! + v[0].length - '<Elements>'.length; const ee = t.indexOf('</Elements>', es) + '</Elements>'.length;
    edits.push([es, ee, '<Elements/>']);
    for (const st of t.slice(es, ee).matchAll(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>(\d+)<\/ID>.*?ManufacturingFeatureID[^>]*><b:ID>(\d+)<\/b:ID>.*?OperationID[^>]*><b:ID>(\d+)/gs)) {
      const [sid, fid, oid] = [st[1], st[2], st[3]];
      const f = one(new RegExp('<ManufacturingFeature i:type="[^"]+"[^>]*><Key[^>]*><ID>' + fid + '</ID>.*?</ManufacturingFeature>', 's'), t, 'feature ' + fid);
      const gid = one(/<GeometryID[^>]*><b:ID>(\d+)/, f[0], 'gid')[1];
      const g = one(new RegExp('<a:GeomGeometry i:type="a:\\w+"[^>]*><Key[^>]*><ID>' + gid + '</ID>.*?</a:GeomGeometry>', 's'), t, 'geometry ' + gid);
      const o = one(new RegExp('<Operation i:type="[^"]+"[^>]*><Key[^>]*><ID>' + oid + '</ID>.*?</Operation>', 's'), t, 'operation ' + oid);
      for (const b of [f, g, o]) if (!has(b.index!)) edits.push([b.index!, b.index! + b[0].length, '']);
      for (const id of [sid, fid, oid, gid]) gone.add(id);
    }
  }
  for (const e of t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)) {
    const ref = /<a:ReferencedObject[^>]*><b:ID>(\d+)<\/b:ID>/.exec(e[0])![1];
    if (gone.has(ref) && !has(e.index!)) edits.push([e.index!, e.index! + e[0].length, '']);
  }
  return { edits, gone };
}

export function checkGone(t: string, gone: Set<string>) { for (const id of gone) if (t.includes(`>${id}<`)) throw new Error('dangling reference to ' + id); }
export { splice };
