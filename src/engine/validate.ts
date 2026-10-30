/**
 * Checks every build must pass before it is written for Maestro.
 * (Each one exists because a real build once failed in Maestro without it.)
 */

/**
 * Stray text: an element that has child elements must not also contain non-whitespace text.
 * Maestro refuses such a file with "Expecting state 'Element'.. Encountered 'Text'".
 * Also checks tags are balanced. Read-only scan - never rewrites the XML.
 */
export function strayTextProblems(xml: string, limit = 5): string[] {
  const problems: string[] = [];
  const stack: { name: string; hasChild: boolean; text: boolean; at: number }[] = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const noteText = (s: string, at: number) => {
    if (stack.length && /\S/.test(s)) { const top = stack[stack.length - 1]; top.text = true; if (top.hasChild) problems.push(`text inside <${top.name}> near offset ${at}`); }
  };
  while ((m = re.exec(xml)) && problems.length < limit) {
    noteText(xml.slice(last, m.index), last);
    last = m.index + m[0].length;
    if (!m[2]) continue; // PI / comment / CDATA
    const closing = m[1] === '/'; const selfClose = m[4] === '/';
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== m[2]) { problems.push(`unbalanced </${m[2]}> at ${m.index}`); break; }
    } else {
      if (stack.length) {
        const top = stack[stack.length - 1];
        if (top.text && !top.hasChild) problems.push(`element <${m[2]}> after text inside <${top.name}> at ${m.index}`);
        top.hasChild = true;
      }
      if (!selfClose) stack.push({ name: m[2], hasChild: false, text: false, at: m.index });
    }
  }
  if (problems.length < limit) noteText(xml.slice(last), last);
  if (!problems.length && stack.length) problems.push(`unclosed <${stack[stack.length - 1].name}>`);
  return problems;
}

/** Key IDs that appear more than once. */
export function duplicateIds(xml: string): Set<string> {
  const seen = new Map<string, number>();
  for (const m of xml.matchAll(/<Key[^>]*><ID>(\d+)<\/ID>/g)) if (m[1] !== '0') seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * Throws unless `after` is safe to hand to Maestro. Duplicate IDs already present in `before`
 * are tolerated (TestingJamb ships with three and Maestro is happy) - only new ones fail.
 */
export function assertSafe(before: string, after: string): void {
  const stray = strayTextProblems(after);
  if (stray.length) throw new Error('stray text / malformed XML: ' + stray.join('; '));
  const was = duplicateIds(before);
  const now = [...duplicateIds(after)].filter((k) => !was.has(k));
  if (now.length) throw new Error('new duplicate IDs: ' + now.slice(0, 5).join(', '));
}
