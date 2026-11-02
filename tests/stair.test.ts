import { describe, it, expect } from 'vitest';
import { describeWithFixtures } from './needs';
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

import { readPgmx, getXml } from '../src/engine/archive';
import { assertSafe } from '../src/engine/validate';
import { stepList, stepParts, trajectoryRecords } from '../src/engine/pgmx';
import { testStringerProgram, TEST_STAIR } from '../src/ops/stairProgram';

const SF = ['fixtures/tdr-latest.pgmx', 'fixtures/stair-test.pgmx'];
describeWithFixtures(SF)('test stringer program', () => {
  const [tdr, stair] = SF.map((f) => getXml(readPgmx(f)));
  const out = testStringerProgram(tdr, stair);
  const pts = (recs: string[]) => recs.flatMap((rec) => {
    const [h, g] = rec.trim().split('\n'); const [, t0, t1] = h.split(' ').map(Number); const v = g.trim().split(' ').map(Number);
    if (v[0] === 1) return [0, 1].map((k) => [v[1] + v[4] * (k ? t1 : t0), v[2] + v[5] * (k ? t1 : t0), v[3]]);
    const [, cx, cy, cz, , , , ux, uy, uz, wx, wy, wz, rr] = v;   // 2: centre, normal, u, v, radius
    return [t0, (t0 + t1) / 2, t1].map((t) => [cx + rr * (Math.cos(t) * ux + Math.sin(t) * wx), cy + rr * (Math.cos(t) * uy + Math.sin(t) * wy), cz + rr * (Math.cos(t) * uz + Math.sin(t) * wz)]);
  });
  it('is safe, has TDR setup + park, and one enabled housing step', () => {
    assertSafe(tdr, out.xml);
    expect(out.xml).toContain('<Executable i:type="Xn">');
    expect(out.xml).toContain('a:SuctionCupSetup');
    expect(stepList(out.xml)).toEqual([['Stringer', 'true'], ['E019 16mm - Stringer housings', 'true'], ['Park Right(2)(1)', 'true']]);
    expect([out.L, out.W, out.T]).toEqual([1450, 290, 42]);
  });
  it('pocket outline lies on the housing rectangles from the stair maths', () => {
    const p = stepParts(out.xml, 'E019 16mm - Stringer housings');
    const geo = [...p.geometry.text.matchAll(/string>8 [^\n]*\n1 (\S+) (\S+) /g)].map((m) => [+m[1], +m[2]]);
    expect(geo).toHaveLength(20);
    const rects = housedStringer(TEST_STAIR).housings.map((h) => h.corners);
    const onEdge = ([x, y]: number[]) => rects.some((c) => c.some((a, i) => { const b = c[(i + 1) % 4];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), t = ((x - a[0]) * dx + (y - a[1]) * dy) / l;
      return t > -0.01 && t < l + 0.01 && Math.abs(((x - a[0]) * dy - (y - a[1]) * dx) / l) < 0.01; }));
    for (const q of geo) expect(onEdge(q), `${q}`).toBe(true);
    // tool centre at cutting depth stays inside the outline, >= 8 (E019 radius) from every edge
    const segs = geo.map((a, i) => [a, geo[(i + 1) % geo.length]]);
    const inside = (x: number, y: number) => { let c = false; for (const [a, b] of segs) if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) c = !c; return c; };
    const dist = (x: number, y: number) => Math.min(...segs.map(([a, b]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); }));
    const cut = pts(trajectoryRecords(p.operation.text)).filter((q) => q[2] < 42);
    expect(cut.length).toBeGreaterThan(100);
    expect(Math.min(...cut.map((q) => q[2]))).toBeCloseTo(30, 6);          // 12 deep from the 42 top
    for (const [x, y] of cut) { expect(inside(x, y)).toBe(true); expect(dist(x, y)).toBeGreaterThan(8 - 0.01); }
  });
});

