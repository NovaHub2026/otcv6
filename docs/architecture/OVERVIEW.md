# Architecture — Overview

Type: SUPPORTING DOCUMENTATION (living)
Describes: the system as it exists today

> This document tracks reality. Layers that do not appear here do not exist yet.

---

## Layering

```
        apps/web        Next.js observer frontend            ✅ (PH-8, APPROVED)
            │           depends on @otc/chart + @otc/core only
        apps/api        NestJS venue: hosting, streaming,    ✅ (PH-5, APPROVED)
            │           persistence, publication
            ├──────────▶ @otc/lab, in the Lab composition    ✅ (PH-23, PH-24)
            │            only: /lab/* and a selectable sign
            │            source, never in production (ADR-0018)
            ▼
   @otc/distribution    sequence-addressed tick feed         ✅ (PH-7, APPROVED)
            │           + Merkle commitments, Ed25519        ✅ (PH-12, APPROVED)
            │             signing, journal publication
      @otc/runtime      hosted markets, scheduling,          ✅ (PH-5, APPROVED)
            │           sealed state, restart continuity
      @otc/trading      contracts and deterministic          ✅ (PH-6, APPROVED)
            │           settlement against the record
       @otc/chart       extreme-preserving reduction         ✅ (PH-8, APPROVED)
            │           to columns; the rendering contract
            ▼
      @otc/engine       generative market model              ✅ (PH-3, APPROVED)
            │           + per-asset personality and rhythm   ✅ (PH-4, PH-10)
            ▼
       @otc/core        deterministic substrate              ✅ (PH-1, APPROVED)
                        ├── time/       instants, clocks, timeframes      ✅
                        ├── entropy/    keyring, streams, cursor lease    ✅
                        ├── math/       portable exp / ln / pow           ✅
                        ├── random/     distribution samplers             ✅
                        ├── market/     log lattice, ticks, candles,      ✅
                        │               snapshot and replay
                        └── guardrails/ architecture tests                ✅

    @otc/fixtures       planted-edge corpus + control        ✅
       @otc/lab         predictability and realism batteries ✅ (PH-2, APPROVED)
                        served to the operator by apps/api   ✅ (PH-23, APPROVED)
       tools/sim        simulation runner, evidence          ✅
                        generators, phase acceptance
```

**This diagram is enforced, not merely drawn.** `dependencies.test.ts` derives
the graph from the workspace manifests and fails on an edge that is not declared
policy. Cycle Audit 4 found it enumerating `packages/` and `tools/` only, so
`apps/` was outside it entirely; that is fixed, and `@otc/web` now has a declared
policy of exactly `@otc/core` and `@otc/chart`.

**And it had gone stale.** The same audit found this document listing five of
nine workspaces — `runtime`, `trading`, `distribution` and `chart` were absent,
under a header stating that layers not appearing here do not exist. Four approved
phases were invisible to a reader following the document's own rule.

Cycle Audit 8 found the same absence a cycle later, and the two sections below
close it: the OTC Market Lab and the multiplexed stream — a phase and a half of
approved work — appeared nowhere here, under that same header.

## The OTC Market Lab, and the boundary that keeps it out of production

A deployment runs **one** engine process, composed one of two ways (ADR-0018).
The production composition is the venue alone: no `/lab` routes, no selectable
sign source. The Lab composition is the same whole engine in simulation mode —
every engine route, plus `/lab/*`, plus a sign source an operator can steer on
every hosted market — and it says so on its process banner, in every `/lab`
response and on every panel screen pointed at it. The panel reaches it through a
proxy and never bundles it: `@otc/web` may depend on `@otc/core` and
`@otc/chart` and nothing else, so the battery and the planted-defect corpus stay
on the server.

