import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { readPgmx, getXml } from '../src/engine/archive';
import { readVariables, setVariables } from '../src/engine/variables';
import { alignDoorJamb } from '../src/check/alignment';
import { generate, type Job } from '../src/ops/generate';

const F = { door: 'fixtures/apex-passage.pgmx', jambLH: 'fixtures/apex-jamb-lh.pgmx', jambRH: 'fixtures/apex-jamb-rh.pgmx' };
const have = Object.values(F).every((f) => existsSync(f));
const job = (o: Partial<Job> = {}): Job => ({ jobNo: '72999', customer: 'Test', hand: 'LH', length: 1980, width: 760, thickness: 36, solidCore: false, range: 'APEX',
  handleHeight: 990, jamb: { width: 112, thickness: 19, footClearance: 28, mitre: false }, ...o });

describe.skipIf(!have)('APEX masters', () => {
  it('reads variables and formulas', () => {
    const vs = readVariables(getXml(readPgmx(F.jambLH)));
    expect(vs.find((v) => v.name === 'LockP')).toMatchObject({ value: 1028, formula: 'Lockposition+footclearance+shiftcut' });
  });
  it('recomputes derived variables', () => {
    const r = setVariables(getXml(readPgmx(F.jambLH)), { doorlength: 2040, Lockposition: 1000 });
    expect(Object.fromEntries(r.changes.map((c) => [c.name, c.to]))).toEqual({ doorlength: '2040', Lockposition: '1000', jamblength: '2071', LockP: '1038' });
  });
  it('refuses to set a calculated variable', () => expect(() => setVariables(getXml(readPgmx(F.jambLH)), { LockP: 1 })).toThrow(/calculated/));
  it('flags the known 0.4 centre hinge on the masters', () => {
    const r = alignDoorJamb(getXml(readPgmx(F.door)), getXml(readPgmx(F.jambLH)));
    expect(r.rows.find((x) => x.item === 'hinge centre pocket start')).toMatchObject({ grade: 'out' });
    expect(r.rows.find((x) => x.item === 'latch / strike centre')).toMatchObject({ grade: 'ok' });
  });
  it('a master-sized LH job changes nothing and is final', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'mt-'));
    const g = generate(job(), F, { outDir: out, heightHand: 'LH' });
    expect(g.doorChanges).toEqual([]); expect(g.jambChanges).toEqual([]); expect(g.status).toBe('final');
    expect(existsSync(g.doorPath) && existsSync(g.jambPath)).toBe(true);
    expect(readPgmx(g.doorPath).xmlName).toBe('72999 Test Door LH.xml');
  });
  it('an RH job off-centre handle uses dx1 - height on the door and the RH jamb', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'mt-'));
    const g = generate(job({ hand: 'RH', handleHeight: 1000 }), F, { outDir: out, heightHand: 'LH' });
    expect(g.doorChanges.find((c) => c.name === 'Doorknob')?.to).toBe('980');
    expect(g.jambChanges.find((c) => c.name === 'Lockposition')?.to).toBe('1000');
    expect(g.status).toBe('provisional');
    // nothing re-evaluated yet: the stored latch/strike are still at 990, so the job check must fail
    expect(g.alignment.intent.find((x) => x.item === 'jamb strike at job height')).toMatchObject({ want: 1000, grade: 'out' });
    expect(g.alignment.ok).toBe(false);
  });
  it('a longer door is provisional until Maestro applies the formulas', () => {
    const g = generate(job({ length: 2040 }), F, { outDir: mkdtempSync(path.join(tmpdir(), 'mt-')), heightHand: 'LH' });
    expect(g.status).toBe('provisional'); expect(g.pendingInMaestro.door).toBeGreaterThan(0);
  });
});
