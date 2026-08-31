# Architecture — Overview

Type: SUPPORTING DOCUMENTATION (living)
Describes: the system as it exists today

> This document tracks reality. Layers that do not appear here do not exist yet.

---

## Layering

```
        apps/web        Next.js client                     (not yet built)
            │  transport contracts only
        apps/api        NestJS runtime, streaming,          (not yet built)
            │           trading, settlement, persistence
            ▼
      @otc/engine       generative market model             (PH-3)
            │
            ▼
       @otc/core        deterministic substrate             (PH-1, APPROVED)
                        ├── time/       instants, clocks, timeframes      ✅
                        ├── entropy/    keyring, streams, cursor lease    ✅
                        ├── math/       portable exp / ln / pow           ✅
                        ├── random/     distribution samplers             ✅
                        ├── market/     log lattice, ticks, candles,      ✅
                        │               snapshot and replay
                        └── guardrails/ architecture tests                ✅

    @otc/fixtures       planted-edge corpus + control       ✅
       @otc/lab         predictability and realism batteries ✅ (PH-2, APPROVED)
       tools/sim        simulation runner and edge estimator ✅
```

## The dependency rule

Information flows **outward from the price core**. `@otc/core` depends on
nothing; `@otc/engine` depends only on `@otc/core`; everything that knows about
trading depends on them and never the reverse.

This is INV-001 — economic blindness — expressed as a build-time property. It is
structurally impossible for the engine to import a position, a payout or an
exposure figure, because the packages defining those concepts sit _above_ it in
the graph. Review vigilance is not the enforcement mechanism; the graph is.

## Guardrails

Several invariants are properties that code either has or silently loses. A
single `Math.random()`, `Date.now()` or `Math.exp()` violates one, and none of
those lines look wrong in review. `packages/core/src/guardrails/` turns each into
a build failure, enforced two ways:

| Guardrail                                                              | Protects                                 |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| no ambient time outside `SystemClock`                                  | replay (INV-009)                         |
| no ambient randomness                                                  | replay, isolation (INV-009, INV-010)     |
| no implementation-approximated maths (`Math.exp`, `Math.log`, `**`, …) | cross-platform reproducibility (INV-009) |
| no economic vocabulary in generation code                              | economic blindness (INV-001)             |
| dependency direction                                                   | economic blindness (INV-001)             |

ESLint reports them in the editor; the guardrail test suite is the authority and
runs in CI. Both were verified by planting a deliberate violation and observing
five distinct failures, then removing it and observing green.

## Determinism model

Every source of nondeterminism is injected rather than ambient:

| Source                         | Injected as                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| randomness                     | `RandomStream`, derived from a `MasterKeyring` and addressed by cursor |
| time                           | `Clock`                                                                |
| floating-point transcendentals | kernel-owned portable functions (PH-1.2)                               |

The consequence is that a market's entire future is a pure function of
`(master secret, stream labels, cursors, model state, clock)`. That is what makes
snapshot, replay, audit and statistical validation possible at all.

## Testing model

| Suite         | Command                                | Character                                      |
| ------------- | -------------------------------------- | ---------------------------------------------- |
| `unit`        | `npx vitest run --project unit`        | milliseconds; runs on every change             |
| `statistical` | `npx vitest run --project statistical` | seeded simulations and distributional evidence |

Statistical tests are **deterministically seeded** and use published critical
values rather than thresholds fitted to observed output. A randomly failing
statistical test is indistinguishable from a real integrity regression, and a
gate the team learns to re-run is not a gate.

## The price representation

The canonical price is an **integer count of log units** (ADR-0004). The integer
the generator accumulates is the one published and the one that settles;
rendering a decimal price is a client concern that never reaches a comparison.

This is not a formatting preference. Publishing a rounded price re-introduces a
directional edge of up to 22 percentage points at the 30-second horizon, because
symmetry holds about the _unrounded_ value and rounding a signed price is
asymmetric about it. Accumulating in log space also makes proportional volatility
automatic, so the generator never has to consult the price level — and the price
level is a sign-dependent quantity, so consulting it would break the symmetry
guarantee of ADR-0003.

## Calibration corpus

`@otc/fixtures` holds a symmetric control and six generators each carrying one
deliberate directional defect. It exists because an attack battery reporting "no
edge found" is worthless until it has been shown capable of reporting the
opposite.

Its calibration produced the result that shapes PH-2: **three of the six defects
are invisible to an unconditional estimator**, and level-anchored defects need
roughly three times the history of the others to reach the same significance.
