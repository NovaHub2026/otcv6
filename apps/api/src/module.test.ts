import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Nothing declares a dependency the container cannot resolve.
 *
 * **PH-22.3.** A constructor parameter typed as a bare `number` made Nest read
 * `Number` from `design:paramtypes`, try to resolve it as a provider, and
 * refuse to start the service at all:
 *
 * ```
 * Nest can't resolve dependencies of the MarketController
 *   (VenueService, HistoryService, RegistrationService, ASSET_REGISTRY,
 *    BOOT_NONCE, ?). … argument Number at index [5]
 * ```
 *
 * Every unit test passed, because they construct these classes directly and
 * never meet the container. The failure arrived in a load run, long after the
 * suite was green — and the identical trap is documented two parameters above
 * the one that caused it, for a nullable type.
 *
 * ## Why this reads the source
 *
 * The first version of this guard read `design:paramtypes` at runtime and was
 * **vacuous**: the unit project transforms TypeScript with esbuild, which does
 * not emit decorator metadata, so the guard read an empty array and passed on
 * every input including the defect it was written for. Watched failing is the
 * only way that was going to surface, and it did.
 *
 * So it reads the text, like every other guardrail in this repository.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

/** Types that erase to something Nest cannot resolve without an explicit token. */
const UNRESOLVABLE = /^(number|string|boolean|symbol|bigint|unknown|any|object)\b/;

/** Constructor parameter lines of every decorated class in `apps/api/src`. */
function constructorParameters(): { file: string; line: number; text: string }[] {
  const found: { file: string; line: number; text: string }[] = [];
  for (const name of readdirSync(here)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const source = readFileSync(path.join(here, name), 'utf8');
    if (!/@(Controller|Injectable)\(/.test(source)) continue;
    const lines = source.split('\n');
    let inside = false;
    let depth = 0;
    for (const [index, line] of lines.entries()) {
      if (!inside && /^\s*constructor\($/.test(line)) {
        inside = true;
        depth = 1;
        continue;
      }
      if (!inside) continue;
      depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
      if (depth <= 0) {
        inside = false;
        continue;
      }
      const parameter = /(?:private|public|protected|readonly|@)\s.*?:\s*(.+?)[,=]?\s*$/.exec(line);
      if (parameter !== null && /^\s*(private|public|protected|readonly)/.test(line)) {
        found.push({ file: name, line: index + 1, text: line.trim() });
      }
    }
  }
  return found;
}

describe('nothing declares a dependency the container cannot resolve', () => {
  const parameters = constructorParameters();

  it('finds the constructors to check', () => {
    // A guard that finds nothing passes on everything. This is the assertion the
    // first version of this file did not have, and it is why that version was
    // vacuous.
    expect(parameters.length).toBeGreaterThan(5);
  });

  it.each(parameters.map((p) => [`${p.file}:${String(p.line)}`, p] as const))(
    '%s',
    (where, parameter) => {
      const declared = /:\s*([^,=]+)/.exec(parameter.text)?.[1]?.trim() ?? '';
      if (!UNRESOLVABLE.test(declared)) return;
      // A primitive is fine when the parameter names its own token.
      const source = readFileSync(path.join(here, parameter.file), 'utf8');
      const above = source.split('\n').slice(Math.max(0, parameter.line - 12), parameter.line);
      expect(
        above.some((line) => /@Inject\(/.test(line)),
        `${where} is \`${declared}\` with no @Inject — Nest resolves that as a provider and the ` +
          `service will not boot`,
      ).toBe(true);
    },
  );
});
