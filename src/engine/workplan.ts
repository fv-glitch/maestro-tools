/**
 * Read-only map of the main workplan: every Executable (step, group, macro instance, park move,
 * message) with its text span, type, Key ID, name, enabled flag and the chain of executables it sits in.
 * Used to find where to splice new steps and which flag to flip - the XML itself is never rebuilt.
 */

export interface ExecInfo {
  /** offsets of `<Executable ...>` and just past its `</Executable>` */
  start: number; end: number;
  type: string;            // MachiningWorkingStep, ExecutableGroup, VisualSubProgram, Xn, Xmsg ...
  id: string; name: string; enabled: boolean;
  depth: number;           // 0 = top level of the main workplan
  parents: { type: string; id: string; name: string }[];
  /** offset of the `true|false` text of this executable's own IsEnabled */
  enabledAt: number; enabledLen: number;
  /** offset and length of this executable's own Name text */
  nameAt: number; nameLen: number;
}

export interface Workplan { execs: ExecInfo[]; elementsStart: number; elementsEnd: number }

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function workplan(t: string): Workplan {
  const mw = t.indexOf('<MainWorkplan>');
  if (mw < 0) throw new Error('no <MainWorkplan>');
  const open = t.indexOf('<Elements', mw);
  const elementsStart = t.indexOf('>', open) + 1;
  const re = /<Executable\b[^>]*?(\/?)>|<\/Executable>|<Elements\b[^>]*?(\/?)>|<\/Elements>/g;
  re.lastIndex = elementsStart;
  const stack: ExecInfo[] = []; const execs: ExecInfo[] = []; let elDepth = 0; let elementsEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const tag = m[0];
    if (tag.startsWith('<Elements')) { if (!m[2]) elDepth++; continue; }
    if (tag === '</Elements>') { if (elDepth === 0) { elementsEnd = m.index; break; } elDepth--; continue; }
    if (tag === '</Executable>') {
      const e = stack.pop(); if (!e) throw new Error('unbalanced </Executable> at ' + m.index);
      e.end = m.index + tag.length; continue;
    }
    if (m[1]) continue;   // <Executable/> holds nothing
    const typ = /i:type="(?:\w+:)?(\w+)"/.exec(tag)?.[1] ?? '?';
    const after = m.index + tag.length;
    const head = /^<Key[^>]*><ID>(\d+)<\/ID>.*?<\/Key><Name[^>]*>([^<]*)<\/Name>(?:<Description\/>|<Description>[^<]*<\/Description>)?<IsEnabled>(true|false)<\/IsEnabled>/s.exec(t.slice(after, after + 2000));
    const nameRel = head ? head[0].indexOf('>' + head[2] + '</Name>') + 1 : -1;
    const enRel = head ? head[0].lastIndexOf('<IsEnabled>') + 11 : -1;
    const e: ExecInfo = {
      start: m.index, end: -1, type: typ, id: head?.[1] ?? '', name: head ? unesc(head[2]) : '', enabled: head?.[3] === 'true',
      depth: stack.length, parents: stack.map((p) => ({ type: p.type, id: p.id, name: p.name })),
      enabledAt: head ? after + enRel : -1, enabledLen: head ? head[3].length : 0,
      nameAt: head ? after + nameRel : -1, nameLen: head ? head[2].length : 0,
    };
    execs.push(e); stack.push(e);
  }
  if (elementsEnd < 0 || stack.length) throw new Error('main workplan is not balanced');
  return { execs, elementsStart, elementsEnd };
}

/**
 * Where new top-level steps go: after the last top-level executable that is not a park move (Xn),
 * so they run after the existing machining and before the trailing park move(s).
 * A blank program (park moves only) gets them at the start, ahead of the park move.
 */
export function insertPoint(t: string): number {
  const wp = workplan(t);
  const top = wp.execs.filter((e) => e.depth === 0);
  const last = [...top].reverse().find((e) => e.type !== 'Xn');
  return last ? last.end : wp.elementsStart;
}
