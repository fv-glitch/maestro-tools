/**
 * Stairs, first step: the maths for a straight flight and the housing layout on a closed (housed) stringer.
 *
 * Pure geometry. Nothing here writes a .pgmx yet: the housings run at the pitch angle and the only pocket
 * template we have (ITM rect pocket) is axis-aligned, so the program side waits for a proven angled
 * pocket to clone (CLAUDE.md rule 5).
 *
 * Limits are NZBC D1/AS1 for main private stairways (per BRANZ "External stairs for houses"):
 * rise <= 190, going >= 280, pitch <= 37 deg, nosing projection <= 25, max 4 m rise between landings.
 * The default going uses the 2R + G = 630 comfort rule (an assumption, not a D1 limit).
 *
 * Elevation frame: u horizontal from the face of the first riser (positive up the flight), v up from the
 * bottom finished floor. Riser k (1..n) has its front face at u = (k-1) G and top at v = k R.
 * Tread k (1..n-1) has its top at v = k R; the top floor is the last "tread".
 * Stringer frame: X along the stringer from its bottom end, Y across from its bottom edge (Y = W top edge),
 * viewed on the inside face. Both end cuts are level (floor and top floor); a plumb cut at the trimmer is not modelled yet.
 * The pitch line (through the nosings) sits `aboveNosing` below the top edge.
 */
export const NZ = { maxRise: 190, minGoing: 280, maxPitch: 37, maxNosing: 25, maxFlightRise: 4000, uniformity: 5 };

export interface StairInput {
  totalRise: number;       // finished floor to finished floor
  risers?: number;         // default: fewest that keep rise <= 190
  going?: number;          // default: max(280, 630 - 2R)
  treadT: number;
  riserT: number;          // 0 = open riser
  nosing?: number;         // projection past the riser face, default 20
  stringerW: number;
  stringerT: number;
  housingDepth?: number;   // into the stringer face, default 12
  aboveNosing?: number;    // stringer top edge above the pitch line (perpendicular), default 50
}

export interface StairPlan {
  risers: number; treads: number; rise: number; going: number; pitchDeg: number; twoRG: number;
  totalGoing: number; nosing: number; housingDepth: number;
  problems: string[];      // breaks a D1/AS1 limit or the stringer
  notes: string[];
}

export function planStair(s: StairInput): StairPlan {
  const problems: string[] = [], notes: string[] = [];
  if (!(s.totalRise > 0)) throw new Error('totalRise must be > 0');
  const n = s.risers ?? Math.ceil(s.totalRise / NZ.maxRise - 1e-9);
  const rise = s.totalRise / n;
  const going = s.going ?? Math.max(NZ.minGoing, 630 - 2 * rise);
  if (s.going === undefined) notes.push(`going ${going.toFixed(1)} from 2R+G = 630 (comfort rule, not a D1 limit)`);
  const nosing = s.nosing ?? 20;
  const pitchDeg = Math.atan2(rise, going) * 180 / Math.PI;
  if (rise > NZ.maxRise + 1e-9) problems.push(`rise ${rise.toFixed(1)} > ${NZ.maxRise}`);
  if (going < NZ.minGoing - 1e-9) problems.push(`going ${going.toFixed(1)} < ${NZ.minGoing}`);
  if (pitchDeg > NZ.maxPitch + 1e-9) problems.push(`pitch ${pitchDeg.toFixed(1)} deg > ${NZ.maxPitch}`);
  if (nosing > NZ.maxNosing) problems.push(`nosing ${nosing} > ${NZ.maxNosing}`);
  if (s.riserT === 0 && nosing < 15) problems.push('open risers need a nosing of 15..25');
  if (s.riserT === 0) notes.push('open risers: the gap must not pass a 100 mm sphere');
  if (s.totalRise > NZ.maxFlightRise) problems.push(`flight rise ${s.totalRise} > ${NZ.maxFlightRise} needs a landing`);
  return { risers: n, treads: n - 1, rise, going, pitchDeg, twoRG: 2 * rise + going, totalGoing: (n - 1) * going,
    nosing, housingDepth: s.housingDepth ?? 12, problems, notes };
}

export type Pt = [number, number];
export interface Housing { kind: 'tread' | 'riser'; index: number; corners: Pt[]; depth: number }
export interface StringerLayout { plan: StairPlan; length: number; width: number; angleDeg: number; housings: Housing[]; endCuts: [Pt, Pt][]; problems: string[] }

/** Housings on the inside face of one stringer. The opposite-hand stringer is the mirror (X -> length - X). */
export function housedStringer(s: StairInput): StringerLayout {
  const p = planStair(s);
  const { rise: R, going: G, nosing: N } = p;
  const a = Math.atan2(R, G), ca = Math.cos(a), sa = Math.sin(a);
  const above = s.aboveNosing ?? 50, W = s.stringerW;
  // pitch line through the tread nosings: v = R + (u + N) tan a  (nosing of tread 1 at u = -N, v = R)
  // offset of the stringer top edge from the pitch line, measured along v
  const lift = above / ca;
  // elevation -> stringer: rotate by -a about the point where the top edge meets v = 0
  const u0 = -N - (R + lift) / Math.tan(a);
  const toS = ([u, v]: Pt): Pt => { const du = u - u0, dv = v; return [du * ca + dv * sa, W + (-du * sa + dv * ca)]; };
  const rect = (u1: number, v1: number, u2: number, v2: number): Pt[] => [[u1, v1], [u2, v1], [u2, v2], [u1, v2]].map((q) => toS(q as Pt));
  const housings: Housing[] = [];
  for (let k = 1; k <= p.treads; k++) {
    // tread k: nosing front at (k-1)G - N, runs back to the face of riser k+1 plus its thickness
    housings.push({ kind: 'tread', index: k, depth: p.housingDepth, corners: rect((k - 1) * G - N, k * R - s.treadT, k * G + s.riserT, k * R) });
  }
  if (s.riserT > 0) for (let k = 1; k <= p.risers; k++) {
    // riser k: under tread k (or under the top floor), above tread k-1 (or the floor)
    const top = k < p.risers ? k * R - s.treadT : k * R;
    housings.push({ kind: 'riser', index: k, depth: p.housingDepth, corners: rect((k - 1) * G, (k - 1) * R, (k - 1) * G + s.riserT, top) });
  }
  const problems = [...p.problems];
  const all = housings.flatMap((h) => h.corners);
  const minY = Math.min(...all.map((q) => q[1])), maxY = Math.max(...all.map((q) => q[1]));
  if (maxY > W + 1e-6) problems.push(`housings break out of the top edge by ${(maxY - W).toFixed(1)} (raise aboveNosing)`);
  if (minY < 30) problems.push(`only ${minY.toFixed(1)} of stringer left under the housings (want >= 30; widen the stringer)`);
  if (p.housingDepth >= s.stringerT / 2) problems.push(`housing depth ${p.housingDepth} is half the stringer or more`);
  // end cuts are level: the bottom floor (v = 0) and the top floor (v = totalRise), each a line across the stringer
  const H = s.totalRise, run = W / Math.tan(a);
  const endCuts: [Pt, Pt][] = [[[0, W], [run, 0]], [[H / sa, W], [H / sa + run, 0]]];
  const length = H / sa + run;
  if (Math.max(...all.map((q) => q[0])) > length + 1e-6) problems.push('housings run past the top end cut');
  return { plan: p, length, width: W, angleDeg: p.pitchDeg, housings, endCuts, problems };
}
