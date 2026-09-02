import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasExtension, isTestFile, SOURCE_EXTENSIONS } from './sourceScan.js';

/**
 * How the guards walk the repository.
 *
 * Five guard files each carried their own directory walk, and each walk had its
 * own idea of what a source file is. That is how `dependencies.test.ts` came to
 * read `.tsx` (CA6-12) while `guardrails.test.ts` did not (a2-03), and how
 * `publicSurface.test.ts` came to read one directory level while the others
 * recursed (a2-10). One walker, one vocabulary, so a widening reaches every
 * guard at once.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** The repository root, from wherever this file is loaded. */
export const repoRoot: string = path.resolve(here, '../../../..');

/** Directories no guard reads into. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  '.git',
]);

export interface WalkOptions {
  /** File extensions to collect. Defaults to {@link SOURCE_EXTENSIONS}. */
  readonly extensions?: readonly string[];
  /** Whether `*.test.*` files are included. Defaults to `true`. */
  readonly includeTests?: boolean;
}

/**
 * Repo-relative paths of every source file under `root` (itself repo-relative),
 * sorted. A root that does not exist yields nothing rather than throwing: a
 * package that has not been created yet is not a violation.
 */
export function listSourceFiles(root: string, options: WalkOptions = {}): string[] {
  const extensions = options.extensions ?? SOURCE_EXTENSIONS;
  const includeTests = options.includeTests ?? true;
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (hasExtension(entry, extensions) && (includeTests || !isTestFile(entry))) {
        out.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(path.join(repoRoot, root));
  return out.sort();
}

/** A file's text, by repo-relative path. */
export function readRepositoryFile(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}
