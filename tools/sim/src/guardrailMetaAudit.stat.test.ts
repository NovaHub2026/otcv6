import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The guardrails are software, and nothing audits them.
 *
 * Both Cycle Audits found the same class of defect, and it was never in the
 * engine: guards that existed, were documented as sufficient, and had never been
 * tested against what they guarded. Four for four — the blindness demonstration
 * missed settlement entirely; the loop-cost detector caught one shape in seven;
 * the dependency check was bypassed by a dynamic import; the rendering guard
 * passed with interpolation planted. PH-9.1 then made it five, when a withheld
 * family reported clean while testing zero hypotheses.
 *
 * Every other claim in this repository rests on that suite, so it gets the same
 * treatment as the engine: **mutate the thing a guard protects and require the
 * guard to fail.** A guard that survives its own mutation is reported, not
 * excused.
 *
 * ## Why this runs in an isolated copy
 *
 * Cycle Audit 2 recorded the most serious process failure in the project: an
 * audit agent's deliberately planted backdoor was swept onto `main` by a
 * concurrent `git add -A`. Mutation testing that edits the live working tree is
 * the same hazard with a scheduler instead of an agent. Each mutation therefore
 * runs against a fresh 3 MB copy with `node_modules` symlinked, and the live
 * repository is never written to.
 *
 * ## What it covers, and how that is known
 *
 * **Out-of-band audit 7, a2-11.** Twelve mutations touched six of nine guard
 * files; `documentation.test.ts`, `publicSurface.test.ts` and
 * `publishingKey.test.ts` — the last enforcing INV-010 — had none, so every
 * assertion in them could have been commented out without this file noticing.
 * CA5-11 and CA6-14 had each recorded the class once. The table now names the
 * specific defeat each guard claims to catch, including the ones the audit used
 * to walk past it, and a test below fails when a guard file has no mutation at
 * all — so a new guard arrives with its mutation or not at all.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const GUARDRAILS = 'packages/core/src/guardrails';

/** A backslash, built at run time so no tool between here and disk decodes what follows it. */
const BACKSLASH = String.fromCharCode(92);

/**
 * Build a dynamic-import expression without writing one here.
 *
 * The dependency guardrail's first specifier reader scanned strings as code, so
 * a file carrying import expressions as mutation payloads read as a file that
 * performed those imports, and this meta-audit's first version made the live
 * dependency guard fail on `@otc/sim`. The shared lexer now knows a string from
 * code; assembling the payload at run time is kept anyway, because a guard's
 * evidence should not depend on the guard's cleverness.
 */
/**
 * Driver names, assembled for the same reason: the synchronous-driver rule reads
 * strings on purpose (`lab["runBattery"]` names a driver in one), and these
 * payloads must plant a driver without this file being the file that reaches it.
 */
const RUN_BATTERY = ['run', 'Battery'].join('');
const RUN_SIMULATION = ['run', 'Simulation'].join('');

function loadExpression(name: string, specifier: string): string {
  const call = ['imp', 'ort'].join('');
  const quoted = String.fromCharCode(39) + specifier + String.fromCharCode(39);
  return `async function ${name}(): Promise<unknown> {\n  return ${call}(${quoted});\n}\n\n`;
}

/** One change to the copy: a replacement in an existing file, or a new file. */
type Edit =
  | {
      readonly file: string;
      /** A string is replaced at its first occurrence; a pattern may use `$1`. */
      readonly find: string | RegExp;
      readonly replace: string;
    }
  | { readonly file: string; readonly create: string };

interface Mutation {
  /** What this proves has teeth. */
  readonly guard: string;
  /** The guardrail test file to run. */
  readonly test: string;
  /** What to do to the copy, relative to the repo root. */
  readonly edits: readonly Edit[];
  /** Why this mutation is the defect the guard names. */
  readonly defect: string;
}

const guard = (name: string): string => `${GUARDRAILS}/${name}`;
const ENGINE_STEP = '    this.#price += sign * steps;';

