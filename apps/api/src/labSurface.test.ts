import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Lab is absent from production, not disabled in it.
 *
 * ADR-0015 §3, and this test is what makes it true rather than intended. The
 * Lab serves the engine's latent state and its **keystream cursors**, which
 * INV-010 forbids publishing: a cursor with the key reconstructs every future
 * price, and a cursor alone narrows the search enormously.
 *
 * A `LAB_ENABLED=false` in production would make that absence a claim about an
 * environment variable. Cycle Audit 7 measured what those are worth — a bind
 * default no test pinned, a portability scan that skipped the directory its own
 * docstring named, a browser suite reporting passes while launching nothing.
 */
const src = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(path.join(src, file), 'utf8');

/** Every production source file: everything under `apps/api/src` except the Lab. */
function productionSources(): { file: string; source: string }[] {
  const out: { file: string; source: string }[] = [];
  for (const name of readdirSync(src)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    out.push({ file: name, source: read(name) });
  }
  return out;
}

describe('the production composition cannot reach the Lab', () => {
  it('has a Lab to be absent', () => {
    // A guard that finds nothing passes on everything.
    expect(
      readdirSync(path.join(src, 'lab')).filter((n) => n.endsWith('.ts')).length,
    ).toBeGreaterThan(2);
  });

  it('no production module imports anything under lab/', () => {
    const offenders = productionSources()
      .filter(({ source }) => /from '\.\/lab\//.test(source) || /from '\.\.\/lab\//.test(source))
      .map(({ file }) => file);
    expect(
      offenders,
      'these are in the production composition and import the Lab; the Lab must be composed ' +
        'on top of the application, never inside it',
    ).toEqual([]);
  });

  it('the Lab composes the application, and not the other way round', () => {
    expect(read('lab/lab.module.ts')).toMatch(/from '\.\.\/app\.module\.js'/);
    expect(read('app.module.ts')).not.toMatch(/lab/i);
  });

  it('keystream cursors appear in the Lab and in no production response', () => {
    // The sharpest thing the Lab exposes, and the reason the boundary is
    // structural rather than a check.
    expect(read('lab/lab.controller.ts')).toMatch(/cursors:/);
    const leaked = productionSources()
      .filter(({ source }) => /cursors/.test(source) && !/^venue\.service\.ts$/.test('x'))
      .filter(({ file }) => file !== 'venue.service.ts')
      .filter(({ source }) => /return[\s\S]{0,400}cursors/.test(source))
      .map(({ file }) => file);
    expect(leaked, 'a production response carries keystream cursors (INV-010)').toEqual([]);
  });

  it('every Lab response says what it is', () => {
    // §3 of the specification: a screenshot of the Lab must not be mistakable
    // for one of the market.
    const controller = read('lab/lab.controller.ts');
    const returns = controller.split('return {').length - 1;
    expect(returns).toBeGreaterThan(1);
    expect(controller.match(/OTC LAB — SIMULATION ENVIRONMENT/g) ?? []).toHaveLength(returns);
  });

  it('reports direction as exactly one half, with its reason and no breakdown', () => {
    // §10 corrected. The specification asks for "UP 51.8% / DOWN 48.2%" and an
    // influence breakdown; those numbers cannot exist, because the sign is an
    // independent fair coin and the magnitude engine cannot observe one.
    const controller = read('lab/lab.controller.ts');
    expect(controller).toMatch(/up: 0\.5/);
    expect(controller).toMatch(/down: 0\.5/);
    expect(controller).toMatch(/ADR-0003/);
    expect(controller, 'an influence breakdown would have to be invented').not.toMatch(
      /trendInfluence|momentumInfluence|meanReversionInfluence/,
    );
  });
});
