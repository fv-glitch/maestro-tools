/**
 * Panel programs built from scratch for flat-pack / carcass work (first job: the window wall library).
 *
 * Nothing here invents Maestro structure. A blank program is the owner's TestingDoorReal with every
 * machining step, subprogram, feature, geometry, operation, variable and expression removed (the
 * workpiece, planes, layers, setup and park move stay exactly as Maestro wrote them). Steps are
 * clones of proven templates:
 *   pocket      ITM  'E016 8mm - Pocket(3)-1143main7_1(1)(1)'   rectangle ClosedPocket, Top
 *   drill 3/8   TDR  'E022 3mm Drill - Dummy pilot 1 RH hung', 'E024 8mm Drill - QF stud 1 RH hung'
 *   edge drill  APEX 'Boring' (HingeHoleLH1, Front plane) with the tool swapped to E024
 *   saw         APEX 'Cut Side LH' (cut along X) and 'Cut Side LH(1)' (cut along Y), E015
 * Coordinates are world: X along the part (dx1), Y across (dy1), Z up, top face Z = dz1.
 */
import { Ids, blocks, cloneBlocks, renameStep, ln, setDesc, setMembers, setTrajectory, setGeoName, setDepth, setOpValue, splice, NS_PROJECT } from '../engine/pgmx';
import { Expressions, makeVariable, geometryRef } from '../engine/params';
import { rectPocketPath } from '../engine/geometry';
import { insertPoint } from '../engine/workplan';
import { pyRepr as r } from '../engine/pyfmt';

const UTIL = 'http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Utility';
const GEO = 'ScmGroup.XCam.MachiningDataModel.Geometry.';
const E024 = '2149911873';

export interface Templates { pocket: string[]; drill3: string[]; drill8: string[]; edge: string[]; sawX: string[]; sawY: string[]; src: string[] }

export function loadTemplates(itm: string, tdr: string, apex: string): Templates {
  return {
    pocket: blocks(itm, 'E016 8mm - Pocket(3)-1143main7_1(1)(1)'),
    drill3: blocks(tdr, 'E022 3mm Drill - Dummy pilot 1 RH hung'),
    drill8: blocks(tdr, 'E024 8mm Drill - QF stud 1 RH hung'),
    edge: blocks(apex, 'Boring'),
    sawX: blocks(apex, 'Cut Side LH'),
    sawY: blocks(apex, 'Cut Side LH(1)'),
    src: [itm, tdr, apex],
  };
}

const sect = (t: string, tag: string) => {
  const m = new RegExp(`<${tag}(?: [^>]*)?>`).exec(t); if (!m) throw new Error('no <' + tag + '>');
  const end = t.indexOf(`</${tag}>`, m.index); return { open: m.index, start: m.index + m[0].length, end };
};

/**
 * TestingDoorReal emptied to a bare workpiece of L x W x T. Keeps the Xn park move, workpiece setup,
 * planes and layers; adds the BoardT variable (copied from Handle, so no description/flags are invented).
 */
export function blankProgram(base: string, L: number, W: number, T: number, extraVars: [string, number][] = []): string {
  let t = base;
  // workplan: keep only the trailing Xn (park) executables
  const mw = t.indexOf('<MainWorkplan>'); const open = t.indexOf('<Elements', mw);
  const start = t.indexOf('>', open) + 1; const close = matchClose(t, open, 'Elements');
  // top-level park moves only (an Xn has no children, so a lazy match cannot run past its own end)
  const xns = [...t.slice(start, close).matchAll(/<Executable i:type="Xn">.*?<\/Executable>/gs)].map((m) => m[0]);
  if (!xns.length) throw new Error('base has no park move');
  t = t.slice(0, start) + xns.join('') + t.slice(close);
  for (const tag of ['Features', 'Geometries', 'Operations']) { const s = sect(t, tag); t = t.slice(0, s.start) + t.slice(s.end); }
  // expressions: only the workpiece ones (Length/Width/Depth = dx1/dy1/dz1)
  { const s = sect(t, 'Expressions'); const keep = [...t.slice(s.start, s.end).matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0]).filter((e) => e.includes('ProjectModule.WorkPiece</b:ObjectType>'));
    if (keep.length !== 3) throw new Error('expected 3 workpiece expressions'); t = t.slice(0, s.start) + keep.join('') + t.slice(s.end); }
  // variables: dx1 dy1 dz1 (+ extras cloned from Handle)
  { const s = sect(t, 'Variables'); const all = [...t.slice(s.start, s.end).matchAll(/<a:Variable>.*?<\/a:Variable>/gs)].map((m) => m[0]);
    const name = (v: string) => /<Name xmlns="[^"]*">([^<]*)</.exec(v)![1];
    const keep = all.filter((v) => ['dx1', 'dy1', 'dz1'].includes(name(v)));
    const ids = new Ids(t);
    const extra = extraVars.map(([n, val]) => makeVariable(ids, t, 'Handle', n, r(val)));
    t = t.slice(0, s.start) + keep.join('') + extra.join('') + t.slice(s.end); }
  return setSize(t, L, W, T);
}

