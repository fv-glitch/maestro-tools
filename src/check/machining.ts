/**
 * What a program will actually cut: every enabled machining step with its macro, plane, depth and
 * geometry extents, read from the steps stored in the file (not from the formulas).
 */
import { parseXml, walk, local, child, kids, text, type, keyId, type XNode } from '../engine/xmltree';

export interface Box { x0: number; x1: number; y0: number; y1: number }
export interface Machining {
  step: string; enabled: boolean; path: string[]; macro?: string;
  feature: string; plane: string; depth?: number; diameter?: number;
  geometry: string; box?: Box; center?: [number, number]; radius?: number;
}

function recordsBox(recs: string[]): { box?: Box; center?: [number, number]; radius?: number } {
  const pts: [number, number][] = []; let center: [number, number] | undefined; let radius: number | undefined;
  for (const rec of recs) {
    for (const m of rec.matchAll(/(?:^|\n)8 ([^\n]*)\n([12]) ([^\n]*)/g)) {
      const p = m[1].trim().split(/\s+/).map(Number); const v = m[3].trim().split(/\s+/).map(Number);
      if (m[2] === '1') { const [x, y, , dx, dy] = v; pts.push([x + p[0] * dx, y + p[0] * dy], [x + p[1] * dx, y + p[1] * dy]); }
      else { const [cx, cy] = v; const r = v[v.length - 1]; pts.push([cx - r, cy - r], [cx + r, cy + r]); }
    }
    const c = /^2 (\S+) (\S+) .* (\S+)\s*$/.exec(rec.trim());
    if (c && !rec.trim().startsWith('8')) { center = [+c[1], +c[2]]; radius = +c[3]; pts.push([center[0] - radius, center[1] - radius], [center[0] + radius, center[1] + radius]); }
  }
  if (!pts.length) return {};
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { box: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }, center, radius };
}

export function machiningOf(xml: string): Machining[] {
  const root = parseXml(xml);
  const planes = new Map<string, string>();
  const feats = new Map<string, XNode>(); const geos = new Map<string, XNode>();
  for (const n of walk(root)) {
    const l = local(n);
    if (l === 'Plane' && local(n.parent!) === 'Planes') planes.set(keyId(n)!, text(n, 'Name') ?? '');
    else if (l === 'ManufacturingFeature') feats.set(keyId(n)!, n);
    else if (l === 'GeomGeometry') geos.set(keyId(n)!, n);
  }
  const out: Machining[] = [];
  const visit = (el: XNode | undefined, path: string[], enabled: boolean, macro?: string) => {
    for (const ex of kids(el, 'Executable')) {
      const t = type(ex); const name = text(ex, 'Name') ?? ''; const en = enabled && text(ex, 'IsEnabled') === 'true';
      const mac = t === 'VisualSubProgram' ? text(ex, 'FileName') ?? name : macro;
      if (t === 'MachiningWorkingStep') {
        const fid = keyId(child(ex, 'ManufacturingFeatureID')); const fe = fid ? feats.get(fid) : undefined;
        const gid = keyId(child(fe, 'GeometryID')); const g = gid ? geos.get(gid) : undefined;
        let depth: number | undefined; for (const d of fe ? walk(fe) : []) if (local(d) === 'EndDepth') { depth = parseFloat(d.text); break; }
        const dia = text(fe, 'Diameter');
        const recs: string[] = [];
        if (g) {
          const desc = text(g, '_serializationGeometryDescription'); if (desc) recs.push(desc);
          for (const s of kids(child(g, '_serializingMembers'), 'string')) recs.push(s.text);
        }
        let geo = recordsBox(recs);
        const px = text(g, '_x'), py = text(g, '_y');
        if (px !== undefined && py !== undefined) geo = { center: [+px, +py], box: { x0: +px, x1: +px, y0: +py, y1: +py } };
        out.push({ step: name, enabled: en, path, macro: mac, feature: fe ? type(fe) : '?', plane: planes.get(keyId(child(g, 'PlaneID')) ?? '') ?? '?',
          depth, diameter: dia ? parseFloat(dia) : undefined, geometry: g ? type(g) : '?', ...geo });
      }
      visit(child(ex, 'Elements'), [...path, name], en, mac);
    }
  };
  for (const n of walk(root)) if (local(n) === 'MainWorkplan') visit(child(n, 'Elements'), [], true);
  return out;
}