import { stringerProgram } from '../src/ops/stairProgram';
describeWithFixtures(SF)('stringer program (our toolpath)', () => {
  const [tdr, stair] = SF.map((f) => getXml(readPgmx(f)));
  const name = 'E019 16mm - Stringer housings';
  const recPts = (recs: string[], z: number) => recs.flatMap((rec) => {   // dense points along each record at height z
    const [h, g] = rec.trim().split('\n'); const [, t0, t1] = h.split(' ').map(Number); const v = g.trim().split(' ').map(Number);
    if (Math.abs(v[3] - z) > 1e-6 || (v[0] === 1 && v[6] !== 0)) return [];
    const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) * (v[0] === 1 ? 1 : v[13]) / 0.25));
    return Array.from({ length: n + 1 }, (_, k) => { const t = t0 + (t1 - t0) * k / n;
      return v[0] === 1 ? [v[1] + v[4] * t, v[2] + v[5] * t] : [v[1] + v[13] * (Math.cos(t) * v[7] + Math.sin(t) * v[10]), v[2] + v[13] * (Math.cos(t) * v[8] + Math.sin(t) * v[11])]; });
  });
  const near = (pts: number[][], x: number, y: number, d: number) => pts.some((p) => (p[0] - x) ** 2 + (p[1] - y) ** 2 <= d * d);

  it('test stair: same outline as Maestro and cuts everything Maestro cuts', () => {
    const ours = stringerProgram(tdr, stair, TEST_STAIR);
    assertSafe(tdr, ours.xml);
    const theirs = stepParts(stair, 'Outline Pocket');
    const tg = [...theirs.geometry.text.matchAll(/string>8 [^\n]*\n1 (\S+) (\S+) /g)].map((m) => [+m[1], +m[2]]);
    expect(ours.pocket.outline).toHaveLength(tg.length);
    for (const q of ours.pocket.outline) expect(tg.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.002), `${q}`).toBe(true);
    const mine = recPts(trajectoryRecords(stepParts(ours.xml, name).operation.text), 30);
    const ref = recPts(trajectoryRecords(theirs.operation.text), 30);
    let checked = 0;
    for (let x = 320; x < 1120; x += 2) for (let y = 30; y < 245; y += 2) {
      if (!near(ref, x, y, 8)) continue; checked++;
      expect(near(mine, x, y, 8.05), `${x},${y}`).toBe(true);
    }
    expect(checked).toBeGreaterThan(5000);
  });
  it('full flight: 2700 rise, 15 risers, one pocket, tool >= 8 inside, 12 deep', () => {
    const s = { ...TEST_STAIR, totalRise: 2700 };
    const out = stringerProgram(tdr, stair, s);
    assertSafe(tdr, out.xml);
    expect(out.L).toBe(Math.ceil(housedStringer(s).length));
    const p = stepParts(out.xml, name);
    const geo = out.pocket.outline; const segs = geo.map((a, i) => [a, geo[(i + 1) % geo.length]]);
    const dist = (x: number, y: number) => Math.min(...segs.map(([a, b]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); }));
    const pts = [36, 30].flatMap((z) => recPts(trajectoryRecords(p.operation.text), z));
    expect(pts.length).toBeGreaterThan(1000);
    for (const [x, y] of pts) expect(dist(x, y)).toBeGreaterThan(8 - 1e-6);
    // every tread and riser housing is reached: each rectangle's centre is within 8 of the path
    for (const h of out.layout.housings) { const c = h.corners.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]);
      expect(near(pts, c[0], c[1], 8.05), h.kind + h.index).toBe(true); }
  });
});

