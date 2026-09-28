/**
 * The packaging script's last step: **does every link in the package resolve?**
 * (the readiness audit of 2026-09-28, finding 21 — see `packageLinks.ts` for what
 * it found). Exit 1 and a list, or exit 0 and a count.
 *
 *   node tools/sim/dist/packageLinksTool.js <package dir>
 */
import { brokenLinks, markdownFiles } from './packageLinks.js';

export function runPackageLinksTool(argv: readonly string[]): { code: number; output: string } {
  const root = argv[0];
  if (root === undefined) {
    return { code: 2, output: 'Usage: package-links <package dir>' };
  }
  let broken: ReturnType<typeof brokenLinks>;
  let files: string[];
  try {
    files = markdownFiles(root);
    broken = brokenLinks(root);
  } catch (error) {
    return { code: 2, output: `Cannot read ${root}: ${(error as Error).message}` };
  }
  if (broken.length === 0) {
    return { code: 0, output: `Links: every target resolves, across ${files.length} document(s).` };
  }
  const lines = broken.map(({ file, target }) => `  ${file} → ${target}`);
  return {
    code: 1,
    output:
      `${broken.length} link(s) in this package point at files it does not ship, ` +
      `across ${files.length} document(s):\n${lines.join('\n')}\n\n` +
      'A package whose own documents cite what it does not contain is not a package. ' +
      'Either ship the target — `integration-package.sh` keeps every `docs/evidence` ' +
      'record a delivered document cites — or say the name in prose instead of linking it.',
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && /packageLinksTool\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  const { code, output } = runPackageLinksTool(process.argv.slice(2));
  process.stdout.write(`${output}\n`);
  process.exit(code);
}
