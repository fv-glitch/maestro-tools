/**
 * View model for the .pgmx viewer: every machining step with its stored toolpath turned into
 * polylines, projected onto the face it is cut from.
 *
 * Toolpath records are in world coordinates (X along the part, Y across, Z up, top face Z = dz1).
 *   line: `8 p0 p1` / `1 x y z dx dy dz`        point(p) = (x,y,z) + p*(dx,dy,dz)
 *   arc : `8 t0 t1` / `2 cx cy cz n(3) u(3) v(3) r`  point(t) = c + r(cos t * u + sin t * v)
 * The face is taken from the approach direction (down -> top, -Y -> back edge, +Y -> front edge ...).
 */
import { parseXml, walk, local, child, kids, text, type, keyId, type XNode } from '../engine/xmltree';
import { variableValues } from '../engine/variables';

export type Face = 'top' | 'front' | 'back' | 'left' | 'right' | 'bottom';
export type P3 = [number, number, number];
export interface ViewStep {
  id: string; name: string; groups: string[]; enabled: boolean; macro?: string;
  tool?: string; feature: string; depth?: number; face: Face;
  cut: P3[][]; moves: P3[][];
}
export interface ViewModel { name: string; L: number; W: number; T: number; steps: ViewStep[] }

function sampleRecords(recs: string[]): P3[] {
  const pts: P3[] = [];
  for (const rec of recs) {
    for (const m of rec.matchAll(/(?:^|\n)8 ([^\n]*)\n([12]) ([^\n]*)/g)) {
      const [p0, p1] = m[1].trim().split(/\s+/).map(Number); const v = m[3].trim().split(/\s+/).map(Number);
      if (m[2] === '1') {
        const [x, y, z, dx, dy, dz] = v;
        pts.push([x + p0 * dx, y + p0 * dy, z + p0 * dz], [x + p1 * dx, y + p1 * dy, z + p1 * dz]);
      } else {
        const [cx, cy, cz, , , , ux, uy, uz, vx, vy, vz] = v; const r = v[12];
        const n = Math.max(2, Math.ceil(Math.abs(p1 - p0) / (Math.PI / 36)));
        for (let i = 0; i <= n; i++) {
          const t = p0 + (p1 - p0) * i / n, c = Math.cos(t), s = Math.sin(t);
          pts.push([cx + r * (c * ux + s * vx), cy + r * (c * uy + s * vy), cz + r * (c * uz + s * vz)]);
        }
      }
    }
  }
  return pts;
}

function curveRecords(curve: XNode | undefined): string[] {
  if (!curve) return [];
  const out: string[] = [];
  const d = text(curve, '_serializationGeometryDescription'); if (d) out.push(d);
  for (const s of kids(child(curve, '_serializingMembers'), 'string')) out.push(s.text);
  return out;
}

function faceOf(approach: P3[], cut: P3[]): Face {
  let d: P3 | undefined;
  if (approach.length >= 2) { const a = approach[0], b = approach[approach.length - 1]; d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; }
  if (!d || Math.hypot(...d) < 1e-6) return 'top';
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  if (az >= ax && az >= ay) return d[2] < 0 ? 'top' : 'bottom';
  if (ay >= ax) return d[1] < 0 ? 'back' : 'front';
  void cut; return d[0] < 0 ? 'right' : 'left';
}

export function viewModel(xml: string, name = ''): ViewModel {
  const root = parseXml(xml); const vars = variableValues(xml);
  const feats = new Map<string, XNode>(); const ops = new Map<string, XNode>();
  for (const n of walk(root)) {
    const l = local(n);
    if (l === 'ManufacturingFeature') feats.set(keyId(n)!, n);
    else if (l === 'Operation' && local(n.parent!) === 'Operations') ops.set(keyId(n)!, n);
  }
  const steps: ViewStep[] = [];
  const visit = (el: XNode | undefined, groups: string[], enabled: boolean, macro?: string) => {
    for (const ex of kids(el, 'Executable')) {
      const t = type(ex); const nm = text(ex, 'Name') ?? ''; const en = enabled && text(ex, 'IsEnabled') === 'true';
      const mac = t === 'VisualSubProgram' ? text(ex, 'FileName') ?? nm : macro;
      if (t === 'MachiningWorkingStep') {
        const fe = feats.get(keyId(child(ex, 'ManufacturingFeatureID')) ?? '');
        const op = ops.get(keyId(child(ex, 'OperationID')) ?? '');
        let depth: number | undefined; for (const d of fe ? walk(fe) : []) if (local(d) === 'EndDepth') { depth = parseFloat(d.text); break; }
        const tool = text(child(op, 'ToolKey'), 'Name');
        const cut: P3[][] = [], moves: P3[][] = []; let approach: P3[] = [];
        for (const tp of kids(child(op, 'ToolpathList'), 'Toolpath')) {
          const pts = sampleRecords(curveRecords(child(tp, 'BasicCurve')));
          if (!pts.length) continue;
          const kind = text(tp, 'Type');
          if (kind === 'TrajectoryPath') cut.push(pts); else moves.push(pts);
          if (kind === 'Approach') approach = pts;
        }
        steps.push({ id: keyId(ex)!, name: nm, groups, enabled: en, macro: mac, tool, feature: fe ? type(fe) : '?', depth,
          face: faceOf(approach, cut[0] ?? []), cut, moves });
      }
      visit(child(ex, 'Elements'), t === 'MachiningWorkingStep' ? groups : [...groups, nm], en, mac);
    }
  };
  for (const n of walk(root)) if (local(n) === 'MainWorkplan') visit(child(n, 'Elements'), [], true);
  return { name, L: vars.dx1 ?? 0, W: vars.dy1 ?? 0, T: vars.dz1 ?? 0, steps };
}
