/**
 * **Every link in the integration package has to resolve** (the readiness audit
 * of 2026-09-28, finding 21).
 *
 * The package is `git archive` minus the documents that govern this repository
 * rather than the engine — `docs/phases`, `docs/audits`, `docs/reports`,
 * `docs/evidence` and the process files at the root. The two documents a broker
 * actually reads cite those trees, so the delivered package carried **seventeen**
 * dead links: `INTEGRATION.md` pointed at `../architecture/API_CONTRACT.md`,
 * which from the package root escapes the package altogether, and both guides
 * cited the measurements behind their own numbers — the refund table, the seam
 * rate, the tempo record — none of which shipped. A broker reading "measured,
 * reproducible: see this file" found nothing there.
 *
 * Nothing checked, because nothing could: the links resolve perfectly in the
 * repository, and only the package deletes their targets. So the check belongs to
 * the package, and it is the packaging script's last step — a release whose
 * documents point at files it does not ship does not build.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** A Markdown link in a delivered file whose target is not in the package. */
export interface BrokenLink {
  /** Package-relative path of the file holding the link. */
  readonly file: string;
  /** The link target, exactly as written. */
  readonly target: string;
}

/** Directories that are never part of a package's own content. */
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.next', '.next-stat', '.git']);

/**
 * `[text](target)`, with an optional `#anchor`. Deliberately does not try to
 * parse reference-style links or HTML anchors: the documents use neither, and a
 * checker that quietly understands less than it appears to is worse than one
 * whose scope is stated.
 */
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** Whether a target is external and so not ours to resolve. */
function isExternal(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

/** Every `*.md` in `root`, package-relative, skipping build output. */
export function markdownFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.md')) {
        out.push(path.relative(root, path.join(dir, entry.name)));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Every relative Markdown link under `root` that does not resolve to a file or
 * directory inside `root`. A target that leaves the package is broken even if it
 * happens to exist on the machine that built it — which is exactly how
 * `../architecture/API_CONTRACT.md` at the package root went unnoticed.
 */
export function brokenLinks(root: string): BrokenLink[] {
  const absoluteRoot = path.resolve(root);
  const broken: BrokenLink[] = [];
  for (const file of markdownFiles(absoluteRoot)) {
    const full = path.join(absoluteRoot, file);
    const text = readFileSync(full, 'utf8');
    for (const match of text.matchAll(LINK)) {
      const target = match[1]!;
      if (isExternal(target)) continue;
      const withoutAnchor = target.split('#')[0]!;
      if (withoutAnchor === '') continue; // a pure `#anchor`, within the file
      const resolved = path.resolve(path.dirname(full), withoutAnchor);
      const inside = resolved === absoluteRoot || resolved.startsWith(absoluteRoot + path.sep);
      if (!inside) {
        broken.push({ file, target });
        continue;
      }
      try {
        statSync(resolved);
      } catch {
        broken.push({ file, target });
      }
    }
  }
  return broken;
}

/** Which `docs/evidence` records a delivered document cites, transitively. */
export function citedEvidence(root: string, from: readonly string[]): Set<string> {
  const absoluteRoot = path.resolve(root);
  const cited = new Set<string>();
  let frontier = [...from];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const file of frontier) {
      const full = path.join(absoluteRoot, file);
      let text: string;
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      for (const match of text.matchAll(LINK)) {
        const target = match[1]!;
        if (isExternal(target)) continue;
        const resolved = path.resolve(path.dirname(full), target.split('#')[0]!);
        const relative = path.relative(absoluteRoot, resolved);
        if (!relative.startsWith(`docs${path.sep}evidence${path.sep}`)) continue;
        if (cited.has(relative)) continue;
        cited.add(relative);
        next.push(relative);
      }
    }
    frontier = next;
  }
  return cited;
}

/** A script in the delivered `package.json` that names a file the package lacks. */
export interface DanglingScript {
  /** The npm script's name. */
  readonly script: string;
  /** The path it names, relative to the package root. */
  readonly target: string;
}

/**
 * **A command the package offers has to be runnable in the package** (the
 * readiness audit of 2026-09-28, finding 21, second half).
 *
 * `npm run state:check` ran the three guards that hold this repository's own
 * process documents — and the package deletes those three test files, by design,
 * because the documents they guard do not ship either. So the delivered
 * `package.json` offered an operator a command that could only fail, in a tree
 * where "check my state directory" is exactly the thing they would reach for.
 *
 * `dist/` paths are not dangling: the package ships source and the broker's first
 * instruction is `npm run build`.
 */
export function danglingScripts(root: string): DanglingScript[] {
  const absoluteRoot = path.resolve(root);
  const manifest = path.join(absoluteRoot, 'package.json');
  let scripts: Record<string, string>;
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    scripts = parsed.scripts ?? {};
  } catch {
    return [];
  }
  const PATHS = /(?:tools|packages|apps|deploy|docs)\/[A-Za-z0-9_./-]+\.(?:sh|js|ts|mjs|cjs|py)/g;
  const out: DanglingScript[] = [];
  for (const [script, command] of Object.entries(scripts)) {
    for (const target of command.match(PATHS) ?? []) {
      if (target.includes('/dist/')) continue;
      try {
        statSync(path.join(absoluteRoot, target));
      } catch {
        out.push({ script, target });
      }
    }
  }
  return out;
}