**Production is never Lab-composed, and the boundary is composition rather than
configuration** (ADR-0015 §3). A real deployment cannot acquire a push button
from a flag, because the route and the sign source are not in its program. Two
architecture tests are that boundary, not a review habit:
[`composition.test.ts`](../../apps/api/src/composition.test.ts) reads the
production entrypoint as text and fails if it registers — or so much as names —
a sign source, and
[`labSurface.test.ts`](../../apps/api/src/labSurface.test.ts) fails if any
production file imports the Lab or can serve latent generator state or a
keystream cursor (INV-010). Both were got past in Cycle Audit 8 — a steering sign source composed
from a subdirectory the scan did not recurse into, and a cursor served under a
word the scan did not look for — and both were widened in response. When the Lab
grows, that is the layer to strengthen.

**The record has the same boundary, and it did not until that audit.** A
Lab-composed process marks its state directory before it publishes a tick
(`lab/composed-by-lab.json`, [`labState.ts`](../../apps/api/src/labState.ts)) and
production refuses to start on a marked one. Without it, one environment
variable pointed both compositions at one directory, and a redeploy served a
market whose prices a human had chosen among futures as production history —
economically blind no longer (INV-001), and not reproducible as production's
(INV-009).

## One connection, several assets

`GET /markets/stream?assets=eurusd,btcusd` (PH-22.2) carries several assets over
one SSE connection — up to `MAX_MULTIPLEXED_ASSETS` of them — because a browser
allows six connections per origin and this product puts eight charts on a
screen. The resume position is **per asset** everywhere it appears —
`from=eurusd:481775,btcusd:9912`, the `id:` field, and the `gap` event, which
names the asset it concerns — so one number never stands for eight and one
asset's eviction does not tear down the other seven. The single-asset endpoint
is unchanged; this is an addition, and
[`CONSISTENCY_CONTRACT.md`](CONSISTENCY_CONTRACT.md) is what both must satisfy.

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
a build failure over `packages/*/src`, `apps/api/src` and `tools/sim/src` — the
lexer every scan shares is tested against every construct that has ever hidden
code from it (`sourceScan.test.ts`, out-of-band audit a2-01) — enforced two
ways:

| Guardrail                                                                                             | Protects                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| no ambient time outside `SystemClock`                                                                 | replay (INV-009)                                |
| no ambient randomness                                                                                 | replay, isolation (INV-009, INV-010)            |
| no implementation-approximated maths (`Math.exp`, `Math.log`, `**`, …)                                | cross-platform reproducibility (INV-009)        |
| no economic vocabulary in generation code                                                             | economic blindness (INV-001)                    |
| dependency direction                                                                                  | economic blindness (INV-001)                    |
| no computed access to, dynamic evaluation of, or aliasing of a global; no mutable module-level export | replay, economic blindness (INV-001, INV-009)   |
| a follower cannot reach the engine, key material or an evaluator                                      | shared market, private state (INV-002, INV-010) |
| the signing path cannot derive the market, transitively                                               | private state (INV-010)                         |
| every module is reachable through barrels or declared internal                                        | surface completeness                            |

ESLint reports them in the editor; the guardrail test suite is the authority and
runs in CI. ESLint's market-model rules cover `packages/*/src` only; under
`apps/api` and `tools/sim` the guardrail suite is the only layer (a2-04). Both were verified by planting a deliberate violation and observing
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

## The market model

`@otc/engine` produces the market. Its shape is one line — a sign-blind magnitude
quantised to the lattice, multiplied by an independent fair coin — with five
layers behind it producing that magnitude: a multifractal volatility cascade,
volatility regimes, structure phases, duration coupling and self-exciting
arrivals. See [`MARKET_MODEL.md`](MARKET_MODEL.md).

The **mirror test** is the primary structural gate. Negating the sign source must
leave every latent variable bit-identical and negate every increment exactly; any
mechanism that reads a sign, a price, or anything derived from them fails it in
milliseconds. PH-2 measured why a statistical battery cannot replace it: a
conventional attack battery returns _clean_ on an engine whose volatility is
keyed to the price level.
