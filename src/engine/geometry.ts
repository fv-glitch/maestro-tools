/**
 * Geometry records and toolpath generators, in Maestro's serialised record format.
 *
 *   line   : `8 0 L` / `1 x y z dx dy dz`      (or end-point form `8 -L -0` for profile passes)
 *   arc    : `8 p0 p1` / `2 cx cy z <normal> <u> <v> r`
 *   circle : `2 cx cy 0 0 0 1 1 0 -0 -0 1 0 r`  (Top-plane geometry)
 *
 * Shapes proven on the machine: rectangle loops (faceplates, dust boxes, strikes), stadium pockets
 * (flush pull), circle loops, copied ITM helix (spindle, barrel bore), single-plunge drills.
 */
import { ln } from './pgmx';
import { pyRepr as r } from './pyfmt';

export const P2 = Math.PI / 2;

/** Closed rectangle as 4 lines starting top-left, clockwise (x along the part, y across). */
export function rectRecords(cx: number, cy: number, L: number, W: number): string[] {
  const x0 = cx - L / 2, x1 = cx + L / 2, y0 = cy - W / 2, y1 = cy + W / 2;
  return [`8 0 ${r(L)}\n1 ${r(x0)} ${r(y1)} 0 1 0 0 \n`, `8 0 ${r(W)}\n1 ${r(x1)} ${r(y1)} 0 0 -1 0 \n`,
    `8 0 ${r(L)}\n1 ${r(x1)} ${r(y0)} 0 -1 0 0 \n`, `8 0 ${r(W)}\n1 ${r(x0)} ${r(y0)} 0 0 1 0 \n`];
}

/** Top-plane circle geometry record. */
export function circleRecord(cx: number, cy: number, radius: number): string {
  return `2 ${r(cx)} ${r(cy)} 0 0 0 1 1 0 -0 -0 1 0 ${r(radius)}\n`;
}

/** Boundary copy of a circle for a ClosedPocket feature: two half arcs. */
export function circleBoundary(circ: string): string[] {
  return [`8 0 ${r(Math.PI)}\n${circ}`, `8 ${r(Math.PI)} ${r(2 * Math.PI)}\n${circ}`];
}

/** One counter-clockwise full circle of the tool centre at height z (top -> left -> bottom -> right). */
export function circleLoop(x: number, y: number, z: number, rr: number): string[] {
  return [`8 ${r(3 * P2)} ${r(5 * P2)}\n2 ${r(x)} ${r(y)} ${r(z)} 0 0 1 -1 0 0 0 -1 0 ${r(rr)}\n`,
    `8 ${r(P2)} ${r(3 * P2)}\n2 ${r(x)} ${r(y)} ${r(z)} 0 0 1 -1 0 0 0 -1 0 ${r(rr)}\n`];
}

export interface Pocket { path: string[]; start: [number, number, number]; end: [number, number, number]; levels: number; loops: [number, number][] }

/**
 * Rectangular pocket on the Top plane: rectangle loops of the tool centre, inner first,
 * stepping out by the tool radius, in `levels` equal depth passes from `top`.
 * Each loop starts at its right end at the inner loop's top edge; levels link back to the inner start and plunge.
 */
export function rectPocketPath(top: number, cx: number, cy: number, L: number, W: number, D: number, step: number, toolR = 4.0): Pocket {
  const hx = L / 2, hy = W / 2;
  const ds: number[] = [];
  for (let k = Math.floor(hy / toolR); k > 0; k--) ds.push(toolR * k);
  const loops = ds.filter((d) => hy - d > 0 && hx - d > 0).map((d) => [hx - d, hy - d] as [number, number]);
  const n = Math.max(1, Math.ceil(D / step - 1e-9));
  const zs = Array.from({ length: n }, (_, k) => top - D * (k + 1) / n);
  const Sy = cy + loops[0][1]; const path: string[] = [];
  zs.forEach((zz, k) => {
    loops.forEach(([lx, ly], i) => {
      const xr = cx + lx;
      if (i) path.push(ln(cx + loops[i - 1][0], Sy, zz, 1, 0, 0, lx - loops[i - 1][0]));
      path.push(ln(xr, Sy, zz, 0, -1, 0, Sy - (cy - ly)), ln(xr, cy - ly, zz, -1, 0, 0, 2 * lx),
        ln(cx - lx, cy - ly, zz, 0, 1, 0, 2 * ly), ln(cx - lx, cy + ly, zz, 1, 0, 0, 2 * lx));
      if (cy + ly - Sy > 1e-9) path.push(ln(xr, cy + ly, zz, 0, -1, 0, cy + ly - Sy));
    });
    if (k < n - 1) {
      if (loops.length > 1) path.push(ln(cx + loops[loops.length - 1][0], Sy, zz, -1, 0, 0, loops[loops.length - 1][0] - loops[0][0]));
      path.push(ln(cx + loops[0][0], Sy, zz, 0, 0, -1, zz - zs[k + 1]));
    }
  });
  return { path, start: [cx + loops[0][0], Sy, zs[0]], end: [cx + loops[loops.length - 1][0], Sy, zs[n - 1]], levels: n, loops };
}

/** Profile (finish) rectangle at the tool radius inside the outline, starting mid top edge, clockwise in +X first. */
export function rectProfileTop(cx: number, cy: number, rx: number, ry: number, z: number): string[] {
  return [ln(cx + rx, cy + ry, z, 1, 0, 0, rx, true), ln(cx + rx, cy - ry, z, 0, -1, 0, 2 * ry, true), ln(cx - rx, cy - ry, z, -1, 0, 0, 2 * rx, true),
    ln(cx - rx, cy + ry, z, 0, 1, 0, 2 * ry, true), ln(cx, cy + ry, z, 1, 0, 0, rx, true)];
}

/**
 * Rewrite fields of an arc/line record (`8 ...` line + `1|2 ...` line) by index, e.g. move a copied
 * helix arc: {1: (x) => x + X - 1190}. Callers keep Python's evaluation order so results stay bit-identical.
 */
export function mapRecord(rec: string, fields: Record<number, (v: number) => number>): string {
  const [a, b] = rec.split('\n');
  const v = b.split(/\s+/).filter(Boolean);
  for (const [i, f] of Object.entries(fields)) v[+i] = r(f(parseFloat(v[+i])));
  return a + '\n' + v.join(' ') + '\n';
}
