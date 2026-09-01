# PH-11 — Coverage, measured over packages and tools

Type: RECORDED EVIDENCE
Produced by: `npm run test:cov` (both projects, `OTC_COVERAGE=1`)
Date: 2026-08-31

---

## Result

| Scope               | Statements | Branches | Functions |
| ------------------- | ---------- | -------- | --------- |
| **All files**       | **93.84%** | 93.68%   | 97.05%    |
| `packages/core/src` | 100%       | 100%     | 100%      |
| `packages/lab/src`  | 96.89%     | 93.06%   | 95.16%    |
| `tools/sim/src`     | 56.55%     | 93.54%   | 92.85%    |

1152 tests across 75 files, both projects, exit 0.

## What B-003 actually was

The item read: _"`vitest.config.ts` includes only `packages/*/src`. `tools/sim`
carries the simulation runner and the phase acceptance suites; its coverage is
unmeasured."_

Excluding the code that **generates** every number this project cites from the
measurement of that project's quality is the wrong way round, so `tools/*` was
added to `coverage.include`.

That exposed a second layer: **`npm run test:cov` did not complete.** Two tests
failed, neither of them a defect — v8 instrumentation rewrites every function, so
a test that takes one second exceeded a five-second timeout, and a throughput
assertion measured 183,265/s against a 200,000 floor, which is measuring the
instrument rather than the engine. Coverage was still effectively unmeasured
after the include was fixed.

Both are now coverage-aware: `OTC_COVERAGE=1` raises the unit timeout and stands
down the one throughput floor that instrumentation invalidates. The work still
runs — the point under coverage is to exercise the path, not to judge its speed.

## The `tools/sim` figure is honest, not flattering

`cli.ts` and `horizonEvidence.ts` read **0%**. They are entry points that no test
drives, and they were deliberately **not** excluded from the measurement: a
script no test runs should read as uncovered, because it is.

Both were smoke-tested by hand rather than assumed working — `--help`, `--list`
and a 20,000-tick edge run all exit 0 with sensible output, and
`horizonEvidence.ts` produced
[`PH-11-HORIZON-COVERAGE.md`](PH-11-HORIZON-COVERAGE.md) end to end. The 0% means
"never exercised by a test", not "broken", and the distinction is recorded rather
than papered over by an exclude rule.

## What the measurement found on the way

Measuring coverage turned out to be a **detector for event-loop starvation**,
which was not its purpose. Instrumentation slows everything five to ten times, so
a synchronous block that always survived at 3 seconds fails at 30.

That surfaced the third recurrence of B-005's class: `withheld.stat.test.ts`
called the synchronous `runBattery` where `runBatteryAsync` already existed, and
the cross-asset case ran **627 seconds** of uninterrupted CPU. `edge.ts`'s
directional estimator had the same shape and now has a generator core.

B-010 had concluded no static guard could catch this class. That was right about
loops and wrong about **entry points**: every recurrence went through a function
whose yielding twin existed and sat two characters away in the import list.
`testCost.test.ts` now enforces it, and the escape hatch is an alias —
`calibrateAsset as calibrateAssetSync` — so a test that genuinely means the
synchronous variant says so at the call site.
