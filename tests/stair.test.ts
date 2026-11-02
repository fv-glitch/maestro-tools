import { describe, it, expect } from 'vitest';
import { planStair, housedStringer } from '../src/ops/stair';

const base = { totalRise: 2700, treadT: 32, riserT: 18, stringerW: 290, stringerT: 42 };

describe('stair plan', () => {
  it('picks the fewest risers under 190 and a D1-compliant going', () => {
    const p = planStair(base);
    expect(p.risers).toBe(15);                 // 2700 / 190 = 14.2 -> 15
    expect(p.rise).toBeCloseTo(180, 6);
    expect(p.going).toBeCloseTo(280, 6);       // 630 - 360 = 270 -> clamped to 280
    expect(p.treads).toBe(14);
    expect(p.totalGoing).toBeCloseTo(3920, 6);
    expect(p.pitchDeg).toBeLessThan(37);
    expect(p.problems).toEqual([]);
  });
  it('flags a steep forced layout', () => {
    const p = planStair({ ...base, risers: 13, going: 240 });
    expect(p.problems.join()).toMatch(/rise 207\.7 > 190/);
    expect(p.problems.join()).toMatch(/going 240\.0 < 280/);
    expect(p.problems.join()).toMatch(/pitch/);
  });
});

describe('housed stringer', () => {
  const L = housedStringer(base);
  it('puts every nosing on the pitch line, aboveNosing below the top edge', () => {
    const treads = L.housings.filter((h) => h.kind === 'tread');
    expect(treads).toHaveLength(14);
    for (const t of treads) expect(t.corners[3][1]).toBeCloseTo(290 - 50, 6);   // nosing top corner
    // nosings are one step apart along the stringer
    const step = Math.hypot(180, 280);
    expect(treads[1].corners[3][0] - treads[0].corners[3][0]).toBeCloseTo(step, 6);
  });
  it('housings are tread/riser thick and stay inside the board', () => {
    const t = L.housings[0].corners, r = L.housings.find((h) => h.kind === 'riser')!.corners;
    expect(Math.hypot(t[3][0] - t[0][0], t[3][1] - t[0][1])).toBeCloseTo(32, 6);
    expect(Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1])).toBeCloseTo(18, 6);
    expect(L.problems).toEqual([]);
    expect(L.length).toBeCloseTo(2700 / Math.sin(Math.atan2(180, 280)) + 290 * 280 / 180, 6);
  });
  it('flags a stringer too narrow for the housings', () => {
    expect(housedStringer({ ...base, stringerW: 200 }).problems.join()).toMatch(/widen the stringer/);
  });
  it('end risers run out past the end cuts and joints overlap by the cutter radius', () => {
    const r = L.housings.filter((h) => h.kind === 'riser');
    const t1 = L.housings.find((h) => h.kind === 'tread')!.corners;
    // riser 1 bottom corners sit below the floor line (stringer side of the cut is Y above the line)
    const [[x0, y0], [x1, y1]] = L.endCuts[0];
    const side = ([x, y]: number[]) => (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
    expect(Math.sign(side(r[0].corners[0]))).not.toBe(Math.sign(side([1000, 280])));
    // riser 1 top is 8 above the underside of tread 1 (perpendicular to the tread, i.e. along the riser)
    expect(Math.hypot(r[0].corners[3][0] - r[0].corners[0][0], r[0].corners[3][1] - r[0].corners[0][1])).toBeCloseTo(180 - 32 + 8 + 10, 6);
    expect(Math.hypot(t1[1][0] - t1[0][0], t1[1][1] - t1[0][1])).toBeCloseTo(20 + 280 + 18 + 8, 6);
  });
});