const MUTATIONS: Mutation[] = [
  {
    guard: 'the gate runs the tests that exist — a root of statistical tests dropped',
    test: guard('gate.test.ts'),
    edits: [
      {
        file: 'vitest.config.ts',
        find: "            'apps/*/src/**/*.stat.test.ts',\n",
        replace: '',
      },
    ],
    defect:
      'CA7-16: deleting one glob removed six statistical files including the entire ' +
      'eight-test browser suite, with every step of the gate still green',
  },
  {
    guard: 'the gate runs the tests that exist — a stray .only left able to silence a sibling',
    test: guard('gate.test.ts'),
    edits: [
      {
        file: 'vitest.config.ts',
        find: '          allowOnly: false,\n          testTimeout: unitTimeoutMs,',
        replace: '          testTimeout: unitTimeoutMs,',
      },
    ],
    defect:
      'CA7-17: Vitest defaults allowOnly to !process.env.CI, so a stray it.only silenced ' +
      'its failing siblings in the layer an approval is recorded from',
  },
  {
    guard: 'economic blindness — economic vocabulary in the price path',
    test: guard('guardrails.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/magnitude.ts',
        find: '  readonly sequence: number;\n}',
        replace: '  readonly sequence: number;\n  readonly userPayout: number;\n}',
      },
    ],
    defect: 'INV-001: the magnitude path naming an economic quantity',
  },
  {
    guard: 'economic blindness — contract vocabulary in the price path',
    test: guard('guardrails.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/magnitude.ts',
        find: '  readonly sequence: number;\n}',
        replace: '  readonly sequence: number;\n  readonly selectedExpirationMs: number;\n}',
      },
    ],
    defect: 'INV-005: the magnitude path seeing a selected expiration',
  },
  {
    guard: 'ambient mutable state',
    test: guard('guardrails.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/engine.ts',
        find: ENGINE_STEP,
        replace: `    const leak = globalThis.__exposure;\n${ENGINE_STEP}`,
      },
    ],
    defect: 'the Cycle Audit 2 backdoor channel: globalThis reaching the price path',
  },
  {
    guard: 'ambient time',
    test: guard('guardrails.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/engine.ts',
        find: ENGINE_STEP,
        replace: `    const when = Date.now();\n${ENGINE_STEP}`,
      },
    ],
    defect: 'INV-009: an unreplayable module',
  },
  {
    guard: 'ambient time in a .mts under the engine (a2-03)',
    test: guard('guardrails.test.ts'),
    // The extension the replayability scan did not read: `.ts` only, so a
    // `Date.now()` in a `.mts` or a `.tsx` under a scanned root was invisible.
    edits: [{ file: 'packages/engine/src/leak.mts', create: 'export const leak = Date.now();\n' }],
    defect: 'INV-009: an unreplayable module, spelled so the scan did not open it',
  },
  {
    guard: 'ambient time reached by a computed name (a2-05)',
    test: guard('guardrails.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/engine.ts',
        find: ENGINE_STEP,
        replace: `    const when = Date["now"]();\n${ENGINE_STEP}`,
      },
    ],
    defect: 'INV-009: `Date["now"]` is `Date.now` with the name in a string the scan blanked',
  },
  {
    guard: 'ambient randomness reached by a unicode-escaped identifier (a2-05)',
    test: guard('guardrails.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/engine.ts',
        find: ENGINE_STEP,
        replace: `    const r = Math.r${BACKSLASH}u0061ndom();\n${ENGINE_STEP}`,
      },
    ],
    defect: 'INV-009: `Math.random` spelled with an escape the engine decodes and the scan did not',
  },
  {
    guard: 'portable numerics',
    test: guard('guardrails.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/engine.ts',
        find: ENGINE_STEP,
        replace: `    const drift = Math.exp(0.1);\n${ENGINE_STEP}`,
      },
    ],
    defect: 'a platform-dependent transcendental in the generation path',
  },
  {
    guard: 'portable numerics in the evidence tooling (a2-04)',
    test: guard('guardrails.test.ts'),
    // `tools/sim` was in neither enforcement layer. Its timers are allowlisted
    // for ambient time; nothing there is allowed a transcendental.
    edits: [
      {
        file: 'tools/sim/src/runner.ts',
        find: `export function ${RUN_SIMULATION}(request: SimulationRequest): SimulationResult {`,
        replace:
          'export const drift = Math.exp(0.1);\n' +
          `export function ${RUN_SIMULATION}(request: SimulationRequest): SimulationResult {`,
      },
    ],
    defect: 'an evidence generator reproducible on one Node build',
  },
  {
    guard: 'the lexer — a regex after a keyword opening a comment (a2-01)',
    test: guard('sourceScan.test.ts'),
    // Remove `return` from the keywords a regex may follow, and `return /[/*]/`
    // becomes a division whose `/*` opens a comment: the CA6-03 evasion, one
    // trigger wider, which defeated every scanner at once.
    edits: [
      {
        file: `${GUARDRAILS}/sourceScan.ts`,
        find: "  'return',\n  'typeof',",
        replace: "  'typeof',",
      },
    ],
    defect: 'every source scanner blind to whatever follows `return /[/*]/`',
  },
  {
    guard: 'dependency direction — framework below apps/',
    test: guard('dependencies.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/engine.ts',
        find: 'export class MarketEngine implements TickSource {',
        replace: `${loadExpression('load', '@nestjs/common')}export class MarketEngine implements TickSource {`,
      },
    ],
    defect: 'the engine acquiring a framework through a dynamic import',
  },
  {
    guard: 'dependency direction — relative path escaping a package',
    test: guard('dependencies.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/engine.ts',
        find: 'export class MarketEngine implements TickSource {',
        replace: `${loadExpression('peek', '../../trading/dist/index.js')}export class MarketEngine implements TickSource {`,
      },
    ],
    defect: 'a dependency edge invisible to the allowlist, the build graph and lint',
  },
  {
    guard: 'dependency direction — a browser component importing the defect corpus',
    test: guard('dependencies.test.ts'),
    // A `.tsx` file, deliberately: CA6-12 found the dependency guard reading
    // only `.ts`, so seven of `apps/web`'s nine files — the entire browser
    // bundle — were never opened, and the planted-defect corpus could be
    // imported into the shipped panel with everything green.
    edits: [
      {
        file: 'apps/web/src/app/preview/Preview.tsx',
        find: "'use client';",
        replace: "'use client';\nimport '@otc/fixtures';",
      },
    ],
    defect: 'the planted-defect corpus shipped in the browser bundle',
  },
  {
    guard: 'dependency direction — a peer-dependency edge (a2-12)',
    test: guard('dependencies.test.ts'),
    edits: [
      {
        file: 'packages/engine/package.json',
        find: '"dependencies": {',
        replace: '"peerDependencies": { "@otc/lab": "*" },\n  "dependencies": {',
      },
    ],
    defect: 'an edge the allowlist and the cycle check never read',
  },
  {
    guard: 'dependency direction — an undeclared third-party import below apps/ (a2-12)',
    test: guard('dependencies.test.ts'),
    edits: [
      {
        file: 'packages/trading/src/settle.ts',
        find: "import { epochMillis, priceAtOrBefore, type EpochMillis } from '@otc/core';",
        replace:
          "import { epochMillis, priceAtOrBefore, type EpochMillis } from '@otc/core';\nimport 'lodash';",
      },
    ],
    defect: 'a dependency that works by hoisting until the package stands alone',
  },
  {
    guard: 'dependency direction — a computed import specifier (a2-12)',
    test: guard('dependencies.test.ts'),
    edits: [
      {
        file: 'packages/trading/src/settle.ts',
        find: "import { epochMillis, priceAtOrBefore, type EpochMillis } from '@otc/core';",
        replace:
          "import { epochMillis, priceAtOrBefore, type EpochMillis } from '@otc/core';\n" +
          `const spec = '@otc/lab';\nexport const later = ${['imp', 'ort'].join('')}(spec);`,
      },
    ],
    defect: 'an import no scan can read the target of',
  },
  {
    guard:
      'dependency direction — an alias reaching a sibling through package.json imports (a2-12)',
    test: guard('dependencies.test.ts'),
    edits: [
      {
        file: 'packages/trading/package.json',
        find: '"dependencies": {',
        replace: '"imports": { "#lab": "@otc/lab" },\n  "dependencies": {',
      },
      {
        file: 'packages/trading/src/settle.ts',
        find: "import { epochMillis, priceAtOrBefore, type EpochMillis } from '@otc/core';",
        replace:
          "import { epochMillis, priceAtOrBefore, type EpochMillis } from '@otc/core';\nimport '#lab';",
      },
    ],
    defect: 'a direction violation spelled as a subpath the manifest rewrites',
  },
  {
    guard: 'single writer — a follower that can construct an engine',
    test: guard('singleWriter.test.ts'),
    // The evasion Cycle Audit 6 (CA6-03) used: a regular-expression literal
    // whose character class contains `/*` opens a block comment the scanner
    // does not close, and a plain static engine import vanishes from every
    // check between it and the next `*/`. An auditor gave a follower a real
    // engine and watched it produce ticks with all 297 guardrail tests green.
    //
    // This mutation exists because CA5-11 and CA6-14 both observed that the
    // meta-audit had no mutation against `singleWriter.test.ts` at all — the
    // guard PH-16.2 rewrote was the one nothing re-checked.
    edits: [
      {
        file: 'packages/runtime/src/follower.ts',
        find: "import type { EpochMillis, LogPrice, Tick } from '@otc/core';",
        replace:
          "const SEPARATOR = /[/*]/;\nimport * as gen from '@otc/engine';\nconst CLOSE = '*/';\n" +
          "import type { EpochMillis, LogPrice, Tick } from '@otc/core';\n" +
          'export const probe = { SEPARATOR, CLOSE, gen };',
      },
    ],
    defect: 'INV-010: a follower able to generate, hidden behind a regex literal',
  },
  {
    guard: 'single writer — the engine import hidden behind a regex after return (a2-01, W-17)',
    test: guard('singleWriter.test.ts'),
    // The same evasion one trigger wider: after a keyword, the CA6-03 fix read
    // the regex as a division. Same outcome, in the function written to fix it.
    edits: [
      {
        file: 'packages/runtime/src/follower.ts',
        find: "import type { EpochMillis, LogPrice, Tick } from '@otc/core';",
        replace:
          'export function sep17(s: string): boolean {\n  return /[/*]/.test(s);\n}\n' +
          "import * as gen17 from '@otc/engine';\nexport const w17 = gen17;\nexport const close17 = '*/';\n" +
          "import type { EpochMillis, LogPrice, Tick } from '@otc/core';",
      },
    ],
    defect: 'INV-010: a follower able to generate, hidden behind a keyword-preceded regex',
  },
  {
    guard: 'publishing key — the refusal condition short-circuited (a2-06, K-09)',
    test: guard('publishingKey.test.ts'),
    // The `throw` and its message stay; the comparison is gone. A substring
    // test on the message passed this.
    edits: [
      {
        file: 'packages/distribution/src/signing.ts',
        find: 'master !== undefined && master.length > 0 && master.toLowerCase() === seed.toLowerCase()',
        replace: 'false as boolean',
      },
    ],
    defect: 'INV-010: a publishing key equal to the generation secret accepted',
  },
  {
    guard: 'publishing key — keystream primitives imported into the signing module (a2-06, K-08)',
    test: guard('publishingKey.test.ts'),
    edits: [
      {
        file: 'packages/distribution/src/signing.ts',
        find: "import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';",
        replace:
          "import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';\n" +
          "import { RandomStream } from '@otc/core';\nexport const k08 = RandomStream;",
      },
    ],
    defect: 'INV-010: the signing path reaching the keystream under a name the guard did not list',
  },
  {
    guard: 'publishing key — a one-file indirection to the keyring (a2-06, K-07)',
    test: guard('publishingKey.test.ts'),
    edits: [
      {
        file: 'packages/distribution/src/internal/keys.ts',
        create:
          "import { MasterKeyring } from '@otc/core';\nexport const seedFrom = MasterKeyring;\n",
      },
      {
        file: 'packages/distribution/src/signing.ts',
        find: "import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';",
        replace:
          "import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';\n" +
          "import { seedFrom } from './internal/keys.js';\nexport const k07 = seedFrom;",
      },
    ],
    defect: 'INV-010: the keyring reached through a file the scan did not list',
  },
  {
    guard: 'assertion cost in the fast suite',
    test: guard('testCost.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/cascade.test.ts',
        find: '    let invalid = 0;',
        replace:
          '    let invalid = 0;\n    for (let z = 0; z < 50_000; z++) {\n      expect(z).toBeGreaterThanOrEqual(0);\n    }',
      },
    ],
    defect: 'a latent 5s timeout that fires only when the suite is under load',
  },
  {
    guard: 'assertion cost — a for…of over a sized dataset (a2-07)',
    test: guard('testCost.test.ts'),
    edits: [
      {
        file: 'packages/engine/src/cascade.test.ts',
        find: '    let invalid = 0;',
        replace:
          '    let invalid = 0;\n    for (const z of new Array(50_000).fill(0)) {\n      expect(z).toBe(0);\n    }',
      },
    ],
    defect: 'the idiomatic shape of the same timeout, which the counting-for detector never read',
  },
  {
    guard: 'synchronous driver — a Sync alias outside the exempt file (a2-07, C-20)',
    test: guard('testCost.test.ts'),
    edits: [
      {
        file: 'tools/sim/src/economicBlindness.stat.test.ts',
        find: "import { describe, expect, it } from 'vitest';",
        replace:
          "import { describe, expect, it } from 'vitest';\n" +
          `import { ${RUN_BATTERY} as ${RUN_BATTERY}Sync } from '@otc/lab';\nexport const c20 = ${RUN_BATTERY}Sync;`,
      },
    ],
    defect: 'B-010: the synchronous driver reached under an honest-looking name',
  },
  {
    guard: 'invariant traceability',
    test: guard('traceability.test.ts'),
    // INV-005 deliberately, because it is the ONLY invariant with a single
    // evidence file. The first version of this mutation stripped INV-002 from one
    // of its nine tagged files and the guard correctly did not care — which read
    // as the guard being toothless when the mutation was simply not a loss of
    // evidence. Same shape as PH-8.1's spike landing on a sampling boundary: the
    // plant has to be the defect the guard names.
    edits: [
      {
        file: guard('guardrails.test.ts'),
        find: 'INV-001 (economic independence), INV-005 (expiration independence)',
        replace: 'INV-001 (economic independence)',
      },
    ],
    defect: 'an enforced invariant losing its only evidence',
  },
  {
    guard: 'invariant traceability — a status synonym (a2-09)',
    test: guard('traceability.test.ts'),
    edits: [
      {
        file: 'docs/architecture/INVARIANTS.md',
        find: /(\| INV-005[^|\n]*\|\s*)Enforced(\s*\|)/,
        replace: '$1Verified$2',
      },
    ],
    defect: 'an invariant dropped from enforcement by one editorial word',
  },
  {
    guard: 'canonical state agrees with the roadmap',
    test: guard('stateConsistency.test.ts'),
    edits: [
      {
        file: 'CURRENT_STATE.md',
        find: '| Last approved phase',
        replace: '| Last approved phase    | PH-1 — Deterministic Market Substrate |\n| Ignored',
      },
    ],
    defect: 'the state document sending a fresh agent to the wrong phase',
  },
  {
    guard: 'canonical state — the active subphase naming an approved one (a2-08)',
    test: guard('stateConsistency.test.ts'),
    edits: [
      {
        file: 'CURRENT_STATE.md',
        find: /\| Active subphase\s*\|[^|\n]*\|/,
        replace: '| Active subphase | PH-1.1 — approved long ago |',
      },
    ],
    defect: 'the state document sending a fresh agent to the wrong subphase',
  },
  {
    guard: 'canonical state — a reverted phase counted as approved (a2-08, DOC-17)',
    test: guard('stateConsistency.test.ts'),
    edits: [
      {
        file: 'docs/phases/ROADMAP.md',
        find: /^\| PH-1 +\|([^|\n]*)\|[^|\n]*\|$/m,
        replace: '| PH-1 |$1| REVERTED (was APPROVED) |',
      },
    ],
    defect: 'a status outside the vocabulary read as approval because it contained the word',
  },
  {
    guard: 'documentation — a phase document disagreeing with the roadmap',
    test: guard('documentation.test.ts'),
    edits: [
      {
        file: 'docs/phases/PH-20-the-operator-panel.md',
        find: 'Status: APPROVED',
        replace: 'Status: ACTIVE',
      },
    ],
    defect: 'two sources for the current phase that disagree, which §71 forbids',
  },
  {
    guard: 'public surface — a nested module no barrel reaches (a2-10)',
    test: guard('publicSurface.test.ts'),
    edits: [{ file: 'packages/runtime/src/deep/orphan.ts', create: 'export const orphan = 1;\n' }],
    defect: "PH-15's failover.ts again, one directory down",
  },
];

