import { describe, it, expect } from 'vitest';
import { evaluate, references } from '../src/engine/formula';
import { netDouble } from '../src/engine/variables';

const v = { doorlength: 1980, footclearance: 28, shiftcut: 10, Lockposition: 990, CustomHinges: 0, dx1: 1980, CustomHingeFoot: 1750,
  MilanoLarge: 1, LH: 1, RH: 0, Mitre: 0, dz2: 0.1, StrikeLen: 55.61, StrikeWid: 41.2, JambThickness: 19 };
describe('Maestro formulas from Shane\'s programs', () => {
  const cases: [string, number][] = [
    ['doorlength+footclearance+3', 2011], ['Lockposition+footclearance+shiftcut', 1028], ['JambThickness-25', -6],
    ['150.000+If(CustomHinges=1;-150+(dx1-CustomHingeFoot-89.2);0)', 150], ['-150-89.2+dx1', 1740.8],
    ['MilanoLarge=1 And LH=1 Or MilanoLarge=3', 1], ['MilanoLarge=1 And RH=1 Or MilanoLarge=4', 0],
    ['dz2 / Sin(If(Mitre=1;45;90))', 0.1], ['ConvertToRadians(If(Mitre=1;45;90))', Math.PI / 2],
    ['0.000+((-((StrikeLen)/2))*Cos(0.000)-(((StrikeWid)/2))*Sin(0.000))', -27.805],
  ];
  for (const [f, want] of cases) it(f, () => expect(evaluate(f, v)).toBeCloseTo(want, 9));
  it('references', () => expect(references('150+If(CustomHinges=1;dx1-Foot;0)').sort()).toEqual(['CustomHinges', 'Foot', 'dx1']));
  it('unknown variable is an error', () => expect(() => evaluate('nope+1', v)).toThrow(/unknown variable/));
});
describe('netDouble', () => {
  for (const [x, s] of [[1980, '1980'], [0.5, '0.5'], [530.2666666666667, '530.2666666666667'], [-1.5, '-1.5'], [1e-5, '1E-05']] as [number, string][]) it(s, () => expect(netDouble(x)).toBe(s));
});
