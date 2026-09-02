# Auditor a1 — The gate and hosted CI

Worktree: `/home/alejo/.otc-audit7/a1`, detached at `36bbf89`. Vitest 3.2.7, Node v24.19.0, 16 cores. All commands below were run from that worktree unless stated; every exit code quoted was observed.

## Method (what you ran, what you planted, what you could not do)

**Read.** `CLAUDE.md`, `GOVERNANCE.md` §28.1/§40, `vitest.config.ts`, `vitest.setup.statistical.ts`, `package.json`, `.github/workflows/ci.yml`, `PH-19.1`, `PH-21.1` §4, `git log -5 --stat`; Vitest's `chunks/rpc.-pEldfrD.js`, `chunks/index.B521nVV-.js` (birpc), `chunks/index.CwejwG0H.js` (runner patching), `chunks/runBaseTests.9Ij9_de-.js`, `chunks/base.DfmxU-tU.js`, `chunks/utils.CAioKnHs.js` (forks transport), `chunks/console.CtFJOzRO.js` (console spy), `chunks/coverage.DfSpMS-b.js` (forks pool), `chunks/cli-api.DVe0nWUx.js` (main-thread `TestRun.updated`, `runFiles`), `@vitest/runner/dist/chunk-hooks.js` (`sendTasksUpdate`, throttle, `withTimeout`, `runSuite`), `tinypool/dist/index.js`, the Vitest typings (`reporters.d.BuRON0I0.d.ts`: `NonProjectOptions`, `TestProjectInlineConfiguration.extends`).

**Re-executed / fetched.** The three red CI job logs (`gh api repos/NovaHub2026/otcv6/actions/jobs/<id>/logs`, runs 33587082478 @2707f27, 33601281019 @ac4c3cf, 33607930939 @3a5f0a5 — the last one carries the watchdog) with per-line timestamps; the resolved Vitest configuration through `createVitest` from `vitest/node` (root and both projects, with and without `fileParallelism:false`).

**Ran (single files only, never the whole suite).** Sweep 1: the eleven suspect files one at a time with the committed watchdog (`npx vitest run --project statistical <file>`). Sweep 2/3/4: the same plus the rest of the statistical suite under an **instrumented setup file** of my own (`vitest.audit.setup.ts`, selected through a copy of the config, `vitest.audit.config.ts`, so the committed files were never edited) that wraps the worker's RPC proxy and records every request's round trip, the interval lag _and the lag still pending at `afterAll`_, and the calls still unsettled at `afterAll`, appended to a file rather than the console. Nine throwaway `*.stat.test.ts` files (R1–R7, W1–W9, A/B/C) with `while (Date.now() < t + N) {}` blocks and specific yields, run one at a time. `npm run build` once (needed by `clientReconstruction`); `OTC_COVERAGE=1 npx vitest run --project unit --coverage packages/chart`; ESLint on two planted files; a verbose run of three unit files; a Node script on child-pipe blocking.

**Planted and restored.** `Math.random()` in `packages/engine/src/engine.ts`; an unused variable and `==` in `apps/web/src/app/page.tsx`; `disableConsoleIntercept` moved into the project block in a config copy. Every throwaway file was deleted by the scripts that created them; `git checkout --` restored the two planted sources.

**Could not do.** Instrument the CI runner itself; run the whole statistical or unit suite; edit `node_modules` (shared, read-only by rule). Timings here are upper bounds where noted: sweep 2 ran while my other experiments were running.

## Findings

### a1-01 — The CI failure is `sampledCatalogue.stat.test.ts`, whose last test runs 92–94 s on CI without a single macrotask turn while an `onTaskUpdate` is in flight; it passes here only because the same test takes 55 s

