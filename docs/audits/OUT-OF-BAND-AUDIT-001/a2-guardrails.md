# Auditor a2 — Guardrails watched failing

Worktree: `/home/alejo/.otc-audit7/a2` (detached at 36bbf89). Final `git status --short` prints only `?? node_modules` (the expected symlink). Every plant below was restored; no `git add/commit/push/stash/worktree` was run.

## Method (what you ran, what you planted, what you could not do)

For each guard I (i) read its docstring plus the INVARIANTS.md / OVERVIEW.md claim it is cited for; (ii) planted a plain defect it names and watched it fail; (iii) planted evasive variants — different syntactic forms, file locations (`apps/api/src`, `apps/web/src/*.tsx`, `tools/sim/src`, `packages/lab/src`), file extensions (`.mts`, `.js`, `.tsx`), type-only / dynamic / computed / unicode-escaped / re-export forms, lexer-confusing constructs; (iv) restored with `git checkout --` (or deleted created files) and re-checked `git status` after each.

Instrument: `npx vitest run --project unit <guardfile>` driven by a small Python harness (`scratchpad/audit/a2lib.py`) that writes the plant, runs exactly one guard file, records the exit code and the failing test names, then restores and asserts the file is clean again. All 322 guardrail unit tests pass on the clean tree (baseline confirmed). Synthetic probes of the two strippers and `moduleSpecifiers` were run as throwaway `*.test.ts` inside `packages/core/src/guardrails/` (removed after). The meta-audit was run with vitest `-t "<guard label>"` for two mutations plus one weakened-guard case (each ~2.6 s in this worktree, not the ~30 s the brief warned of, because `node_modules` is symlinked and the tree is small).

