/**
 * Minimal READ-ONLY XML tree for checkers and reports. Never used to write a program
 * (see CLAUDE.md rule 1). Element names keep their prefix; local() strips it.
 */
export interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string; parent?: XNode }

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescape = (s: string) => s.replace(/&(lt|gt|amp|quot|apos);/g, (_m, e) => ENT[e]);

export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  let cur = root;
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m.index > last) cur.text += unescape(xml.slice(last, m.index));
    last = m.index + m[0].length;
    if (!m[2]) continue;
    if (m[1] === '/') { cur = cur.parent ?? root; continue; }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = unescape(a[2]);
    const node: XNode = { name: m[2], attrs, children: [], text: '', parent: cur };
    cur.children.push(node);
    if (m[4] !== '/') cur = node;
  }
  return root;
}

export const local = (n: XNode) => n.name.includes(':') ? n.name.split(':')[1] : n.name;
export const child = (n: XNode | undefined, name: string) => n?.children.find((c) => local(c) === name);
export const kids = (n: XNode | undefined, name: string) => n ? n.children.filter((c) => local(c) === name) : [];
export const text = (n: XNode | undefined, name: string) => child(n, name)?.text;
export function* walk(n: XNode): Generator<XNode> { yield n; for (const c of n.children) yield* walk(c); }
export const type = (n: XNode) => (n.attrs['i:type'] ?? '').split(':').pop() ?? '';
/** Key/ID of an object node, or ID of a reference node (b:ID). */
export const keyId = (n: XNode | undefined) => text(child(n, 'Key'), 'ID') ?? text(n, 'ID');