export function matchClose(t: string, open: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}(?:[ >/])`, 'g'); re.lastIndex = open + 1; let depth = 1; let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (t[t.indexOf('>', m.index) - 1] === '/' && !m[1]) continue;   // <Elements/>
    depth += m[1] ? -1 : 1; if (!depth) return m.index;
  }
  throw new Error('unclosed ' + tag);
}

/** Workpiece, dx1/dy1/dz1 and the six face planes for a part of L x W x T. */
export function setSize(t: string, L: number, W: number, T: number): string {
  const setVar = (s: string, n: string, v: number) => s.replace(new RegExp(`(<Name xmlns="[^"]*">${n}</Name>.*?<a:Value[^>]*>)[^<]*(<)`, 's'), (_m, a, b) => a + r(v) + b);
  t = setVar(setVar(setVar(t, 'dx1', L), 'dy1', W), 'dz1', T);
  t = t.replace(/(<WorkPiece>.*?<\/WorkPiece>)/s, (wpc) => wpc
    .replace(/(<Depth>)[^<]*(<\/Depth><DepthName>)/, (_m, a, b) => a + r(T) + b)
    .replace(/(<a:Depth>)[^<]*(<\/a:Depth><a:Length>)[^<]*(<\/a:Length><a:Width>)[^<]*(<)/, (_m, a, b, c, d) => a + r(T) + b + r(L) + c + r(W) + d)
    .replace(/(<\/Geometry><Length>)[^<]*(<)/, (_m, a, b) => a + r(L) + b)
    .replace(/(<\/State><Width>)[^<]*(<)/, (_m, a, b) => a + r(W) + b));
  const plane: Record<string, [number, number, number, number, number]> = {     // P(x,y,z), XDim, YDim
    Top: [0, 0, T, L, W], Right: [L, 0, 0, W, T], Left: [0, W, 0, W, T], Front: [0, 0, 0, L, T], Back: [L, W, 0, L, T], Bottom: [0, W, 0, L, W] };
  return t.replace(/<Plane>.*?<\/Plane>/gs, (p) => {
    const nm = /Utility">([^<]*)<\/Name>/.exec(p)![1]; const v = plane[nm]; if (!v) return p;
    return p.replace(/(<a:_xP>)[^<]*(<)/, (_m, a, b) => a + r(v[0]) + b).replace(/(<a:_yP>)[^<]*(<)/, (_m, a, b) => a + r(v[1]) + b)
      .replace(/(<a:_zP>)[^<]*(<)/, (_m, a, b) => a + r(v[2]) + b)
      .replace(/(<XDimension>)[^<]*(<\/XDimension><YDimension>)[^<]*(<)/, (_m, a, b, c) => a + r(v[3]) + b + r(v[4]) + c);
  });
}

export function planeId(t: string, name: string): string {
  const m = new RegExp(`<Plane><Key[^>]*><ID>(\\d+)</ID>.{0,200}?Utility">${name}</Name>`, 's').exec(t);
  if (!m) throw new Error('no plane ' + name); return m[1];
}

export type Edge = 'X0' | 'X1' | 'Y0' | 'Y1';
const EDGE_PLANE: Record<Edge, string> = { X0: 'Left', X1: 'Right', Y0: 'Front', Y1: 'Back' };

