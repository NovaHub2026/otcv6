import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/**
 * Every production source file: everything under `apps/api/src` except the Lab.
 *
 * **Recursive since Cycle Audit 8 (a1, a4).** It listed the top level only, so
 * a subdirectory was outside every guard in this file: an auditor put a
 * steering sign source under `apps/api/src/ops/` and a route serving the
 * keystream cursors beside it, and the whole suite stayed green. A guard whose
 * scope is one directory deep is a guard against tidy defects.
 */
function productionSources(dir = src, prefix = ''): { file: string; source: string }[] {
  const out: { file: string; source: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'lab' || entry.name === 'dist' || entry.name === 'node_modules') continue;
      out.push(...productionSources(path.join(dir, entry.name), relative));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    out.push({ file: relative, source: readFileSync(path.join(dir, entry.name), 'utf8') });
  }
  return out;
}

describe('the production composition cannot reach the Lab', () => {
  it('has a Lab to be absent, and looks below the top level', () => {
    // A guard that finds nothing passes on everything.
    expect(
      readdirSync(path.join(src, 'lab')).filter((n) => n.endsWith('.ts')).length,
    ).toBeGreaterThan(2);
    // And the scan reaches subdirectories. There is no non-Lab subdirectory in
    // the tree today, which is exactly how the hole survived: the assertion is
    // made against a directory shaped like the one an auditor planted.
    const probe = mkdtempSync(path.join(tmpdir(), 'otc-scan-'));
    try {
      mkdirSync(path.join(probe, 'ops'), { recursive: true });
      mkdirSync(path.join(probe, 'lab'), { recursive: true });
      writeFileSync(path.join(probe, 'top.ts'), '');
      writeFileSync(path.join(probe, 'ops', 'steering.ts'), '');
      writeFileSync(path.join(probe, 'ops', 'steering.test.ts'), '');
      writeFileSync(path.join(probe, 'lab', 'inside.ts'), '');
      const seen = productionSources(probe)
        .map(({ file }) => file)
        .sort();
      expect(seen, 'the scan misses a nested source, or descends into lab/').toEqual([
        'ops/steering.ts',
        'top.ts',
      ]);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  it('no production module imports anything under lab/', () => {
    // The specifier, however it is reached: `import … from './lab/x.js'`,
    // `await import('./lab/x.js')` and `require('../lab/x.js')` are the same
    // door. Cycle Audit 8 (a4) planted the dynamic form into `main.ts` — the
    // `OTC_LAB_ENABLED` arrangement ADR-0015 §3 forbids by name — and this
    // guard, anchored on `from '`, saw nothing.
    const offenders = productionSources()
      .filter(({ source }) => /['"`]\.{1,2}\/lab\//.test(source))
      .map(({ file }) => file);
    expect(
      offenders,
      'these are in the production composition and import the Lab; the Lab must be composed ' +
        'on top of the application, never inside it',
    ).toEqual([]);
  });

  it('the Lab composes the application, and not the other way round', () => {
    // The direction is the boundary. The Lab may know about the application;
    // the application may not know the Lab exists.
    expect(read('lab/lab.module.ts')).toMatch(/from '\.\.\/app\.module\.js'/);

    // Checked on what the module *does*, not on whether it says the word. The
    // first version of this forbade the string `lab` anywhere in the file and
    // fired on a comment explaining why the export is safe — a guard that
    // punishes the explanation of the rule it enforces is a guard that will be
    // deleted the first time it is inconvenient.
    const app = read('app.module.ts');
    expect(app, 'AppModule imports the Lab').not.toMatch(/from '\.\/lab\//);
    expect(app, 'AppModule declares a Lab provider or controller').not.toMatch(
      /\bLab(Module|Controller|Service)\b/,
    );
  });

  it('keystream cursors appear in the Lab and in no production response', () => {
    // The sharpest thing the Lab exposes, and the reason the boundary is
    // structural rather than a check.
    expect(read('lab/lab.controller.ts')).toMatch(/cursors:/);
    // **Cycle Audit 8 (a1).** This carried two exemptions for `venue.service.ts`:
    // one dead — `!/^venue\.service\.ts$/.test('x')`, a regex tested against a
    // string literal, so always true — and one real and uncommented. The module
    // exempted is the one that owns `snapshotEngine()`, `labTicksAhead` and
    // `labFork`: an auditor added a production method there returning the
    // cursors and this test passed. Both are gone; nothing is exempt.
    const leaked = productionSources()
      .filter(({ source }) => /return[\s\S]{0,400}cursors/.test(source))
      .map(({ file }) => file);
    expect(leaked, 'a production response carries keystream cursors (INV-010)').toEqual([]);
  });

  /**
   * **Cycle Audit 8 (a1).** The guard above looks for the word `cursors`, and a
   * defect does not have to write it: an auditor added a production route that
   * spread `snapshotEngine()` into its response — a status page, a debug
   * endpoint, a support tool — and served all seven cursors and the whole latent
   * magnitude and arrival state with the suite green. INV-010 is about the
   * value, not the identifier, so the guard is about the value too.
   *
   * The engine snapshot may be *read* in production — `venue.service.ts` takes
   * the price, the sequence and the instant off it four times — but it may never
   * be spread, returned whole, or serialised. Naming the fields is the act that
   * makes a leak deliberate.
   */
  it('no production source hands out an engine snapshot whole (INV-010)', () => {
    const offenders = productionSources()
      .filter(({ source }) =>
        // `...snapshotEngine()`, `...snapshot`, `return snapshot`, `JSON.stringify(snapshot)`
        /\.\.\.[\w.]*snapshot|\.\.\.\s*\(?[\w.]*\.snapshotEngine\(\)|return\s+snapshot\b|stringify\([\w.]*snapshot/i.test(
          source,
        ),
      )
      .map(({ file }) => file);
    expect(
      offenders,
      'a production source passes an engine snapshot on whole; name the fields it needs — the ' +
        'snapshot carries the keystream cursors and the latent state (INV-010)',
    ).toEqual([]);
    // And the Lab, which may, still does — so this guard has a subject.
    expect(read('lab/lab.controller.ts')).toMatch(/snapshotEngine\(\)/);
  });

  it('every Lab response says what it is', () => {
    // §3 of the specification: a screenshot of the Lab must not be mistakable
    // for one of the market.
    //
    // Per route, not per `return {`: the first version counted returns against
    // literal banners, and PH-24.2 broke it in both directions — a constant
    // replaced the literal, and private helpers return objects that are not
    // responses. Each routed method must carry the environment itself, or
    // spread a helper that does (`plan`, `timelines`).
    const controller = read('lab/lab.controller.ts');
    const routes = controller.split(/^\s*@(?:Get|Post)\(/m).slice(1);
    expect(routes.length).toBeGreaterThanOrEqual(9);
    for (const route of routes) {
      const body = route.split(/^\s*(?:@(?:Get|Post)\(|private |\/\*\*\s*$)/m)[0]!;
      const name =
        /^[^)]*\)\s*\n\s*(?:async )?([a-zA-Z]+)\(/.exec(route)?.[1] ?? route.slice(0, 40);
      expect(
        /environment: LAB|OTC LAB — SIMULATION ENVIRONMENT|\.\.\.this\.plan\(|this\.session\.timelines\(\)/.test(
          body,
        ),
        `route ${name} answers without saying it is the Lab`,
      ).toBe(true);
    }
    expect(controller).toMatch(/const LAB = 'OTC LAB — SIMULATION ENVIRONMENT'/);
  });

  it('never appends a tick to a feed from outside the engine (PH-24.5 §3)', () => {
    // §37's synthetic tick is not built, and this is the mechanism that keeps
    // it not built: the Lab reads feeds; it does not write them. The engine is
    // the single writer (ADR-0012), and a tick from anywhere else collides with
    // its sequence numbering.
    const labDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lab');
    const sources = readdirSync(labDir).filter((n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n));
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const source = readFileSync(path.join(labDir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(source, `lab/${file} writes to a feed`).not.toMatch(/\.publish\(|feed\.forget\(/);
    }
  });

  it('never serves a predictability verdict without its sensitivity (§68, CA7-05)', () => {
    // "Clean" and "clean at a minimum detectable effect of 0.22pp" are
    // different claims, and only the second can be acted on. `VALIDATION.md`
    // exists to keep them apart, and Cycle Audit 7 caught PH-21 collapsing
    // exactly that distinction for a different metric.
    //
    // A dashboard that shows a verdict and hides the resolution at which it
    // looked is worse than no dashboard: it invites the reliance
    // `differentiation.ts` warns about, in writing.
    const controller = read('lab/lab.controller.ts');
    const block = /predictability:\s*\{([\s\S]*?)\n {6}\},/.exec(controller)?.[1];
    expect(block, 'no predictability block found').toBeDefined();
    expect(block!, 'the verdict is served').toMatch(/clean:/);
    expect(block!, 'and its sensitivity travels with it').toMatch(/sensitivity:/);
    // And the sample size, for the same reason.
    expect(controller).toMatch(/sampledTicks:/);
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
