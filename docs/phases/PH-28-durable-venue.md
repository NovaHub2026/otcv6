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
