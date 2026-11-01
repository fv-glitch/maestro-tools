/**
 * Panel job: part programs from a CNC package's parts.json (window wall format), and saw programs
 * from a two-stage cut plan (scripts/cutplan.py -> plan.json).
 *
 * Part frame (parts.json): x along L from edge X0, y along W from edge Y0, z from face F0 (0) to F1 (T).
 * Setup F1 = F1 up: world = part frame. Setup F0 = turned over about X: world y = W - y.
 */
import { Builder, blankProgram, type Templates, type Edge } from './cabinet';

export interface PartOp { type: 'pocket' | 'drill' | 'edge_drill'; face?: 'F0' | 'F1'; depth: number; dia?: number; x?: number; y?: number; polygon?: number[][]; edge?: Edge; pos?: number; z?: number }
export interface Part { id: string; names: string[]; qty: number; L: number; W: number; T: number; setups: string[]; outline: number[][]; ops: PartOp[] }
export interface Program { name: string; xml: string; part?: string; setup?: string; summary: string }

const TOOL_R = 4, MIN_W = 2 * TOOL_R + 0.5, RUN_OUT = 2, BOARD = 'BoardT';
type Rect = [number, number, number, number];   // x0 y0 x1 y1

/** Point-in-polygon (even-odd) for orthogonal outlines. */
function inside(x: number, y: number, poly: number[][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) c = !c;
  }
  return c;
}

/**
 * Cover an orthogonal region with maximal rectangles (overlap allowed - pockets of equal depth can overlap).
 * cellIn(i, j) says whether grid cell [xs[i], xs[i+1]] x [ys[j], ys[j+1]] is part of the region.
 */
function rectCover(xs: number[], ys: number[], cellIn: (i: number, j: number) => boolean): Rect[] {
  const nx = xs.length - 1, ny = ys.length - 1;
  const cells: boolean[][] = Array.from({ length: nx }, (_, i) => Array.from({ length: ny }, (_, j) => cellIn(i, j)));
  const full = (i0: number, j0: number, i1: number, j1: number) => { for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (!cells[i][j]) return false; return true; };
  const cands: [number, number, number, number][] = [];
  for (let i0 = 0; i0 < nx; i0++) for (let j0 = 0; j0 < ny; j0++) {
    if (!cells[i0][j0]) continue;
    for (let i1 = i0; i1 < nx && cells[i1][j0]; i1++) for (let j1 = j0; j1 < ny && full(i0, j0, i1, j1); j1++) {
      // keep only maximal rectangles
      const grow = (i0 > 0 && full(i0 - 1, j0, i0 - 1, j1)) || (i1 < nx - 1 && full(i1 + 1, j0, i1 + 1, j1)) ||
        (j0 > 0 && full(i0, j0 - 1, i1, j0 - 1)) || (j1 < ny - 1 && full(i0, j1 + 1, i1, j1 + 1));
      if (!grow) cands.push([i0, j0, i1, j1]);
    }
  }
  const covered = cells.map((col) => col.map(() => false)); const out: Rect[] = [];
  for (;;) {
    let best: [number, number, number, number] | null = null, gain = 0;
    for (const c of cands) {
      let g = 0; for (let i = c[0]; i <= c[2]; i++) for (let j = c[1]; j <= c[3]; j++) if (!covered[i][j]) g += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      if (g > gain + 1e-9) { gain = g; best = c; }
    }
    if (!best) break;
    for (let i = best[0]; i <= best[2]; i++) for (let j = best[1]; j <= best[3]; j++) covered[i][j] = true;
    out.push([xs[best[0]], ys[best[1]], xs[best[2] + 1], ys[best[3] + 1]]);
  }
  return out;
}

const uniq = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);

