# PH-4.3 — Multi-asset validation and the differentiation metric

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-4.3
Parent phase: PH-4 — Asset Personality System and Multi-Asset Instantiation
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Establish, per asset and not per family, that every registered asset is
unexploitable and plausible — and that the assets are **measurably** different
markets rather than one market relabelled. Only then may INV-007 be promoted.

## 2. Problem

INV-007 is the invariant most easily faked. PH-4.2 produced five assets whose
parameters differ on paper, and a table of different numbers is not evidence that
anything differs. A metric is needed whose null hypothesis is reachable: if the
personalities were secretly identical, it must say so.

The second problem is cost. PH-3 policed one asset at a 0.217pp detection floor —
finer than the 0.2513pp the promotional payout implies — and that took 24 million
ticks. The floor is set by the number of 30-second contracts, so matching it for
`btcusd` at a 334ms pace would need roughly 85 million ticks, about a gigabyte of
typed arrays before the feature frame. Five assets at PH-3 rigor is not a suite
anyone will run.

## 3. Layered acceptance

Stated for what each layer is, rather than blurred into one claim:

1. **The mirror test, per asset.** Exact, cheap, structural. Negate the sign
   stream from a randomised interior point; every latent variable must be
   bit-identical and every increment exactly negated. This is the real guarantee.
   No statistical battery can replace it and no amount of simulation strengthens
   it.
2. **The battery, per asset, over an equal simulated span.** 46 days each,
   confirming that no _particular personality_ breaks the structural argument.
   The floor is coarser than the payout threshold and is reported as such.

   Budgeting by ticks was the first attempt and produced incomparable evidence:
   three million ticks is 46 days of `eurusd` but only 12 days of `btcusd`, whose
   floor came out at **1.13pp** against `eurusd`'s **0.57pp**. The floor is set by
   the number of 30-second contracts, which is a property of wall-clock span, so
   span is what must be held equal. Holding it equal costs 23.9M ticks across the
   five assets — `btcusd` alone needs 12.2M to reach the same 46 days.

3. **PH-3's full-rigor run**, already recorded, below the payout threshold on the
   canonical configuration.

All five assets run identical code and differ only in parameters, so a break in
the structural argument would be a break in shared code and would surface on any
of them.

## 4. The differentiation metric

Leave-one-out nearest-centroid classification of windows to assets. The null is
explicit and reachable: if every asset were the same market, accuracy could not
beat `1 / assets` = 20%.

Windows are described by a signature of nine features: pace and scale, plus seven
shape statistics — return kurtosis, absolute-return autocorrelation at three
lags, tail ratio, arrival dispersion, and a variance ratio. Features are
standardised across the pooled sample so none dominates by its units, and the
held-out window is excluded from its own asset's centroid so nothing is ever
classified partly by itself.

### What was measured

As recorded by `multiAsset.stat.test.ts`, 40 windows per asset, chance = 20%:

| Signature         | Real catalogue         | Identical-personality control |
| ----------------- | ---------------------- | ----------------------------- |
| Full (9 features) | **53.0%**, p = 5.1e-25 | 21.0%, p = 0.39               |
| Shape only (7)    | 30.0%, p = 5.0e-4      | —                             |

The control landing on chance is what makes the 53.0% mean something.

### The finding: separation is mostly pace and scale

This is the result the subphase existed to discover, and it is not the flattering
one.

Dividing out pace and amplitude leaves a real but weak signal: 30.0% against a
20% null is significant (p = 5.0e-4), so the assets are not _identical_ in shape
— but it is a long way from the 53.0% the full signature reaches, and far from
the near-perfect separation a genuinely distinct set of market shapes would give.

Three separate levers were tried before accepting that:

| Lever attempted                            | Between/within variance ratio |
| ------------------------------------------ | ----------------------------- |
| Existing trait spread, 2 000-tick windows  | ≤ 0.17 on every feature       |
| Existing trait spread, 20 000-tick windows | ≤ 0.21, except arrival 0.78   |
| Regime and structure timings, 10x range    | ≤ 0.13                        |
| Cascade memory span, 40x range             | ≤ 0.32, and not monotone      |

