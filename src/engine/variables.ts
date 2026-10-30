/**
 * Project variables: read them, set job inputs, and recompute every variable whose value is an
 * expression of other variables (jamblength = doorlength+footclearance+3, LockP, dy1 = DoorSize ...),
 * so a generated program is self-consistent before Maestro ever opens it.
 *
 * Only the <a:Value> text of variables is edited. Expressions on other objects (macro placements,
 * parameters, workpiece size) are evaluated by Maestro; `dependents()` lists the ones an input change
 * touches so the checker can confirm Maestro has applied them.
 */
import { evaluate, references, type Vars } from './formula';

export interface VariableInfo { id: string; name: string; value: number; valueText: string; valueStart: number; valueEnd: number; formula?: string }
export interface ExpressionInfo { refId: string; refType: string; property: string; formula: string }

/** .NET double.ToString() layout (how Maestro writes variable values): 1980, 0.5, 1E-05, 1E+15. */
export function netDouble(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const [mant, e] = x.toExponential().split('e'); const exp = parseInt(e, 10);
  if (exp <= -5 || exp >= 15) return mant.toUpperCase() + 'E' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  return String(x);
}

function projectVariablesBlock(t: string): { start: number; text: string } {
  const m = /<Variables xmlns:a="[^"]*Parametrics">.*?<\/Variables>/s.exec(t);
  if (!m) throw new Error('no project <Variables>');
  return { start: m.index, text: m[0] };
}

export function expressions(t: string): ExpressionInfo[] {
  return [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => {
    const x = m[0];
    const ref = /<a:ReferencedObject[^>]*><b:ID>(\d+)<\/b:ID><b:ObjectType>([^<]+)/.exec(x)!;
    const prop = [...x.matchAll(/<a:Name>([^<]*)<\/a:Name>/g)].map((n) => n[1]).join('.');
    const val = /<a:Value>([^<]*)<\/a:Value>/.exec(x);
    return { refId: ref[1], refType: ref[2].split('.').pop()!, property: prop, formula: val ? decodeXml(val[1]) : '' };
  });
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function readVariables(t: string): VariableInfo[] {
  const blk = projectVariablesBlock(t);
  const formulas = new Map(expressions(t).filter((e) => e.refType === 'Variable' && e.property === 'Value').map((e) => [e.refId, e.formula]));
  return [...blk.text.matchAll(/<a:Variable>.*?<\/a:Variable>/gs)].map((m) => {
    const v = m[0];
    const id = /<ID>(\d+)<\/ID>/.exec(v)![1];
    const name = /<Name xmlns="[^"]*">([^<]*)<\/Name>/.exec(v)![1];
    const vm = /(<a:Value i:type="b:double"[^>]*>)([^<]*)</.exec(v);
    if (!vm) throw new Error(`variable ${name} is not a double`);
    const valueStart = blk.start + m.index! + vm.index + vm[1].length;
    return { id, name, value: parseFloat(vm[2]), valueText: vm[2], valueStart, valueEnd: valueStart + vm[2].length, formula: formulas.get(id) };
  });
}

export function variableValues(t: string): Vars {
  return Object.fromEntries(readVariables(t).map((v) => [v.name, v.value]));
}

export interface SetResult { xml: string; changes: { name: string; from: string; to: string; derived: boolean }[] }

/**
 * Set input variables, then recompute derived variables in dependency order.
 * Refuses to set a variable that is itself driven by a formula (set its inputs instead).
 */
export function setVariables(t: string, inputs: Record<string, number>): SetResult {
  const vars = readVariables(t);
  const byName = new Map(vars.map((v) => [v.name, v]));
  const values: Vars = Object.fromEntries(vars.map((v) => [v.name, v.value]));
  for (const [k, val] of Object.entries(inputs)) {
    const v = byName.get(k);
    if (!v) throw new Error(`no variable ${k}`);
    if (v.formula) throw new Error(`${k} is calculated (= ${v.formula}); set its inputs instead`);
    values[k] = val;
  }
  // derived variables: evaluate in dependency order
  const derived = vars.filter((v) => v.formula);
  const done = new Set<string>(); const order: VariableInfo[] = [];
  const visit = (v: VariableInfo, stack: Set<string>) => {
    if (done.has(v.name)) return;
    if (stack.has(v.name)) throw new Error('circular variables: ' + [...stack, v.name].join(' -> '));
    stack.add(v.name);
    for (const r of references(v.formula!)) { const d = byName.get(r); if (d?.formula) visit(d, stack); }
    stack.delete(v.name); done.add(v.name); order.push(v);
  };
  derived.forEach((v) => visit(v, new Set()));
  for (const v of order) values[v.name] = evaluate(v.formula!, values);
  const changes: SetResult['changes'] = []; const edits: [number, number, string][] = [];
  for (const v of vars) {
    const nv = values[v.name];
    if (Math.abs(nv - v.value) <= 1e-12 * Math.max(1, Math.abs(v.value))) continue;
    const text = netDouble(nv);
    edits.push([v.valueStart, v.valueEnd, text]);
    changes.push({ name: v.name, from: v.valueText, to: text, derived: !!v.formula });
  }
  let xml = t;
  for (const [a, b, s] of edits.sort((x, y) => y[0] - x[0])) xml = xml.slice(0, a) + s + xml.slice(b);
  return { xml, changes };
}

/** Non-variable expressions that read any of `names` (Maestro must re-evaluate these). */
export function dependents(t: string, names: string[]): ExpressionInfo[] {
  const set = new Set(names);
  return expressions(t).filter((e) => !(e.refType === 'Variable' && e.property === 'Value') && e.formula && references(e.formula).some((r) => set.has(r)));
}