/** Collects cloned steps and splices them into a blank program in one go. */
export class Builder {
  readonly ids: Ids; readonly ex: Expressions;
  private groups: { name: string; steps: string[] }[] = [];
  private feats: string[] = []; private geos: string[] = []; private ops: string[] = [];
  readonly L: number; readonly W: number; readonly T: number; readonly CLR: number;
  constructor(private t: string, private tp: Templates) {
    this.ids = new Ids(t, ...tp.src); this.ex = new Expressions(t, this.ids);
    const v = (n: string) => parseFloat(new RegExp(`<Name xmlns="[^"]*">${n}</Name>.*?<a:Value[^>]*>([^<]*)`, 's').exec(t)![1]);
    this.L = v('dx1'); this.W = v('dy1'); this.T = v('dz1'); this.CLR = this.T + 50;
  }
  private add(group: string, st: string, fm: string, gm: string, om: string) {
    let g = this.groups.find((x) => x.name === group); if (!g) this.groups.push(g = { name: group, steps: [] });
    g.steps.push(st); this.feats.push(fm); this.geos.push(gm); this.ops.push(om);
  }

  /**
   * Rectangular pocket [x0,x1] x [y0,y1] on the top face, `depth` deep, E016 (ContourParallel, 2.667 max per level).
   * exprX/exprY: optional formulas for the rectangle's sides (housing walls that follow BoardT).
   */
  pocket(group: string, name: string, x0: number, y0: number, x1: number, y1: number, depth: number,
    expr?: { x0?: string; x1?: string; y0?: string; y1?: string }): void {
    let [st, fm, gm, om] = cloneBlocks(this.ids, this.tp.pocket);
    const Lx = x1 - x0, Wy = y1 - y0; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // same member order and directions as the ITM template: x1,y1 -> x0,y1 -> x0,y0 -> x1,y0 -> x1,y1
    const rect = [`8 0 ${r(Lx)}\n1 ${r(x1)} ${r(y1)} 0 -1 0 0 \n`, `8 0 ${r(Wy)}\n1 ${r(x0)} ${r(y1)} 0 0 -1 0 \n`,
      `8 0 ${r(Lx)}\n1 ${r(x0)} ${r(y0)} 0 1 0 0 \n`, `8 0 ${r(Wy)}\n1 ${r(x1)} ${r(y0)} 0 0 1 0 \n`];
    gm = setGeoName(setMembers(this.ids, gm, rect), name.replace(/^E0\d+ [^-]*- /, '').replace(/ /g, ''));
    fm = setDepth(setMembers(this.ids, fm, rect), depth);
    // rectPocketPath works along the long side in X; for pockets long in Y, build it transposed
    const along = Lx >= Wy;
    const pk = along ? rectPocketPath(this.T, cx, cy, Lx, Wy, depth, 2.667) : rectPocketPath(this.T, cy, cx, Wy, Lx, depth, 2.667);
    const sw = (rec: string) => along ? rec : swapXY(rec);
    const s = along ? pk.start : [pk.start[1], pk.start[0], pk.start[2]], e = along ? pk.end : [pk.end[1], pk.end[0], pk.end[2]];
    om = setTrajectory(this.ids, om, pk.path.map(sw));
    om = setOpValue(om, 'AxialCuttingDepth', r(depth / pk.levels));
    om = setDesc(om, 'Approach', ln(s[0], s[1], this.CLR, 0, 0, -1, this.CLR - s[2]), this.CLR - s[2]);
    om = setDesc(om, 'Lift', ln(e[0], e[1], e[2], 0, 0, 1, this.CLR - e[2]), this.CLR - e[2]);
    this.add(group, renameStep(st, name, true), fm, gm, om);
    if (expr) {
      const [gid, gtype] = geometryRef(gm);
      // element i: 0 top (x1->x0 @y1), 1 left (y1->y0 @x0), 2 bottom (x0->x1 @y0), 3 right (y0->y1 @x1)
      const set = (i: number, p: string, v?: string) => { if (v) this.ex.element(i, p, gid, gtype, v); };
      set(0, 'StartX', expr.x1); set(0, 'EndX', expr.x0); set(1, 'StartX', expr.x0); set(1, 'EndX', expr.x0);
      set(2, 'StartX', expr.x0); set(2, 'EndX', expr.x1); set(3, 'StartX', expr.x1); set(3, 'EndX', expr.x1);
      set(0, 'StartY', expr.y1); set(0, 'EndY', expr.y1); set(1, 'StartY', expr.y1); set(1, 'EndY', expr.y0);
      set(2, 'StartY', expr.y0); set(2, 'EndY', expr.y0); set(3, 'StartY', expr.y0); set(3, 'EndY', expr.y1);
    }
  }