const SAWF = 'fixtures/stair-sawcuts.pgmx';
describeWithFixtures([...SF, SAWF])('stringer end saw cuts', () => {
  const [tdr, stair, saw] = [...SF, SAWF].map((f) => getXml(readPgmx(f)));
  const nums = (s: string) => s.trim().split(/\s+/).map(Number);
  const descs = (b: string) => [...b.matchAll(/(?:<b:Type>(\w+)<\/b:Type>.*?)?_serializationGeometryDescription>([^<]*)</gs)].map((m) => nums(m[2]));
  it('3R test stair: both cuts match the ones drawn by hand in Maestro (100 run-out, blade on the waste side)', () => {
    const out = stringerProgram(tdr, stair, TEST_STAIR, undefined, saw);
    assertSafe(tdr, out.xml);
    expect(stepList(out.xml).map((x) => x[0])).toEqual(['Stringer', 'E019 16mm - Stringer housings', 'E015 Saw - Floor cut', 'E015 Saw - Top cut', 'Park Right(2)(1)']);
    for (const [ours, his] of [['E015 Saw - Floor cut', 'Cut with blade'], ['E015 Saw - Top cut', 'Cut with blade(1)']]) {
      const a = stepParts(out.xml, ours), b = stepParts(saw, his);
      expect(/SideOfFeature>(\w+)</.exec(a.feature.text)![1]).toBe(/SideOfFeature>(\w+)</.exec(b.feature.text)![1]);
      expect(/EndDepth>([^<]+)</.exec(a.feature.text)![1]).toBe('42');
      const [ga, gb] = [descs(a.geometry.text)[0], descs(b.geometry.text)[0]];
      ga.forEach((v, i) => expect(Math.abs(v - gb[i]), `geo ${ours} ${i}`).toBeLessThan(0.003));
      const [oa, ob] = [descs(a.operation.text), descs(b.operation.text)];   // approach, trajectory, lift
      expect(oa).toHaveLength(ob.length);
      oa.forEach((rec, k) => rec.forEach((v, i) => expect(Math.abs(v - ob[k][i]), `op ${ours} ${k}.${i}`).toBeLessThan(0.003)));
    }
  });
  it('full flight: top cut moves to the top of the 5445 stringer', () => {
    const out = stringerProgram(tdr, stair, { ...TEST_STAIR, totalRise: 2700 }, undefined, saw);
    assertSafe(tdr, out.xml);
    const g = descs(stepParts(out.xml, 'E015 Saw - Top cut').geometry.text)[0];
    const [[t0]] = [out.layout.endCuts[1]];
    expect(g[4]).toBeCloseTo(t0[0] - 100 * g[7], 6);   // starts 100 before the top edge along the cut
    expect(g[5]).toBeCloseTo(290 - 100 * g[8], 6);
    expect(g[2]).toBeCloseTo(Math.hypot(451.1111111, 290) + 200, 3);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as pathMod from 'node:path';
import { stairJob } from '../src/ops/stairJob';
describe.skipIf(!(SF.every(exists) && exists(SAWF)))('stair job (app / web)', () => {
  it('writes a viewable program, and refuses a stair that breaks the limits', () => {
    const dir = mkdtempSync(pathMod.join(tmpdir(), 'stair-'));
    try {
      const r = stairJob({ totalRise: 2700, treadT: 32, riserT: 18, stringerW: 290, stringerT: 42, nosing: 20, name: 'S 15' }, dir, 'fixtures');
      expect(r.ok).toBe(true); expect(r.plan.risers).toBe(15); expect(r.stringer.length).toBe(5445);
      expect(exists(r.file!)).toBe(true);
      expect(r.view!.steps.map((s) => s.name)).toEqual(['E019 16mm - Stringer housings', 'E015 Saw - Floor cut', 'E015 Saw - Top cut']);
      const bad = stairJob({ totalRise: 2700, treadT: 32, riserT: 18, stringerW: 290, stringerT: 42, risers: 12, going: 240 }, dir, 'fixtures');
      expect(bad.ok).toBe(false); expect(bad.file).toBeUndefined(); expect(bad.problems.join()).toMatch(/rise 225\.0 > 190/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
