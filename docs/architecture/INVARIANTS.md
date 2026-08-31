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

| Invariant                                              | Status           | Evidence                                                                                                                                                       |
| ------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-001 Economic independence                          | Enforced         | `guardrails.test.ts` — source scan rejects economic vocabulary anywhere in the generation path                                                                 |
| INV-002 Shared market                                  | Enforced         | `sharedMarket.test.ts` — independently constructed processes produce identical streams; observers at different cadences agree on price                         |
| INV-003 Single underlying stream                       | Enforced         | `sharedMarket.test.ts`, `candle.test.ts` — every candle's open, close and extremes are prices that occurred in the tick stream                                 |
| INV-004 Timeframe observer independence                | Enforced         | `timeframe.test.ts`, `candle.test.ts` — aggregation is a pure fold; refolding a coarser timeframe from a finer one agrees                                      |
| INV-005 Expiration independence                        | Enforced         | `guardrails.test.ts` — source scan rejects contract, expiration and direction vocabulary in the generation path                                                |
| INV-006 No deterministic exploitable directional rules | Enforced         | `mirror.test.ts` (sign symmetry is structural), `battery.test.ts`, `calibration.stat.test.ts`, `engineValidation.stat.test.ts`, `phaseAcceptance.stat.test.ts` |
| INV-007 Asset differentiation                          | **Pending PH-4** | No asset personality system exists yet. There is one instrument, so there is nothing to differentiate.                                                         |
| INV-008 Continuous market state                        | Enforced         | `factory.test.ts` (restart across a lease seam, and snapshot/restore of the composed model), `engine.test.ts`, `seamReplay.test.ts`, `lease.test.ts`           |
| INV-009 Reproducible settlement                        | Enforced         | `seamReplay.test.ts`, `replay.test.ts` — a recorded run replays to identical prices                                                                            |
| INV-010 Private generator state                        | Enforced         | `keyring.test.ts` (key material is redacted in JSON, string and inspect forms), `engine.test.ts` (a snapshot carries no key material), `lease.test.ts`         |

## What the map does not claim

Evidence is not proof of sufficiency. A tag says _someone deliberately connected this
test to this invariant_, not _this invariant is fully verified_. INV-006 in particular
can never be discharged by testing alone — no battery proves the absence of an edge.
It rests on the structural argument in [OVERVIEW.md](OVERVIEW.md): the sign is drawn
from a dedicated stream that no magnitude input can observe, so the mirror involution
holds by construction. The battery exists to catch a _break_ in that argument, not to
establish it.

INV-007 is honestly marked pending rather than quietly omitted. Marking it enforced
against the single-instrument tests that exist today would be exactly the failure this
document was created to prevent.