  /**
   * Vertical hole from the top face: 3 mm (E022) or 8 mm (E024).
   * expr: optional formulas for the point's X / Y (GeomCartesianPoint X/Y, as in the DummyHandleX build).
   */
  drill(group: string, name: string, x: number, y: number, dia: 3 | 8, depth: number, expr?: { x?: string; y?: string }): void {
    let [st, fm, gm, om] = cloneBlocks(this.ids, dia === 3 ? this.tp.drill3 : this.tp.drill8);
    gm = gm.replace(/(<a:_x>)[^<]*(<\/a:_x><a:_y>)[^<]*(<\/a:_y>)/, (_m, a, b, c) => a + r(x) + b + r(y) + c);
    gm = setGeoName(gm, name.replace(/^E0\d+ [^-]*- /, '').replace(/ /g, ''));
    fm = setDepth(fm, depth).replace(/(<a:Diameter>)[^<]*(<)/, (_m, a, b) => a + dia + b);
    om = setDesc(om, 'Approach', ln(x, y, this.CLR, 0, 0, -1, this.CLR - this.T), this.CLR - this.T);
    om = setTrajectory(this.ids, om, [ln(x, y, this.T, 0, 0, -1, depth)]);
    om = setDesc(om, 'Lift', ln(x, y, this.T - depth, 0, 0, 1, this.CLR - this.T + depth), this.CLR - this.T + depth);
    this.add(group, renameStep(st, name, true), fm, gm, om);
    if (expr) {
      const [gid, gtype] = geometryRef(gm);
      if (expr.x) this.ex.prop('X', gid, gtype, expr.x);
      if (expr.y) this.ex.prop('Y', gid, gtype, expr.y);
    }
  }

  /**
   * Horizontal 8 mm hole into an edge (E024). pos = along the edge (x for Y0/Y1, y for X0/X1), z = height above the bottom face.
   * Plane coordinates (from the planes' P/N/Vx): Front x=X, Left x=W-Y, Right x=Y, Back x=L-X; plane y = Z on all four.
   */
  edgeDrill(group: string, name: string, edge: Edge, pos: number, z: number, depth: number): void {
    let [st, fm, gm, om] = cloneBlocks(this.ids, this.tp.edge);
    const { L, W } = this;
    const px = { X0: W - pos, X1: pos, Y0: pos, Y1: L - pos }[edge];
    // entry point on the edge and the inward drilling direction (world)
    const [ex, ey, dx, dy] = { X0: [0, pos, 1, 0], X1: [L, pos, -1, 0], Y0: [pos, 0, 0, 1], Y1: [pos, W, 0, -1] }[edge];
    const pid = planeId(this.t, EDGE_PLANE[edge]);
    gm = gm.replace(/(<a:PlaneID[^>]*><b:ID>)\d+(<)/, (_m, a, b) => a + pid + b)
      .replace(/(<a:_x>)[^<]*(<\/a:_x><a:_y>)[^<]*(<\/a:_y>)/, (_m, a, b, c) => a + r(px) + b + r(z) + c);
    gm = setGeoName(gm, name.replace(/^E0\d+ [^-]*- /, '').replace(/ /g, ''));
    fm = setDepth(fm, depth).replace(/(<a:Diameter>)[^<]*(<)/, (_m, a, b) => a + '8' + b);
    om = om.replace(/(<ToolKey[^>]*><b:ID>)\d+(<\/b:ID><b:ObjectType>[^<]*<\/b:ObjectType><b:Name>)E022(<)/, (_m, a, b, c) => a + E024 + b + 'E024' + c);
    if (!om.includes('<b:Name>E024<')) throw new Error('edge drill tool swap failed');
    const OUT = 20;
    om = setDesc(om, 'Approach', ln(ex - dx * OUT, ey - dy * OUT, z, dx, dy, 0, OUT), OUT);
    om = setTrajectory(this.ids, om, [ln(ex, ey, z, dx, dy, 0, depth)]);
    om = setDesc(om, 'Lift', ln(ex + dx * depth, ey + dy * depth, z, -dx, -dy, 0, depth + OUT), depth + OUT);
    this.add(group, renameStep(st, name, true), fm, gm, om);
  }

