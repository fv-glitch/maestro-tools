/**
 * Number formatting that matches Python's repr(float) exactly.
 *
 * Every number this engine writes into a .pgmx uses this, so the output is byte-identical to the
 * Python builds that were proven in Maestro and on the machine (Oct 2026).
 * JS and Python both produce the shortest round-trip digits; they differ only in layout:
 *   Python: 1028.0, 1e-05, 1.5e+16    JS: 1028, 0.00001, 15000000000000000
 */
export function pyRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [mant, expStr] = x.toExponential().split('e');
  const exp = parseInt(expStr, 10);
  const neg = mant.startsWith('-');
  const digits = mant.replace('-', '').replace('.', '');
  const sign = neg ? '-' : '';
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits[0];
    return sign + m + 'e' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  }
  if (exp >= 0) {
    if (digits.length <= exp + 1) return sign + digits + '0'.repeat(exp + 1 - digits.length) + '.0';
    return sign + digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
  }
  return sign + '0.' + '0'.repeat(-exp - 1) + digits;
}

/** Python round(x, n) for the non-tie values the engine uses (decimal rounding of the exact double). */
export function pyRound(x: number, n: number): number {
  return Number(x.toFixed(n));
}

/** Python '%d' for a float or int (truncates toward zero). */
export function pyInt(x: number): string {
  return String(Math.trunc(x));
}
