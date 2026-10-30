/**
 * Parity: replay the real Oct-2026 builds and require byte-identical program XML to what the
 * Python engine produced (files that were opened in Maestro and run on the machine).
 * Fixtures are Shane's real programs and are NOT in git - put them in ./fixtures to run these.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readPgmx, getXml, getEntryText } from '../src/engine/archive';
import { assertSafe } from '../src/engine/validate';
import { addDummyHandleParameter, latchHandleSet, groupSteps, HANDLE_GROUPS, spindleHelix, setStartPoint, jambStrikeInAmelia } from '../src/ops/recorded';

const fx = (n: string) => `fixtures/${n}.pgmx`;
const has = (...n: string[]) => n.every((x) => existsSync(fx(x)));
const xml = (n: string) => getXml(readPgmx(fx(n)));

function firstDiff(a: string, b: string): string {
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return i >= a.length && a.length === b.length ? 'identical' : `first difference at ${i}:\n got: ${a.slice(Math.max(0, i - 80), i + 120)}\nwant: ${b.slice(Math.max(0, i - 80), i + 120)}`;
}
function same(got: string, want: string, before: string) {
  assertSafe(before, got);
  if (got !== want) expect.fail(firstDiff(got, want));
}

describe.skipIf(!has('door-dh2', 'door-dh3'))('DummyHandleX parameter', () => {
  it('matches dh3', () => { const t = xml('door-dh2'); same(addDummyHandleParameter(t), xml('door-dh3'), t); });
});
describe.skipIf(!has('door-1430', 'door-lt1', 'itm-final'))('latch handle set', () => {
  it('matches lt1', () => {
    const a = readPgmx(fx('door-1430')); const t = getXml(a);
    same(latchHandleSet(t, xml('itm-final'), getEntryText(a, 'def.tlgx')), xml('door-lt1'), t);
  });
});
describe.skipIf(!has('door-lt1', 'door-gp1'))('groups', () => {
  it('matches gp1', () => { const t = xml('door-lt1'); same(groupSteps(t, HANDLE_GROUPS), xml('door-gp1'), t); });
});
describe.skipIf(!has('door-gp1', 'door-hx1', 'itm-final'))('spindle helix', () => {
  it('matches hx1', () => {
    const t = xml('door-gp1');
    same(spindleHelix(t, xml('itm-final'), ['E019 16mm - Latch spindle hole', 'E019 16mm - Latch spindle hole Other Side']), xml('door-hx1'), t);
  });
});
describe.skipIf(!has('door-hx1', 'door-sp1'))('profile start point', () => {
  it('matches sp1', () => {
    const t = xml('door-hx1');
    same(setStartPoint(t, 'E017 3mm - Latch faceplate corners', 'MiddleOfFirstElement', 'MiddleOfMostLengthElement'), xml('door-sp1'), t);
  });
});
describe.skipIf(!has('jamb-orig', 'jamb-sk1'))('jamb strike', () => {
  it('matches sk1', () => { const t = xml('jamb-orig'); same(jambStrikeInAmelia(t), xml('jamb-sk1'), t); });
});
