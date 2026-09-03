import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSourceFiles, repoRoot } from './repository.js';

/**
 * The gate's own configuration, guarded.
 *
 * This project's single most expensive class of defect is an instrument that
 * silently stops measuring. Cycle Audit 6's headline was two Vitest options
 * living where Vitest 3 drops them without a word, so the statistical suite had
 * never run serially despite a comment saying it did. The out-of-band audit
 * found the browser suite reporting six tests as *passed* while launching no
 * browser. Cycle Audit 7 found two more, and neither needed a subtle mistake —
 * deleting one line from a glob list, and a default that differs between a
 * laptop and CI.
 *
 * So the configuration is read and asserted, like any other code.
 */
const config = readFileSync(path.join(repoRoot, 'vitest.config.ts'), 'utf8');

/** Where this repository keeps code. Anything else is not the gate's business. */
const WORKSPACE_ROOTS = ['packages', 'tools', 'apps'];

describe('the gate runs the tests that exist', () => {
  it('has a glob for every root that holds statistical tests (CA7-16)', () => {
    // **Cycle Audit 7.** An auditor deleted `'apps/*/src/**/*.stat.test.ts'`
    // from the statistical include: six files vanished, among them the entire
    // eight-test browser suite — the only browser coverage in the repository —
    // and every step of the gate still passed with counts identical to the
    // recorded baseline. Nothing in either layer noticed.
    //
    // The check is against what is on disk, not against a remembered list, so
    // a new root with statistical tests joins it by existing.
    const roots = WORKSPACE_ROOTS.filter((root) =>
      listSourceFiles(root, { includeTests: true }).some((file) => file.endsWith('.stat.test.ts')),
    );
    expect(roots.length, 'no statistical tests were found at all').toBeGreaterThan(1);
    const unmatched = roots.filter((root) => !config.includes(`'${root}/*/src/**/*.stat.test.ts'`));
    expect(unmatched, 'these roots hold statistical tests the gate would not run').toEqual([]);
  });

  it('has a glob for every root that holds unit tests', () => {
    const roots = WORKSPACE_ROOTS.filter((root) =>
      listSourceFiles(root, { includeTests: true }).some(
        (file) => file.endsWith('.test.ts') && !file.endsWith('.stat.test.ts'),
      ),
    );
    expect(roots.length).toBeGreaterThan(1);
    const unmatched = roots.filter((root) => !config.includes(`'${root}/*/src/**/*.test.ts'`));
    expect(unmatched, 'these roots hold unit tests the gate would not run').toEqual([]);
  });

  it('refuses a stray .only rather than letting it silence a sibling (CA7-17)', () => {
    // Vitest defaults `allowOnly` to `!process.env.CI`, so a file carrying
    // `it.only` silenced its failing siblings locally — exit 0, "2204 passed |
    // 1 skipped" — and turned red only on a push to `main`. The local gate is
    // what an approval is recorded from, so the layer that could be fooled was
    // the authoritative one.
    const occurrences = config.match(/allowOnly:\s*false/g) ?? [];
    expect(occurrences.length, 'both projects must pin allowOnly').toBe(2);
  });
});
