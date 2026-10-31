/**
 * Cut simulation: the material each visible step removes, as height maps on the faces it cuts.
 *
 * The tool is a flat-bottomed cylinder of the step's tool width, swept along the STORED toolpath
 * (cut + approach/lift, wherever they go below the face). Every map cell keeps the deepest cut.
 * Face frames match src/view/model.ts faceFrame(): point = o + a*u + b*v + depth*n.
 * Pure module (no DOM) so it can be tested in node.
 */

export function faceFrame(face, L, W, T) {
  switch (face) {
    case 'bottom': return { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], thick: T, ext: [L, W] };
    case 'back': return { o: [0, W, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0], thick: W, ext: [L, T] };
    case 'front': return { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0], thick: W, ext: [L, T] };
    case 'right': return { o: [L, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [-1, 0, 0], thick: L, ext: [W, T] };
    case 'left': return { o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0], thick: L, ext: [W, T] };
    default: return { o: [0, 0, T], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1], thick: T, ext: [L, W] };
  }
}
const dot = (p, o, d) => (p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1] + (p[2] - o[2]) * d[2];

/** Segments of a step in face coordinates [a0,b0,d0,a1,b1,d1], clipped to the part below the face. */
function segmentsOf(step, f) {
  const out = [];
  for (const poly of [...step.cut, ...step.moves]) {
    for (let i = 1; i < poly.length; i++) {
      const p = poly[i - 1], q = poly[i];
      let a0 = dot(p, f.o, f.u), b0 = dot(p, f.o, f.v), d0 = dot(p, f.o, f.n);
      let a1 = dot(q, f.o, f.u), b1 = dot(q, f.o, f.v), d1 = dot(q, f.o, f.n);
      if (d0 <= 0 && d1 <= 0) continue;
      if (d0 < 0 || d1 < 0) {                    // clip at the face
        const t = d0 / (d0 - d1);
        const a = a0 + (a1 - a0) * t, b = b0 + (b1 - b0) * t;
        if (d0 < 0) { a0 = a; b0 = b; d0 = 0; } else { a1 = a; b1 = b; d1 = 0; }
      }
      out.push([a0, b0, d0, a1, b1, d1]);
    }
    if (poly.length === 1) { const p = poly[0]; const d = dot(p, f.o, f.n); if (d > 0) { const a = dot(p, f.o, f.u), b = dot(p, f.o, f.v); out.push([a, b, d, a, b, d]); } }
  }
  return out;
}

/**
 * steps: visible steps that cut (enabled, with toolDia). The faces are split into fixed 16 mm tiles and
 * only tiles a tool touches get a height map, so a profile round the whole part stays cheap.
 * Returns { cell, tiles: [{ face, frame, a0, b0, n, h }], maxDepth }; a tile has (n+1)^2 nodes
 * (row-major, a across) at spacing cell starting from (a0, b0); NaN = off the face. Neighbouring tiles share edge nodes.
 * budget: total nodes - detail is traded for speed on big programs (finest 0.1 mm).
 */
export const TILE = 16;
export function simulate(model, steps, budget = 1.5e6) {
  const { L, W, T } = model;
  const caps = [];                                     // capsules: one tool sweep along one segment
  for (const s of steps) {
    const r = (s.toolDia || 0) / 2; if (!(r > 0)) continue;
    const f = faceFrame(s.face, L, W, T); const clamp = f.thick >= 1 ? f.thick : Infinity;
    for (const g of segmentsOf(s, f)) caps.push({ face: s.face, f, r, g, clamp });
  }
  // touched tiles
  const tileKeys = new Map();                          // face|ti|tj -> tile
  const touch = (c, fn) => {
    const [a0, b0, , a1, b1] = c.g;
    const ti0 = Math.floor((Math.min(a0, a1) - c.r) / TILE), ti1 = Math.floor((Math.max(a0, a1) + c.r) / TILE);
    const tj0 = Math.floor((Math.min(b0, b1) - c.r) / TILE), tj1 = Math.floor((Math.max(b0, b1) + c.r) / TILE);
    for (let ti = ti0; ti <= ti1; ti++) for (let tj = tj0; tj <= tj1; tj++) fn(ti, tj);
  };
  for (const c of caps) touch(c, (ti, tj) => { const k = c.face + '|' + ti + '|' + tj; if (!tileKeys.has(k)) tileKeys.set(k, { face: c.face, frame: c.f, ti, tj }); });
  const n = Math.max(1, Math.min(160, Math.floor(TILE / Math.max(0.1, Math.sqrt(tileKeys.size * TILE * TILE / budget)))));
  const cell = TILE / n, N = n + 1;
  for (const t of tileKeys.values()) {
    t.a0 = t.ti * TILE; t.b0 = t.tj * TILE; t.n = n; t.h = new Float32Array(N * N);
    // nodes off the face are air: NaN, never cut and never meshed. Jamb programs (0.1 thick) hold several
    // pieces placed outside dx1 x dy1, so they are not limited.
    if (T < 1) continue;
    const [ea, eb] = t.frame.ext; const e = cell * 1e-3;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = t.a0 + i * cell, b = t.b0 + j * cell;
      if (a < -e || a > ea + e || b < -e || b > eb + e) t.h[j * N + i] = NaN;
    }
  }
  let maxDepth = 0;
  // deepest sweeps first: later, shallower ones then skip almost every node with one compare
  for (const c of caps) c.dmax = Math.min(c.clamp, Math.max(c.g[2], c.g[5]));
  caps.sort((x, y) => y.dmax - x.dmax);
  for (const c of caps) {
    const dmax = c.dmax;
    const [pa, pb, d0, qa, qb, d1] = c.g; const r = c.r, r2 = r * r;
    const da = qa - pa, db = qb - pb, len2 = da * da + db * db;
    const amin = Math.min(pa, qa) - r, amax = Math.max(pa, qa) + r, bmin = Math.min(pb, qb) - r, bmax = Math.max(pb, qb) + r;
    touch(c, (ti, tj) => {
      const t = tileKeys.get(c.face + '|' + ti + '|' + tj); const h = t.h;
      const i0 = Math.max(0, Math.ceil((amin - t.a0) / cell)), i1 = Math.min(n, Math.floor((amax - t.a0) / cell));
      const j0 = Math.max(0, Math.ceil((bmin - t.b0) / cell)), j1 = Math.min(n, Math.floor((bmax - t.b0) / cell));
      for (let j = j0; j <= j1; j++) {
        const yb = t.b0 + j * cell - pb;
        for (let i = i0; i <= i1; i++) {
          const k = j * N + i; if (h[k] >= dmax) continue;
          const xa = t.a0 + i * cell - pa; let d;
          if (len2 < 1e-12) { if (xa * xa + yb * yb > r2) continue; d = Math.max(d0, d1); }
          else {
            // tool positions along the segment that cover this node: t in [tc - s, tc + s]
            const tc = (xa * da + yb * db) / len2; const perp2 = xa * xa + yb * yb - tc * tc * len2;
            if (perp2 > r2) continue;
            const s = Math.sqrt((r2 - Math.max(0, perp2)) / len2);
            const lo = Math.max(0, tc - s), hi = Math.min(1, tc + s); if (lo > hi) continue;
            d = Math.max(d0 + (d1 - d0) * lo, d0 + (d1 - d0) * hi);
          }
          if (d > c.clamp) d = c.clamp;
          if (h[k] < d) { h[k] = d; if (d > maxDepth) maxDepth = d; }
        }
      }
    });
  }
  return { cell, tiles: [...tileKeys.values()], maxDepth };
}