const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/**
 * Everything here is asynchronous, and that is not a style choice.
 *
 * **Cycle Audit 6, C-2, and the standing hazard `CLAUDE.md` §5 names.** This
 * file used `execFileSync` to run a *whole vitest invocation* per check — twice
 * per mutation, twenty-four in all — plus a synchronous `tar` of the repository
 * per workspace. Each of those blocks the worker's event loop from start to
 * finish, and a worker that cannot run its own microtasks cannot answer the
 * main thread: `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`, every
 * test passing, exit 1.
 *
 * It cost this project three phase gates and was attributed to machine load
 * twice, including by me. The hosted runner settled it: an idle two-core box,
 * 228 tests green, one error, exit 1. On a slower machine each of those blocking
 * calls simply lasts longer.
 *
 * Awaiting them lets the loop breathe between and during, which is all the RPC
 * channel needs.
 */
const run = promisify(execFile);

/** A fresh copy of the repository with node_modules symlinked. */
async function isolatedCopy(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'otc-meta-'));
  workspaces.push(dir);
  await run('bash', [
    '-c',
    // `--exclude=.next` matches that name and nothing else, so when the browser
    // suites got their own build directory (`.next-stat`, PH-24.14) every copy
    // started carrying ~90 MB of webpack cache. One copy per guardrail, on a
    // 4 GB tmpfs, filled the disk and failed this file with "No space left on
    // device" — a green suite reported as a broken guardrail. The glob covers
    // both, and anything else Next.js names that way.
    `tar -cf - --exclude=node_modules --exclude=dist --exclude='.next*' --exclude=.git --exclude=coverage --exclude=artifacts -C ${repoRoot} . | tar -xf - -C ${dir}`,
  ]);
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}

