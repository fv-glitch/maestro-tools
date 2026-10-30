/**
 * Project variables and expressions (Maestro "parameters").
 * Expressions bind a geometry property to a formula, e.g. a GeomCircle's CenterX = LatchHandleX,
 * so Shane can move hardware by changing one value in Maestro.
 *
 * Proven property names: GeomCartesianPoint X/Y, GeomCircle CenterX (CenterY, Radius),
 * GeomCompositeCurve Elements[i].StartX/StartY/EndX/EndY (used by Shane's own macros).
 */
import { Ids } from './pgmx';

const UTIL = 'http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Utility';
const NIL = `<a:Key i:nil="true" xmlns:b="${UTIL}"/>`;

function variablesBlock(t: string): string {
  const m = /<Variables.*?<\/Variables>/s.exec(t);
  if (!m) throw new Error('no <Variables>');
  return m[0];
}

/** The <a:Variable> block whose name is `name`. */
export function findVariable(t: string, name: string): string {
  const v = [...variablesBlock(t).matchAll(/<a:Variable>.*?<\/a:Variable>/gs)].map((m) => m[0])
    .find((x) => new RegExp('<Name xmlns="[^"]*">' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</Name>').test(x));
  if (!v) throw new Error('variable not found: ' + name);
  return v;
}

/** A new variable copied from `template` with a new ID, name and value text (e.g. "990"). */
export function makeVariable(ids: Ids, t: string, template: string, name: string, value: string): string {
  let nv = findVariable(t, template).replace(/<ID>\d+<\/ID>/, `<ID>${ids.take()}</ID>`);
  nv = nv.replace(/(<Name xmlns="[^"]*">)[^<]*(<\/Name>)/, (_m, a, b) => a + name + b);
  return nv.replace(/(<a:Value i:type="b:double"[^>]*>)[^<]*(<)/, (_m, a, b) => a + value + b);
}

export function insertVariables(t: string, vars: string[]): string {
  const i = t.indexOf('</Variables>');
  return t.slice(0, i) + vars.join('') + t.slice(i);
}

/** Builds <a:Expression> blocks with sequential IDs and "[Expression](n)" names. */
export class Expressions {
  private n: number;
  readonly items: string[] = [];
  constructor(t: string, private ids: Ids) {
    this.n = Math.max(0, ...[...t.matchAll(/\[Expression\]\((\d+)\)/g)].map((m) => parseInt(m[1], 10))) + 1;
  }
  private add(property: string, refId: string, refType: string, value: string): void {
    this.items.push(`<a:Expression><Key xmlns="${UTIL}"><ID>${this.ids.take()}</ID><ObjectType>ScmGroup.XCam.MachiningDataModel.Parametrics.Expression</ObjectType></Key>` +
      `<Name xmlns="${UTIL}">[Expression](${this.n++})</Name>${property}` +
      `<a:ReferencedObject xmlns:b="${UTIL}"><b:ID>${refId}</b:ID><b:ObjectType>${refType}</b:ObjectType></a:ReferencedObject><a:Value>${value}</a:Value></a:Expression>`);
  }
  /** Simple property, e.g. ('X', pointId, '...GeomCartesianPoint', 'LatchHandleX-14.337'). */
  prop(name: string, refId: string, refType: string, value: string): void {
    this.add(`<a:Property><a:Index>-1</a:Index>${NIL}<a:Name>${name}</a:Name></a:Property>`, refId, refType, value);
  }
  /** Composite-curve element property, e.g. Elements[2].StartY. */
  element(index: number, name: string, refId: string, refType: string, value: string): void {
    this.add(`<a:Property i:type="a:CompositeField"><a:Index>${index}</a:Index>${NIL}<a:Name>Elements</a:Name>` +
      `<a:InnerField><a:Index>-1</a:Index>${NIL}<a:Name>${name}</a:Name></a:InnerField></a:Property>`, refId, refType, value);
  }
  insertInto(t: string): string {
    const i = t.indexOf('</Expressions>');
    return t.slice(0, i) + this.items.join('') + t.slice(i);
  }
}

/** Key ID and ObjectType of a geometry block. */
export function geometryRef(gm: string): [string, string] {
  const m = /<Key[^>]*><ID>(\d+)<\/ID><ObjectType>([^<]+)/.exec(gm);
  if (!m) throw new Error('no key in geometry');
  return [m[1], m[2]];
}
