# Cycle 1 verification evidence

Recorded evidence for [Cycle Audit 001](../audits/CYCLE-AUDIT-001.md), executed
after every finding in that audit had been resolved.

This file exists because `CLAUDE.md` promised `docs/evidence/` and the directory
did not exist (F-09). Evidence referenced by an approval should be readable
without re-running a thirteen-minute suite.

## How to reproduce

```bash
npm run format:check
npm run lint
npm run build
npm run test:cov      # both projects, with coverage
```

Coverage measures `packages/*/src` only; `tools/*` is excluded by
`vitest.config.ts` (tracked as B-003). Results below were produced by running
coverage over **both** the `unit` and `statistical` projects — measuring `unit`
alone understates files exercised only by statistical tests, which is what made
`report.ts` read 0% during the audit (F-08).

## Results

Executed 2026-08-31 against the post-fix state of Cycle Audit 001.

| Check                  | Result                                     |
| ---------------------- | ------------------------------------------ |
| `npm run format:check` | PASSED                                     |
| `npm run lint`         | PASSED (ESLint 9, type-aware)              |
| `npm run build`        | PASSED (`tsc -b`, full typecheck)          |
| `npm run test:cov`     | **PASSED — 713 tests, 44 files, 0 failed** |
| Wall clock             | 509 s                                      |

| Coverage (both projects) | %      |
| ------------------------ | ------ |
| Statements               | 98.04% |
| Branches                 | 96.04% |
| Functions                | 98.59% |
| Lines                    | 98.04% |

Per package, by statements: `fixtures` 100%, `core` 99.70%, `lab` 97.11%,
`engine` 96.68%.

### Two numbers worth keeping

`report.ts` measures **100%**. Under the unit-only measurement used throughout
Cycle 1 it read **0%**, because every test that exercises it is a statistical
test. Nothing about the file changed; only how it was measured did. That is F-08.

`modulator.ts` moved from **62.85% to 82.85%**, with function coverage at 100%.
The gap was `ModulatedMagnitudeModel.restore()` — the composed snapshot/restore
path the hosted runtime will call on every deploy, which no test had ever
executed. That is F-06.

### Lowest-covered files

`arrival.ts` 81.81%, `horizons.ts` 82.60%, `modulator.ts` 82.85%. The residue in
each is defensive branches on states the engine's own validation makes
unreachable — rejected configurations that `RangeError` out earlier. Recorded
here so the next audit can check that claim rather than inherit it.

## What the statistical suite establishes

The slow project is not a redundant copy of the unit suite. It carries the
evidence that cannot be produced quickly:

- **Mirror test on the canonical engine** — the sign stream is negated from a
  randomised interior snapshot; every latent variable must be bit-identical and
  every increment exactly negated. This is the operational check on the theorem.
- **Planted-edge calibration** — the battery must find every defect in the
  fixture corpus and must clear the symmetric control. A battery that has never
  caught a known edge is not evidence of anything.
- **Phase acceptance** — the canonical engine is attacked at a resolution finer
  than the 0.2513pp materiality threshold implied by a 99% payout.
- **Realism metrics** — fifteen stylised facts, each with a stated target band.