What I could NOT do: I did not run `npm run lint`, `npm run gate`, `npm test`, `test:cov`, or the whole statistical suite (shared machine). `npx eslint <file>` **did** resolve type-aware rules in this worktree, so the ESLint findings below are executed, not read. I did not attempt runtime exploitation (building a real follower engine and sampling divergence, as PH-16.2's auditor did) — my follower findings stop at "the guard does not see the import/identifier", which is the guard's own contract.

## Plant table

Legend: caught = guard exited non-zero on the plant. Every row was restored.

### Guard 1 — `guardrails.test.ts` (ambient time/randomness, portability, economic vocabulary; scan roots)

| #     | Planted defect                                            | File                              | Caught?                            | Command                   |
| ----- | --------------------------------------------------------- | --------------------------------- | ---------------------------------- | ------------------------- |
| G1-01 | `Date.now()`                                              | engine.ts                         | YES                                | vitest guardrails.test.ts |
| G1-13 | `Math.random()`                                           | engine.ts                         | YES                                | "                         |
| G1-28 | `Math.exp()`                                              | engine.ts                         | YES                                | "                         |
| G1-31 | `userPayout` field read                                   | engine.ts                         | YES                                | "                         |
| G1-02 | `Date.now()`                                              | **apps/api/src/venue.service.ts** | YES                                | "                         |
| G1-03 | `Date.now()`                                              | apps/web/src/lib/api.ts           | no (out of scan roots — by design) | "                         |
| G1-04 | `Date.now()`                                              | **tools/sim/src/runner.ts**       | **no**                             | "                         |
| G1-05 | `Date.now()`                                              | **packages/lab/src/realism.ts**   | no (lab out of roots)              | "                         |
| G1-36 | `Date.now()` in a **`.mts`**                              | packages/engine/src/p36.mts       | **no**                             | "                         |
| G1-06 | `Date.now()` in a **`.tsx`**                              | packages/chart/src/p06.tsx        | **no**                             | "                         |
| G1-07 | `Date["now"]()` computed                                  | engine.ts                         | **no**                             | "                         |
| G1-14 | `Math["random"]()` computed                               | engine.ts                         | **no**                             | "                         |
| G1-29 | `Math["exp"]()` computed                                  | engine.ts                         | **no**                             | "                         |
| G1-15 | `Math.random()` unicode escape                            | engine.ts                         | **no** (redo2)                     | "                         |
| G1-35 | `Math.exp()` unicode escape                               | engine.ts                         | **no** (redo2)                     | "                         |
| G1-08 | `Date()` no-new                                           | engine.ts                         | **no**                             | "                         |
| G1-09 | `new Intl.DateTimeFormat().format()`                      | engine.ts                         | **no**                             | "                         |
| G1-11 | `process.uptime()`                                        | engine.ts                         | **no**                             | "                         |
| G1-12 | `performance.timeOrigin`                                  | engine.ts                         | **no**                             | "                         |
| G1-16 | `Reflect.get(Math,"random")()`                            | engine.ts                         | **no**                             | "                         |
| G1-17 | `const M = Math; M.random()`                              | engine.ts                         | **no**                             | "                         |
| G1-20 | `new Function("return Math.random()")()`                  | engine.ts                         | **no**                             | "                         |
| G1-21 | `eval("Math.random()")`                                   | engine.ts                         | **no**                             | "                         |
| G1-22 | `global.__exposure` (Node `global`, not `globalThis`)     | engine.ts                         | **no**                             | "                         |
| G1-23 | `process["env"]` computed                                 | engine.ts                         | **no**                             | "                         |
| G1-25 | `process.argv`                                            | engine.ts                         | **no**                             | "                         |
| G1-26 | module-level mutable `export let` channel                 | engine.ts                         | **no**                             | "                         |
| G1-30 | `const {exp}=Math; exp()`                                 | engine.ts                         | **no**                             | "                         |
| G1-32 | `this["pay"+"out"]` split economic word                   | engine.ts                         | **no**                             | "                         |
| G1-33 | `.payout` unicode escape                                  | engine.ts                         | **no** (redo2)                     | "                         |
| G1-34 | bare `exposure/balance/userId/positions/expiry/stake/pnl` | engine.ts                         | **no**                             | "                         |

### Guard 2 — `sourceScan.ts` strippers (synthetic probes; see Findings a2-01/02)

| #                 | Construct before a hidden `Date.now()` + engine import                        | scanSource | moduleSpecifiers | keepStrings |
| ----------------- | ----------------------------------------------------------------------------- | ---------- | ---------------- | ----------- |
| S/03              | regex `/[/*]/` after `return`                                                 | **MISSED** | **[]**           | **missing** |
| S/04              | regex `/[/*]/` after `)` of `if`                                              | **MISSED** | []               | missing     |
| S/06              | regex class `/[\]//*]/`                                                       | **MISSED** | []               | missing     |
| S/07              | regex `/'/` after `return`                                                    | **MISSED** | []               | present     |
| S/19              | regex after `typeof`                                                          | **MISSED** | []               | missing     |
| S/20              | regex after `}` of a block                                                    | **MISSED** | []               | missing     |
| 01                | template `` `${"`"}` `` (backtick in `${}`)                                   | **MISSED** | **[]**           | present     |
| 23                | template `` `${"`"+Date.now()}` ``                                            | **MISSED** | []               | present     |
| 09                | JSX text apostrophe `<p>Don't</p>`                                            | MISSED     | []               | present     |
| 05/08/11-18/22/24 | controls (regex `[/*]` after `=`, division, CA5-05 markers, url `*/`, quotes) | SEEN       | ["@otc/engine"]  | present     |
| JSX-A             | `<p>x</p>` closing tag then static import                                     | —          | **[]**           | —           |
| JSX-B             | `<Chart />` self-closing then import                                          | —          | ["@otc/engine"]  | —           |

### Guard 3 — `dependencies.test.ts`

| #       | Planted defect                                            | File                | Caught? |
| ------- | --------------------------------------------------------- | ------------------- | ------- |
| D-01    | plain `import '@otc/lab'`                                 | trading/settle.ts   | YES     |
| D-02    | `import type {...} from '@otc/lab'`                       | "                   | YES     |
| D-03/05 | `import('@otc/lab')` / template literal                   | "                   | YES     |
| D-04    | `require('@otc/lab')`                                     | "                   | YES     |
| D-08    | relative `../../lab/src/index.js`                         | "                   | YES     |
| D-12    | `import 'express'` (framework below apps)                 | "                   | YES     |
| D-16    | devDependencies edge engine→lab (manifest)                | engine/package.json | YES     |
| D-22    | `import '@otc/fixtures'` after `'use client'` (.tsx)      | Preview.tsx         | YES     |
| D-06    | `import(['@otc','lab'].join('/'))` computed               | trading/settle.ts   | **no**  |
| D-07    | `import(spec)` variable specifier                         | "                   | **no**  |
| D-09    | `import 'otc-lab-alias'` (tsconfig paths)                 | "                   | **no**  |
| D-10    | `import '#lab'` (package.json imports field)              | "                   | **no**  |
| D-11    | `import 'lodash'` (undeclared third-party)                | "                   | **no**  |
| D-15    | **peerDependencies** edge engine→lab                      | engine/package.json | **no**  |
| D-15b   | **optionalDependencies** edge engine→lab                  | "                   | **no**  |
| D-14    | `import '@otc/lab'` in a **`.js`**                        | engine/src/leak.js  | **no**  |
| D-14b   | same in `.mts` (control)                                  | engine/src/leak.mts | YES     |
| D-19    | regex `/[/*]/` after `return` hides `import '@otc/lab'`   | trading/settle.ts   | **no**  |
| D-20    | template `` `${"`"}` `` hides `import '@otc/lab'`         | "                   | **no**  |
| D-21    | regex class `/[\]//*]/` hides import                      | "                   | **no**  |
| D-23    | `import('@otc/fixtures')` after a JSX closing tag         | Preview.tsx         | **no**  |
| D-13    | static `import '@otc/fixtures'` after JSX text apostrophe | Preview.tsx         | **no**  |

### Guard 4 — `singleWriter.test.ts` (follower)

| #         | Planted defect                                                | Caught?                              |
| --------- | ------------------------------------------------------------- | ------------------------------------ |
| W-01      | plain `import * from '@otc/engine'`                           | YES                                  |
| W-02      | relative `../../engine/src/index.js`                          | YES                                  |
| W-03      | new runtime file re-exporting engine, imported relatively     | YES                                  |
| W-16      | relative import of a directory (`./fill`) re-exporting engine | YES                                  |
| W-11/W-15 | relative import of a non-existent / dist file                 | YES (walk throws)                    |
| W-12      | `import(\`./resume.js\`)` template literal                    | YES                                  |
| W-18      | template `` `${"`"}` `` before engine import                  | YES (keepStrings kept the specifier) |
| W-04      | `core['Random'+'Stream']` split-string key material           | **no**                               |
| W-05      | `core.RandomStream` unicode escape                            | **no**                               |
| W-06      | `import {runInThisContext} from 'node:vm'`                    | **no**                               |
| W-07      | `import {Worker} from 'node:worker_threads'`                  | **no**                               |
| W-08      | `global.__engine` (Node `global`)                             | **no**                               |
| W-09      | `(()=>0).constructor` (Function ctor)                         | **no**                               |
| W-10      | `(0, eval)` indirect eval                                     | **no**                               |
| W-13      | `process.getBuiltinModule`                                    | **no**                               |
| W-17      | regex `/[/*]/` after `return` hides static engine import      | **no**                               |
| W-19      | regex class `/[\]//*]/` hides static engine import            | **no**                               |

### Guard 5 — `publishingKey.test.ts`

| #     | Planted defect                                                   | Caught? |
| ----- | ---------------------------------------------------------------- | ------- |
| K-01  | plain `import {MasterKeyring}` in signing.ts                     | YES     |
| K-06b | refusal block deleted entirely (control)                         | YES     |
| K-04  | `core['Master'+'Keyring']` split-string                          | **no**  |
| K-05  | `MasterKeyring` unicode escape                                   | **no**  |
| K-08  | `import {RandomStream, expandKey}` (not on GENERATION_SURFACE)   | **no**  |
| K-06  | refusal deleted, message kept as a dead string                   | **no**  |
| K-09  | refusal condition replaced by `false`                            | **no**  |
| K-07  | one-file indirection signing.ts→./internal/keys.ts→MasterKeyring | **no**  |
| K-02  | CA5-05 comment-marker strings around import (redo2, aliased)     | **no**  |
| K-03  | CA6-03 regex literal before import (redo2, aliased)              | **no**  |

### Guard 6 — `publicSurface.test.ts`

| #    | Planted unexported module                            | Caught? |
| ---- | ---------------------------------------------------- | ------- |
| P-02 | `packages/runtime/src/thing.ts` (top-level, control) | YES     |
| P-01 | `packages/runtime/src/deep/thing.ts` (nested)        | **no**  |
| P-03 | `packages/lab/src/attacks/zz.ts` (nested)            | **no**  |
| P-04 | `packages/chart/src/Thing.tsx` (top-level `.tsx`)    | **no**  |
| P-05 | `apps/api/src/orphan.ts` (apps not enumerated)       | **no**  |

### Guard 7 — `documentation.test.ts` / `stateConsistency.test.ts`

| #                  | Planted defect                                                                                  | Caught?                                |
| ------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| DOC-01             | roadmap PH-21 cell APPROVED while doc ACTIVE                                                    | YES                                    |
| DOC-16             | roadmap PH-20 `NOT APPROVED` while doc APPROVED (control)                                       | YES                                    |
| DOC-04b            | link to a missing **file**                                                                      | YES                                    |
| DOC-05             | evidence doc not indexed                                                                        | YES                                    |
| DOC-07             | subphase doc with no roadmap row                                                                | YES                                    |
| DOC-06             | CURRENT_STATE active phase `PH-20 (active)` (roadmap: approved)                                 | YES                                    |
| DOC-08             | Approved-phases count off by one                                                                | YES                                    |
| DOC-12/13/14/18/19 | controls (roadmap subphase APPROVED, stale last-approved, wrong cycle, deleted row, empty cell) | YES                                    |
| DOC-17             | roadmap PH-20 cell `REVERTED (was APPROVED)` while doc APPROVED                                 | **no**                                 |
| DOC-02             | phase doc `Status: Approved` (mixed case)                                                       | no (semantically equal — not a defect) |
| DOC-04             | link to a missing **#anchor** in an existing file                                               | **no**                                 |
| DOC-06b            | active phase named without its ID                                                               | **no**                                 |
| DOC-09             | `Phase lifecycle: APPROVED` while roadmap PH-21 ACTIVE                                          | **no**                                 |
| DOC-10             | `Active subphase` names an APPROVED subphase                                                    | **no**                                 |
| DOC-11             | `Last approved subphase` names an ACTIVE subphase                                               | **no**                                 |
| DOC-15             | SESSION_HANDOFF `Active phase` names an approved phase                                          | **no**                                 |

### Guard 8 — `traceability.test.ts`

| #     | Planted defect                                                  | Caught?                       |
| ----- | --------------------------------------------------------------- | ----------------------------- |
| T-01  | evidence tag moved into a `/**` block (tag on line 2)           | YES                           |
| T-01b | INV-005 tag removed (control)                                   | YES                           |
| T-03  | INV-005 evidence moved to `apps/api/src` test (apps not walked) | YES (loses evidence → caught) |
| T-02  | INV-005 status `enforced` (lowercase) + evidence removed        | **no**                        |
| T-02b | status `Enforced (structural)` + evidence removed               | **no**                        |
| T-02c | status `Verified` + evidence removed                            | **no**                        |

### Guard 9 — `testCost.test.ts`

| #         | Planted defect                                                            | Caught? |
| --------- | ------------------------------------------------------------------------- | ------- |
| C-01      | `for(let z=0;z<50_000;z++){expect}` (control)                             | YES     |
| C-05      | bound from imported const (unknown → suspect)                             | YES     |
| C-11      | `z += 1` (control)                                                        | YES     |
| C-13      | nested 300×300 (control)                                                  | YES     |
| C-16/C-19 | `import {runBattery as rb}` / `lab.runBattery(x)` (controls)              | YES     |
| C-02      | `for...of` over a 50k array                                               | **no**  |
| C-03      | `while` loop                                                              | **no**  |
| C-04      | `Array.from({length:100_000}).forEach(expect)`                            | **no**  |
| C-06      | bound is `arr.length`                                                     | **no**  |
| C-07      | prefix `++z`                                                              | **no**  |
| C-08      | assertion in a helper called in the loop                                  | **no**  |
| C-09      | `.map(z => expect(...))`                                                  | **no**  |
| C-10      | multi-line `for` header                                                   | **no**  |
| C-12      | single-line body without braces                                           | **no**  |
| C-14      | decrementing loop (`z--`)                                                 | **no**  |
| C-15      | bound `50 * 1000` (literal expression)                                    | **no**  |
| C-17      | `lab["runBattery"]()` computed                                            | **no**  |
| C-18      | `const f = lab.runBattery; f(x)` indirection                              | **no**  |
| C-20      | `runBattery as runBatterySync` then call in a loop (deceptive Sync alias) | **no**  |

### Guard 10 — ESLint layer (executed `npx eslint`, type resolution worked)

| #   | Planted defect           | packages/engine/src | apps/api/src | tools/sim/src |
| --- | ------------------------ | ------------------- | ------------ | ------------- |
| L01 | `Date.now()`             | error               | **exit 0**   | **exit 0**    |
| L02 | `Date["now"]()` computed | error               | exit 0       | exit 0        |
| L03 | `Math.random()`          | error               | exit 0       | exit 0        |
| L05 | `Math.random()` unicode  | error               | exit 0       | exit 0        |
| L06 | `Math.exp()`             | error               | exit 0       | exit 0        |
| L12 | `new Date()`             | error               | exit 0       | exit 0        |
| L13 | `2 ** 3`                 | error               | exit 0       | exit 0        |

### Guard 11 — meta-audit (`guardrailMetaAudit.stat.test.ts`)

| Run                                                                                                       | Result                                                                        |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| clean tree, `-t "ambient time"`                                                                           | pass, exit 0 (mutation caught)                                                |
| clean tree, `-t "single writer"`                                                                          | pass, exit 0 (mutation caught)                                                |
| **weakened guard** (both ambient-time `expect`s commented out in guardrails.test.ts), `-t "ambient time"` | **FAIL, exit 1** — "the guard survived its own mutation … it is not evidence" |

## Findings

### a2-01 — CRITICAL — the CA6-03 regex-literal evasion is not closed; a keyword-preceded regex reopens it against every `sourceScan` guard

**Severity** critical.
**Where** `packages/core/src/guardrails/sourceScan.ts:98` (`stripCommentsKeepingStrings`), `:150` (`stripCommentsAndStrings`), `:250` (`moduleSpecifiers`) — the regex/division discriminator `if (c === '/' && /[=(,:[!&|?{;+\-*%<>~^]/.test(previousMeaningful))`.

**Claim** The docstring on `stripCommentsKeepingStrings` (lines 44-71) states CA6-03 is fixed and "the two scanners now handle the same three constructs"; PH-19.1 lists "a lexer that is nearly right is a lexer that is wrong" as closed. The claim is that a regular-expression literal whose character class contains `/*` can no longer open a spurious block comment.

**Evidence** The fix recognises a regex only when the previous meaningful character is one of a fixed punctuation set. A regex that follows a **keyword** — `return`, `typeof`, `case`, `in`, `of`, `yield`, `await`, `throw`, `do`, `else` — is preceded by a letter, so it is treated as division; its `/*` then opens a block comment that runs to the next `*/` (which the plant supplies in a trailing string), swallowing everything between. Stripped output, captured live:

```
src = "function f(s: string) {\n  return /[/*]/.test(s);\n}\nconst t = Date.now();\nimport x from '@otc/engine';\nconst c = '*/';"
stripCommentsAndStrings(src)   => 'function f(s: string) {\n  return /[\n\n\n\n""'
stripCommentsKeepingStrings(src) => 'function f(s: string) {\n  return /[\n\n\n\n\';'
```

Both `Date.now()` and `@otc/engine` are gone. Confirmed against the live guards:

- guardrails.test.ts: **S-02/S-03/S-13 EVADED** (a `Date.now()` after `return /[/*]/`, after `if(...) /[/*]/`, and after `typeof /[/*]/` passed all 22 tests, exit 0). Controls S-06…S-14 (regex after `=`, division, string `*/`, escaped `//`) all CAUGHT.
- dependencies.test.ts: **D-19/D-21 EVADED** (a `import '@otc/lab'` hidden after `return /[/*]/` / `/[\]//*]/` in `trading/settle.ts` passed all 44 tests). The CA5-05 (D-17) and CA6-03-after-`=` (D-18) controls both CAUGHT.
- singleWriter.test.ts: **W-17/W-19 EVADED** — a plain static `import * as gen from '@otc/engine'` in `follower.ts`, hidden after `return /[/*]/` (W-17) or `/[\]//*]/` (W-19), passed all 6 tests, exit 0. This is INV-002/INV-010: the exact outcome PH-16.2 recorded ("an auditor gave a follower a real engine … all guardrail tests green"), reproduced in the guard PH-16.2 rewrote, one trigger wider.

**Impact** Every guard routed through `sourceScan` — economic blindness, ambient time/state/randomness, portability (`stripCommentsAndStrings`), dependency direction (`moduleSpecifiers`), and the follower guard (`stripCommentsKeepingStrings`) — can be blinded by placing a `/[/*]/`-style regex after a keyword and a `*/` in a later string. A regex `return /[/*]/` is idiomatic, valid, review-invisible code. This is the same defect class as CA5-05 and CA6-03, the third recurrence, and it defeats the follower guard that INV-002/INV-010 rest on.

**Recommended fix** The set-membership test for regex context is the wrong discriminator. Either (a) add the regex-permitting keywords (`return typeof case in of instanceof void delete new yield await throw do else`) to the "regex may follow" decision — matching on the last _word_, not the last character; or better (b) when scanning a regex character class `[...]`, do not let `/*`/`//` inside it change lexer state (the class already suppresses `[` handling for `]`; it must also suppress comment recognition), and treat the whole `/.../ ` as one token regardless of preceding token. The meta-audit's `singleWriter` mutation must gain a keyword-triggered variant (it currently only plants the `=`-triggered form).

### a2-02 — CRITICAL — a backtick inside an interpolation (`` `${"`"}` ``) blinds `stripCommentsAndStrings` and `moduleSpecifiers`

**Severity** critical (shares the blast radius of a2-01 for two of the three scanners).
**Where** `sourceScan.ts` template-literal handling in both `stripCommentsAndStrings` (:170-183) and `moduleSpecifiers` (:263-289). The string/template loop does not recurse into `${…}`; it scans for the next unescaped backtick, so a backtick that appears _inside a string inside `${}`_ is read as the template's closing backtick, desynchronising the lexer for the rest of the file.

**Claim** Same docstring claim as a2-01: the scanners "handle … the three string forms" correctly.

**Evidence** Synthetic probe (throwaway test, removed): source ``const s = `${"`"}`;`` followed by `const t = Date.now();`, an engine import and a string → `scanSource` **MISSED** (no violation), `stripped-text has Date.now: n`, `moduleSpecifiers: []`. Live:

- guardrails.test.ts **S-01 EVADED** (`Date.now()` after `` `${"`"}` `` passed 22/22).
- dependencies.test.ts **D-20 EVADED** (`import '@otc/lab'` after `` `${"`"}` `` in trading/settle.ts passed 44/44).
- The follower guard's `stripCommentsKeepingStrings` **keeps** string contents, so it still saw the specifier (W-18 CAUGHT) — this evasion hits the economic/ambient/portability scan and the dependency scan, not the follower.

**Impact** Template literals are ubiquitous; a nested backtick is unusual but legal and unremarkable in a template that builds template source. An economic-vocabulary or ambient-time defect below it, or an illegal dependency, is invisible.

**Recommended fix** Lex `${…}` as a nested expression context (push/pop on `${`/`}`) rather than scanning to the next backtick. This is the standard template-literal lexing the current code skips.

### a2-03 — MATERIAL — `guardrails.test.ts` still scans only `.ts`; `.mts`/`.cts`/`.tsx`/`.js` in the generation path are invisible (CA6-12 fixed only the dependency guard)

**Severity** material.
**Where** `guardrails.test.ts` `listSourceFiles` (`else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts'))`).

**Claim** OVERVIEW.md and INVARIANTS.md cite `guardrails.test.ts` as the enforcement of INV-001 (economic blindness) and INV-009 (replay/portability) across the generation and replayable roots. CA6-12's own docstring in `dependencies.test.ts` says a guard "should fail because a rule was broken, never because of how a file was spelled" — and added `.tsx/.mts/.cts`. That fix was applied to `dependencies.test.ts` only.

**Evidence** G1-36 (`Date.now()` in `packages/engine/src/p36.mts`) and G1-06 (`Date.now()` in `packages/chart/src/p06.tsx`) both **EVADED** — 22/22 pass, exit 0. The dependency guard's own `SOURCE_EXTENSIONS` also omits `.js`: D-14 (`import '@otc/lab'` in `packages/engine/src/leak.js`) **EVADED** while D-14b (same as `.mts`) was CAUGHT.

**Impact** A generation-path module written as `.mts`/`.cts`/`.tsx` (or a stray compiled/checked-in `.js`) can carry economic vocabulary, ambient time/state/randomness, or a non-portable transcendental with nothing firing. TypeScript projects increasingly use `.mts`. The gap is exactly CA6-12, surviving in the sibling guard.

**Recommended fix** Share one `SOURCE_EXTENSIONS` list between `guardrails.test.ts`, `dependencies.test.ts` and `publicSurface.test.ts`, and include `.js` for the dependency guard (a checked-in `.js` under `src/` is still shipped code).

### a2-04 — MATERIAL — `tools/sim/src` is in NEITHER enforcement layer for ambient time/randomness/portability

**Severity** material.
**Where** `guardrails.test.ts` `REPLAYABLE_ROOTS` (no `tools/`); `eslint.config.js` market-model block (`files: ['packages/*/src/**/*.ts']`, no `tools/`).

**Claim** OVERVIEW.md: "ESLint reports them in the editor; the guardrail test suite is the authority and runs in CI." CLAUDE.md §6.2: ambient time/randomness "enforced by lint/architecture tests." `tools/sim` "produces the numbers every claim in this project cites" (vitest.config coverage note).

**Evidence** G1-04 (`Date.now()` in `tools/sim/src/runner.ts`) **EVADED** the guardrail scan (22/22, exit 0). `npx eslint tools/sim/src/runner.ts` with `Date.now/Math.random/new Date/**` planted exited **0**. So a genuine ambient-time or non-portable-math defect in the evidence generators is caught by nothing.

**Impact** The simulation runner and evidence generators (`calibration`, `horizonEvidence`, `phaseAcceptance`, …) are not bound to replay or portability by any executed guard. A non-portable `Math.exp` in `runner.ts` would make a "reproducible" statistical result reproducible only on one Node build, undetected. (Note: `tools/sim` legitimately uses `Date.now()` in `horizonEvidence.ts` for wall-clock evidence timing — B-018 records this as the reason the roots were not widened. That is why the fix must be an allowlist, not a ban; see below.)

**Recommended fix** Add `tools/sim/src` to a portability + randomness scan (these have no legitimate use there) even if ambient time stays allowlisted for the evidence timers; or extend the ESLint market-model `files` glob to `tools/*/src/**/*.ts` with an allow-list override for the timing files.

### a2-05 — MATERIAL — computed-property / indirection access defeats the entire `sourceScan` layer, and the guard suite (the "authority") is weaker than ESLint here

**Severity** material.
**Where** all regex-based rules in `sourceScan.ts` (`AMBIENT_RULES`, `PORTABILITY_RULES`, `ECONOMIC_BLINDNESS_RULES`) and the identifier scans in `singleWriter`/`publishingKey`.

**Claim** B-018 already records computed-property access as DEFERRED "because it needs a parser." I confirm it and add two observations that sharpen it.

**Evidence** Against guardrails.test.ts, all EVADED: `Date["now"]()` (G1-07), `Math["random"]()` (G1-14), `Math["exp"]()` (G1-29), unicode-escaped `Math.random()` (G1-15) and `.payout` (G1-33), `const {exp}=Math` (G1-30), `const M=Math;M.random()` (G1-17), `this["pay"+"out"]` (G1-32), `Reflect.get`, `new Function`, `eval`, `Date()` no-new, `Intl.DateTimeFormat().format()`, `process.uptime()`, `performance.timeOrigin`, `global.` (Node global), `process["env"]`, `process.argv`. Two sharper points:

1. **ESLint is materially stronger than the "authority" here.** `npx eslint packages/engine/src/engine.ts` caught the computed `Date["now"]` and unicode `Math.random` (AST-normalised) that the guard suite missed. OVERVIEW.md calls the guard suite "the authority" and ESLint the editor aid — for computed/unicode member access the relationship is inverted, and ESLint is scoped out of `apps/`+`tools/` (a2-04), so the stronger check does not run where the weaker one is the only one.
2. **The follower and publishing-key identifier scans are defeated the same way**: W-04/W-05 (`core['Random'+'Stream']`, `core.RandomStream`) and K-04/K-05 (same for `MasterKeyring`) EVADED. For a guard whose stated contract is "provably unable to reach key material," a substring/`\b`-regex identifier scan is not proof.

**Impact** Every ambient/economic/portability/key-material guard has a uniform bypass in one syntactic step. The engine could read `global.__exposure` or `Math['random']` today and pass CI.

**Recommended fix** B-018's own conclusion (a parser). Concretely: run these scans over the TypeScript AST (the project already type-checks; a ts-morph or `typescript` pass would give `MemberExpression`/`ElementAccessExpression` with resolved names, catching computed and unicode-escaped forms and `Reflect.get`/`Function`/`eval` as call targets). Until then, at minimum ban `Reflect.get`, `Function(`, `eval(`, `global` and bracket-access on `Math`/`Date`/`process` textually.

### a2-06 — MATERIAL — `publishingKey.test.ts`: the refusal check is a substring test satisfiable by a dead string or a defeated condition, and the surface list omits the entropy primitives

**Severity** material.
**Where** `publishingKey.test.ts` — `REQUIRED_REFUSAL = 'equal to OTC_MASTER_SECRET'` with `expect(code).toContain(REQUIRED_REFUSAL)`; and `GENERATION_SURFACE` (lines ~55-63).

**Claim** The guard's docstring (m-5) says it fixed exactly this: "A guard satisfiable by a sentence _about_ the defence is not a guard" and that it now scans comment-stripped code so a comment cannot satisfy it. INV-010 rests on the publishing key being unable to derive the market.

**Evidence**

- **K-06 EVADED**: I deleted the whole equality-refusal block and left a live statement `const note06 = 'equal to OTC_MASTER_SECRET'; void note06;`. Comments are stripped, but this is _code_ containing the required substring — 7/7 pass, exit 0. The m-5 fix stripped comments but a dead string literal in code satisfies `.toContain` just as well.
- **K-09 EVADED**: I replaced the refusal condition `master !== undefined && … === seed…` with `false as boolean`. The `throw` block (and its message string) stays, so `.toContain('equal to OTC_MASTER_SECRET')` passes — but the refusal never fires. 7/7 pass. A publishing key equal to the master secret would now be accepted.
- **K-08 EVADED**: `import { RandomStream, expandKey } from '@otc/core'` in signing.ts passed. `GENERATION_SURFACE` lists `MasterKeyring, deriveKey, hkdf, chacha, ChaCha, keyEpoch, RandomSource` but **not** `RandomStream, expandKey, expandNonce, chacha20Block, CursorLease` — the very primitives the follower guard added to _its_ list after CA5-05. Signing code can import the keystream primitives directly.
- K-04/K-05/K-07 (split-string, unicode, one-file indirection) EVADED as expected (a2-05, and the scan is non-transitive: it reads only the five `SIGNING_MODULES`).
- K-06b (delete the block entirely) CAUGHT — the only version the guard actually detects.

**Impact** The "half that notices" (K-06/K-09) is defeated by a one-line change that looks exactly like the "one secret to rotate" simplification the guard exists to prevent — this is the m-6/m-5 failure recurring. K-08 is a live gap: the publishing path can reach generation primitives under names the guard does not list.

**Recommended fix** For the refusal: assert behaviour, not text — the behavioural half already lives in `signing.test.ts`; have _this_ guard import nothing but require that `signing.test.ts` contains a test that calls `publishingKeyFromEnvironment` with equal secrets and expects a throw (or move the assertion there and drop the substring test, which proves nothing). Add `RandomStream, expandKey, expandNonce, chacha20Block, CursorLease, deriveKey` to `GENERATION_SURFACE` (align with the follower guard's `FORBIDDEN_IDENTIFIERS`). Make the module scan transitive.

### a2-07 — MATERIAL — `testCost.test.ts` recognises only one loop shape; for-of/while/forEach/.map/helper-in-loop/prefix-++ all evade

**Severity** material.
**Where** `testCost.test.ts` `loopIterations` (single regex for `for (let i = N; i <op> BOUND; i++/i+=k)`), and the `SYNCHRONOUS_DRIVERS` call detection.

**Claim** The docstring: "A guardrail that catches a seventh of its subject is worse than none" — presented as the _lesson learned_, implying the current detector is comprehensive. B-021 says catching accidental cost "is `testCost.test.ts`'s job."

**Evidence** All EVADED (7/7 pass): `for...of` over a 50k array (C-02), `while` (C-03), `Array.from({length:100_000}).forEach(expect)` (C-04), `arr.length` bound (C-06), prefix `++z` (C-07), assertion in a helper called in the loop (C-08), `.map(expect)` (C-09), multi-line `for` header (C-10), single-line body no braces (C-12), decrementing (C-14), `50*1000` literal-expression bound (C-15). Controls C-01/C-05/C-11/C-13 CAUGHT. For the driver check: `lab["runBattery"]()` (C-17), `const f = lab.runBattery; f()` (C-18), and the deceptive `runBattery as runBatterySync` then call-in-loop (C-20) all EVADED; controls C-16/C-19 CAUGHT.

**Impact** `Array.from({length:100000}).forEach(x => expect(...))` and `for (const x of bigArray) expect(...)` are the _idiomatic_ ways to assert over a dataset — more common than the counting `for` the guard recognises — and both are exactly the 25µs-×-100k timeout the guard names. The RPC-starvation class (B-010) is only partly mitigated: C-20 shows the `Sync` escape hatch (documented for one legitimate file) lets any statistical test call a synchronous driver with an honest-looking alias.

**Recommended fix** Detect assertion density structurally: flag any `expect(` whose enclosing block is a `for`/`for...of`/`for...in`/`while`/`do` loop or a `.forEach(`/`.map(`/`.flatMap(` callback, regardless of bound (the AST makes this exact; textually, match the loop _keywords_ and array-iteration method names, not just the counting-for pattern). For the driver check, count calls by resolved binding, not by alias spelling; the `Sync` allowance should be scoped to the one file that needs it rather than any alias containing "sync".

### a2-08 — MATERIAL — `stateConsistency`/`documentation` do not guard subphase pointers, the `Phase lifecycle` row, SESSION_HANDOFF's active phase, or a "reverted" status

**Severity** material.
**Where** `stateConsistency.test.ts` (operates on top-level `PH-N` rows only; `isApproved` negation set is `NOT|NEVER|UN-`), `documentation.test.ts` phase-status cross-check.

**Claim** These guards exist so §71 cold-start works: "a fresh agent must determine the current phase **and subphase** from the repository alone" (stateConsistency docstring), and CURRENT_STATE/SESSION_HANDOFF must not disagree.

**Evidence** All EVADED:

- **DOC-10**: CURRENT_STATE `Active subphase = PH-20.3 — Editing and retiring` (an APPROVED subphase) — 6/6 pass. Subphase rows are never validated against the roadmap.
- **DOC-11**: `Last approved subphase = PH-21.1` (an ACTIVE subphase) — pass.
- **DOC-09/09b**: `Phase lifecycle = APPROVED` while roadmap shows PH-21 ACTIVE — pass (the row is unread).
- **DOC-15**: SESSION_HANDOFF `Active phase = PH-20 — the operator panel (ACTIVE)` (PH-20 is approved) — pass (the "active phase names an approved phase" check runs only on CURRENT_STATE).
- **DOC-17**: roadmap PH-20 cell `REVERTED (was APPROVED)` while the doc says APPROVED — pass on **both** guards: `documentation.test.ts` `.toContain('APPROVED')` is satisfied by "was APPROVED" and its negation check only knows `NOT APPROVED`; `stateConsistency.isApproved` counts it approved because `REVERTED` is not in `{NOT,NEVER,UN-}`. So a reverted/superseded phase still counts toward the approved total and can be reported as the last approved phase.
- DOC-06b (active phase named without ID) and DOC-04 (dead `#anchor`) EVADED — lower severity (documented behaviour for anchors).

**Impact** The subphase is the level a fresh agent actually resumes at, and it is unguarded end-to-end; SESSION_HANDOFF's active phase is unguarded; and a reverted phase is silently miscounted. These are precisely the §71 drift failures the family was built to stop (M-11/M-12), one level down and one vocabulary word wide.

**Recommended fix** Extend `roadmapPhases`/the status cross-check to subphase rows (`PH-N.M`) and validate CURRENT_STATE's `Active subphase`/`Last approved subphase` against them; apply the "does not name an approved phase as active" check to SESSION_HANDOFF too; broaden the negation vocabulary in `isApproved` and the documentation status check to `REVERTED|SUPERSEDED|ROLLED BACK|WITHDRAWN` (or, better, match the status cell against an allowlist of exact tokens rather than substring-scanning for `APPROVED`).

### a2-09 — MATERIAL — `traceability.test.ts` reads the status as an exact string `Enforced`; any synonym plus evidence removal is invisible

**Severity** material.
**Where** `traceability.test.ts` `backs every enforced invariant` (`status.get(id) === 'Enforced'`).

**Claim** The guard "fails if any [enforced] invariant has no test claiming it" (docstring), the INV-005-never-enforced regression made concrete.

**Evidence** T-02/T-02b/T-02c EVADED: with INV-005's only evidence tag removed from `guardrails.test.ts`, changing the INVARIANTS.md status cell to `enforced` (lowercase), `Enforced (structural)`, or `Verified` makes the `=== 'Enforced'` test skip INV-005 entirely — 5/5 pass. The "pending → has evidence" companion check also keys on `startsWith('Pending')`, so `Verified`/`enforced` fall through both. T-01/T-01b/T-03 (tag in a `/**` block, tag removed, evidence relocated to an unwalked `apps/` test) all CAUGHT — the primary contract holds for the literal `Enforced`.

**Impact** A one-character casing drift or an editorial synonym in the status column silently removes an invariant from enforcement — the same "gap in an unwritten map is invisible" failure the guard was written for. Combined with the fact that `apps/` tests are not walked for evidence (T-03 relocates evidence there and the guard correctly reports the loss, but it means an invariant whose _only_ evidence is an `apps/` test would read as unbacked).

**Recommended fix** Normalise the status cell (case-insensitive, treat `Enforced*` as enforced) and assert the cell is one of a known set; fail on an unrecognised status rather than silently treating it as not-enforced.

### a2-10 — MINOR/MATERIAL — `publicSurface.test.ts` sees only top-level `.ts`; nested modules, `.tsx`, and `apps/` are invisible

**Severity** minor (surface completeness, not an invariant) trending material for `apps/`.
**Where** `publicSurface.test.ts` `topLevelModules` (`readdirSync(src)` non-recursive, `.ts` only) and `packages()` (enumerates `packages` + `tools`, not `apps`).

**Evidence** EVADED: `packages/runtime/src/deep/thing.ts` (P-01), `packages/lab/src/attacks/zz.ts` (P-03), `packages/chart/src/Thing.tsx` (P-04), `apps/api/src/orphan.ts` (P-05). Control P-02 (top-level `runtime/src/thing.ts`) CAUGHT. So the PH-15 defect (a whole leader loop unreachable from the index) recurs for any module in a subdirectory — and `packages/lab/src/attacks/` is a real, populated nested directory whose modules this guard never checks.

**Impact** A completed, tested, approved module in a nested directory (the norm in `lab/attacks`) can be unreachable from its package surface with nothing noticing — exactly PH-15's `failover.ts` case. Lower severity than the invariant guards because it is caught in practice when an integration test imports the module, but that is the accident PH-15 said not to rely on.

**Recommended fix** Walk `src/` recursively (as `dependencies.test.ts` and `traceability.test.ts` already do), include `.tsx`, and decide whether nested modules must be re-exported or are implicitly internal (a documented rule either way).

### a2-11 — MATERIAL — the meta-audit asserts guards fail on a mutation but does not assert guards are _not vacuously passing_; six of nine guard files and most guard assertions are never mutated

**Severity** material.
**Where** `tools/sim/src/guardrailMetaAudit.stat.test.ts` `MUTATIONS` (12 entries over 6 test files).

**Claim** PH-9.2/§ docstring: "mutate the thing a guard protects and require the guard to fail … A guard that survives its own mutation is reported." The known-limitations note concedes it is "ten mutations, not an exhaustive mutation space."

**Evidence** Mutated guard files: `guardrails.test.ts` (5 mutations), `dependencies.test.ts` (3), `singleWriter.test.ts` (1), `testCost.test.ts` (1), `traceability.test.ts` (1), `stateConsistency.test.ts` (1). **Never mutated at all: `documentation.test.ts`, `publicSurface.test.ts`, `publishingKey.test.ts`.** Within mutated files, only one assertion each is exercised — e.g. `stateConsistency` is mutated only for the last-approved-phase count, never for the subphase/negation gaps in a2-08; `traceability` only for the tag-removal path, never the status-synonym gap in a2-09; `dependencies` never for the computed-import/manifest-edge gaps in the plant table. **Positive check on the harness**: I ran two mutations on the clean tree (`ambient time`, `single writer`) — both pass, exit 0, mutation caught (~2.6 s each). **Weakened-guard check**: I commented out both ambient-time `expect`s in `guardrails.test.ts` and re-ran `-t "ambient time"` — it **FAILED, exit 1**: "the guard survived its own mutation … it is not evidence." So the harness _does_ have teeth for the assertions it targets: because it re-checks that the guard passes clean _and then_ fails on the mutation, a guard whose central `expect` is deleted is caught — **for the one assertion each mutation exercises**. A guard file with no mutation (publishingKey, publicSurface, documentation) could have every assertion commented out and the meta-audit would not notice.

**Impact** Three guard files — including `publishingKey.test.ts`, which enforces INV-010 and which a2-06 shows is defeatable by a one-line refusal edit — have no meta-audit coverage at all. The meta-audit's green result certifies only the 12 specific assertions it mutates; the a2-06/07/08/09 gaps sit in assertions or files it never touches, which is why they survive despite "10/10 mutations caught."

**Recommended fix** Add mutations for the uncovered files, targeting the _specific defeat_ each guard claims to catch: for `publishingKey`, delete the refusal condition (K-09 form) and confirm the guard fails — it will not today (a2-06), which is itself the finding; for `documentation`, an unindexed evidence doc; for `publicSurface`, an unexported top-level module. Track the intended-coverage set so a new guard assertion without a mutation is itself flagged (CA5-11/CA6-14 recorded this class twice; it is still open for three files).

### a2-12 — MINOR — the dependency guard does not police undeclared third-party or aliased imports below `apps/`

**Severity** minor (architecture hygiene, not an invariant).
**Where** `dependencies.test.ts` `imports nothing it has not declared` (filters to `specifier.startsWith('@otc/')`).

**Evidence** D-11 (`import 'lodash'` undeclared in `trading`), D-09 (`import 'otc-lab-alias'`, a tsconfig `paths` alias), D-10 (`import '#lab'`, a package.json `imports` subpath) all EVADED, as did D-06/D-07 (computed / variable dynamic-import specifiers). The `@otc/*` direction rules and the framework denylist are enforced; arbitrary external or aliased dependencies are not.

**Impact** A package below `apps/` could acquire an undeclared npm dependency (works via hoisting until published) or reach a sibling through a tsconfig path alias / `#imports` subpath, invisible to the allowlist. Low severity because it does not by itself breach INV-001, but a `paths` alias to `@otc/engine/src` would be a real direction violation the guard cannot see.

**Recommended fix** Assert _every_ bare specifier (not just `@otc/*`) is in the manifest's declared deps; resolve tsconfig `paths` and package.json `imports` to their targets before applying the direction rule.

### a2-13 — documentation-only claims spot-checked (item 12): three checked, all genuinely enforced

I grepped the docs for "enforced by / guarded by / a test asserts / the guardrail scan" and verified three claims not covered by the guards above:

- lab/attacks/types.ts "a test asserts that every kind is represented" → `battery.test.ts` asserts `featureKind` per family. **Real.**
- PH-8 "Rendering work drifting into packages below it — Guarded by dependencies.test.ts" → `@otc/chart` allowlist is `['@otc/core']`; a chart→react/framework import would fire `imports no framework`. **Real.**
- INVARIANTS.md INV-010 "key material redacted in JSON, string, inspect" → `keyring.test.ts:116/136` assert `[redacted]` in JSON and Node `inspect`. **Real.**
  No documentation-only phantom guard found among these three. (I did not exhaustively check every "enforced by" claim.)

## What survived

The clean tree passes all 322 guardrail unit tests and the two meta-audit mutations I ran. The following **evaded** their guard and are the material residue:

1. **a2-01 (critical)** keyword-preceded regex (`return /[/*]/…`) blinds all three `sourceScan` functions — defeats economic/ambient/portability scan, dependency scan, and the follower guard (INV-002/INV-010). Third recurrence of the CA5-05/CA6-03 class.
2. **a2-02 (critical)** `` `${"`"}` `` blinds `stripCommentsAndStrings` and `moduleSpecifiers`.
3. **a2-05 (material)** computed/unicode/indirection member access defeats every `sourceScan` and identifier guard uniformly; ESLint is stronger here but scoped out of apps/tools.
4. **a2-06 (material)** publishing-key refusal is a substring test (dead string or `if(false)` satisfies it), and `GENERATION_SURFACE` omits `RandomStream/expandKey/…`.
5. **a2-07 (material)** loop-cost detector misses for-of/while/forEach/.map/helper/prefix-++/length-bound; the `Sync` driver alias is a usable escape hatch.
6. **a2-03 / a2-04 (material)** `.mts/.cts/.tsx/.js` and `tools/sim/src` invisible to the ambient/portability/economic scan (and ESLint).
7. **a2-08 / a2-09 (material)** subphase pointers, `Phase lifecycle`, SESSION_HANDOFF active phase, "reverted" status, and status synonyms unguarded in the state/traceability guards.
8. **a2-10 / a2-11 / a2-12 (minor–material)** nested/`.tsx`/`apps` modules invisible to publicSurface; three guard files unmutated by the meta-audit (incl. publishingKey); undeclared/aliased third-party imports unpoliced.

## Limits of this audit

- **No runtime exploitation.** I proved the guards do not _see_ the plants; I did not build a real follower engine and measure INV-002 divergence as PH-16.2's auditor did. The a2-01/W-17 evasion is the same mechanism PH-16.2 showed was exploitable, so I treat it as critical, but I did not re-demonstrate the 120/120 divergence.
- **No `.git` history / merge-window check.** I worked only in the detached worktree; I did not verify that these guards run in CI on `main` (SESSION_HANDOFF records CI **red**, which I did not investigate — a red CI on a green local gate is itself a standing finding per CLAUDE.md that is outside my subject).
- **ESLint executed in a worktree.** `npx eslint` resolved types here (contrary to the brief's warning); the ESLint results (a2-04, a2-05) are executed, but the brief notes worktree lint can be unreliable, so treat the _scope_ conclusions (apps/tools exit 0) as the load-bearing part — they depend only on the config's `files` globs, which I also read directly.
- **Meta-audit run twice, not fully.** I ran 2 of 12 mutations plus one weakened-guard case to establish the harness has teeth; I did not run all 12 (each ~2.6 s here, but the brief capped me at two and the shared machine argues against the full statistical suite). The coverage-gap finding (a2-11) is from reading the `MUTATIONS` table, which is exhaustive and does not require running it.
- **Plant scope.** Every plant was a single construct in isolation; I did not test combinations (e.g. a2-01 regex evasion _inside_ a `.mts` file), which would compound. The synthetic stripper probes (guard 2) were run as throwaway tests inside the guardrails directory and removed; `git status` is clean.
- **Item 12 is a spot-check**, three claims, not an exhaustive sweep of every "enforced by" sentence in the repository.