The explanation is structural: **observable volatility dynamics are dominated by
the MSM cascade**, which spans six hours down to seconds and is identical across
every asset. The regime and structure layers contribute far less to what a
scale-free statistic can see, so moving their parameters moves the signature
very little.

Two honest consequences:

- The claim recorded for INV-007 is that assets are **strongly distinguishable**
  from their published series (53.0% against a 20% null, p = 5.1e-25), driven
  mostly by pace and scale. Those are genuine market properties, not cosmetic
  ones: a trader experiences a 334 ms market at ten times the volatility as a
  different market, not a relabelled one.
- The shape-only number is recorded as a **ceiling** in the test, so a future
  change that genuinely improves structural differentiation will fail it and
  force the claim to be rewritten rather than silently overstated.

Making assets differ in rhythm as well as in size means personalising the
cascade — component count and hazard ratio — which interacts directly with the
kurtosis gate, since the cascade's contribution is raised to the power of its
component count. That is a phase's worth of work, not a subphase's, and it is
recorded in the backlog rather than half-done here.

### A defect the metric found in the catalogue

Measured during development, `gbpjpy` and `xauusd` classified at 9/40 each: they
sat at 1310 ms / 1.8e-5 and 1401 ms / 2.4e-5, which is the same market twice. The
catalogue was respread across the pace and scale plane, and both recovered. The
metric earned its place by failing the product it was measuring, before anyone
had to notice by eye.

## 5. Acceptance criteria

1. Every registered asset passes the mirror test with zero divergences.
2. Every registered asset is clean under the battery and plausible under the
   realism battery, at a reported floor.
3. Differentiation on the real catalogue beats chance with p < 1e-10.
4. Differentiation on an identical-personality control does **not** beat chance.
5. INV-007 is promoted in `INVARIANTS.md`, and `traceability.test.ts` agrees.

## 6. Approval record

**APPROVED** from executed evidence, 2026-08-31.

### Verification executed

Per-asset acceptance, equal 46-day spans, 23.9M ticks total:

| Asset  | Span    | Realism | Detection floor | Ticks      | Verdict    |
| ------ | ------- | ------- | --------------- | ---------- | ---------- |
| eurusd | 48 days | 15/15   | 0.562pp         | 3,129,988  | ACCEPTABLE |
| gbpjpy | 48 days | 15/15   | 0.563pp         | 5,331,270  | ACCEPTABLE |
| btcusd | 48 days | 15/15   | 0.562pp         | 12,146,389 | ACCEPTABLE |
| spx    | 47 days | 15/15   | 0.565pp         | 1,271,920  | ACCEPTABLE |
| xauusd | 48 days | 15/15   | 0.569pp         | 2,032,955  | ACCEPTABLE |

Every asset clean under the battery, plausible on all fifteen realism metrics,
and passing the mirror test with **zero divergences**. Floors agree to within
0.007pp, which is what equalising the span was for.

| Check                     | Result                  |
| ------------------------- | ----------------------- |
| `npm run format:check`    | PASSED                  |
| `npm run lint`            | PASSED                  |
| `npm run build`           | PASSED                  |
| `multiAsset.stat.test.ts` | PASSED — 12 tests, 145s |
| `differentiation.test.ts` | PASSED — 7 tests        |

### What the floors mean, stated plainly

0.562pp is **coarser** than the 0.2513pp the promotional payout implies. These
runs do not prove any individual asset unexploitable at the product margin; PH-3
did that for the canonical configuration at 0.217pp, and the mirror test proves
the structural property exactly for each asset here.

What five per-asset runs at a common floor add is that no _particular
personality_ breaks the argument — which is the question PH-4 raised and the one
a family-level run could not answer.

### Known limitations carried forward

- Scale-free shape differentiation is weak (30.0% against a 20% null). Tracked as
  B-004; personalising the volatility cascade is the fix, and it interacts with
  the kurtosis gate.
- Per-asset battery floors sit above the payout threshold. Closing that for every
  asset costs roughly five times PH-3's 24M-tick run, and `btcusd` alone would
  need about 85M ticks with the memory that implies.
