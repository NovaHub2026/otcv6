// Invariant evidence: INV-001 (economic independence), INV-005 (expiration independence).
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readRepositoryFile } from './repository.js';
import {
  AMBIENT_RULES,
  ECONOMIC_BLINDNESS_RULES,
  moduleSpecifiers,
  PORTABILITY_RULES,
  scanOptionsFor,
  scanSource,
  SOURCE_EXTENSIONS,
  stripCommentsAndStrings,
  type Violation,
} from './sourceScan.js';

/**
 * Packages whose code generates, carries or transforms market data.
 *
 * **Widened by Cycle Audit 4 (M-4), and again by Cycle Audit 6 (CA6-11).** It
 * listed `core`, `engine` and `fixtures` only, so `runtime`, `trading`,
 * `distribution` and everything under `apps/` were unscanned. Cycle Audit 4
 * added the packages; `apps/` stayed in this sentence and out of the list for
 * two more cycles, which is how a docstring comes to describe a fix that did not
 * happen. `apps/api/src` is in {@link REPLAYABLE_ROOTS} now — and those are precisely where economic state lives.
 * An auditor put a module-level channel in `packages/core/src/market/`, wrote it
 * from `packages/trading/src/settle.ts`, and read it back into the engine. The
 * write side was in a directory this scan never opened.
 *
 * Scanning a package does not make it economically blind; the behavioural tests
 * do that. It makes the *vocabulary* rules — no ambient time, no ambient mutable
 * state, no non-portable numerics — apply everywhere they should have applied
 * all along.
 */
const GENERATION_ROOTS = [
  'packages/core/src',
  'packages/engine/src',
  // Fixtures deliberately plant directional defects, but they are still
  // generation code: they must be replayable and portable, or a calibration run
  // would not be reproducible. Their intended violation — reading a sign — is
  // caught by the mirror test in PH-3, not by this scanner.
  'packages/fixtures/src',
  'packages/distribution/src',
  'packages/chart/src',
];

/**
 * Packages that must stay replayable, which is a wider set than the price path.
 *
 * `runtime` schedules markets and persists them; `trading` settles against the
 * published record. Neither generates prices, so neither is bound by the
 * economic-vocabulary rule — `trading` is *about* payouts, and scanning it for
 * the word would be nonsense. Both are still bound by the rules that make a
 * record reproducible: no ambient clock, no ambient mutable state, no
 * non-portable numerics.
 *
 * Cycle Audit 4 (M-4) found neither being scanned at all.
 */
const REPLAYABLE_ROOTS = [
  ...GENERATION_ROOTS,
  'packages/runtime/src',
  'packages/trading/src',
  /**
   * **Cycle Audit 6, CA6-11.** `apps/` is named in the docstring above as part
   * of what Cycle Audit 4 widened this to cover, and it was never added. PH-18
   * then cited "the guardrail scan" as what keeps INV-001 true of the panel it
   * built — in a directory this scan did not open. An auditor put an ambient
   * economic channel in the venue's publish loop and all 297 guardrail tests
   * passed; the identical line in `packages/runtime/src/venue.ts` failed
   * instantly.
   *
   * The service hosts and persists markets, so it belongs to the replayable set
   * for the same reason `runtime` does. `apps/web` deliberately does **not**:
   * a browser panel reads the wall clock to choose a window and is not part of
   * any record. What protects the browser bundle is the dependency guard, which
   * CA6-12 fixed to read `.tsx` — and PH-18 §5's sentence about this scan was
   * corrected rather than made true.
   */
  'apps/api/src',
];

