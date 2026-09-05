# PH-26 — The Catalogue Of Thirty

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-26
Status: APPROVED
Cycle: 9 (phase 1 of 3)
Created: 2026-09-04
Approved: 2026-09-05
Branch: `feature/ph-26-catalogue-of-thirty`

---

## 1. What is actually unknown

The Human Owner asked for a library of thirty predefined OTC assets, ready to
integrate into a broker, and for the five hand-authored assets to be replaced by
it. Three of those decisions are theirs and are recorded as given: equities are
declared in the existing `etf` family rather than a new one, no archetype is
added, and the five incumbents go away.

What is not known is whether **the project's own verification survives a
catalogue six times larger**, and that is the phase.

The number is not a guess. Sixteen statistical files reference `ASSET_CATALOGUE`;
nine of them do work per asset, and at five assets they generate **188.7 million
simulated ticks**, of which **97.5% sits in three tests**:

| Test                       | Work per asset                                      | Ticks at 5 |
| -------------------------- | --------------------------------------------------- | ---------- |
| `multiAsset.stat.test.ts`  | 46 simulated days **plus a full battery** per asset | 78.3 M     |
| `latticeTies.stat.test.ts` | 12 replicates × 8,000 horizons × 30 s               | 55.7 M     |
| `catalogue.stat.test.ts`   | `calibrateAssetAsync` at 10 days × 3 replicates     | 50.1 M     |

At thirty that is roughly **1.13 billion ticks** — six to seven hours of
single-core wall clock locally, and the statistical suite runs serially by
design, so a bigger machine does not help. Hosted CI measures about 1.5× local
against a **180-minute job ceiling** that was already raised once this cycle.
The suite as written does not fit, and a gate that cannot be executed is not a
gate (`GOVERNANCE.md` §68).

Three smaller facts have to be closed before the first asset compiles:

- **Six per-asset-id tables are indexed with non-null assertions** under
  `it.each` over `ASSET_CATALOGUE` — `MEASURED_LATTICE_TIE_RATES`, `GRAIN`,
  `PH4_TICK_RMS`, `PH4_MEAN_INTERVAL_MS`, `GRAIN_FACTOR`, `PH4_EXCESS_KURTOSIS`,
  `REALISM_WINDOW_SECONDS`, `PH4_CARRIED`. Replacing the five assets does not
  slow these down; it makes them **throw**.
- **Two differentiation thresholds are absolute and tied to N = 5**
  (`multiAsset.stat.test.ts` — `shape.accuracy > 0.32`, `rhythmOnly.accuracy >
0.35`). Classifier chance falls from 1/5 to 1/30; the thresholds have to become
  multiples of chance, or paired lifts over the identical-personality control.
- **`horizonCoverage.stat.test.ts` asserts recorded rows == assets × 8** against
  `docs/evidence/PH-11-HORIZON-COVERAGE.md`. Thirty assets needs **240 recorded
  rows** before the gate can pass at all.

## 2. Why this phase, and why now

Because the Human Owner asked for it, and because the alternative order is worse.
PH-25 — the battery against a production venue's own record — is the other phase
on Cycle 9's table, and its subject is the feed a real observer reads. Running it
against a catalogue that is about to be replaced measures a market that will not
ship. PH-26 first makes PH-25's subject the real one.

## 3. What this phase may not do

- **It may not add an asset family or an archetype.** Both are the Human Owner's
  explicit decision. Equities are `etf`; the thirty are allocated across the eight
  archetypes that exist.