**Severity:** critical (it is the reason `main` is red on four consecutive pushes, and the local gate's green rests on 8 % of headroom).

**Where:** `tools/sim/src/sampledCatalogue.stat.test.ts:305-392` (test `separates its own siblings, not merely its families`), `:165-176` (`signaturesFor`), `:78-80` (`WINDOW_TICKS = 2_000`, `WINDOWS = 40`, `SIGNATURE_TICKS = 80_010`); `packages/lab/src/observer.ts:144,164` (`chunkTicks = 250_000`; the only yield is `if (count % chunkTicks === 0) await setImmediate`); `packages/lab/src/differentiation.ts:89,189` (`assetSignature`, `measureDifferentiation`, both synchronous).

**Claim.** `PH-21.1` §4 and `vitest.setup.statistical.ts` say the cause "is always the same shape and never the same place: a test body that runs synchronously for long enough that its worker cannot answer the runner", and that the watchdog "reports the worst block per file above two seconds and fails the file above sixty". Three earlier attributions (CA6-01 oversubscription, CA6-02 console traffic, `c736707` `execFileSync`) were each recorded as the cause; none was reproduced.

**Evidence.**

_Mechanism, from the code._ `createBirpc` (`index.B521nVV-.js:52-71`): every request arms `setTimeout(..., 60000)` (captured real timer, `unref()`'d) and `post()`s; the reply is matched in `onMessage` (`:139-146`) and the timer callback rejects and deletes the entry (`:56-64`). In a forked worker the reply arrives on `process.on("message")` (`utils.CAioKnHs.js:25-42`), i.e. it is read in the loop's **poll** phase; the expired timer fires in the **timers** phase. After a long synchronous stretch Node runs timers before the next poll unless the stretch itself ran inside the timers phase — so an expired timer always beats a queued reply. `unref()` only affects liveness. `onUserConsoleLog`/`onCollected`/`onCancel` are events (`rpc.-pEldfrD.js:43-47`, no timer). `onTaskUpdate` is sent by `sendTasksUpdateThrottled` (`chunk-hooks.js:1483-1500`): a pack arriving more than 100 ms after the previous send is sent **synchronously** — which is every test boundary in a suite of long tests. A rejected update stays in `pendingTasksUpdates` (`:1466-1472`); `finishSendTasksUpdate` (`:1477`) `Promise.all`s it at the end of the file; `startTests` (`:1822`) throws; the worker's run rejects; the forks pool rethrows per file (`coverage.DfSpMS-b.js:2658-2662`) into `Promise.allSettled` (`:2680`) and an `AggregateError` (`:2695`), which `state.catchError` splits into "Unhandled Error". The "originated in" attribution is added only by the worker's `unhandledRejection` handler (`execute.B7h3T_Hc.js:491-496`), never on this path — its absence says nothing about _when_ the timer fired.

_Reproduction, exact error, ten-line file_ (`tools/sim/src/zzAuditR1.stat.test.ts`, one test, `spin(65_000)`):

```
npx vitest run --project statistical tools/sim/src/zzAuditR1.stat.test.ts
 ✓ |statistical| tools/sim/src/zzAuditR1.stat.test.ts (1 test) 65002ms
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError …/rpc.-pEldfrD.js:53:10
 ❯ Timeout._onTimeout …/index.B521nVV-.js:59:62
 Test Files  1 passed (1)   Tests  1 passed (1)   Errors  1 error      EXIT=1
```

No "originated in" line. The threshold, bounded: R2 `spin(45_000)` → EXIT 0, no error. R4 `await setTimeout(1500); spin(65_000)` → EXIT 0 (nothing in flight, and a timers-phase block lets the poll run first). R5 `await setImmediate; spin(65_000)` → EXIT 1, error. R3 `spin(35_000); await setImmediate; spin(35_000)` → **EXIT 1, error** (one `setImmediate` from a poll-phase continuation goes poll→check without a poll in between). R7 the same with **two** `setImmediate`s → EXIT 0. Three files A(65 s)/B/C shuffled, `--no-file-parallelism`, A completed first: `Test Files 3 passed (3)  Errors 1 error`, EXIT 1 — the run continues past the failing file, so nothing constrains which file it is.

_Which file, from CI._ Per-file overhead between one file's `✓` and the next file's start is ≤ 4.0 s in all three logs (script `gaps.py` over 107 file lines), which excludes a late reply to a _final_ update (that would hold the single worker ≥ 60 s). The only file whose watchdog line is not the truth: the committed watchdog printed `worst block 14.1s` for `sampledCatalogue` on CI and `10.3s` locally, but that number is blind to the tail (a1-02). The last test's durations:

| run                                      | `separates its own siblings…` | preceding test |
| ---------------------------------------- | ----------------------------- | -------------- |
| CI 33587082478 (2707f27)                 | **94 027 ms**                 | 304 852 ms     |
| CI 33601281019 (ac4c3cf)                 | **92 660 ms**                 | 225 784 ms     |
| CI 33607930939 (3a5f0a5)                 | **91 824 ms**                 | 296 610 ms     |
| local, sweep 1 (quiet)                   | 55 477 ms                     | 191 374 ms     |
| local, sweep 2 (instrumented, contended) | **101 985 ms**                | 323 491 ms     |

_Local reproduction on the real file_ (sweep 2, `npx vitest run --config vitest.audit.config.ts --project statistical tools/sim/src/sampledCatalogue.stat.test.ts`): `EXIT=1`, `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`, all 4 tests ✓, and the instrument's line for the file: `SUMMARY worst_block=104.4s max_rtt=2.2s(onTaskUpdate) events=29` with `BLOCK 104.4s still pending at afterAll +598.9s` — the interval last fired ~2 s before the last test began and not again until after it ended: the whole test is one macrotask-free stretch. Its awaits resolve through microtasks only: `signaturesFor` asks `buildObserverDataset` for 80 010 ticks, `count % 250_000 === 0` is never true, and `assetSignature`/`measureDifferentiation` are synchronous; 24 assets plus the control clones at ~2 s each. The in-flight request is the `test-finished` pack of the 191–323 s test before it, sent synchronously (throttle) microseconds before the block. The console lines it prints reach the main thread ~8 s apart on CI (`stdout |` timestamps 08:26:46→08:28:18) because the console spy flushes on a **microtask** (`console.CtFJOzRO.js:39-48`) and `process.send` writes without a loop turn — the worker sends for 92 s while never reading.

_Speed ratio._ Per test, CI/local is 1.24–1.69× (`multiAsset` 12 tests all 1.51–1.69×; `dispersion` 1.67×), not the 3.7× assumed in the brief (that figure compares a serial CI run with a pre-CA6-01 parallel local run). The local margin is 60/55.5 = **8 %**; CI is at −35 %.

**Impact.** Every push to `main` is red for a reason that names no file; `PH-20` was approved with this pending; the local `GATE_EXIT=0` results depend on this one test staying under 60 s on a 16-core machine — any ~8 % contention (another session, a build, a slower laptop) turns the gate red with every test passing, which is the history of B-005, B-010 and CA6-02. The four "fixes" recorded so far did not touch it.

**Recommended fix.**

1. In `signaturesFor` (`sampledCatalogue.stat.test.ts:165`) pass `chunkTicks: 10_000` (or make `buildObserverDataset` yield at least once per call), and add `await yieldToLoop()` between assets in the loops at `:354`, `:375-389` where `yieldToLoop = () => new Promise((r) => setImmediate(() => setImmediate(r)))` — two immediates guarantee a poll phase (R3 vs R7).
2. Export that helper from `@otc/lab` (next to `calibrateAssetAsync`) and change the CLAUDE.md §5 convention to it; a single `setImmediate` is not a guarantee at the start of a test.
3. Make the watchdog measure the tail (a1-02) and turn its threshold into a _round-trip_ measurement (a1-02's instrument wraps `globalThis.__vitest_worker__.rpc`; ~30 lines).

### a1-02 — The event-loop watchdog cannot see the block that fails the run: it never measures the tail of a file

**Severity:** material.

**Where:** `vitest.setup.statistical.ts:56-88` (`beforeAll` starts a 250 ms interval; `afterAll` reads `worst` and clears it).

**Claim.** "It reports the worst block per file above two seconds and fails the file above sixty" (`PH-21.1` §4); `FAIL_ABOVE_MS` "fails the file, and says which one".

**Evidence.** The interval's callback runs only in a timers phase. After a block, the runner reaches `afterAll` through microtasks; if no timers phase intervenes, `clearInterval` runs with `worst` unchanged. Controlled pairs (committed config, one file each):

| plant                                                                      | watchdog output                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| W1: `spin(5_000)` then end                                                 | _nothing_ (EXIT 0)                                                                         |
| W7: `spin(5_000); await setTimeout(10)`                                    | `worst block 4.8s`                                                                         |
| W8: `spin(5_000); await setImmediate; await setImmediate`                  | `worst block 4.8s`                                                                         |
| W6: `spin(5_000); await setImmediate; spin(8_000)`                         | _nothing_                                                                                  |
| W9: `spin(5_000); await setTimeout(10); spin(8_000); await setTimeout(10)` | `worst block 7.8s` (no under-report)                                                       |
| R1: `spin(65_000)`                                                         | _nothing_ — the file that should "fail above sixty" passed the watchdog and failed the run |

On the real file: committed watchdog 10.3 s local / 14.1 s CI; the instrument's `pending at afterAll` 104.4 s. `multiAsset`: committed 3.3 s; instrument `13.3s still pending at afterAll`. Also: `console.info` in `afterAll` goes through the console interception (W7 log line 18: `stdout | tools/sim/src/zzAuditW7.stat.test.ts` precedes the watchdog line) — the file's comment says the interception "is off" (a1-03). What survived: `unref()` does not stop measurement (W7/W8); hooks run once per file (`withheld.stat` has 2 `describe`s and produced one `SUMMARY`); `expected = now + INTERVAL_MS` does not under-report a second block (W9).

**Impact.** The watchdog's acceptance criterion (`PH-21.1` §5.3, "no statistical file reports a worst block above the failure threshold") is satisfied by the failing tree; the number it prints for the guilty file is wrong by 7×.

**Recommended fix.** In `afterAll`, before `clearInterval`, fold in `Date.now() - expected` (the lag still pending) — one line, and it turns W1/W6/R1 from silent into reported. Better, replace lag with the quantity that fails the run: wrap `globalThis.__vitest_worker__.rpc` in a Proxy that records each request's round trip and the requests still unsettled at `afterAll` (`vitest.audit.setup.ts` in this audit's scratchpad is a working draft), and fail on a round trip ≥ 30 s. Write it to a file as well as the console.

### a1-03 — `disableConsoleIntercept: true` has never applied to either project; the CA6-02 remedy and the watchdog's comment are both inert

**Severity:** material.

**Where:** `vitest.config.ts:93` (root), project blocks `:109-140`; Vitest `cli-api.DVe0nWUx.js:7452-7466` (inline projects get `test: {...options.test, ...cliOverrides}`; the root config is inherited only with `extends: true`, `reporters.d.BuRON0I0.d.ts:2367-2369`).

**Claim.** `vitest.config.ts:80-92`: "Worker output goes straight to stdout instead of over the RPC channel … Removing the interception removes the traffic"; `vitest.setup.statistical.ts:81-83`: "the console interception that would have relayed it is off". Recorded as the fix for CA6-02.

**Evidence.** Resolved configuration (`createVitest` from `vitest/node`, script `resolved.mjs` run from the worktree root):

```
ROOT    {"maxWorkers":8,"fileParallelism":true,"pool":"forks","isolate":true,"disableConsoleIntercept":true,"reporters":["basic"],…}
PROJECT unit         {…,"disableConsoleIntercept":false,"reporters":["default"],"setupFiles":[],"testTimeout":20000,"hookTimeout":10000}
PROJECT statistical  {…,"disableConsoleIntercept":false,"setupFiles":[".../vitest.setup.statistical.ts"],"testTimeout":900000,"hookTimeout":900000}
```

Behaviour: `npx vitest run --project statistical packages/core/src/market/market.stat.test.ts` prints `stdout | packages/core/src/market/market.stat.test.ts > throughput > …` before `candle aggregation: …` — the interception header. The three CI logs carry the same `stdout |` headers (e.g. 33601281019 lines 486-490 region, 33607930939 08:26:46…). With the option moved inside the statistical project (`vitest.audit2.config.ts`, a copy): the header is gone, `EXIT=0`. `setupFiles`, `testTimeout`, `hookTimeout` inside the projects **are** honoured (dump above; CI tests of 225 s pass); `maxWorkers`/`reporters` at the root are honoured, and `--no-file-parallelism` resolves to `maxWorkers:1,minWorkers:1` for both projects.

**Impact.** Not the cause of the failure (events carry no timeout), but a recorded remedy that never ran, in the exact shape CA6-01 found in the opposite direction; the `basic` reporter also prints a deprecation banner on every run ("will be removed"; the replacement is `['default', { summary: false }]`).

**Recommended fix.** Put `disableConsoleIntercept: true` inside both project blocks (or `extends: true` on each project), replace `reporters: ['basic']` with `[['default', { summary: false }]]`, and add a test that asserts the resolved project config (`createVitest(...).projects[i].config`) — a docstring is not a guard.

### a1-04 — Unit `testTimeout` cannot bound the tests it was raised for; the two slowest unit tests are 25–31 s synchronous computations that pass a 20 s timeout

**Severity:** material.

**Where:** `vitest.config.ts:41-61` ("20s is roughly five times the slowest test"); `packages/engine/src/asset.test.ts:27-33`; `packages/engine/src/families.test.ts:284-290`; `@vitest/runner chunk-hooks.js:1856-1875` (`withTimeout` is a `setTimeout` race — it cannot interrupt synchronous code).

**Evidence.** `npx vitest run --project unit --reporter=verbose packages/engine/src/families.test.ts packages/engine/src/asset.test.ts packages/engine/src/registration.test.ts`: `asset.test.ts > pools tens of thousands of windows from one replicate 31355ms`, `families.test.ts > never draws a brief the solve cannot author 25008ms`, all 86 tests ✓, `Test Files 3 passed`, real 36.9 s (with sweep 2 running on one other core). Both bodies are synchronous (`calibrate(...)` / nested `for` over `ASSET_ARCHETYPES × 6` solves, no `await`).

**Impact.** The comment's headroom claim is false by ~8×; the timeout guards only asynchronous tests, and the slowest unit tests are the ones it cannot see. Relevant to B-030 (below).

**Recommended fix.** Move the two tests to the statistical project (the config's own rule: "a unit test that needs more than that is a statistical test in the wrong project"), and have `testCost.test.ts` or a JSON-reporter step assert a per-test ceiling from measured durations rather than a comment.

### a1-05 — The panel suite leaves a `next-server` and its shell orphaned for the rest of the CI job

**Severity:** material (a resource leak on a 2-core runner for ~40 minutes, and a wrong teardown).

**Where:** `apps/web/src/panel.stat.test.ts:100-107` (`spawn('npx', ['next','start',…])`), `:56-60` (`child.kill('SIGKILL')` on the `npx` process only).

**Evidence.** CI cleanup, both runs that include the panel suite: `Terminate orphan process: pid (3290) (sh)`, `pid (3291) (next-server (v15.5.24))` (33601281019, 07:35:59); `pid (3287) (sh)`, `pid (3288) (next-server (v15.5.24))` (33607930939, 09:02:07). The run without the panel suite (33587082478) has no `Terminate orphan` line. `npx` runs `next` through a shell; killing `npx` does not kill its process group.

**Impact.** A Next server keeps running (and holding its port) through the other 36 files on a two-core runner; locally the same leak survives every gate that runs with a browser.

**Recommended fix.** `spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', …], { detached: true })` and `process.kill(-child.pid, 'SIGKILL')` in `afterAll` (also for the engine child), or `npx --no-install next` with `detached` + group kill.

### a1-06 — `npm run gate` and `ci.yml` differ in five ways that matter for "a green gate is what verified means"

**Severity:** minor (each individually), material together.

**Where:** `package.json:26,30`; `.github/workflows/ci.yml:16-46, 48-96`.

**Evidence.** (1) CI's statistical job runs with `OTC_REQUIRE_BROWSER=1` and `npx playwright install --with-deps chromium`; the gate sets neither, so `panel.stat.test.ts` can skip silently in a local gate (`unavailable` path, `:54`). (2) CI sets `NODE_OPTIONS=--max-old-space-size=6144` for the statistical job; the gate does not — the same `phaseAcceptance` run uses whatever default heap the developer's Node picks. (3) CI runs the two jobs on two runners in parallel; the gate serially — `format:check`, `typecheck:web`, `typecheck:config` and `lint` never run on the machine that runs the statistical suite in CI (harmless today). (4) `npm ci` from the lockfile versus a developer's `npm install`. (5) `concurrency: cancel-in-progress: true` cancels a running statistical job on the next push, so a commit can have no CI result at all (`GOVERNANCE.md` §40.1 "never report CI as passing if it did not run"). Same in both: `--no-file-parallelism` via `npm run test:stat`; `npm run test:unit` with the config's 20 s timeout; build before lint; `.nvmrc` = 24 (local v24.19.0). `actions/setup-node` `cache: npm` caches the npm download cache only, not `node_modules` or `dist` — it cannot hide a clean-checkout failure.

**Recommended fix.** `"gate": "... OTC_REQUIRE_BROWSER=1 NODE_OPTIONS=--max-old-space-size=6144 npm run test:stat"` (or a `.env.gate` both read), and drop `cancel-in-progress` for `main`.

### a1-07 — The last three attributions were recorded as causes without a reproduction, and the failure reproduces with a ten-line file in 65 seconds

**Severity:** minor (process), recorded because §28.1 asks for findings about the audit's own weakness and this one is the project's.

**Where:** `vitest.config.ts:63-92` (CA6-01, CA6-02 narratives), commit `c736707`, `PH-21.1` §4.

**Evidence.** Each of the three narratives explains a different mechanism (oversubscription; console/reporter RPC traffic; `execFileSync`), each was followed by a red run, and none is consistent with the code: the timed-out call is a worker→main request whose _reply_ the worker cannot read; console logs are events without a timer; `--no-file-parallelism` had made oversubscription impossible before the last three runs. R1 (this report) reproduces the exact stack in one file.

**Recommended fix.** Record in `DECISION-LOG.md` that a cause for this failure is only accepted with a reproduction that produces the error and a change that makes the same reproduction pass.

### a1-08 — B-030: no shared-resource mechanism exists in the unit suite; the plausible mechanism is the 20 s timeout on asynchronous tests under a saturated box, and the gate still does not capture identities

**Severity:** minor (nothing reproduced; a mechanism candidate with evidence, and a fix for the record-keeping).

**Where:** `docs/BACKLOG.md:93-118`; `vitest.config.ts:41-61`; unit tests under `packages/runtime/src/*.test.ts`.

**Evidence.** Static: every temp path in the unit suite is `mkdtemp(path.join(tmpdir(), 'otc-…-'))` (five runtime files, all unique, all removed in `afterAll`/`afterEach`); no `listen(`, no fixed port, no `process.chdir`, no `process.env` mutation except `vi.stubEnv` in `apps/web/src/app/engine/engineProxy.test.ts:122,135` (scoped); **no unit file uses `beforeAll`** (so `hookTimeout` 10 s is not it; a failing `beforeAll` marks tests skipped, `chunk-hooks.js:1712`, not failed). Dynamic: the unit suite already contains synchronous tests of 25–31 s (a1-04), so its asynchronous tests of a few seconds are the ones that hit 20 s when the machine is ~5× oversubscribed; PH-20.1 — when B-030 occurred — introduced a suite that runs `next build` (all cores) and Chromium inside the statistical job. "12 busy loops on 16 cores" is ~1.3× contention, not 5×. The shared results cache (`node_modules/.vite/vitest/*/results.json`, written by every worktree that runs Vitest) currently flags `backfill.test.ts`, `dependencies.test.ts`, `limiter.test.ts`, `registry.test.ts` as failed and lists other auditors' throwaway files — it cannot be used as evidence, and it also drives the sequencer's file order.

**Recommended fix.** `"test:unit": "vitest run --project unit --reporter=default --reporter=json --outputFile=artifacts/unit-results.json"` so the next occurrence names its seven tests; run the unit project with `--no-file-parallelism` when the statistical suite is running on the same box; move the 25–31 s tests (a1-04).

## What survived (attacks that held, with the command)

- **ESLint reads `apps/web/src/**/*.tsx` with type-aware rules.** Planted `const unusedAuditVar = 42; return a == b;` in `apps/web/src/app/page.tsx`; `npx eslint apps/web/src/app/page.tsx` → `14:9 error … @typescript-eslint/no-unused-vars`, `15:12 error Expected '===' … eqeqeq`, `ESLINT_EXIT=1`; restored with `git checkout --`.
- **`no-restricted-properties` fires on `Math.random()` in the engine.** Appended `return Math.random()` to `packages/engine/src/engine.ts`; `npx eslint packages/engine/src/engine.ts` → `248:10 error 'Math.random' is restricted … no-restricted-properties`, `ESLINT_EXIT=1`; restored.
- **Every `.ts/.tsx/.mts/.cts` outside `node_modules/dist/.next` is in a typechecked program.** `find` → 264 files; every one matches `packages/*/src/**/*.ts`, `tools/sim/src/**/*.ts`, `apps/api/src/**/*.ts` (all in `tsc -b` via `tsconfig.json` references), `apps/web/src/**/*.ts(x)` + `apps/web/next-env.d.ts` (`typecheck:web`), or `vitest.config.ts`/`vitest.setup.statistical.ts` (`typecheck:config`); the exclusion filter printed nothing.
- **Coverage runs under `OTC_COVERAGE=1` and the globs match `apps/*/src/**/*.ts?(x)`.** `OTC_COVERAGE=1 npx vitest run --project unit --coverage packages/chart` → `EXIT=0`, `coverage/coverage-summary.json` with 124 entries, 15 under `apps/web` (12 `.tsx`), 7 under `apps/api`.
- **Project-level `setupFiles`, `testTimeout`, `hookTimeout` are honoured; root `maxWorkers`, `reporters` are honoured; `--no-file-parallelism` yields `maxWorkers:1`.** `createVitest` dump above; `setup 50-172ms` in every run.
- **The worker's stdout pipe does not block the loop.** `node pipe-parent.cjs` (child writes 10 MB to an unread pipe): `child: loop free after 3ms`, `timer fired at 204ms`, `parent: child still alive after 2s = true`.
- **No synchronous blocking call in any `*.stat.test.ts`** beyond small `readFileSync`/`writeFileSync` in `guardrailMetaAudit`, `publication`, `horizonCoverage`; no `execFileSync`/`spawnSync`/`execSync`/`Atomics.wait`/zlib sync; `node:sqlite` is used only inside the spawned service, not the worker.
- **The forks pool continues after a rejected file** (three-file shuffle, above) and reports the error once at the end — consistent with all three CI logs.
- **The CI timeline has no ≥ 60 s stall at any file boundary** (max overhead 4.0 s, before `assurance.stat`, in all three runs).

## Per-file measurements

Committed watchdog (sweep 1, one file at a time; local `elapsed` includes ~1.5 s start-up) versus CI 33607930939; and the instrument (sweep 2/3, `worst` includes the lag pending at `afterAll`; `max RTT` is the longest `onTaskUpdate` round trip observed):

| file                                                         | CI dur  | CI watchdog | local dur | local watchdog | instrument worst / max RTT / unsettled at afterAll    |
| ------------------------------------------------------------ | ------- | ----------- | --------- | -------------- | ----------------------------------------------------- |
| sampledCatalogue                                             | 549.2 s | 14.1 s      | 376 s     | 10.3 s         | **104.4 s (tail) / — / run FAILED with the CI error** |
| multiAsset                                                   | 160.1 s | 5.2 s       | 99 s      | 3.3 s          | 13.3 s (tail) / 5.3 s                                 |
| withheld                                                     | 21.4 s  | 20.4 s      | —         | —              | 29.4 s / 0.0 s                                        |
| redTeam                                                      | 35.7 s  | 8.0 s       | —         | —              | 8.5 s / 8.5 s                                         |
| dispersion                                                   | 197.5 s | 3.9 s       | 119 s     | 2.3 s          | PENDING                                               |
| lab/attacks/calibration                                      | 257.4 s | 2.1 s       | 165 s     | none           | PENDING                                               |
| detectionPower                                               | 230.7 s | 2.0 s       | 207 s     | none           | PENDING                                               |
| sim/calibration                                              | 99.0 s  | none        | 94 s      | none           | PENDING                                               |
| latticeTies                                                  | 71.5 s  | none        | 67 s      | none           | PENDING                                               |
| phaseAcceptance                                              | 114.8 s | 2.6 s       | 107 s     | 2.7 s          | PENDING                                               |
| catalogue                                                    | 63.4 s  | none        | 60 s      | none           | PENDING                                               |
| catalogueScale                                               | 261.1 s | 9.7 s       | 254 s     | 9.3 s          | PENDING                                               |
| clientReconstruction                                         | 92.0 s  | none        | 93 s      | none           | PENDING                                               |
| engineValidation / report / personality / the 20 short files | —       | ≤ 2.2 s     | —         | —              | PENDING                                               |

## Limits of this audit

- The CI runner could not be instrumented; the identification of the file rests on (i) the mechanism reproduced with throwaway files, (ii) the same failure reproduced on the real file locally under contention, (iii) the last test's CI duration exceeding 60 s in all three runs while every other measured candidate is far below, and (iv) the timeline excluding a boundary stall. A second file with a > 60 s macrotask-free tail on CI cannot be excluded until the pending rows above are filled (sweeps 2–4 were still running when this was written; the table is updated below if they finished in time).
- Local timings are upper bounds: sweep 2 overlapped my other experiments, and the machine hosts seven auditors.
- The unit suite was not run whole; B-030's mechanism is argued, not reproduced.
- `git status --short` in the worktree prints only the pre-existing `?? node_modules` symlink line (untracked because `.gitignore` matches `node_modules/` as a directory); every file I created was deleted and both planted sources were restored with `git checkout --`.

## Minor

- `vitest.config.ts` still says the statistical suite "prints heavily … and that traffic is what turns a busy box into a `Timeout calling`" — events have no timeout; the sentence should go with a1-03.
- `reporters: ['basic']` prints a deprecation banner on every invocation.
- `PH-21.1` §4 says the watchdog "fails the file above sixty, which is Vitest's own RPC timeout" — the two are unrelated quantities (lag versus round trip) and the watchdog did not fail R1.
- `CLAUDE.md` §5 should say _two_ `setImmediate`s (or `setTimeout(0)` followed by `setImmediate`) and "before any test's first 60 s", not "every few hundred thousand ticks" — R3 fails with the stated convention.