/**
 * The evidence generators.
 *
 * **Out-of-band audit 7, a2-04.** `tools/sim` produces the numbers every claim
 * in this project cites, and it was in neither enforcement layer: not in these
 * roots, and outside the ESLint block's `packages/*` glob. A `Date.now()` in
 * `runner.ts` was caught by nothing. B-018 recorded the reason the roots were
 * not widened — `horizonEvidence.ts` times wall-clock work legitimately — and
 * that is an argument for an allowlist, not for no scan. So the tooling is
 * bound by the replayability rules with the four timers named below, and by
 * portability outright: a non-portable `Math.exp` in an evidence generator
 * makes a "reproducible" result reproducible on one Node build.
 *
 * It is not bound by the economic vocabulary. The simulation computes
 * economics; that is its job.
 */
const TOOLING_ROOTS = ['tools/sim/src'];

/**
 * `publishingKeyFromEnvironment` is the sanctioned reader of ambient state.
 *
 * A publishing key has to come from somewhere outside the process, and reading
 * `OTC_MASTER_SECRET` there is the *defence* — it is how the loader refuses a
 * publishing key equal to the generation secret (INV-010). Moving the check
 * somewhere unscanned to keep this list short would trade a guaranteed refusal
 * for a tidier scan. `publishingKey.test.ts` asserts the refusal still exists.
 */
const AMBIENT_STATE_ALLOWLIST = [
  'packages/distribution/src/signing.ts',
  /**
   * Configuration, read once at composition and never again.
   *
   * These are the service's edge: the state directory, the history database, the
   * publishing secret, the listening port. Something has to read the
   * environment, and confining it to the module that wires the application
   * together is the same containment `signing.ts` gets — with the same
   * consequence, that nothing below them can.
   */
  'apps/api/src/app.module.ts',
  'apps/api/src/main.ts',
  'apps/api/src/publication.service.ts',
  /**
   * The tooling's entry points read `process.argv` and `process.env` to learn
   * what to run. They are commands, not modules anything imports; every module
   * they drive is scanned without exemption.
   */
  'tools/sim/src/catalogueScale.ts',
  'tools/sim/src/cli.ts',
  'tools/sim/src/dispersionEvidence.ts',
  'tools/sim/src/horizonEvidence.ts',
  'tools/sim/src/venueScale.ts',
];

/**
 * `SystemClock` is the single sanctioned reader of ambient time in anything
 * that ships: something must eventually ask the operating system what time it
 * is, and confining that to one named class is what makes every other module
 * replayable.
 *
 * The four tooling files time wall-clock work — how long a hundred-asset
 * registration or a horizon-evidence run took — and report it as evidence.
 * That is a measurement of the run, not an input to it: none of them passes
 * what it reads to anything that generates. Each is asserted below to still
 * read time, so the list cannot outlive the reason for an entry.
 */
const AMBIENT_TIME_ALLOWLIST = [
  'packages/core/src/time/clock.ts',
  'tools/sim/src/catalogueScale.ts',
  'tools/sim/src/horizonEvidence.ts',
  'tools/sim/src/runner.ts',
  'tools/sim/src/venueScale.ts',
];

interface Source {
  readonly file: string;
  readonly source: string;
}

function sourcesUnder(roots: readonly string[]): Source[] {
  return roots
    .flatMap((root) => listSourceFiles(root, { includeTests: false }))
    .map((file) => ({ file, source: readRepositoryFile(file) }));
}

/** The price path: bound by every rule, including economic blindness. */
function generationSources(): Source[] {
  return sourcesUnder(GENERATION_ROOTS);
}

/** Everything that must stay reproducible: the price path, what hosts it, and what measures it. */
function replayableSources(): Source[] {
  return sourcesUnder([...REPLAYABLE_ROOTS, ...TOOLING_ROOTS]);
}