- **It may not weaken INV-007.** Thirty assets on eight archetypes puts up to
  eleven assets in one family; every pair must still clear the differentiation
  check, and the check must still be a measurement rather than a proximity
  argument (Issue #21 is exactly that complaint at a hundred assets).
- **It may not sample silently.** If a suite measures a subset, the record says
  which assets were measured and which were not — a sampled tie rate means the
  unsampled assets ship with an unverified settlement refund rate.
- **It may not fabricate calibration evidence.** Every recorded number is
  produced by a run, not by an author.

## 4. Phase invariants

INV-007 (asset differentiation) is the invariant this phase is about. INV-002,
INV-003, INV-008 and INV-009 are untouched by construction — the catalogue is
data — and INV-001 and INV-006 are structural and cannot be reached from here.

## 5. Subphases

| Subphase | Title                                                                     |
| -------- | ------------------------------------------------------------------------- |
| PH-26.1  | The suites scale: stratified sampling, id-keyed tables, N-free thresholds |
| PH-26.2  | The thirty personalities: drawn under seed, filtered by profile           |
| PH-26.3  | The catalogue compiled and calibrated, with its evidence recorded         |
| PH-26.4  | The integration library: the thirty as something a broker can consume     |

## 6. The design decision this phase rests on

**The personalities are drawn, not typed.** `sampleArchetype(archetype, stream)`
produces a legal personality from an archetype's declared ranges, and
`sampledCatalogue.stat.test.ts` already draws twenty-four that way. Thirty
hand-typed trait vectors would be thirty chances to author something a
feasibility guard refuses after a multi-million-tick calibration.

But a pure draw has no character: thirty draws from eight boxes give thirty
legal strangers, and the Human Owner asked for Tesla not to feel like Microsoft.
So each asset gets a **seat** — a narrowing of its archetype's ranges, recorded
beside the asset, from which its personality is drawn under a stream seeded by
its own id. NVIDIA sits at the fast edge of `sector-etf` with burstiness at the
ceiling; Petrobras at the memory floor on both the excitation and the cascade
axis; MMX in the fast third of `alt-crypto` with the widest budget in the
catalogue. The seed makes it reproducible, the archetype makes it legal, the
seat makes it itself.

**A seat is checked exactly as an archetype is, and this is the part that is easy
to get wrong.** A narrowed box passed to the sampler is an `AssetArchetype` value
that never enters `ASSET_ARCHETYPES` — so it is invisible to
`assertArchetypeFeasible`, which iterates that array. Worse,
`assertArchetypeFeasible` is not called at registration at all: its only caller in
the repository is `families.test.ts`, despite its own docstring saying otherwise.
A seat would therefore be the one region of trait space nothing ever checks.

PH-26.2 closes that before it opens it: every seat is run through
`assertArchetypeFeasible` in a unit test the same way the eight archetypes are,
and the test is watched failing against a seat planted outside its parent's box.
A seat is a documented narrowing, never a ninth archetype — nothing is added to
`ASSET_ARCHETYPES`, and the Human Owner's decision holds.

**Where a seat leaves its archetype's band, it says so.** The eight equity seats
carry dispersion budgets of 0.105 to 0.32 against `sector-etf`'s declared
0.035–0.07, and nothing in the pipeline clamps a supplied budget. That is a real
departure — Apple is not a sector ETF — and it is recorded next to the number
rather than presented as conformance.

## 7. Reference prices

Measured, not invented: the **August 2026 monthly average** of each instrument,
which is what the Human Owner asked for. Sources are dated and recorded per asset
in PH-26.3's evidence — X-Rates and the ECB's daily reference rates for the eight
currency pairs, `stockanalysis.com` daily closes for the eight equities,
CoinCodex and dated reporting for the six crypto pairs. The eight invented
thematic indices have no true price and all begin at **1,000 USDT**, because a
common base makes a percentage legible at a glance.

The reference price is only the origin of the log lattice; it is not a quote and
the market tracks nothing. Two consequences are recorded rather than hidden:

- **August's mean sits below the market of 2026-09-04** for the currency pairs —
  AUD/USD averaged 0.7098 and trades 0.7205, 1.5% apart. The Human Owner chose the
  monthly mean; this says so.
- **DOGE at 0.078 is the fragile case.** `displayPrecisionFor` evaluates the step
  only at the reference price, while the displayed step scales with the live
  price, so a long enough fall makes one lattice step invisible on screen — a
  contract that paid would show an unchanged price. PH-26.3 measures the margin
  and records the price at which it runs out.

## 8. What is deliberately not decided here

`displayPrecision` is **not supplied** for any of the thirty. A precision coarser
than the lattice's own is refused at stage `calibration` — after the simulation
that produced the quantum — so supplying one buys nothing and costs a re-run. The
lattice answers, and the answer is recorded.

## 9. Integrated phase verification (2026-09-05)

Full `npm run gate` on `feature/ph-26-catalogue-of-thirty` with all four
subphases in, third attempt, `OTC_REQUIRE_BROWSER=1`, zero skipped:

```
format:check     0
build            0
typecheck:web    0
typecheck:config 0
lint             0
unit         136 files, 2,935 tests           39.4s
coverage     136 files, 2,935 tests          120.0s   floors held; tools/sim 37.8%
statistical   43 files,   393 tests        4,158.8s
GATE COMPLETE: unit, coverage floors and statistical suites all ran, with a real browser
GATE_EXIT=0
```

**Sixty-nine minutes for the statistical suite at thirty assets, against
seventy-two at five.** That is the number PH-26.1 was for.

The first two attempts failed, and both failures were the phase's own:

1. **Coverage.** PH-26.3's two evidence runners — `buildCatalogue.ts` and
   `tieRateEvidence.ts`, deliberate acts with no unit coverage by nature —
   dropped `tools/sim` from 35.7% to 29.5% against a 33% floor. The floor is a
   ratchet and lowering it is a decision; the honest answer was that the
   builder's emitter deserved a test anyway, being what writes thirty markets'
   numbers into source. Its pure half is `catalogueBuild.ts` now, tested by
   fifteen cases and four plants — two of which survived the first version of
   the guard, one because the fixture made two lattices equal that must be
   allowed to differ, one because it compared keyrings by their labels rather
   than by what they produce. Coverage rose to 37.8% and the floor to 35.
2. **A type error in that new test**, which `vitest` transpiles past and
   `tsc -b` refuses — the second gate step, minutes in. Recorded in the
   session's memory rather than in the repository, because it is about how the
   agent works.

The catalogue served after the gate: `GET /catalogue` on the local engine
reports thirty-one assets live — the thirty compiled, and one an operator had
registered through the panel in an earlier session, which survived in the state
directory as it should.
