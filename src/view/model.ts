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
import { readTools, type ToolInfo } from '../engine/tools';
import type { PgmxArchive } from '../engine/archive';
import { getXml } from '../engine/archive';

export type Face = 'top' | 'front' | 'back' | 'left' | 'right' | 'bottom';
export type P3 = [number, number, number];
export interface ViewStep {
  id: string; name: string; groups: string[]; enabled: boolean; macro?: string;
  tool?: string; feature: string; depth?: number; face: Face;
  cut: P3[][]; moves: P3[][];
  /** cutting width of the tool (diameter; kerf for a saw) when the tool library has it */
  toolDia?: number; toolDesc?: string;
  /** size of the cut on its face: extent along the face's two axes (toolpath + tool width) and depth into the face */
  size?: CutSize;
  /** the toolpath where it is inside the material (cut + the in-material part of approach/lift) */
  sweep?: P3[][];
}
export interface CutSize {
  a: number; b: number; depth: number; through: boolean; axes: [string, string];
  /** the tool runs off the face (e.g. a hinge mortise open to one face): a and b are only what is in the part */
  open: boolean;
}
export interface ViewModel { name: string; L: number; W: number; T: number; steps: ViewStep[]; tools: Record<string, ToolInfo> }

/**
 * Face frame: plane origin o, in-plane axes u, v, and the inward normal n (the way the tool goes in).
 * A world point p sits at plane (a, b) = ((p-o).u, (p-o).v) and depth (p-o).n below that face.
 * The renderer's cut simulation uses the same frames (keep them in step).
 */
export function faceFrame(face: Face, L: number, W: number, T: number) {
  const F: Record<Face, { o: P3; u: P3; v: P3; n: P3; axes: [string, string]; thick: number; ext: [number, number] }> = {
    top: { o: [0, 0, T], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1], axes: ['X', 'Y'], thick: T, ext: [L, W] },
    bottom: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], axes: ['X', 'Y'], thick: T, ext: [L, W] },
    back: { o: [0, W, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0], axes: ['X', 'Z'], thick: W, ext: [L, T] },
    front: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0], axes: ['X', 'Z'], thick: W, ext: [L, T] },
    right: { o: [L, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [-1, 0, 0], axes: ['Y', 'Z'], thick: L, ext: [W, T] },
    left: { o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0], axes: ['Y', 'Z'], thick: L, ext: [W, T] },
  };
  return F[face];
}

const dot = (p: P3, o: P3, d: P3) => (p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1] + (p[2] - o[2]) * d[2];

/** The parts of a step's toolpaths (cut and approach/lift) that are below the face, i.e. in the material. */
export function inMaterial(polys: P3[][], face: Face, L: number, W: number, T: number): P3[][] {
  const f = faceFrame(face, L, W, T); const out: P3[][] = []; let cur: P3[] = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]; const d = dot(p, f.o, f.n);
      if (i) {
        const q = poly[i - 1]; const dq = dot(q, f.o, f.n);
        if ((d > 1e-3) !== (dq > 1e-3) && Math.abs(d - dq) > 1e-9) {        // crosses the face
          const t = (0 - dq) / (d - dq); const x = q.map((c, k) => r3(c + (p[k] - c) * t)) as P3;
          if (d > 1e-3) cur.push(x); else { cur.push(x); flush(); }
        }
      }
      if (d > 1e-3) cur.push(p);
    }
    flush();
  }
  return out;
}

/** Extent of material a step removes: its in-material toolpath widened by the tool. */
export function cutSize(sweep: P3[][], face: Face, width: number, L: number, W: number, T: number): CutSize | undefined {
  const f = faceFrame(face, L, W, T);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, depth = 0;
  for (const poly of sweep) for (const p of poly) {
    const a = dot(p, f.o, f.u), b = dot(p, f.o, f.v), d = dot(p, f.o, f.n);
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); depth = Math.max(depth, d);
  }
  if (!(depth > 1e-3)) return undefined;
  const r = (x: number) => Math.round(x * 100) / 100; const h = width / 2;
  // only what is in the part. Jamb programs (modelled 0.1 thick) hold several pieces placed outside
  // dx1 x dy1, so their cuts are never clipped.
  const clip = (lo: number, hi: number, ext: number): [number, boolean] =>
    T < 1 ? [hi - lo, false] : [Math.min(hi, ext) - Math.max(lo, 0), lo < -1e-3 || hi > ext + 1e-3];
  const [a, oa] = clip(a0 - h, a1 + h, f.ext[0]), [b, ob] = clip(b0 - h, b1 + h, f.ext[1]);
  return { a: r(a), b: r(b), depth: r(depth), open: oa || ob,
    through: f.thick >= 1 && depth >= f.thick - 1e-3,   // jamb programs model the part 0.1 thick: never 'through'
    axes: f.axes };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;   // 1 micron: keeps the JSON for big programs small

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
  return pts.map((p) => [r3(p[0]), r3(p[1]), r3(p[2])] as P3);
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

/** View model straight from an opened archive (adds the tool library). */
export function viewModelOf(a: PgmxArchive, name = ''): ViewModel {
  const tl = a.entries.find((e) => /\.tlgx$/i.test(e.name));
  return viewModel(getXml(a), name, tl ? new TextDecoder().decode(tl.data) : undefined);
}

export function viewModel(xml: string, name = '', toolsXml?: string): ViewModel {
  const root = parseXml(xml); const vars = variableValues(xml);
  const tools = readTools(toolsXml); const L = vars.dx1 ?? 0, W = vars.dy1 ?? 0, T = vars.dz1 ?? 0;
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
        const st: ViewStep = { id: keyId(ex)!, name: nm, groups, enabled: en, macro: mac, tool, feature: fe ? type(fe) : '?', depth,
          face: faceOf(approach, cut[0] ?? []), cut, moves };
        const ti = tool ? tools[tool] : undefined;
        st.sweep = inMaterial([...cut, ...moves], st.face, L, W, T);
        if (ti) { st.toolDia = ti.width; st.toolDesc = ti.description; st.size = cutSize(st.sweep, st.face, ti.width, L, W, T); }
        steps.push(st);
      }
      visit(child(ex, 'Elements'), t === 'MachiningWorkingStep' ? groups : [...groups, nm], en, mac);
    }
  };
  for (const n of walk(root)) if (local(n) === 'MainWorkplan') visit(child(n, 'Elements'), [], true);
  return { name, L, W, T, steps, tools };
}
