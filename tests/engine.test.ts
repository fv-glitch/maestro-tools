import { describe, it, expect } from 'vitest';
import { pyRepr } from '../src/engine/pyfmt';
import { strayTextProblems } from '../src/engine/validate';

describe('pyRepr matches Python repr(float)', () => {
  const cases: [number, string][] = [
    [1028, '1028.0'], [26.45, '26.45'], [-2.4166666666666665, '-2.4166666666666665'], [0, '0.0'], [-0, '-0.0'],
    [1e-5, '1e-05'], [1.5e-7, '1.5e-07'], [0.0001, '0.0001'], [1e16, '1e+16'], [123456789012345.6, '123456789012345.6'],
    [Math.PI, '3.141592653589793'], [2.27592163920595629e-16, '2.2759216392059563e-16'], [20, '20.0'], [-1, '-1.0'], [0.1 + 0.2, '0.30000000000000004'],
  ];
  for (const [x, want] of cases) it(`${want}`, () => expect(pyRepr(x)).toBe(want));
});

describe('stray text check', () => {
  it('accepts clean XML', () => expect(strayTextProblems('<a><b>1</b><c/><d x="1">t</d></a>')).toEqual([]));
  it('catches the Oct-30 failure (text after a closing tag)', () => {
    expect(strayTextProblems('<g><d>2 990 750</d>2 990 750\n</g>').length).toBeGreaterThan(0);
  });
  it('catches unbalanced tags', () => expect(strayTextProblems('<a><b></a>').length).toBeGreaterThan(0));
});