/** Run one guardrail file. Returns true when it PASSES. */
async function guardPasses(dir: string, testFile: string): Promise<boolean> {
  try {
    await run('npx', ['vitest', 'run', '--project', 'unit', testFile], {
      cwd: dir,
      timeout: 180_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Apply one edit to the copy, asserting its anchor so a no-op cannot pass as a mutation. */
function apply(dir: string, edit: Edit): void {
  const target = path.join(dir, edit.file);
  if ('create' in edit) {
    expect(existsSync(target), `${edit.file} already exists — the mutation would overwrite`).toBe(
      false,
    );
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, edit.create, 'utf8');
    return;
  }
  const original = readFileSync(target, 'utf8');
  const present =
    typeof edit.find === 'string' ? original.includes(edit.find) : edit.find.test(original);
  expect(
    present,
    `mutation anchor missing in ${edit.file} — the mutation would be a no-op, ` +
      `which is exactly how a meta-audit becomes a formality`,
  ).toBe(true);
  const mutated =
    typeof edit.find === 'string'
      ? original.replace(edit.find, () => edit.replace)
      : original.replace(edit.find, edit.replace);
  expect(mutated, `the mutation of ${edit.file} changed nothing`).not.toBe(original);
  writeFileSync(target, mutated, 'utf8');
}

describe('every guardrail fails on the defect it names', () => {
  it.each(MUTATIONS.map((m) => [m.guard, m] as const))(
    'guard: %s',
    async (_label, mutation) => {
      const dir = await isolatedCopy();

      // The guard must pass before the mutation, or the result below proves
      // nothing about the mutation.
      expect(await guardPasses(dir, mutation.test), 'guard did not pass on a clean tree').toBe(
        true,
      );

      const originals = new Map(
        mutation.edits
          .filter((edit) => !('create' in edit))
          .map((edit) => [edit.file, readFileSync(path.join(repoRoot, edit.file), 'utf8')]),
      );
      for (const edit of mutation.edits) apply(dir, edit);

      expect(
        await guardPasses(dir, mutation.test),
        `the guard survived its own mutation (${mutation.defect}) — it is not evidence`,
      ).toBe(false);

      // The live repository was never touched.
      for (const edit of mutation.edits) {
        const live = path.join(repoRoot, edit.file);
        if ('create' in edit)
          expect(existsSync(live), `${edit.file} appeared in the live tree`).toBe(false);
        else expect(readFileSync(live, 'utf8')).toBe(originals.get(edit.file));
      }
    },
    600_000,
  );
});

describe('every guard file has a mutation', () => {
  it('names every guardrail test file in the table', () => {
    // A guard nothing mutates is a guard nothing has watched failing (a2-11).
    const guards = readdirSync(path.join(repoRoot, GUARDRAILS))
      .filter((name) => name.endsWith('.test.ts'))
      .map(guard)
      .sort();
    const mutated = new Set(MUTATIONS.map((m) => m.test));
    expect(
      guards.filter((file) => !mutated.has(file)),
      'guard files with no mutation in MUTATIONS',
    ).toEqual([]);
    for (const file of mutated) expect(existsSync(path.join(repoRoot, file)), file).toBe(true);
  });
});
