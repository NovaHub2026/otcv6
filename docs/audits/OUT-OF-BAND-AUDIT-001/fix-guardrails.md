# Fix report — guardrails (auditor a2's findings a2-01 … a2-12)

Worktree: `/home/alejo/.otc-audit7/fix` (branch `feature/out-of-band-audit`). Only the files under `packages/core/src/guardrails/` and `tools/sim/src/guardrailMetaAudit.stat.test.ts` were edited; no `git add/commit/stash/checkout --` was run. Every plant ran in an **isolated copy** (`git archive HEAD` + this agent's guard files, `node_modules` symlinked — the meta-audit's own method) because three other agents were editing `packages/{engine,runtime,distribution,trading}` and `apps/api` in the same worktree; the live tree was never planted into.

## Files changed

```
 M packages/core/src/guardrails/sourceScan.ts            one tokenizer; all three scanners render its tokens
?? packages/core/src/guardrails/sourceScan.test.ts       the lexer corpus (51 cases: every construct from the a2 table)
?? packages/core/src/guardrails/repository.ts            shared walker (repoRoot, listSourceFiles, readRepositoryFile)
?? packages/core/src/guardrails/lifecycle.ts             shared status vocabulary + roadmap row parser
 M packages/core/src/guardrails/guardrails.test.ts       a2-03, a2-04, a2-05
 M packages/core/src/guardrails/dependencies.test.ts     a2-03, a2-12
 M packages/core/src/guardrails/publicSurface.test.ts    a2-03, a2-10
 M packages/core/src/guardrails/publishingKey.test.ts    a2-06
 M packages/core/src/guardrails/singleWriter.test.ts     a2-01 (shared reader), a2-05/06 escape hatches
 M packages/core/src/guardrails/testCost.test.ts         a2-07
 M packages/core/src/guardrails/stateConsistency.test.ts a2-08
 M packages/core/src/guardrails/documentation.test.ts    a2-08 (DOC-17)
 M packages/core/src/guardrails/traceability.test.ts     a2-09
 M tools/sim/src/guardrailMetaAudit.stat.test.ts         a2-11 (33 mutations, coverage assertion)
```

## Two things found on HEAD that were not in the brief

1. **HEAD is red for the old `guardrails.test.ts`.** On an untouched `git archive HEAD` copy, the old guard fails `generation code is portable` with `packages/engine/src/personality.ts:535 [no-exponent-operator] * the *target*. **Cycle Audit 7, a3-12.** …` — a **doc-comment line**. The old lexer read `coefficients[i]! / (shifted + i);` (personality.ts:414) as the start of a regex after `!`, ran to the next `/` — inside the `/**` that opens the following doc comment — and the comment's Markdown bold `**…**` reached the `**` rule as code. The engine agent's commit 6779f62 added that comment; the old lexer made it a gate failure. The new lexer treats a postfix `!` as the end of an operand and never lets a regex guess cross a line, so the new guard passes on HEAD (`generation code is portable` ✓, see the N-01 control below). Worth recording: the a2-01 class produced a false positive as well as the false negatives the auditor found.
2. **HEAD is red for the old `publicSurface.test.ts`**: the runtime agent's commit f41ed6b added `packages/runtime/src/atomicFile.ts` without exporting it. I declared it `INTERNAL` for `@otc/runtime` (it is the atomic-write primitive `registry.ts` and `fileStore.ts` share). If the runtime agent exports it instead, remove that `INTERNAL` entry — the new guard also fails when an `INTERNAL` module is exported by a barrel (P-06 below), so the two cannot both be true silently.

Command: `cd scratchpad/fixcopy && npx vitest run --project unit packages/core/src/guardrails/{guardrails,publicSurface}.test.ts` on the HEAD copy with no overlay → `1 failed | 21 passed (22)` and `1 failed | 10 passed (11)`.

## Per finding

### a2-01 + a2-02 (critical) — the lexer

