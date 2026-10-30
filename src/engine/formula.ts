/**
 * Evaluator for Maestro's expression language, as used in Shane's programs and macros, e.g.
 *   doorlength+footclearance+3
 *   150.000+If(CustomHinges=1;-150+(dx1-CustomHingeFoot-89.2);0)
 *   MilanoLarge=1 And LH=1 Or MilanoLarge=3
 *   dz2 / Sin(If(Mitre=1;45;90))          (trig in DEGREES: Sin(90) = 1)
 *   0.000+((-((StrikeLen)/2))*Cos(0.000)-(((StrikeWid)/2))*Sin(0.000))
 * Booleans are 1/0. Arguments are separated by ';'.
 */
type Tok = { k: 'num' | 'id' | 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!; out.push({ k: 'num', v: m[0] }); i += m[0].length; continue; }
    if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!; out.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>', '=='].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/()<>=;,^'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    throw new Error(`formula: unexpected '${c}' in ${src}`);
  }
  return out;
}

const rad = (d: number) => d * Math.PI / 180;
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: (x) => Math.sin(rad(x)), cos: (x) => Math.cos(rad(x)), tan: (x) => Math.tan(rad(x)),
  asin: (x) => Math.asin(x) * 180 / Math.PI, acos: (x) => Math.acos(x) * 180 / Math.PI, atan: (x) => Math.atan(x) * 180 / Math.PI,
  converttoradians: (x) => rad(x), converttodegrees: (x) => x * 180 / Math.PI,
  abs: Math.abs, sqrt: Math.sqrt, min: Math.min, max: Math.max, round: (x, n = 0) => Number(x.toFixed(n)),
  floor: Math.floor, ceiling: Math.ceil, ceil: Math.ceil, int: Math.trunc, pow: Math.pow,
};

export type Vars = Record<string, number>;

export function evaluate(src: string, vars: Vars): number {
  const t = tokenize(src); let p = 0;
  const peek = () => t[p]; const next = () => t[p++];
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v;
  const isWord = (w: string) => peek()?.k === 'id' && peek().v.toLowerCase() === w;
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`formula: expected '${v}' in ${src}`); p++; };
  const or = (): number => { let a = and(); while (isWord('or')) { p++; const b = and(); a = (a || b) ? 1 : 0; } return a; };
  const and = (): number => { let a = not(); while (isWord('and')) { p++; const b = not(); a = (a && b) ? 1 : 0; } return a; };
  const not = (): number => { if (isWord('not')) { p++; return not() ? 0 : 1; } return cmp(); };
  const cmp = (): number => {
    const a = add();
    for (const op of ['<=', '>=', '<>', '==', '=', '<', '>']) if (isOp(op)) {
      p++; const b = add(); const e = 1e-9;
      return ({ '<=': a <= b + e, '>=': a >= b - e, '<>': Math.abs(a - b) > e, '==': Math.abs(a - b) <= e, '=': Math.abs(a - b) <= e, '<': a < b - e, '>': a > b + e } as Record<string, boolean>)[op] ? 1 : 0;
    }
    return a;
  };
  const add = (): number => { let a = mul(); for (;;) { if (isOp('+')) { p++; a += mul(); } else if (isOp('-')) { p++; a -= mul(); } else return a; } };
  const mul = (): number => { let a = unary(); for (;;) { if (isOp('*')) { p++; a *= unary(); } else if (isOp('/')) { p++; a /= unary(); } else return a; } };
  const unary = (): number => { if (isOp('-')) { p++; return -unary(); } if (isOp('+')) { p++; return unary(); } return pow(); };
  const pow = (): number => { const a = atom(); if (isOp('^')) { p++; return Math.pow(a, unary()); } return a; };
  const args = (): number[] => {
    expect('('); const a: number[] = [];
    if (!isOp(')')) { a.push(or()); while (isOp(';') || isOp(',')) { p++; a.push(or()); } }
    expect(')'); return a;
  };
  const atom = (): number => {
    const tk = next();
    if (!tk) throw new Error(`formula: unexpected end of ${src}`);
    if (tk.k === 'num') return parseFloat(tk.v);
    if (tk.k === 'op' && tk.v === '(') { const v = or(); expect(')'); return v; }
    if (tk.k === 'id') {
      const lw = tk.v.toLowerCase();
      if (isOp('(')) {
        if (lw === 'if') {
          // evaluate all three (they are pure), pick one
          expect('('); const c = or(); expect(';'); const a = or(); expect(';'); const b = or(); expect(')');
          return c ? a : b;
        }
        const f = FUNCS[lw]; if (!f) throw new Error(`formula: unknown function ${tk.v} in ${src}`);
        return f(...args());
      }
      if (lw === 'true') return 1; if (lw === 'false') return 0; if (lw === 'pi') return Math.PI;
      if (!(tk.v in vars)) throw new Error(`formula: unknown variable ${tk.v} in ${src}`);
      return vars[tk.v];
    }
    throw new Error(`formula: unexpected '${tk.v}' in ${src}`);
  };
  const v = or();
  if (p !== t.length) throw new Error(`formula: trailing input in ${src}`);
  return v;
}

/** Identifiers a formula reads (excluding function names). */
export function references(src: string): string[] {
  const t = tokenize(src); const out = new Set<string>();
  t.forEach((tk, i) => {
    if (tk.k !== 'id') return;
    const lw = tk.v.toLowerCase();
    if (['and', 'or', 'not', 'true', 'false', 'pi'].includes(lw)) return;
    if (t[i + 1]?.k === 'op' && t[i + 1].v === '(') return;
    out.add(tk.v);
  });
  return [...out];
}
