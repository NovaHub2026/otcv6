import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { brokenLinks, citedEvidence, markdownFiles } from './packageLinks.js';
import { runPackageLinksTool } from './packageLinksTool.js';

/**
 * The delivered package carried seventeen dead links (the readiness audit of
 * 2026-09-28, finding 21) and nothing could have caught it: the links resolve in
 * the repository, and only the package deletes their targets. These are the
 * checker's own tests — the packaging script runs it as its last step.
 */
describe('a package whose documents cite what it does not ship', () => {
  let base: string;
  let root: string;

  beforeEach(() => {
    // The package is a *subdirectory* of the temp area on purpose, so a test can
    // put a real file outside it: the escaping-link check below is only a check if
    // its target exists on disk.
    base = mkdtempSync(path.join(tmpdir(), 'pkg-links-'));
    root = path.join(base, 'package');
    mkdirSync(path.join(root, 'docs', 'integration'), { recursive: true });
    mkdirSync(path.join(root, 'docs', 'architecture'), { recursive: true });
    mkdirSync(path.join(root, 'docs', 'evidence'), { recursive: true });
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const write = (relative: string, text: string): void =>
    writeFileSync(path.join(root, relative), text);

  it('accepts a link that resolves, an external one and a bare anchor', () => {
    write('docs/architecture/API_CONTRACT.md', '# contract\n');
    write(
      'docs/integration/INTEGRATION.md',
      [
        'See [the contract](../architecture/API_CONTRACT.md).',
        'See [the site](https://example.invalid/x).',
        'See [below](#later) and [the contract again](../architecture/API_CONTRACT.md#routes).',
      ].join('\n'),
    );
    expect(brokenLinks(root)).toEqual([]);
    expect(runPackageLinksTool([root]).code).toBe(0);
  });

  it('reports a link whose target was deleted from the package', () => {
    write('docs/integration/INTEGRATION.md', 'Measured in [the record](../evidence/GONE.md).');
    expect(brokenLinks(root)).toEqual([
      { file: path.join('docs', 'integration', 'INTEGRATION.md'), target: '../evidence/GONE.md' },
    ]);
    const { code, output } = runPackageLinksTool([root]);
    expect(code).toBe(1);
    expect(output).toContain('../evidence/GONE.md');
  });

  /**
   * The one that shipped. `INTEGRATION.md` is copied to the package root, where
   * every link written from `docs/integration/` climbs one level too far — and
   * `../architecture/API_CONTRACT.md` is the file `README.md` tells the broker to
   * read. It resolved on the machine that built the package, which is why a check
   * for existence alone would have passed it.
   */
  it('reports a link that escapes the package even though the file exists outside it', () => {
    // The target is written *outside* the package, and the package has one of its
    // own at the path the link would have meant one directory down. So existence
    // cannot be what fails: only the rule that a link must not leave the package
    // can. Planting `inside = true` reddens exactly this test.
    mkdirSync(path.join(base, 'docs', 'architecture'), { recursive: true });
    writeFileSync(path.join(base, 'docs', 'architecture', 'API_CONTRACT.md'), '# outside\n');
    write('docs/architecture/API_CONTRACT.md', '# the one that ships\n');
    write('INTEGRATION.md', 'See [the contract](../docs/architecture/API_CONTRACT.md).');
    expect(path.resolve(base, 'docs', 'architecture', 'API_CONTRACT.md')).toSatisfy((p: string) =>
      existsSync(p),
    );
    expect(brokenLinks(root)).toEqual([
      { file: 'INTEGRATION.md', target: '../docs/architecture/API_CONTRACT.md' },
    ]);
  });

  it('finds every document and ignores build output', () => {
    write('docs/integration/INTEGRATION.md', '# guide\n');
    mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    write('node_modules/x/README.md', 'See [nothing](./missing.md).');
    mkdirSync(path.join(root, 'packages', 'core', 'dist'), { recursive: true });
    write('packages/core/dist/NOTES.md', 'See [nothing](./missing.md).');
    expect(markdownFiles(root)).toEqual([path.join('docs', 'integration', 'INTEGRATION.md')]);
    expect(brokenLinks(root)).toEqual([]);
  });

  it('follows a kept record to the records it cites in turn', () => {
    write('docs/evidence/A.md', 'Before it, [B](B.md) and [an ADR](../decisions/ADR-1.md).');
    write('docs/evidence/B.md', 'Before it, [C](./C.md).');
    write('docs/evidence/C.md', '# c\n');
    write('docs/evidence/UNCITED.md', '# nobody links this\n');
    write('docs/integration/INTEGRATION.md', 'Measured in [A](../evidence/A.md).');
    const cited = citedEvidence(root, [path.join('docs', 'integration', 'INTEGRATION.md')]);
    expect([...cited].sort()).toEqual(
      ['A.md', 'B.md', 'C.md'].map((name) => path.join('docs', 'evidence', name)),
    );
    expect(cited.has(path.join('docs', 'evidence', 'UNCITED.md'))).toBe(false);
  });

  it('refuses a directory it cannot read, rather than reporting a clean package', () => {
    const { code, output } = runPackageLinksTool([path.join(root, 'nowhere')]);
    expect(code).toBe(2);
    expect(output).toContain('Cannot read');
  });
});
