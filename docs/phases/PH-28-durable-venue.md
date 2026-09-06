# PH-28 — The Durable Venue: The Record Outlives The Process

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-28
Status: ACTIVE
Cycle: 10 (phase 1 of 3) — the closing cycle
Created: 2026-09-05
Branch: `feature/ph-28-durable-venue`

---

## 1. What is actually unknown

Nothing about the market. What is unknown is whether the venue a broker
integrates still has its record after the process that wrote it is gone, and
the answer today is measured and no: PH-25.1's observer, reading the served
record across a checkpoint, a `SIGKILL` and a resume, found that

- **the replay window is process-local** (finding a): `FileStateStore` keeps
  checkpoints and candles, not ticks; a client holding a sequence from before
  the resume point is refused as evicted though nothing was evicted, and the
  ticks it wants are reproducible (INV-009) and unservable;
- **a kill costs the candle record the minute it fell in** (finding c): the
  open bar dies with the process and the resumed recorder, seeing that minute
  from inside, withholds it (a5-01), so the minute tier shows a hole and the
  hourly tier withholds the hour around it (Cycle Audit 9, a6-01).

Both are one fact: the shipped service persists what it needs to _continue_
the market and nothing of what it _published_. The multi-node store already
holds a per-tick record with seams (`SqliteCoordinatedStore.appendTicks`,
`readRecord`) and the shipped `apps/api` reads none of it.

A third thing, handed forward by Cycle Audit 9 and not a finding: the venue's
surface hands production controllers an object that can snapshot the engine
(`VenueService.hostedMarket()`), guarded by value at every production GET
route since a1-01 and by nothing structural.

## 2. Why this phase, and why now

Because it is what a broker's settlement rests on. A broker that settles
against this record needs the record to be there after a restart, and needs
its candle chart to not have a hole where the operator restarted the service.
Cycle 10 is the closing cycle (`ROADMAP.md`, the Cycle 10 plan), PH-29's
settlement query reads the record this phase persists, and the improvement
report ranked it first for the same reason: two later items stand on it.

## 3. What this phase may not do

- **It may not touch the price path.** The record is written after
  publication and read by nothing that generates (INV-001). `packages/engine`
  and the generation code in `packages/core` are not in scope.
- **It may not let a persisted tick disagree with a published one.** A tick
  the record already holds is compared, never overwritten; a disagreement is
  a refusal to publish, not a second record (INV-002).
- **It may not persist anything an observer cannot read.** The record holds
  sequence, instant and price — what the stream carries — and nothing of the
  engine's latent state (INV-010).
- **It may not change what a resumed market generates.** The record dedups
  a republished tick; it never feeds one back.

## 4. Phase invariants

INV-002, INV-008 and INV-009 are what is delivered; INV-001 and INV-010 are
what the delivery must not violate.

## 5. Subphases

| Subphase | Title                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| PH-28.1  | The record composed: ticks persisted, replay served from the store across a restart    |
| PH-28.2  | The venue's handle: production controllers see a published view, never the engine      |
| PH-28.3  | The store operated: integrity at boot, backup and restore, the commitments file (#19)  |
| PH-28.4  | The served verdict across a kill and a restart, on the thirty (PH-25.1 a and c closed) |

## 6. The design, in one paragraph

A `TickRecord` in `@otc/runtime` — SQLite, one file in the state directory,
bounded per asset — is written by `VenueService.tick()` in one transaction per
scheduler pass, **before** the feed, the publisher and the history see the
batch. Its append is idempotent and comparing: a sequence already recorded
must carry the same instant and price or the append refuses and the market
stalls (INV-002); the ticks it returns as _fresh_ are the only ones published
onward, which is what makes a resumed market's republication of the ticks
between its checkpoint and the kill harmless — they are verified, not served
twice. At boot the feed's window is primed from the record's tail, so a
client's resume sequence is honoured across a restart; and the history
recorder is handed the record's ticks since its last stored bar before any
live tick, so the minute the kill fell in is seen from its start and stored
whole. Nothing reaches the engine from any of it.

## 7. What the phase leaves open, deliberately

The record is one process's, on one machine. The multi-node composition
(Issue #9) is deferred by the Cycle 10 plan; a fleet's record is the
coordinated store's, which already exists and is not hosted.

## 8. What the phase found

1. **Every boot began a new commitment chain** (PH-28.3). `PublicationService`
   built a fresh writer at an empty root on every start, so a broker verifying
   across a restart found one chain per boot. The record built in PH-28.1 is
   what continuing the chain needed; where the record cannot reach the tip the
   chain is restarted and the break is visible, never bridged.
2. **Two guards were wrong about a clean tree** — the stale-build guard
   (mtimes after a checkout, PH-28.1) and the documentation guard's history
   under hosted CI's one-commit checkout (PH-28.3). Both now ask the right
   question; hosted CI on the Cycle Audit 9 merge was red on the second.
3. **The engine's handle is a composition callback** (PH-28.2), not the
   branded token the audit named: an unwrap method on the venue's type is
   still a method on the type.
4. **A lost record makes a restart republish**, and the chain shows it as a
   second genesis link overlapping the first (PH-28.3, decision log).
5. **The row costs 32.6 bytes on disk**, so the default record is eight
   megabytes per asset and a quarter of a gigabyte for the thirty (PH-28.1).
6. **Thirty of thirty** on the product, from outside the process (PH-28.4).

## 9. Integrated phase verification

| Check                                                                                               | Result                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Every subphase document APPROVED and the roadmap agrees                                             | `documentation.test.ts`, `stateConsistency.test.ts` green                                                                                 |
| The record holds sequence, instant and price only; nothing of the engine (INV-010)                  | `tickRecord.test.ts` asserts the schema; `productionResponses.test.ts` by value                                                           |
| The record is written after generation and feeds nothing back (INV-001)                             | the venue's `tick()` order, `venueRecord.test.ts`; the engine untouched (no diff under `packages/engine`)                                 |
| A resume across a kill honoured; the kill minute stored; a fork refused (INV-002, INV-008, INV-009) | `venueRecord.test.ts` in-process; `servedRecord.stat.test.ts` over the socket; thirty of thirty on the product (`PH-28-DURABLE-VENUE.md`) |
| The engine unreachable from a production controller's type (INV-010)                                | `labSurface.test.ts` three guards, each watched failing                                                                                   |
| The directory verified at boot, backed up and restored; the chain across the process                | `stateDirectory.test.ts`, `stateTool.test.ts`, `commitmentsFile.test.ts`, `venueRecord.test.ts`                                           |
| Every guard watched failing                                                                         | PH-28.1 four plants, PH-28.2 three, PH-28.3 three                                                                                         |
| Phase quality gate `npm run gate` with the browser prefix                                           | _pending: recorded at approval_                                                                                                           |
| Hosted CI on the merge commit                                                                       | _recorded in `CURRENT_STATE.md` § "Hosted CI, honestly" when it lands_                                                                    |
