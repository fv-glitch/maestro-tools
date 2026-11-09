// Where an expression's value is stored in the program, so it can be checked (stale.ts) or moved (applyvars.ts).
export type Stored =
  | { kind: 'variable' }
  | { kind: 'unknown'; what: string }
  | { kind: 'num'; what: string; formula: string; value: number; refType: string; refId: string; prop: string; index?: number }
  | { kind: 'bool'; what: string; formula: string; value: boolean; refType: string; refId: string; prop: string };

const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function blockById(t: string, open: RegExp, close: string, id: string): { start: number; text: string } | null {
  const re = new RegExp(open.source + '<Key[^>]*><ID>' + id + '</ID>', 'g');
  const m = re.exec(t); if (!m) return null;
  const end = t.indexOf(close, m.index); return { start: m.index, text: t.slice(m.index, end + close.length) };
}
export const vspBlock = (t: string, id: string) => {
  const m = new RegExp('<Executable i:type="VisualSubProgram"><Key[^>]*><ID>' + id + '</ID>').exec(t); if (!m) return null;
  const end = t.indexOf('</FileName></Executable>', m.index) + '</FileName></Executable>'.length;
  return { start: m.index, text: t.slice(m.index, end) };
};
export const geomBlock = (t: string, id: string) => blockById(t, /<a:GeomGeometry i:type="a:\w+"[^>]*>/, '</a:GeomGeometry>', id);
export const featBlock = (t: string, id: string) => blockById(t, /<ManufacturingFeature i:type="[^"]+"[^>]*>/, '</ManufacturingFeature>', id);
export const stepBlock = (t: string, id: string) => blockById(t, /<Executable i:type="a:MachiningWorkingStep"[^>]*>/, '</Executable>', id);

/** Line record of a trimmed curve: "8 0 L\n1 x y z dx dy dz". */
export function lineOf(g: string) {
  const m = /Description>8 0 (\S+)\n1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) /.exec(g);
  if (!m) return null;
  const [L, x, y, z, dx, dy, dz] = m.slice(1).map(Number);
  return { L, x, y, z, dx, dy, dz, sx: x, sy: y, ex: x + L * dx, ey: y + L * dy };
}

export function paramAt(inst: string, index: number) {
  const ps = inst.indexOf('<Parameters>'); const pe = inst.indexOf('</Parameters>', ps);
  const items = [...inst.slice(ps, pe).matchAll(/<SubProgramParameter>.*?<\/SubProgramParameter>/gs)];
  const it = items[index]; if (!it) return null;
  const nm = /<Name>([^<]*)<\/Name>/.exec(it[0])![1];
  const vm = /(<_serializedValue[^>]*>)([^<]*)</.exec(it[0])!;
  return { name: nm, value: +vm[2], valueText: vm[2], at: ps + it.index! + vm.index + vm[1].length };
}

export function storedValue(t: string, e: string): Stored {
  const ref = /<a:ReferencedObject[^>]*><b:ID>(\d+)<\/b:ID><b:ObjectType>([^<]+)/.exec(e)!;
  const refId = ref[1], refType = ref[2].split('.').pop()!;
  const names = [...e.matchAll(/<a:Name>([^<]*)<\/a:Name>/g)].map((n) => n[1]);
  const prop = names.join('.'); const formula = dec(/<a:Value>([^<]*)<\/a:Value>/.exec(e)?.[1] ?? '');
  const idxs = [...e.matchAll(/<a:Index>(-?\d+)<\/a:Index>/g)].map((m) => +m[1]).filter((i) => i >= 0); const index = idxs.length ? idxs[0] : undefined;
  const what = `${refType} ${refId} ${prop}${index !== undefined && index >= 0 ? '[' + index + ']' : ''}`;
  const num = (value: number) => ({ kind: 'num' as const, what, formula, value, refType, refId, prop, index });
  if (refType === 'Variable') return { kind: 'variable' };
  if (refType === 'WorkPiece') {
    const b = blockById(t, /<WorkPiece>/, '</WorkPiece>', refId); const m = b && new RegExp(`<${prop}>([^<]+)</${prop}>`).exec(b.text);
    return m ? num(+m[1]) : { kind: 'unknown', what };
  }
  if (refType === 'VisualSubProgram') {
    const b = vspBlock(t, refId); if (!b) return { kind: 'unknown', what };
    const nm = /<Name[^>]*>([^<]*)<\/Name>/.exec(b.text)![1];
    const w = `${nm} ${prop}${index !== undefined && index >= 0 ? '[' + index + ']' : ''}`;
    if (prop === 'ModifyInfos.CoordinateX' || prop === 'ModifyInfos.CoordinateY') {
      const m = new RegExp(`<${prop.split('.')[1]}>([^<]+)<`).exec(b.text.slice(b.text.indexOf('<ModifyInfos>')));
      return m ? { ...num(+m[1]), what: w } : { kind: 'unknown', what: w };
    }
    if (prop === 'Parameters.Item.Value' && index !== undefined) { const p = paramAt(b.text, index); return p ? { ...num(p.value), what: `${w} (${p.name})` } : { kind: 'unknown', what: w }; }
    if (prop === 'IsEnabled') return { kind: 'bool', what: w, formula, value: /<IsEnabled>true/.test(b.text.slice(0, 3000)), refType, refId, prop };
    return { kind: 'unknown', what: `${refType} ${prop}` };
  }
  if (refType === 'MachiningWorkingStep' && prop === 'IsEnabled') {
    const b = stepBlock(t, refId); if (!b) return { kind: 'unknown', what };
    const nm = /<Name[^>]*>([^<]*)<\/Name>/.exec(b.text)![1];
    return { kind: 'bool', what: `step ${nm} IsEnabled`, formula, value: /<IsEnabled>true/.test(b.text.slice(0, 3000)), refType, refId, prop };
  }
  if (refType === 'GeomTrimmedCurve') {
    const b = geomBlock(t, refId); const l = b && lineOf(b.text);
    if (!l) return { kind: 'unknown', what: `${refType} ${prop}` };
    const nm = /<Name[^>]*>([^<]*)<\/Name>/.exec(b!.text)?.[1] ?? refId;
    const v = { StartX: l.sx, StartY: l.sy, EndX: l.ex, EndY: l.ey }[prop as 'StartX'];
    return v === undefined ? { kind: 'unknown', what: `${refType} ${prop}` } : { ...num(v), what: `line ${nm} ${prop}` };
  }
  if (refType === 'GeomCartesianPoint') {
    const b = geomBlock(t, refId); const m = b && new RegExp(`<a:_${prop.toLowerCase()}>([^<]+)<`).exec(b.text);
    return m ? { ...num(+m[1]), what: `point ${refId} ${prop}` } : { kind: 'unknown', what: `${refType} ${prop}` };
  }
  if (/Depth$/.test(prop) && /Feature|Hole|Pocket|Milling/.test(refType)) {
    const b = featBlock(t, refId); const tag = names[names.length - 1]; const m = b && new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(b.text);
    return m ? num(+m[1]) : { kind: 'unknown', what: `${refType} ${prop}` };
  }
  return { kind: 'unknown', what: `${refType} ${prop}` };
}