/** Pocket polygon -> rectangles. */
export function pocketRects(poly: number[][]): Rect[] {
  const xs = uniq(poly.map((p) => p[0])), ys = uniq(poly.map((p) => p[1]));
  return rectCover(xs, ys, (i, j) => inside((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, poly));
}

/** Notches: the part's bounding box minus its outline, as rectangles. */
export function notchRects(p: Part): Rect[] {
  const xs = uniq([0, p.L, ...p.outline.map((q) => q[0])]), ys = uniq([0, p.W, ...p.outline.map((q) => q[1])]);
  return rectCover(xs, ys, (i, j) => !inside((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, p.outline));
}

/**
 * Sides of a rectangle on the part's edge run out past it (so no hair is left on the edge), and a
 * rectangle narrower than the cutter is widened on an open side so the pocket has a toolpath.
 */
function runOut(rc: Rect, L: number, W: number, extra = RUN_OUT): Rect {
  let [x0, y0, x1, y1] = rc; const e = 1e-6;
  const open = { x0: x0 <= e, x1: x1 >= L - e, y0: y0 <= e, y1: y1 >= W - e };
  if (open.x0) x0 -= extra; if (open.x1) x1 += extra; if (open.y0) y0 -= extra; if (open.y1) y1 += extra;
  if (x1 - x0 < MIN_W) { if (open.x0) x0 = x1 - MIN_W; else if (open.x1) x1 = x0 + MIN_W; }
  if (y1 - y0 < MIN_W) { if (open.y0) y0 = y1 - MIN_W; else if (open.y1) y1 = y0 + MIN_W; }
  if (x1 - x0 < MIN_W - 1e-9 || y1 - y0 < MIN_W - 1e-9) throw new Error(`pocket ${rc.join(',')} is narrower than the 8 mm cutter and closed on both sides`);
  return [x0, y0, x1, y1];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pretty = (n: string) => n.replace(/_/g, ' ');

export function partPrograms(p: Part, base: string, tp: Templates): Program[] {
  const out: Program[] = [];
  const setups = p.setups.filter((s) => s === 'F1' || p.ops.some((o) => o.face === s));
  for (const setup of setups) {
    const flip = setup === 'F0';
    const Y = (y: number) => flip ? p.W - y : y;
    const b = new Builder(blankProgram(base, p.L, p.W, p.T, [[BOARD, 18]]), tp);
    const counts: Record<string, number> = {};
    const n = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    // notches (through) - F1 setup only
    if (!flip) for (const rc of notchRects(p)) {
      const [x0, y0, x1, y1] = runOut(rc, p.L, p.W, RUN_OUT);
      b.pocket('Notches', `E016 8mm - Notch ${n('notch')}`, x0, y0, x1, y1, p.T + 0.2);
    }
    // housings and rebates
    for (const o of p.ops.filter((q) => q.type === 'pocket' && q.face === setup)) {
      const poly = o.polygon!.map(([x, y]) => [x, Y(y)]);
      for (const rc of pocketRects(poly)) {
        const housing = [rc[2] - rc[0], rc[3] - rc[1]].map((d) => Math.abs(d - 18) < 0.01);
        let [x0, y0, x1, y1] = rc; const ex: { x0?: string; x1?: string; y0?: string; y1?: string } = {};
        const grow = `(${BOARD}+0.2-18)/2`;
        // housing walls follow BoardT (measured board + 0.2); the toolpath is stored for BoardT = 18
        if (housing[0]) { ex.x0 = `${r3(x0)}-${grow}`; ex.x1 = `${r3(x1)}+${grow}`; x0 -= 0.1; x1 += 0.1; }
        else if (housing[1]) { ex.y0 = `${r3(y0)}-${grow}`; ex.y1 = `${r3(y1)}+${grow}`; y0 -= 0.1; y1 += 0.1; }
        const ro = runOut([x0, y0, x1, y1], p.L, p.W);
        // run-out moves an open side: its expression must follow (only walls inside the part carry BoardT)
        for (const [k, i] of [['x0', 0], ['y0', 1], ['x1', 2], ['y1', 3]] as const) if (ex[k] && Math.abs(ro[i] - [x0, y0, x1, y1][i]) > 1e-9) delete ex[k];
        const kind = housing[0] || housing[1] ? 'Housing' : 'Rebate';
        b.pocket(kind === 'Housing' ? 'Housings' : 'Rebates', `E016 8mm - ${kind} ${n(kind)}`, ro[0], ro[1], ro[2], ro[3], o.depth, Object.keys(ex).length ? ex : undefined);
      }
    }
    for (const o of p.ops.filter((q) => q.type === 'drill' && q.face === setup && q.dia === 8))
      b.drill('Dowels 8mm', `E024 8mm Drill - Dowel ${n('dowel')}`, o.x!, Y(o.y!), 8, o.depth);
    if (!flip) for (const o of p.ops.filter((q) => q.type === 'edge_drill'))
      b.edgeDrill('Edge dowels 8mm', `E024 8mm Drill - Edge dowel ${o.edge} ${n('edge' + o.edge)}`, o.edge!, o.pos!, o.z!, o.depth);
    for (const o of p.ops.filter((q) => q.type === 'drill' && q.face === setup && q.dia === 3))
      b.drill('Screw marks 3mm', `E022 3mm Drill - Screw mark ${n('spot')}`, o.x!, Y(o.y!), 3, o.depth);
    if (!Object.keys(counts).length) continue;
    const label = pretty(p.names[0]) + (p.names.length > 1 ? ` (+${p.names.length - 1})` : '') + (p.qty > 1 ? ` x${p.qty}` : '');
    out.push({ name: `${p.id} ${setup} - ${label}`, part: p.id, setup, xml: b.finish(),
      summary: Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') });
  }
  return out;
}

// ---------------------------------------------------------------- saw programs from the cut plan
export interface PlanStrip { w: number; pieces: { id: string; along: number; across: number; turned: boolean }[] }
export interface PlanJSON { sheet: [number, number]; trim: number; kerf: number; narrow: number; plans: Record<string, { sheets: PlanStrip[][] }> }

/** Blade-centre positions, same layout as scripts/cutplan.py. */
export function ripCuts(plan: PlanJSON, sheet: PlanStrip[]) {
  const { trim, kerf, narrow } = plan; let y = trim; const cuts = [y + kerf / 2]; y += kerf; const strips: { s: PlanStrip; y0: number }[] = [];
  for (const s of sheet.filter((q) => q.w >= narrow)) { strips.push({ s, y0: y }); y += s.w; cuts.push(y + kerf / 2); y += kerf; }
  return { cuts, strips, block: sheet.some((q) => q.w < narrow) ? y : undefined };
}
export function crossCuts(plan: PlanJSON, s: PlanStrip) {
  const { trim, kerf } = plan; let x = trim; const cuts = [x + kerf / 2]; x += kerf;
  for (const p of s.pieces) { x += p.along; cuts.push(x + kerf / 2); x += kerf; }
  return cuts;
}

export function sawPrograms(plan: PlanJSON, base: string, tp: Templates): Program[] {
  const out: Program[] = []; const [SL, SW] = plan.sheet; const seen = new Map<string, string>();
  for (const [T, pl] of Object.entries(plan.plans)) {
    pl.sheets.forEach((sheet, si) => {
      const tag = `T${T} sheet ${si + 1}`; const rc = ripCuts(plan, sheet);
      const b = new Builder(blankProgram(base, SL, SW, +T), tp);
      rc.cuts.forEach((c, i) => b.saw('Rip', `E015 Saw - Rip R${i + 1} Y${r3(c)}`, 'x', c));
      out.push({ name: `Saw ${tag} - Rip`, xml: b.finish(), summary: `${rc.cuts.length} rips` });
      rc.strips.forEach(({ s }, k) => {
        const key = `${T}|${s.w}|${s.pieces.map((p) => p.along).join(',')}`;
        if (seen.has(key)) return;
        const name = `Saw ${tag} - Strip ${k + 1} (${r3(s.w)}) Crosscut`; seen.set(key, name);
        const bx = new Builder(blankProgram(base, SL, s.w, +T), tp);
        crossCuts(plan, s).forEach((c, i) => bx.saw('Crosscut', `E015 Saw - Cut C${i + 1} X${r3(c)}`, 'y', c));
        out.push({ name, xml: bx.finish(), summary: s.pieces.map((p) => p.id).join(' ') });
      });
    });
  }
  return out;
}

/** Which crosscut program each strip uses (strips with the same pieces share one). */
export function stripPrograms(plan: PlanJSON): Map<string, string> {
  const m = new Map<string, string>(); const seen = new Map<string, string>();
  for (const [T, pl] of Object.entries(plan.plans)) pl.sheets.forEach((sheet, si) => ripCuts(plan, sheet).strips.forEach(({ s }, k) => {
    const key = `${T}|${s.w}|${s.pieces.map((p) => p.along).join(',')}`;
    if (!seen.has(key)) seen.set(key, `Saw T${T} sheet ${si + 1} - Strip ${k + 1} (${r3(s.w)}) Crosscut`);
    m.set(`T${T} sheet ${si + 1} strip ${k + 1}`, seen.get(key)!);
  }));
  return m;
}