function describeViolations(violations: Violation[]): string {
  return violations
    .map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}\n    ${v.reason}`)
    .join('\n');
}

describe('guardrail scanner', () => {
  it('finds ambient time', () => {
    const found = scanSource('x.ts', 'const t = Date.now();', AMBIENT_RULES);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe('no-ambient-time');
  });

  it('finds every spelling of ambient time the audit planted (a2-05)', () => {
    for (const source of [
      'const p08 = Date();', // G1-08
      'const p09 = new Intl.DateTimeFormat().format();', // G1-09
      'const p11 = process.uptime();', // G1-11
      'const p12 = performance.timeOrigin;', // G1-12
      'const p = performance.now();',
      'const p = process.hrtime.bigint();',
      'const d = new Date(0);',
    ]) {
      const found = scanSource('x.ts', source, AMBIENT_RULES).filter(
        (v) => v.rule === 'no-ambient-time',
      );
      expect(found, source).toHaveLength(1);
    }
  });

  it('finds ambient mutable state', () => {
    expect(scanSource('x.ts', 'const x = globalThis.leak;', AMBIENT_RULES)).toHaveLength(1);
    expect(scanSource('x.ts', 'const e = process.env.MODE;', AMBIENT_RULES)).toHaveLength(1);
    // The path members are what a module legitimately reads from import.meta.
    expect(
      scanSource(
        'x.ts',
        'const here = path.dirname(fileURLToPath(import.meta.url));',
        AMBIENT_RULES,
      ),
    ).toHaveLength(0);
    for (const source of [
      'const p22 = (global as Record<string, unknown>).__exposure;', // G1-22
      'const p25 = process.argv;', // G1-25
      'const p24 = import.meta.env;', // G1-24
      'const p24b = (import.meta as Record<string, unknown>).env;', // G1-24, as planted
      'const p13 = process.getBuiltinModule;', // W-13
    ]) {
      const found = scanSource('x.ts', source, AMBIENT_RULES).filter(
        (v) => v.rule === 'no-ambient-state',
      );
      expect(found, source).toHaveLength(1);
    }
  });

  it('finds ambient randomness', () => {
    expect(scanSource('x.ts', 'const r = Math.random();', AMBIENT_RULES)).toHaveLength(1);
    expect(scanSource('x.ts', 'const r = randomBytes(32);', AMBIENT_RULES)).toHaveLength(1);
    expect(scanSource('x.ts', 'const r = randomFill(buffer);', AMBIENT_RULES)).toHaveLength(1);
    expect(scanSource('x.ts', 'const k = generateKeySync("hmac");', AMBIENT_RULES)).toHaveLength(1);
  });

  it('finds bracket access on a global, which names the member in a string (a2-05)', () => {
    for (const source of [
      'const p07 = Date["now"]();', // G1-07
      'const p14 = Math["random"]();', // G1-14
      'const p29 = Math["exp"](0.1);', // G1-29
      'const p23 = process["env"];', // G1-23
      'const p = performance[key];',
      'const p = Reflect["get"];',
    ]) {
      const found = scanSource('x.ts', source, AMBIENT_RULES).filter(
        (v) => v.rule === 'no-computed-global-access',
      );
      expect(found, source).toHaveLength(1);
    }
  });

  it('finds dynamic evaluation (a2-05)', () => {
    for (const source of [
      'const p16 = (Reflect.get(Math, "random") as () => number)();', // G1-16
      'const p10 = Reflect.construct(Date, []);', // G1-10
      'const p20 = new Function("return Math.random()")();', // G1-20
      'const p21 = eval("Math.random()");', // G1-21
      'const f = Function("return 1");',
    ]) {
      const found = scanSource('x.ts', source, AMBIENT_RULES).filter(
        (v) => v.rule === 'no-dynamic-evaluation',
      );
      expect(found, source).toHaveLength(1);
    }
    // A function of one's own that happens to end in the word is not the constructor.
    expect(
      scanSource('x.ts', 'const v = myFunction(1) + obj.eval(2);', AMBIENT_RULES).filter(
        (v) => v.rule === 'no-dynamic-evaluation',
      ),
    ).toHaveLength(0);
  });

  it('finds a global taken as a value, which hides the member access (a2-05)', () => {
    for (const source of [
      'const M17 = Math;', // G1-17
      'const { exp: exp30 } = Math;', // G1-30
      'const f = use(Date);',
      'const p = [performance];',
    ]) {
      const found = scanSource('x.ts', source, AMBIENT_RULES).filter(
        (v) => v.rule === 'no-global-aliasing',
      );
      expect(found, source).toHaveLength(1);
    }
    // The ordinary member access is not aliasing.
    expect(
      scanSource('x.ts', 'const v = Math.floor(x) + Math.sqrt(y);', AMBIENT_RULES).filter(
        (v) => v.rule === 'no-global-aliasing',
      ),
    ).toHaveLength(0);
  });

  it('finds a mutable module-level export (a2-05, B-007)', () => {
    const found = scanSource('x.ts', 'export let p26 = 0;', AMBIENT_RULES);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe('no-mutable-module-state');
    expect(scanSource('x.ts', 'export const p = 0;\nlet local = 0;', AMBIENT_RULES)).toHaveLength(
      0,
    );
  });

  it('finds non-portable maths', () => {
    expect(scanSource('x.ts', 'const v = Math.exp(x);', PORTABILITY_RULES)).toHaveLength(1);
    expect(scanSource('x.ts', 'const v = Math.log(x);', PORTABILITY_RULES)).toHaveLength(1);
    expect(scanSource('x.ts', 'const v = 2 ** 32;', PORTABILITY_RULES)).toHaveLength(1);
  });

  it('permits the exactly-specified operations', () => {
    const safe = 'const v = Math.sqrt(a) + Math.floor(b) * Math.abs(c) - Math.imul(d, e);';
    expect(scanSource('x.ts', safe, PORTABILITY_RULES)).toHaveLength(0);
  });

  it('finds economic inputs', () => {
    expect(scanSource('x.ts', 'const p = config.payout;', ECONOMIC_BLINDNESS_RULES)).toHaveLength(
      1,
    );
    expect(scanSource('x.ts', 'if (brokerExposure > 0) {}', ECONOMIC_BLINDNESS_RULES)).toHaveLength(
      1,
    );
  });

  it('finds contract and expiration inputs', () => {
    expect(
      scanSource('x.ts', 'const e = ctx.selectedExpirationMs;', ECONOMIC_BLINDNESS_RULES),
    ).toHaveLength(1);
    expect(
      scanSource('x.ts', 'if (tradeDirection === 1) {}', ECONOMIC_BLINDNESS_RULES),
    ).toHaveLength(1);
  });

  it('matches inside camelCase, not only at word boundaries', () => {
    // The Cycle Audit 001 regression: `\bpayout\b` cannot match `userPayout`,
    // and `\bexpiration\b` cannot match `selectedExpirationMs`. A planted
    // `selectedExpirationMs` field passed every guardrail because of it.
    for (const source of [
      'const a = userPayout;',
      'const b = ctx.selectedExpirationMs;',
      'const c = theContractHorizonMs;',
    ]) {
      expect(scanSource('x.ts', source, ECONOMIC_BLINDNESS_RULES), source).toHaveLength(1);
    }
  });

  it('does not flag ordinary words that merely look economic', () => {
    const safe =
      'const p = stream.position(); const state = { open, high, low, close };\n' +
      'const v = volatilityContraction(range); const id = contractionId;';
    expect(scanSource('x.ts', safe, ECONOMIC_BLINDNESS_RULES)).toHaveLength(0);
  });

  it('ignores comments and string literals', () => {
    const source = [
      '// Date.now() is forbidden here',
      '/* Math.random() explained */',
      'const message = "call Date.now() for the wall clock";',
      'const template = `Math.random ${x}`;',
      'const ok = 1;',
    ].join('\n');
    expect(scanSource('x.ts', source, AMBIENT_RULES)).toHaveLength(0);
  });

  it('still sees code on the same line as a trailing comment', () => {
    expect(scanSource('x.ts', 'const t = Date.now(); // needed', AMBIENT_RULES)).toHaveLength(1);
  });

  it('preserves line numbering when stripping', () => {
    const stripped = stripCommentsAndStrings('a\n/* x\ny */\nb');
    expect(stripped.split('\n')).toHaveLength(4);
  });

  it('reads every source spelling, not only .ts (a2-03)', () => {
    // The vocabulary the walker uses. A `.mts` or `.tsx` under a scanned root
    // is scanned; the meta-audit plants one to prove it.
    expect(SOURCE_EXTENSIONS).toEqual(['.ts', '.tsx', '.mts', '.cts']);
    expect(scanOptionsFor('component.tsx')).toEqual({ jsx: true });
    expect(scanOptionsFor('module.mts')).toEqual({ jsx: false });
  });
});

describe('generation code is replayable', () => {
  // The replayability rules apply to everything that must reproduce, which is
  // wider than the price path: `runtime` schedules and persists markets,
  // `trading` settles against the published record, `tools/sim` measures it.
  const sources = replayableSources();
  const byRule = (rule: string): Violation[] =>
    sources.flatMap(({ file, source }) =>
      scanSource(file, source, AMBIENT_RULES).filter((v) => v.rule === rule),
    );

  it('scans a non-empty set of files, including the tooling', () => {
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.some(({ file }) => file.startsWith('tools/sim/src/'))).toBe(true);
  });

  it('never reads ambient time outside the sanctioned clock and the evidence timers', () => {
    const violations = byRule('no-ambient-time').filter(
      (v) => !AMBIENT_TIME_ALLOWLIST.includes(v.file),
    );
    expect(describeViolations(violations)).toBe('');
  });

  it('never reads ambient randomness', () => {
    expect(describeViolations(byRule('no-ambient-randomness'))).toBe('');
  });

  it('never reads ambient mutable state', () => {
    // Added by Cycle Audit 2, which planted a backdoor reading operator exposure
    // through `globalThis`, armed by `process.env`, and watched every
    // import-based and vocabulary-based guardrail pass it. Ambient state is a
    // channel into the price path that names nothing and imports nothing.
    const violations = byRule('no-ambient-state').filter(
      (v) => !AMBIENT_STATE_ALLOWLIST.includes(v.file),
    );
    expect(describeViolations(violations)).toBe('');
  });

  it('never reaches a global by a computed name, dynamic evaluation or an alias', () => {
    // a2-05: the three constructs that hide a name from a name-based scan.
    // No allowlist: nothing replayable has a use for any of them.
    const violations = [
      ...byRule('no-computed-global-access'),
      ...byRule('no-dynamic-evaluation'),
      ...byRule('no-global-aliasing'),
      ...byRule('no-mutable-module-state'),
    ];
    expect(describeViolations(violations)).toBe('');
  });

  it('confines ambient time to exactly the allowlisted files', () => {
    // Equality, so an allowlisted file that stops reading time fails too: an
    // exemption that outlives its reason is a hole with a docstring.
    const readers = [...new Set(byRule('no-ambient-time').map((v) => v.file))].sort();
    expect(readers).toEqual([...AMBIENT_TIME_ALLOWLIST].sort());
  });

  it('keeps no ambient-state exemption that is no longer needed', () => {
    const readers = new Set(byRule('no-ambient-state').map((v) => v.file));
    const stale = AMBIENT_STATE_ALLOWLIST.filter((file) => !readers.has(file));
    expect(stale, 'allowlisted files that no longer read ambient state').toEqual([]);
  });
});

describe('generation code is portable', () => {
  it('uses no implementation-approximated floating-point operation', () => {
    const violations = generationSources().flatMap(({ file, source }) =>
      scanSource(file, source, PORTABILITY_RULES),
    );
    expect(describeViolations(violations)).toBe('');
  });

  it('nor does the tooling that produces the evidence (a2-04)', () => {
    const violations = sourcesUnder(TOOLING_ROOTS).flatMap(({ file, source }) =>
      scanSource(file, source, PORTABILITY_RULES),
    );
    expect(describeViolations(violations)).toBe('');
  });

  it('nor does anything else that has to stay replayable (CA7-14)', () => {
    // **Cycle Audit 7.** This guard scanned `GENERATION_ROOTS` and the tooling
    // and stopped there, while {@link REPLAYABLE_ROOTS}'s own docstring says
    // `runtime` and `trading` are "still bound by the rules that make a record
    // reproducible: no ambient clock, no ambient mutable state, **no
    // non-portable numerics**". Two of those three were enforced.
    //
    // It was not hypothetical. `apps/api/src/market.controller.ts` shipped a
    // second implementation of `displayPrice` built on `Math.exp`, serving the
    // price the panel shows — in the one directory neither this scan nor the
    // type-aware ESLint block (`files: ['packages/*/src/**/*.ts']`) opened. An
    // auditor planted `Math.log` and `Math.pow` into `settle.ts` and
    // `publication.service.ts` and all 458 guardrail tests passed.
    //
    // The asymmetry is the tell: the *ambient time* rule already scanned these
    // roots and caught a planted `Date.now()` in the same file on the same run.
    // One rule reached the directory and its neighbour did not.
    const violations = sourcesUnder(REPLAYABLE_ROOTS).flatMap(({ file, source }) =>
      scanSource(file, source, PORTABILITY_RULES),
    );
    expect(describeViolations(violations)).toBe('');
  });
});

describe('generation code is economically blind', () => {
  it('contains no economic vocabulary', () => {
    const violations = generationSources().flatMap(({ file, source }) =>
      scanSource(file, source, ECONOMIC_BLINDNESS_RULES),
    );
    expect(describeViolations(violations)).toBe('');
  });
});

describe('dependency direction', () => {
  // The manifest-level policy lives in `dependencies.test.ts`. These three are
  // the rules that policy cannot express: they are about *which files* may
  // import, not which packages may declare.
  //
  // **PH-19.1 / a2-01.** This block carried a private two-regex comment
  // stripper — the CA5-05 form, left behind when the shared scanner was fixed.
  // It reads specifiers through the shared lexer now.
  function workspaceImports(file: string): string[] {
    return moduleSpecifiers(readRepositoryFile(file), scanOptionsFor(file)).filter((s) =>
      s.startsWith('@otc/'),
    );
  }

  it('keeps @otc/core free of workspace dependencies', () => {
    const offenders = listSourceFiles('packages/core/src')
      .map((file) => ({ file, imports: workspaceImports(file) }))
      .filter(({ imports }) => imports.length > 0);
    expect(offenders).toEqual([]);
  });

  it('limits @otc/lab to depending on @otc/core outside its tests', () => {
    // The battery must be able to attack any tick source without knowing what
    // produced it. A battery that can reach the generator is not an observer.
    // Its tests may import the fixture corpus — that is where calibration
    // happens — but nothing that ships may.
    const offenders = listSourceFiles('packages/lab/src', { includeTests: false })
      .map((file) => ({
        file,
        imports: workspaceImports(file).filter(
          (s) => s !== '@otc/core' && !s.startsWith('@otc/core/'),
        ),
      }))
      .filter(({ imports }) => imports.length > 0);
    expect(offenders).toEqual([]);
  });

  it('limits @otc/engine to depending on @otc/core', () => {
    const offenders = listSourceFiles('packages/engine/src')
      .map((file) => ({
        file,
        imports: workspaceImports(file).filter(
          (s) => s !== '@otc/core' && !s.startsWith('@otc/core/'),
        ),
      }))
      .filter(({ imports }) => imports.length > 0);
    expect(offenders).toEqual([]);
  });
});