  /**
   * Through saw cut (E015) with the blade centre on `c`: along X (y = c) or along Y (x = c), running
   * `run` mm past both ends of the part. The geometry line is the kerf edge on the right of travel
   * (the template's SideOfFeature=Left puts the blade on its left), so the blade centre lands on c.
   */
  saw(group: string, name: string, axis: 'x' | 'y', c: number, run = 100): void {
    let [st, fm, gm, om] = cloneBlocks(this.ids, axis === 'x' ? this.tp.sawX : this.tp.sawY);
    const { L, W, T } = this; const half = 3.15 / 2; const Z = -0.2, CL = T + 52;
    let geo: string, path: string, a: [number, number], b: [number, number];
    if (axis === 'x') {   // template travels -X; blade on the left of travel = -Y side of the line
      const len = L + 2 * run; a = [L + run, c]; b = [-run, c];
      geo = `8 0 ${r(len)}\n1 ${r(L + run)} ${r(c + half)} 0 -1 0 0 \n`; path = `8 0 ${r(len)}\n1 ${r(L + run)} ${r(c)} ${r(Z)} -1 0 0 \n`;
    } else {              // template travels +Y; blade on the left of travel = -X side of the line
      const len = W + 2 * run; a = [c, -run]; b = [c, W + run];
      geo = `8 0 ${r(len)}\n1 ${r(c + half)} ${r(-run)} 0 0 1 0 \n`; path = `8 0 ${r(len)}\n1 ${r(c)} ${r(-run)} ${r(Z)} 0 1 0 \n`;
    }
    gm = gm.replace(/(_serializationGeometryDescription>)[^<]*(<)/, (_m, p, q) => p + geo + q);
    gm = setGeoName(gm, name.replace(/^E0\d+ [^-]*- /, '').replace(/ /g, ''));
    fm = setDepth(fm, T);
    om = om.replace(/(<b:Type>TrajectoryPath<\/b:Type>.*?_serializationGeometryDescription>)[^<]*(<)/s, (_m, p, q) => p + path + q);
    om = setDesc(om, 'Approach', ln(a[0], a[1], CL, 0, 0, -1, CL - Z), CL - Z);
    om = setDesc(om, 'Lift', ln(b[0], b[1], Z, 0, 0, 1, CL - Z), CL - Z);
    this.add(group, renameStep(st, name, true), fm, gm, om);
  }

  /**
   * Splice everything in: steps in ExecutableGroups after the last top-level step and before the
   * trailing park move(s) (on a blank that is the start of the workplan), blocks into their sections.
   */
  finish(): string {
    const t = this.t;
    const groups = this.groups.map((g) => `<Executable i:type="a:ExecutableGroup" xmlns:a="${NS_PROJECT}"><Key xmlns="${UTIL}"><ID>${this.ids.take()}</ID>` +
      `<ObjectType>ScmGroup.XCam.MachiningDataModel.ProjectModule.ExecutableGroup</ObjectType></Key><Name xmlns="${UTIL}">${g.name}</Name>` +
      `<Description/><IsEnabled>true</IsEnabled><Priority>0</Priority><Elements>${g.steps.join('')}</Elements></Executable>`).join('');
    const park = insertPoint(t);
    const at = (tag: string) => t.indexOf(`</${tag}>`);
    return splice(t, [[park, park, groups], [at('Features'), at('Features'), this.feats.join('')], [at('Geometries'), at('Geometries'), this.geos.join('')],
      [at('Operations'), at('Operations'), this.ops.join('')], [at('Expressions'), at('Expressions'), this.ex.items.join('')]]);
  }
}

/** Swap X and Y in a line record (used to run a pocket path transposed). */
function swapXY(rec: string): string {
  const [a, b] = rec.split('\n'); const v = b.trim().split(/\s+/);
  return `${a}\n${v[0]} ${v[2]} ${v[1]} ${v[3]} ${v[5]} ${v[4]} ${v[6]} \n`;
}
export { GEO };
