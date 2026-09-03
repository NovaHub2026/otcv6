# Invariant traceability

The ten invariants in [CLAUDE.md](../../CLAUDE.md) are the product's promises. This
document is the map from each promise to the executable evidence that discharges it.

## Why this document exists

The first Cycle Audit found that INV-005 — _selecting an expiration never changes
price generation_ — had **no enforcement whatsoever**. Planting a
`selectedExpirationMs` field directly into the price engine's input type left all
eighteen guardrail tests passing. The invariant had been asserted in three phase
approval records without ever being tested.

It survived because nothing connected an invariant to its evidence. Each invariant
looked covered, because for most of them something somewhere did cover it — but no
one could see which ones had nothing. A gap in an unwritten map is invisible.

So the map is written, and a test enforces it. `traceability.test.ts` fails if an
invariant listed here as enforced has no tagged evidence, if an invariant listed as
pending has acquired some, or if this table and CLAUDE.md disagree about what the
invariants are.

## How evidence is declared

A test file declares what it discharges with a header comment on its first line:

```ts
// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
```

Tags are deliberately coarse — file-level, not test-level. A finer tag would be a
second thing to keep in sync, and the point is a map that stays true, not one that
is maximally precise.

## The map

| Invariant                                              | Status   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-001 Economic independence                          | Enforced | `guardrails.test.ts` — source scan rejects economic vocabulary anywhere in the generation path; `dependencies.test.ts` — nothing below `apps/` may import a framework; **`economicBlindness.stat.test.ts` — the published tick stream is byte-identical between a quiet market and one under heavy adversarial trading, on all five assets** ; `sourceScan.test.ts` — the lexer every scan shares, against every construct that has hidden code from it (a2-01)                                                |
| INV-002 Shared market                                  | Enforced | `sharedMarket.test.ts` — independently constructed processes produce identical streams; observers at different cadences agree on price                                                                                                                                                                                                                                                                                                                                                                         |
| INV-003 Single underlying stream                       | Enforced | `sharedMarket.test.ts`, `candle.test.ts` — every candle's open, close and extremes are prices that occurred in the tick stream                                                                                                                                                                                                                                                                                                                                                                                 |
| INV-004 Timeframe observer independence                | Enforced | `timeframe.test.ts`, `candle.test.ts` — aggregation is a pure fold; refolding a coarser timeframe from a finer one agrees                                                                                                                                                                                                                                                                                                                                                                                      |
| INV-005 Expiration independence                        | Enforced | `guardrails.test.ts` — source scan rejects contract, expiration and direction vocabulary in the generation path ; `sourceScan.test.ts`                                                                                                                                                                                                                                                                                                                                                                         |
| INV-006 No deterministic exploitable directional rules | Enforced | `mirror.test.ts` and `productionComposition.test.ts` (sign symmetry is structural — reflected through an interior snapshot since 2026-09-02; the from-origin harness used until then was blind to origin-symmetric level leaks, out-of-band audit a3-01), `battery.test.ts`, `calibration.stat.test.ts`, `engineValidation.stat.test.ts`, `phaseAcceptance.stat.test.ts`                                                                                                                                       |
| INV-007 Asset differentiation                          | Enforced | `multiAsset.stat.test.ts` — the claim is a **separation of two distributions**, measured across stream families. Real catalogue: full signature 51.5-60.5%, scale-free **shape** 32.5-41.0%. Identical-personality control (five copies of one personality): full 18.5-33.5%, shape 14.5-25.0%. The distributions do not overlap — the worst real draw beats the best control draw on both. Attribution: rhythm features alone 39.5%, tail features alone 28.0%. **No p-value is quoted**; see the note below. |
| INV-008 Continuous market state                        | Enforced | `factory.test.ts` (restart across a lease seam, and snapshot/restore of the composed model), `engine.test.ts`, `seamReplay.test.ts`, `lease.test.ts`                                                                                                                                                                                                                                                                                                                                                           |
| INV-009 Reproducible settlement                        | Enforced | `seamReplay.test.ts`, `replay.test.ts` — a recorded run replays to identical prices                                                                                                                                                                                                                                                                                                                                                                                                                            |
| INV-010 Private generator state                        | Enforced | `keyring.test.ts` (key material is redacted in JSON, string and inspect forms), `engine.test.ts` (a snapshot's field set is exact, holds no run of draws and no key material — CA7-02 found this row citing an assertion that did not exist), `lease.test.ts` ; `publishingKey.test.ts` (structural refusal, transitive signing path), `singleWriter.test.ts` (a follower cannot reach the engine or key material)                                                                                             |

## The last one to become evidence

INV-001 was the invariant the whole architecture exists to protect, and until
PH-6 it was the one still held up by an argument rather than a measurement. The
scan proves the price path never _names_ an economic quantity; that is not the
same as showing economic state cannot reach it.

It stayed comfortable for five phases because contracts and the engine had never
been in the same process — there were no positions to leak. PH-6 put them
together and then tried to make the leak happen: one-sided exposure, concentrated
on a single asset, entries pinned to tick instants, stakes scaled by the market's
own recent movement. The streams are identical.

## What the map does not claim

Evidence is not proof of sufficiency. A tag says _someone deliberately connected this
test to this invariant_, not _this invariant is fully verified_. INV-006 in particular
can never be discharged by testing alone — no battery proves the absence of an edge.
It rests on the structural argument in [OVERVIEW.md](OVERVIEW.md): the sign is drawn
from a dedicated stream that no magnitude input can observe, so the mirror involution
holds by construction. The battery exists to catch a _break_ in that argument, not to
establish it.

INV-007 was marked pending through PH-4.1 and PH-4.2 and promoted only in PH-4.3,
when the evidence existed. `traceability.test.ts` enforced that in both directions
and caught a premature tag during PH-4.1.

Its evidence is also the most carefully hedged in this table, because it is the
invariant most easily faked — and Cycle Audit 2 found the hedging still was not
enough. The significance originally quoted here, p = 5.1e-25, came from a
binomial tail assuming 200 independent classifications. They are contiguous
slices of a few realisations, each classified against a centroid built from its
own asset's other windows; the audit measured that same machinery reporting
p = 4.1e-3 for five copies of a single personality. The figure now quoted comes
from a permutation null, which carries the dependence structure automatically and
cannot report below its own resolution. The separation is still real — no
relabelling of 199 came within 22 points of it — but it is significant at 0.005,
not at 1e-25. The metric it rests on has a reachable null, and that
null was measured: five copies of one personality score at chance.

Until PH-10 the metric did **not** establish that the assets differ in _shape_
once pace and amplitude are divided out. That signal was real but weak — 30.0%
against 20% — because the volatility cascade dominated the observable dynamics
and every asset shared one. PH-10 made the cascade's time structure per-asset and
the figure is now 32.5-41.0% across stream families, against an
identical-personality control of 14.5-25.0%.

**Cycle Audit 4 removed the p-value that used to sit here, and the reason
generalises.** The permutation null was itself measured returning p <= 0.01 for
five copies of _one_ personality in three of eight stream families. Each asset's
windows are contiguous slices of a single continuous realisation, so they share
slow state and are genuinely more alike than windows from different runs — under
the null. Shuffling the labels destroys a structure the null actually has, so the
observed arrangement lands in the tail for reasons unrelated to whether the labels
mean anything.

That is the same error Cycle Audit 2 found in the binomial this replaced, one
level further in: an exchangeability assumption the data does not satisfy. The
honest null is the identical-personality control, because it carries every
dependence the real measurement has — it _is_ the real measurement, with the
personalities made identical. The audit also found the previous single-seed
assertions passing on luck: the control reaches 33.5% on some seeds, which would
have failed the test's own bounds.

The shape figure is worth guarding, because it is trivially purchasable: spread
the assets further apart in tail weight and it rises without any of them becoming
a more distinct market. So PH-10.2 pinned every asset's realised tick amplitude
to its PH-4 value to fifteen decimal places and its tail weight to within 6%, and
`catalogue.test.ts` enforces both. The attribution then falls out: the five
features PH-10 made per-asset score 39.5% on their own, while the two it held
fixed score 28.0% — at the top of the identical-personality control's own band,
which is where a frozen feature belongs.

Assets are still much easier to tell apart by size than by character. That is
true of real markets too, and the claim is now stated at the strength the
measurement supports rather than at the strength the full signature suggests.
