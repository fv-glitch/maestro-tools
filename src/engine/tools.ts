/**
 * Tool table from a program's def.tlgx (read-only): name (E0xx) -> cutting diameter.
 * A saw blade (has BladeThickness) cuts a kerf, so its cutting width is the blade thickness.
 */
import { parseXml, walk, local, type XNode } from './xmltree';

export interface ToolInfo { name: string; description: string; diameter: number; width: number; saw: boolean; cutLength?: number }

const kid = (n: XNode | undefined, name: string) => n?.children.find((c) => local(c) === name);

export function readTools(tlgx: string | undefined): Record<string, ToolInfo> {
  const out: Record<string, ToolInfo> = {};
  if (!tlgx) return out;
  for (const n of walk(parseXml(tlgx))) {
    if (local(n) !== 'CoreTool') continue;
    const name = kid(n, 'Name')?.text.trim(); if (!name) continue;
    const dim = [...walk(n)].find((c) => local(c) === 'ToolDimension');
    const num = (k: string) => { const v = parseFloat(kid(dim, k)?.text ?? ''); return Number.isFinite(v) ? v : undefined; };
    const diameter = num('Diameter') ?? 0; const blade = num('BladeThickness');
    out[name] = { name, description: kid(n, 'Description')?.text.trim() ?? '', diameter, width: blade ?? diameter, saw: blade !== undefined, cutLength: num('SinkingLength') };
  }
  return out;
}
