import { describe, it } from 'vitest';
import { existsSync } from 'node:fs';

/**
 * describe() that only runs when every fixture file exists. Unlike describe.skipIf, the suite body is
 * not evaluated when files are missing, so suites that read fixtures at collection time skip cleanly.
 * The real programs in ./fixtures are kept out of git; copy them in to run these suites.
 */
export function describeWithFixtures(files: string[]) {
  const missing = files.filter((f) => !existsSync(f));
  return (name: string, fn: () => void) =>
    missing.length ? describe.skip(name, () => { it(`needs ${missing.join(', ')}`, () => {}); }) : describe(name, fn);
}