**What changed.** `sourceScan.ts` has one tokenizer, `tokenize(source, { jsx })`, and `stripCommentsAndStrings`, `stripCommentsKeepingStrings` and `moduleSpecifiers` (now over `importSpecifiers`, which also returns _computed_ specifiers) only render its tokens. It handles: line/block comments; the three string forms with template substitutions lexed **recursively as code** (a2-02: `` `${"`"}` ``, nested templates, a regex class inside a substitution); regex literals decided by the **previous token** — regex after the keywords `return typeof case in of instanceof void delete new yield await throw do else`, after `( , = : [ ! & | ? { ; + - * % < > ~ ^`, after `}`, after the `)` of an `if`/`while`/`for`/`with` head, and at file start; division after an identifier, a number, `)`, `]`, `++`, `--`, a literal, and after a **postfix `!`** (`x! / y`); character classes in which `/` does not terminate; a **line-bounded regex guess** (no closing `/` on the line ⇒ it was a division), so a wrong guess costs at most one line, never a file; a shebang as a comment; identifier escapes decoded (`Math.random` → `Math.random`, both `\uXXXX` and `\u{…}`), and escapes decoded inside specifier strings; and for `.tsx`, a **JSX element lexer** (tag, attributes with quoted strings and `{…}` containers lexed as code, children text emitted as `jsx-text`, nested elements, fragments), entered only where an expression is expected (`( , = : ? { [ && || ?? => !` or `return/yield/await/default`) and **backtracked** if the element never closes, so `<T,>(x) => x`, `Array<string>`, `a < b && c > d` and `<T extends object>(…)` are not elements. `scanSource` passes `{ jsx }` from the file name; a `.ts` file can never open an element.

_Alternative rejected:_ the brief's "in `.tsx` a quote between `>` and `<` on a line is text" rule — it desynchronises on ordinary code such as `a > b ? 'x<y' : z` (one quote of the pair matches, the other opens a string that runs to the next quote in the file). The element lexer is more code but fails safe. A `typescript`-based parser was excluded by the constraint that `@otc/core` depends on nothing.

**Corpus.** `sourceScan.test.ts` (51 cases): every Guard-2 row (S/03 S/04 S/06 S/07 S/19 S/20, 01, 23, 09, JSX-A, JSX-B), S-01…S-14, S-20, D-19…D-23, W-17…W-19, CA5-05, CA6-03, each keyword, unicode escapes (G1-15/33/35, W-05, K-05), a JSX case with attributes/containers/fragments, the controls, `Buffer.from('302e…')`/`Array.from(…)`/`import.meta` not read as imports, computed specifiers reported. Each case asserts: the hidden `Date.now()` is found **on the right line**, `@otc/engine` is in `moduleSpecifiers`, `stripCommentsKeepingStrings` keeps it, tokens concatenate back to the source, and line counts survive both renderings.

**Regression check over the repository.** `node --experimental-transform-types scratchpad/lexcmp/compare.ts` ran old vs new over all 265 `.ts/.tsx` files: 38 `keepStrings` differences, 3 specifier differences, 14 scan differences — every one an old-lexer error: `return /\bAPPROVED\b/` in our own `stateConsistency.test.ts` read as a division; `x! / y` misparses in `personality.ts`, `rhythm.test.ts`, `frame.ts`, `edge.ts` (the first producing the false `**` finding above); `Buffer.from('302e…', 'hex')` and `Buffer.from('0000…')` reported as import specifiers; `#!/usr/bin/env node` read as a regex; JSX closing tags `</p>` read as regex starts in `Chart.tsx`/`Nav.tsx`. New behaviour that is stricter on purpose: template _substitutions_ are code, so `${Date.now()}` is a call (the old stripper blanked whole templates).

**Watched failing** (isolated copy; `python3 scratchpad/{before,plants1,plants2,plants3}.py`; each plant = write → `npx vitest run --project unit <guard>` → restore):

| Plant                                                                                                | HEAD guards                                             | Fixed guards                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| S-02 `return /[/*]/` then `Date.now()` in engine.ts                                                  | EVADED (only the baseline `personality.ts:535` failure) | CAUGHT `2 failed \| 29 passed (31)`                                                                            |
| S-01 `` `${"`"}` `` then `Date.now()`                                                                | EVADED                                                  | CAUGHT                                                                                                         |
| S-03/S-04/S-05/S-13/S-20 (`)` of `if`, `/[\]//*]/`, `/'/` after return, `typeof`, `}` of a block)    | (a2 table: evaded)                                      | CAUGHT, all                                                                                                    |
| D-19/D-20/D-21 hiding `import '@otc/lab'` in settle.ts                                               | D-19 EVADED `44 passed (44)`                            | CAUGHT `1 failed \| 57 passed (58)`                                                                            |
| D-13 JSX apostrophe before `import '@otc/fixtures'` in Preview.tsx; D-23 dynamic import after `</p>` | (a2: evaded)                                            | CAUGHT                                                                                                         |
| **W-17** `return /[/*]/` hiding `import * as gen17 from '@otc/engine'` in follower.ts                | EVADED `6 passed (6)`                                   | CAUGHT `1 failed \| 5 passed (6)` — `imports no engine, fixture corpus, laboratory or evaluator, at any depth` |
| W-18/W-19                                                                                            | (a2: W-18 caught, W-19 evaded)                          | CAUGHT                                                                                                         |
| Controls S-06/S-10/S-14, N-01 benign line                                                            | —                                                       | S-06/S-10/S-14 CAUGHT (they hide nothing), N-01 EVADED (31 passed)                                             |

### a2-05 (material) — the constructs that hide a name

`AMBIENT_RULES` now: `no-ambient-time` adds `Date(`, `Intl.DateTimeFormat`, `performance.timeOrigin`, `process.uptime`; `no-ambient-randomness` adds `randomFill`, `generateKey*`, `webcrypto`; `no-ambient-state` adds bare `global`, `process.argv|execArgv|getBuiltinModule`, and `import.meta` as a value (only `.url|.dirname|.filename` allowed — the auditor's G1-24 reaches `env` through a cast); three new construct rules with no allowlist anywhere: `no-computed-global-access` (`Math[`, `Date[`, `process[`, `performance[`, `Intl[`, `crypto[`, `Reflect[`, `globalThis[`, `global[`, `Atomics[`), `no-dynamic-evaluation` (`Reflect.`, `new Function(`, `Function(`, `eval(`), `no-global-aliasing` (a listed global not followed by `.`, `[` or `(` — `const M = Math`, `const { exp } = Math`, `f(Date)`), and `no-mutable-module-state` (`export let|var`). Identifier escapes are decoded by the lexer, so every identifier scan (economic vocabulary, follower, publishing key) sees `Math.random`, `.payout`, `MasterKeyring`, `RandomStream` through `a`. The follower guard's `FORBIDDEN_CONSTRUCTS` gained `global`, `Reflect`, `.constructor`, indirect `eval`, `getBuiltinModule`, and `FORBIDDEN_MODULES` gained `node:vm|worker_threads|child_process|module` (W-06/07/08/09/10/13).

Watched failing (`plants1.py`, `plants3.py`): G1-07, G1-08, G1-09, G1-10, G1-11, G1-12, G1-14, G1-15, G1-16, G1-17, G1-18, G1-19, G1-20, G1-21, G1-22, G1-23, G1-24 (re-planted after the `import.meta` fix: `1 failed | 30 passed (31)`, `never reads ambient mutable state`), G1-25, G1-26, G1-29, G1-30, G1-33, G1-35, W-05…W-10, W-13 — all CAUGHT. HEAD guards: G1-07 and G1-15 EVADED (only the baseline failure), per the a2 table.

**Out of reach, said so:** `this["pay" + "out"]` (G1-32), `core["Random" + "Stream"]` (W-04), `core["Master" + "Keyring"]` (K-04) — a word assembled at run time from string literals. Banning `x[…]` with a non-literal key would ban ordinary code (`record[key]`). The behavioural tests (tick identity under trading, the settlement mirror) remain the defence, as B-007 records. All three were planted and EVADED, as expected, and are recorded as such in the plant logs.

### a2-03 (material) — one extension list

`sourceScan.ts` exports `SOURCE_EXTENSIONS = ['.ts','.tsx','.mts','.cts']`, `SHIPPED_EXTENSIONS` (+ `.js .jsx .mjs .cjs`), `isTestFile`, `isStatisticalTestFile`, `isDeclarationFile`, `isJsxFile`, `scanOptionsFor`; `repository.ts` exports one `listSourceFiles(root, { extensions, includeTests })` walker used by `guardrails`, `dependencies`, `publicSurface`, `testCost`. Watched failing: G1-36 (`Date.now()` in `packages/engine/src/p36.mts`) HEAD EVADED → CAUGHT; G1-06 (`.tsx` under `packages/chart/src`) CAUGHT; D-14 (`import '@otc/lab'` in `packages/engine/src/leak.js`) CAUGHT (a2: evaded). Meta-audit mutation `ambient time in a .mts under the engine (a2-03)` creates the file and is caught.

### a2-04 (material) — `tools/sim/src`

`TOOLING_ROOTS = ['tools/sim/src']` joins the replayability scans (time, randomness, state, the a2-05 constructs) and the portability scan; not the economic vocabulary (the simulation computes economics). Allowlists, both asserted non-stale: `AMBIENT_TIME_ALLOWLIST` = `packages/core/src/time/clock.ts` + `tools/sim/src/{catalogueScale,horizonEvidence,runner,venueScale}.ts` (the `confines ambient time to exactly the allowlisted files` test is an equality, so an entry that stops reading time fails); `AMBIENT_STATE_ALLOWLIST` += `tools/sim/src/{catalogueScale,cli,dispersionEvidence,horizonEvidence,venueScale}.ts` (they read `process.argv`/`process.env` as entry points), with a `keeps no ambient-state exemption that is no longer needed` test. Watched failing: G1-04 `Date.now()` in `tools/sim/src/edge.ts` HEAD EVADED → CAUGHT `2 failed`; G1-04b `Math.exp` in `runner.ts` CAUGHT (meta-audit mutation `portable numerics in the evidence tooling (a2-04)`). Note: the auditor's G1-04 planted into `runner.ts`, which is now a _timer_ (hrtime) allowlisted for ambient time — the plant moved to `edge.ts`; a transcendental in `runner.ts` is still caught because portability has no allowlist. **Not done, not my file:** the ESLint market-model block still covers `packages/*/src` only (`eslint.config.js`).

### a2-06 (material) — publishing key

Refusal check is **structural**: `signing.ts` (comments and strings stripped) must read `env.OTC_MASTER_SECRET` and `env.OTC_PUBLISHING_KEY` into bindings, contain an `if` whose condition names both bindings with `===`, and that `if`'s body must `throw new PublishingKeyError(`. A companion test asserts `signing.test.ts` still calls `publishingKeyFromEnvironment` with both secrets inside an `expect(…)` followed by `.toThrow(` (the behavioural half lives there; importing `@otc/distribution` from core is refused by the dependency rule, as the file's own docstring records). `GENERATION_SURFACE` adds `RandomStream`, `expandKey`, `expandNonce`, `CursorLease`, `createMarketEngine`, `EngineSnapshot` (aligned with `singleWriter`'s list; `chacha` substring already covers `chacha20Block`). The scan is **transitive** over relative imports from the five entry points (`signing.ts → rotation.ts` is asserted to be reached). Watched failing (`plants4.py`): K-06 dead string CAUGHT (a2: evaded), K-09 `false as boolean` HEAD EVADED `7 passed (7)` → CAUGHT, K-08 HEAD EVADED → CAUGHT, K-07 indirection CAUGHT, K-02/K-03/K-05 CAUGHT; K-04 split string EVADED (documented). Meta-audit: three `publishing key —` mutations, all caught.

### a2-07 (material) — assertion cost and the driver rule

The detector reads structure over the stripped source: every `for`, `for…of/in`, `while`, `do…while` and `.forEach/.map/.flatMap/.filter/.every/.some/.find*/.reduce*` with its body's extent; every `expect(` and every call to a **local helper whose body asserts** (C-08) is charged the product of the enclosing loops' counts. Sizes are read as far as a file states them: literals, `_` and `e` forms, constant arithmetic (`50 * 1000`), `const` chains, unary minus, `Math.floor/min/max`, `.length` of a sized array, array literals, `new Array(n)`, `Array.from({ length })`, `.fill/.map/.keys/.entries/.slice`, and — the dataset case — the largest literal argument ≥ 20,000 of the call that built the collection. Prefix `++`/`--`, decrementing, `+=`/`-=`, multi-line headers, typed `let i: number =`, brace-less bodies: all read.

**Policy, written into the docstring:** a _bare identifier_ bound or step the file never binds (an import or a parameter) is suspect, as before (C-05); a bound the file binds but cannot evaluate (`const last = ticks[…].instant`) is stated, not suspect; a collection the file cannot size (`for (const f of fields)`, `while (queue.length > 0)`, `for (;;)`) is **not charged** — 196 unit-test sites assert over small parameter lists that way, and a guard that cried wolf on all of them would be weakened rather than obeyed.

**Two real findings, carried in the open** in `KNOWN_ASSERTION_LOOPS`, each asserted to still exist (`carries no known assertion loop that has since been fixed`), owed to the owning agents: `packages/engine/src/engine.test.ts:62-64` — `for (let i = 0; i < ticks.length; i += 1)` over `drain(build(), 20_000)` (asserted to hold 20,000) with three matchers per tick = 60,000 matcher calls (≈1.5 s); `packages/runtime/src/failover.test.ts:192` — `for (const entry of entries)` over `store.readRecord(ASSET, 1, 100_000)`, where the literal is a cap (the record is a few dozen entries): fix is to read with the cap the test expects, or count and assert once. I could not edit either (outside my file set).

Driver rule: **any** mention of `runBattery|runSimulation|calibrateAsset|estimateDirectionalEdge` (word-bounded, strings kept so `lab["runBattery"]` is seen) in a statistical test is an offence, except the `driver as …Sync` import in a file listed in `SYNCHRONOUS_DRIVER_EXEMPTIONS` (`packages/engine/src/catalogue.stat.test.ts: calibrateAsset`) that also contains `.toThrow(` and mentions the driver exactly once; the exemption is asserted non-stale. The meta-audit file names drivers in mutation payloads, so it now assembles them at run time (`['run','Battery'].join('')`), the way it already assembled `import(`.

Watched failing (`plants6.py`): C-02, C-03, C-04, C-06, C-07, C-08, C-09, C-10, C-12, C-14, C-15, C-21 (call-built dataset), C-17, C-18, C-20, C-23 — all CAUGHT; HEAD: C-02 and C-20 EVADED. Controls C-01/C-05/C-11/C-13/C-16/C-19 CAUGHT; C-22 (`for…of [1,2,3]`) EVADED as intended. The new `asset.stat.test.ts`/`families.stat.test.ts` mention no driver; the unit project (2,123 tests) trips nothing else.

### a2-08 (material) — subphases, lifecycle rows, the handoff, `REVERTED`

`lifecycle.ts` holds the exact vocabulary (`APPROVED`, `APPROVED WITH OPEN FINDINGS`, `ACTIVE`, `NOT STARTED`, `PLANNED`, `BLOCKED`, `REVERTED`, `SUPERSEDED`, `WITHDRAWN`, `NOT APPROVED`), `normaliseStatus` (strip `*`, collapse spaces, upper-case), `isRecognisedStatus`, `isApprovedStatus` (exact membership), `roadmapRows` (phase **and** subphase rows, read only from tables whose header's last column is `State` — the roadmap's "Closes" table tripped the first version), `namesIdentifier` (`PH-20.3` is not in `PH-20.31`). `stateConsistency.test.ts`: every roadmap cell must be in the vocabulary (DOC-17 fails here); at most one active phase/subphase, belonging together; `Last approved phase`/`subphase` by ordering; `Active phase`/`Active subphase` must name the roadmap's active one and never an approved one, in **both** `CURRENT_STATE.md` and `SESSION_HANDOFF.md`; `Phase lifecycle`/`Subphase lifecycle` must be `ACTIVE` when one is active, and `n/a`/`None`/a non-active vocabulary word otherwise (the historical values); the active subphase's document must declare `Status: ACTIVE`. `documentation.test.ts` compares the normalised roadmap cell and the document's `Status:` for equality and fails on either being outside the vocabulary. Passes on the current tree (PH-21 / PH-21.1 ACTIVE). Watched failing (`plants5.py`): DOC-09, DOC-10, DOC-10b, DOC-11, DOC-15, DOC-15b, DOC-17 (both guards), DOC-06, DOC-06b (named without its ID — now caught, the active id must be named) — all CAUGHT; HEAD: DOC-10 and DOC-17b EVADED; DOC-02 (`Status: Approved`) EVADED as intended (semantically equal).

### a2-09 (material) — traceability vocabulary

Status cells normalise to their first word (`Enforced`, `enforced`, `**Enforced**`, `Enforced (structural)` → `enforced`; `Pending (PH-9)` → `pending`), the checks key on that, and `documents every status in the vocabulary` fails on anything else. Evidence is also walked under `apps/`. Watched failing: T-02, T-02b, T-02c (with evidence removed), T-02d (`Verified` alone) CAUGHT; HEAD T-02d EVADED; T-02e (`Enforced (structural)` alone) EVADED as intended.

### a2-10 — public surface

Recursive walk over `SOURCE_EXTENSIONS` (so `.tsx`); a module is on the surface iff a chain of **barrels** reaches it from `src/index.ts` (a barrel's `import … from`/`export … from` relative specifiers, directory imports resolved to `index.*`, requiring a _file_); anything else is `INTERNAL` or missing. Two new `INTERNAL` decisions with reasons: `@otc/core`: `market/testStreams.ts` (the kernel's own test streams; found by the recursion), `guardrails/{lifecycle,repository,sourceScan}.ts`; `@otc/runtime`: `atomicFile.ts` (see above — reconcile with the runtime agent). New tests: `declares nothing internal that a barrel exports anyway`, and `knows which workspaces have no surface to check` = exactly `['@otc/api', '@otc/web']` — **apps have no `src/index.ts`**; their surface is the process (`main.ts`/Nest module, Next routes), so an orphan under `apps/api/src` (P-05) is not checked, by decision; an app that grows an index joins the check automatically. Watched failing: P-01, P-03, P-04, P-06 CAUGHT (HEAD P-01: the baseline failure only); P-05 EVADED by policy.

### a2-11 (material) — meta-audit

`Mutation` now carries `edits: Edit[]` (`{file, find: string | RegExp, replace}` or `{file, create}`), anchors asserted present and the edit asserted to change the file, created files asserted absent from the live tree afterwards. 33 mutations over **all 10** guard files (the coverage test `every guard file has a mutation > names every guardrail test file in the table` fails on a guard file with none): the original 12 plus a2-01 (`sourceScan.test.ts`: drop `'return'` from `REGEX_AFTER_KEYWORDS`; `singleWriter`: W-17 form), a2-03 (`.mts` created), a2-04 (`Math.exp` in `runner.ts`), a2-05 (`Date["now"]`, unicode `Math.random`), a2-06 (K-09 condition, K-08 primitives, K-07 two-file indirection), a2-07 (`for…of` over `new Array(50_000)`, C-20 alias), a2-08 (`Active subphase` → `PH-1.1` by regex; PH-1 row → `REVERTED (was APPROVED)` by regex), a2-09 (`Verified` by regex), documentation (PH-20 doc `Status: ACTIVE`), publicSurface (`runtime/src/deep/orphan.ts` created), a2-12 (peer edge, `lodash`, `import(spec)`, `#lab` through `package.json` `imports` + settle.ts). `tar` now also excludes `artifacts/`.

```
npx vitest run --project statistical tools/sim/src/guardrailMetaAudit.stat.test.ts
      Tests  33 passed (33)    (run 1, ~102 s)   META_EXIT=0
      Tests  33 passed (33)    (run 2, after the final lexer/walker patches)   META_EXIT=0
```

### a2-12 (minor) — dependency guard

`declared` includes `peerDependencies` and `optionalDependencies` (policed by `ALLOWED`, walked by the cycle check); below `apps/` every bare specifier must be declared by the workspace — Node builtins excepted, and for **test files** the root manifest's devDependencies (`vitest`) — apps keep the internal rule only (their frameworks bring transitive packages); `importSpecifiers(...).computed` must be empty below `apps/` (D-06/D-07); tsconfig `compilerOptions.paths` (following `extends`, comments tolerated) and `package.json` `imports` are resolved **before** the direction/escape/framework rules, a path target judged as a relative escape and a bare target as a package — unit-tested with synthetic aliases (`resolveAlias`) and integration-tested by the `#lab` mutation and the D-09/D-10 plants; source files use `SHIPPED_EXTENSIONS`. Watched failing (`plants2.py`): D-06, D-07, D-09 (tsconfig paths, two-file plant), D-10 (`imports`), D-11, D-14, D-15, D-15b — all CAUGHT; HEAD: D-11 and D-07 EVADED.

## Decisions worth recording elsewhere

- **`}` starts a regex; `)` is division unless it closes a control head; a regex never crosses a line.** These three rules are what make a wrong guess cost a line rather than a file.
- **Template substitutions are code.** Stricter than before; a `${payout}` in an engine template would now be a finding. The current tree has none.
- **Unknown-size collections are not charged** by the cost detector; unbound identifiers are. The residue is a loop over a dataset whose size no expression in the file states.
- **`INTERNAL` for `atomicFile.ts`** was my call in the runtime agent's absence; reversible in one line.

## Doc lines that now need updating (not my files)

- `docs/architecture/OVERVIEW.md:72` — after "turns each into a build failure" add: "over `packages/*/src`, `apps/api/src` and `tools/sim/src`; the lexer they share is tested against every construct that has ever hidden code from it (`sourceScan.test.ts`)".
- `docs/architecture/OVERVIEW.md:75-81` (Guardrails table) — add rows: `| no computed access to, dynamic evaluation of, or aliasing of a global; no mutable module-level export | replay, economic blindness (INV-001, INV-009) |`, `| a follower cannot reach the engine, key material or an evaluator | shared market, private state (INV-002, INV-010) |`, `| the signing path cannot derive the market, transitively | private state (INV-010) |`, `| every module is reachable through barrels or declared internal | (surface completeness) |`.
- `docs/architecture/OVERVIEW.md:83` — "ESLint reports them in the editor; the guardrail test suite is the authority" → append: "ESLint's market-model rules cover `packages/*/src` only; under `apps/api` and `tools/sim` the guardrail suite is the only layer (a2-04)."
- `docs/BACKLOG.md:30` (B-018) — replace the `**DEFERRED …**` cell with: "**CLOSED 2026-09-02 (out-of-band audit 7, a2-05/a2-04).** Computed access is banned as a _construct_ — `Date["now"]`, `Math["exp"]`, `Reflect.get`, `new Function`, `eval`, a global taken as a value, `export let` — rather than parsed, and identifier escapes are decoded by the shared lexer. `tools/sim/src` is scanned, with a four-file timer allowlist and a five-file entry-point allowlist, both asserted non-stale. Still open: a name split across string literals (`this["pay" + "out"]`), which no textual scan can see; the behavioural tests are the defence (B-007)."
- `docs/architecture/INVARIANTS.md:39,43` — add `sourceScan.test.ts` (the lexer corpus) to the INV-001 and INV-005 evidence cells; `:48` (INV-010) — add `publishingKey.test.ts` (structural refusal, transitive signing path) and `singleWriter.test.ts`.
- `docs/phases/PH-19.1-the-instrument.md` §3 — the sentence that `moduleSpecifiers` "walks tokens" is true again only because all three scanners now share one tokenizer; a2-01 was its third recurrence. A phase/audit record entry is the orchestrator's call.
- `CLAUDE.md` §6.2 — "enforced by lint/architecture tests" is accurate for `packages/*`; under `apps/api` and `tools/sim` it is architecture tests alone.

## What remains open, honestly

1. **Split-string names** — G1-32 (`this["pay"+"out"]`), W-04, K-04: planted, EVADED, unreachable textually. Behavioural tests are the defence.
2. **Generic economic words** (G1-34: `exposure`, `balance`, `userId`, `positions`, `expiry`, `stake`, `pnl`) — still not in the vocabulary, for the reason the rule's docstring gives (`position`/`contraction`); B-007 stands.
3. **`Symbol.for` registry channel** (G1-27) — not banned; a global-registry read that names nothing. Cheap to add to `no-ambient-state` if wanted.
4. **Dead `#anchor` links** (DOC-04) — `documentation.test.ts` still checks files, not anchors.
5. **Orphan modules under `apps/*/src`** (P-05) — no index, by decision; enumerated so a change is noticed.
6. **Collections of unreadable size** in the cost detector, and `while` loops with unreadable conditions — not charged (documented policy).
7. **ESLint scope** (`eslint.config.js`: `packages/*/src` only) — outside my file set.
8. **Two known assertion loops** owed: `engine.test.ts:62-64`, `failover.test.ts:192` (registered, non-stale).
9. **`apps/api/src/adminSurface.test.ts`** — 2 unit failures on the live tree, in a file another agent is mid-edit on (`apps/api`: 6 modified files + new `adminAuth.guard.ts`); not a guardrail.

## Final commands (live worktree unless noted)

```
npx vitest run --project unit packages/core/src/guardrails         Test Files 10 passed | Tests 448 passed (448)     exit 0
npx vitest run --project unit packages/core/src/guardrails/sourceScan.test.ts   51 passed                       exit 0
npx vitest run --project unit                                       Test Files 1 failed | 86 passed; Tests 2 failed | 2121 passed (2123)   exit 1
    — the 2: apps/api/src/adminSurface.test.ts (another agent's in-progress apps/api edits; all 10 guard files pass in the run)
npx vitest run --project statistical tools/sim/src/guardrailMetaAudit.stat.test.ts   33 passed (33)   exit 0  (twice)
npx tsc -p packages/core/tsconfig.json --noEmit                                                        exit 0
npx tsc -p tools/sim/tsconfig.json --noEmit  (no errors in guardrailMetaAudit.stat.test.ts)
npx eslint packages/core/src/guardrails tools/sim/src/guardrailMetaAudit.stat.test.ts                exit 0
npx prettier --check packages/core/src/guardrails tools/sim/src/guardrailMetaAudit.stat.test.ts      exit 0
python3 scratchpad/plants{1..6}.py (isolated copy: HEAD + my files)   90 plants: every expected CAUGHT caught; residues/controls as listed
python3 scratchpad/before.py (isolated copy: HEAD guards, no overlay) key plants EVADED (only the HEAD baseline failure present)
git -C /home/alejo/.otc-audit7/fix status --short -- packages/core/src/guardrails tools/sim/src/guardrailMetaAudit.stat.test.ts
     M ×11 (listed above), ?? lifecycle.ts, repository.ts, sourceScan.test.ts
```

Plant logs: `scratchpad/plants.log`; meta-audit logs: `scratchpad/metaaudit.log`, `scratchpad/metaaudit2.log`; lexer comparison: `scratchpad/lexcmp/out.txt`.
