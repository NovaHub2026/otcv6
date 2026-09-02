# Multi-node generation and operations

Type: ARCHITECTURE (living)
Canonical for: who may generate an asset, what a follower serves, how a
failover is recorded, what the coordinated store guarantees, how the published
record is rotated and retained, what the standing verdict runs, and how
operator risk stays outside generation
Added: 2026-09-02, by the out-of-band audit (a7-08), closing B-023 — Cycle
Audit 5 found the subjects of PH-13 to PH-16 in no architecture document while
`DOCS_INDEX.md` tells a reader that a missing one means the layer does not exist
Decisions: [ADR-0010](../decisions/ADR-0010-catch-up-bound.md),
[ADR-0012](../decisions/ADR-0012-single-writer-generation.md)

---

## 1. Generation is single-writer per asset

Two nodes holding the same key produce the same ticks — until one restarts.
`resumeMarket` seams **forward to the resuming node's own clock**, so two nodes
restarting at different instants publish different prices for the same asset
from then on. Replaying the gap is what ADR-0010 refuses; coordinating the seam
is coordination. So exactly one node generates any asset at a time, and
horizontal scale is different assets leading on different nodes (ADR-0012).

Leadership is a **lease** on `(assetId)` in a shared store — `acquire`, `renew`,
`release`, `inspect` (`packages/runtime/src/lease.ts`) — with three properties
that carry the argument, each with a test that fails without it:

- **The store judges expiry, with its own clock.** `LeaseGrant.expiresAt` is
  advisory and nothing branches on it, so skew between nodes cannot cause a
  handover. The SQLite store reads the clock **inside** the write transaction
  (a5-05), asserted by a clock that probes the lock through a second connection
  (`sqliteStore.test.ts`, "the clock is read under the write lock").
- **The term is the catch-up bound.** `DEFAULT_LEASE_TERM_MS` is 15 000 ms, and
  `lease.test.ts` asserts `DEFAULT_LEASE_TERM_MS === DEFAULT_MAX_CATCH_UP_MS`:
  a leader out of contact for a full term could not have advanced anyway, so
  losing the lease takes nothing the bound had not already taken. Renewal is
  every 5 000 ms — three attempts per term, two lost round-trips survivable.
- **A holder is a process, not a node** (1 to 128 printable characters). A
  restarted process waits out its predecessor's term rather than reclaiming it,
  because "the old process is certainly gone" is what a hung process disproves.

The lease is worth nothing in the interval between losing it and knowing it, so
every grant carries a **fence token** (`fence.ts`): strictly increasing across
every grant for an asset, preserved by renewal, incremented on every
reacquisition — same holder, after release, after expiry — and never recycled,
because the high-water mark outlives the grant. `saveFenced`, `appendTicks` and
`recordSeam` refuse a token that is not the current unexpired grant's with
`StaleFenceError` (never led, expired, or held by another) and leave the record
untouched. That is what a stale fence **cannot** do. What it **can** do is read
— `readRecord`, `recordHead`, `seams` and `load` are unfenced, as is the plain
`save` the fresh-start path uses — and keep generating locally, spending
keystream nobody will accept; which is why the leader loop renews before it
advances (§3). Guarded by `describeCoordinatedStore` in
`leaseConformance.test.ts`, run unmodified against both stores, and by
`lease.test.ts` (a partitioned leader that keeps writing and changes nothing).

## 2. Followers serve the record and cannot generate

`FollowerMarket` (`follower.ts`) replicates through the store that carries the
lease — there is no second channel — and cannot generate because of the module
graph, not a comment. `packages/core/src/guardrails/singleWriter.test.ts` walks
every module reachable from `follower.ts` inside the runtime, type-only imports
included, and fails on: `@otc/engine`, `@otc/fixtures`, `@otc/lab`, `node:vm`,
`node:worker_threads`, `node:child_process`, `node:module`; any generation or
key-material identifier, `@otc/core`'s own entropy primitives included; and
any dynamic escape hatch — `import(`, `require(`, `Function`, `.constructor`,
`eval`, `globalThis`, `global`, `Reflect`, `getBuiltinModule`. Its comment
stripper keeps string literals, because `const OPEN = '/*'` once hid a real
engine import and an auditor measured INV-002 broken at 120 of 120 sampled
instants (B-013). The guard failed on its first run, on the type-only path
`follower → replication → lease → state → @otc/engine`, which is why `fence.ts`
is a separate module.

What a follower **answers** (`serve(fromSequence, recordHead)`, the record head
read from the store because a follower cannot tell "behind" from "impossible"
alone):

| Request                                         | Answer                                     |
| ----------------------------------------------- | ------------------------------------------ |
| Within what it holds                            | `entries` — ticks and the seams between    |
| Beyond it, within the record                    | `lagging`, both heads reported             |
| Beyond the record itself                        | `unknown` — the phantom case               |
| Older than it retains (50 000 ticks by default) | `evicted`, with the oldest it still holds  |
| Sequence 1 of an asset with no record           | empty `entries`: "send me what comes next" |

What it **refuses**: closing a gap (`ReplicationGapError`), a seam that does not
continue its head, a price before its first retained tick, a price inside a
seam (§3). Guarded by `follower.test.ts` and by `multiNode.test.ts`, which drives
the real engine across the five catalogue assets for ten minutes of market time
with three followers reading at different rates, and asserts incrementally that
each holds a prefix of the record and agrees with the leader at 250 sampled
instants per asset.

## 3. Failover and the seam marker

`resumeMarket` (`resume.ts`) has three outcomes. **Fresh**: no record.
**Resumed**: the snapshot restores, reproduces the record's own pending tick,
and the checkpoint is younger than `DEFAULT_MAX_CATCH_UP_MS` (15 000 ms); ticks
published after it are regenerated identically and the log accepts them as
replay. **Seam**: the snapshot is unusable, the record's `version` is older than
this code's, or — Cycle Audit 5's first finding — the checkpoint is staler than
the bound. A seam opens at the clock, carries the last published price,
continues the sequence from `max(leasedSequence, lastPublished + 100 000)`, and
moves every stream cursor past its lease and past the snapshot's cursor plus
4 096 blocks: nothing published twice, no keystream position spent twice.

**A discontinuity is recorded, never inferred.** PH-5.2's seam jumps the
sequence deliberately; PH-14.2's log refuses a gap, because one served to
observers is indistinguishable from the market. Both are right, so the record
holds the discontinuity as a `SeamMarker` (`replication.ts`) — last sequence and
instant before, first sequence and instant after, the reason. The only way to
append past a gap is to record one; a seam must continue the record's own head
and move forward; `readRecord` yields **entries**, with the seam positioned at
`lastSequence + 1`, so a client resuming inside a gap is handed the seam before
the ticks that follow.

`LeaderSession` (`failover.ts`) is the loop, and the order is the content: renew,
throwing `LeadershipLostError` rather than returning empty if the lease is gone
— **before** generating, because the fence would refuse the ticks only after the
keystream was spent; advance; record a pending seam once, immediately before its
first tick, naming the **record's** head rather than the checkpoint's, since a
dead leader appends every tick and checkpoints on a cadence; append everything
not yet recorded, oldest first, under the fence; checkpoint every
`DEFAULT_CHECKPOINT_INTERVAL_MS` (5 000 ms), asserted strictly inside the bound
by `failoverBound.test.ts`, because a longer cadence guarantees some failover
resumes from a checkpoint too stale to resume from.

**The record leads the checkpoint** (a5-03). A store may be busy, and one
`SQLITE_BUSY` is not a discontinuity — but before this one refused append wedged
a leader for ever: measured, record head 1 against a market at sequence 8, five
refused appends, no seam, lease never lost. Now refused ticks are kept and
retried before anything newer; no checkpoint is written, on the cadence or on
demand, while any tick is unrecorded, because a successor resumes from the
checkpoint and its first append would otherwise be a gap handed on; and after
`MAX_CONSECUTIVE_APPEND_FAILURES` (3) the session **releases** the lease, so a
successor need not wait out the term, and throws with the refusal as `cause`. A
`StaleFenceError` is not transient and loses leadership at once
(`failover.test.ts`, "a transient store failure does not wedge the leader").

**Settlement sees the seam.** `priceAt` is `null` strictly inside a seam window,
because the pre-seam price would answer for an interval no node was generating;
an idle market past its newest tick still reports the newest price. `spansSeam`
tests **overlap**, not containment — Cycle Audit 5 produced a real 93-second gap
and a contract whose expiry fell inside it settled as a loss while `priceAt`
refused the same instant. `settle()` (`packages/trading/src/settle.ts`) applies
the same overlap rule to `TickRecord.seams` and throws `NotSettleableError`.

**"Stalled", operationally.** `VenueService.tick` advances with
`advanceDetailed` and keeps every per-asset failure. A market past the bound
refuses every later advance, because `#lastAdvancedAt` moves only after the
check, so the failure is permanent until a restart — by decision (ADR-0010),
since the alternative is generating the unobserved interval. The reason is
logged once per distinct message, `/health` reports `degraded` with the stalled
list, and the restart takes the seam and logs it as one. Cycle Audit 6 found
`/health` returning `ok` with every market stopped (CA6-33).

`cluster.test.ts` is the integrated evidence: three nodes, five assets, four
crashes and four revivals, one damaged checkpoint, a suspended process that
wakes believing it leads. It asserts single writer and prefix at every step, no
sequence twice, every jump matched element for element against the recorded
seams, instants never moving backwards, and the stale writer refused by the
renewal check **and** by the fence independently.

## 4. The `CoordinatedStore` and its two implementations

`CoordinatedStore` is `LeaseStore`, `StateStore` and `ReplicationLog` in one
interface plus `saveFenced`, because a fence check against one store followed by
a write to another is a race with a comment. The contract is executable —
`describeCoordinatedStore` runs unmodified against both implementations, and a
property a backend cannot meet is a wrong backend, not a relaxed property. One
rule both share since a5-05: a batch that repeats or reorders a sequence is
refused whole with `RangeError` before any comparison with the record. The
SQLite store used to deduplicate such a batch against itself and raise
`RecordForkError` — "two concurrent leaders" — for one writer's malformed batch
(B-019).

`MemoryCoordinatedStore` is the reference: every critical section contains no
`await`, which is atomic for one process and says nothing about two.

`SqliteCoordinatedStore` (`sqliteStore.ts`, `node:sqlite`, no dependency added;
`engines` is Node ≥ 24) is the store two processes can share. Its open path is
as careful as its methods because the constructor was where concurrency first
broke: `busy_timeout` first (`DEFAULT_BUSY_TIMEOUT_MS`, 5 000 ms — **the wait is
synchronous** and stalls the event loop for up to that long on a contended
write, a property of the binding, a5-06); WAL for file-backed databases, retried
up to 100 times by waiting on an empty immediate transaction because the
journal-mode change ignores the busy handler, after eight processes opening one
new file had seven die in the constructor; `PRAGMA user_version` checked
**before any statement**, refusing a file newer than `STORE_SCHEMA_VERSION` (1)
and naming both numbers (a5-11 — the candle history does the same under
`HISTORY_SCHEMA_VERSION`, and no migration exists because no schema has
changed); then four tables — `lease` with `high_water` kept when a grant is
cleared, `record` keyed by an insertion ordinal because sequences are sparse
after a seam, `record_meta` carrying `expect_next` separately from `head`, and
`state`. Every write runs under `BEGIN IMMEDIATE`, reads the clock inside it,
and rolls back on a throw only if a transaction is open, so every failure is a
rejection and `SQLITE_BUSY` never leaves the connection mid-transaction.
`sqliteConcurrency.test.ts` races six processes over 150 rounds — 900 contended
acquisitions against `dist/` — and requires one winner per asset and no
duplicate token; swapping `BEGIN IMMEDIATE` for `BEGIN` fails it and nothing
else. **Correct for** several processes on one machine, on a local filesystem;
SQLite over a network filesystem is a documented way to corrupt a database, and
a networked backend is not built without a deployment to inform it (PH-15 §11).

The state record (`state.ts`) is versioned: `version` **newer** than
`STATE_RECORD_VERSION` is `CorruptRecordError`, refuse to start, because the
lease marks may be in a shape this code cannot read (a5-11); **older** is
`UnusableRecordError` and seams; another asset's record refuses, because seaming
on one re-issued 5 377 consumed blocks in an audit probe.

`FileStateStore` and `FileAssetRegistry` write through `atomicFile.ts`: a
temporary name unique per **call** (a per-process name lost one of two
concurrent saves 200 times out of 200), `fsync` of the file, `rename`, `fsync`
of the directory — tolerating `EINVAL`, `EISDIR`, `ENOTSUP`, `EPERM` from
filesystems that refuse to sync one; the file's own sync is never optional.
Against a **crash** a reader sees the previous file or the new one, never a
torn one; against a **power loss** the bytes and the directory entry are on the
platter before the call resolves (a5-10). No test can watch a power loss, and
none claims to. Registrations are published with `link`, which fails `EEXIST`
atomically, so ten concurrent registrations of one id admit exactly one; overlay
edits are serialised through a promise queue, because two interleaved
read-modify-writes of one file are a lost update whatever the temporary names
(a5-07, `registry.test.ts`). The candle history runs `synchronous = FULL`: a bar
lost from the last WAL frames after retention deleted its ticks is a permanent
hole.

## 5. Publication operations

**Key rotation** (`packages/distribution/src/rotation.ts`). `verifySignedChain`
took one key, so a rotated key failed verification exactly as a forgery does.
Now a rotation is a record **signed by the outgoing key** naming its successor;
the epoch is derived as the key's position in `authorisedKeys(genesis,
rotations)` rather than claimed in any payload, so the canonical commitment
encoding did not change and no published root was invalidated; and a verifier
needs only the genesis key out of band. Along a chain epochs are
**non-decreasing**, and each rotation names the chain **head root per asset** at
the moment it was signed, so "follows the rotation" is a position in the
hash-linked record rather than in an array the attacker hands over (Cycle Audit
5, F-3). Refused: reinstating a retired key, rotating to the same key, an epoch
gap, and a key not in its one canonical lower-case spelling — `Buffer.from(hex)`
truncates and is case-insensitive, and an auditor rotated "back" to genesis
under an alias (F-2). Which key signs which window: every commitment after an
asset's named head must carry that epoch or later; windows before it remain
valid under the retired key. **Content is attested; attribution is not**
(a5-12): a successor may re-sign pre-rotation windows and the chain verifies, so
a verifier who needs to know which key first signed a window keeps the
commitments as originally published. Guarded by `rotation.test.ts` and
`signing.test.ts`.

**Journal retention** (`retention.ts`). The dispute window is 90 days and the
reach is `disputeWindowMs + longestHorizonMs` — the horizon term (15 minutes)
because a settlement disputable today may have opened a contract earlier, and
re-deriving it needs the entry tick (B-017). A journal is pruneable iff
`now − newestInstant > reach`, **strictly**: on the boundary it is kept, since
the last day of a window is a day a dispute may be raised, and a5-02 found that
edge documented and unguarded — `retention.test.ts` now holds it at the
millisecond. `commitmentIsPruneable` is a function that returns `false`, so a
cleanup task can ask and never lose the ability to prove the record unaltered;
an unusable `now` refuses rather than prunes. The cost is not the constraint:
PH-3 measured roughly 73 000 ticks per asset-day, so five assets over ninety
days is about 33 million ticks (`retention.ts`).

**The standing verdict** (`packages/lab/src/standing.ts`). `runStandingAssurance`
runs `runBatteryAsync` over a dataset built from the published record with
`composeFamilies` = `defaultFamilies()` — the registry **and** the learned
`learned-logistic` family, which a4-04 found missing when composition read
`ATTACK_FAMILIES` (measured: 26 families ran without it) — plus every withheld
family the inputs can construct; `standing.test.ts` names the learned family
rather than counting. The floor is the battery's own
`minimumDetectableEffectPoints`, recomputed per run. `classifyStanding` reports
`exploitable` at any power; otherwise `undecided` if a withheld family could not
be built, if there are no horizons, or if any horizon's floor is coarser than
`PRODUCT_MARGIN_PP` (0.2513pp — the product's margin, not the caller's payout,
after A6-03 measured 33 hours of a fair walk judged at 0.85 reported `clean`
with a 4.040pp floor); `clean` only when everything holds. Why both family sets:
on a clock-predictable record the withheld four alone returned 88 hypotheses and
zero findings, worst z −1.15; with the registry, 501 hypotheses and 97 findings,
worst z 77.6 (PH-16.1). The cadence is daily, decided from an injected instant,
refusing a corrupt `lastRunAt`. `clean` means no hypothesis in this family set
fired at this power — never "there is no leak".

`tools/sim/src/operations.stat.test.ts` is the integrated evidence: two assets
led on a `SqliteCoordinatedStore` for an hour, the file reopened by a second
connection, the record committed across a key rotation and verified from the
genesis key and refused without the rotation log, an anchor extended and a
truncated successor refused, every journal retained today and pruneable after
200 days with no commitment ever pruneable, and a standing verdict of
**`undecided`**.

## 6. Operator risk, and why it cannot reach generation

The unit of risk is the **settlement event** (`packages/trading/src/exposure.ts`):
contracts sharing one comparison are one Bernoulli draw, so a thousand crowded
contracts are one effective bet (`effectiveBets`, the inverse participation
ratio), and two books of equal stake differ in spread by √1000 ≈ 31.6 — PH-13.1's
headline, asserted as a ratio in `exposure.test.ts`. Exposure nets exactly within
an event; the operator's profit under each resolution is accumulated directly,
because `(netExposure/2)²` understated the spread by `(1+r)/r`, 2.01× at the 99%
payout (B-015). Grouping runs through an `EntryResolver` mapping a submitted
instant to the tick the record settles against, because keying on raw instants
let one millisecond of jitter turn one comparison into 200 events and admit a
book at 39.6× its limit (B-016, A6-04); a venue holding a record must pass one.

The **limiter** (`limiter.ts`) is a refusal, never an adjustment: `admit` and
the incremental `ExposureBook.admit` decline a contract that would push an
event's net exposure past `maxEventExposure`, name the event and the limit, and
accept anything that **reduces** net exposure on an event already over it,
because refusing a hedge is worse than no limiter. The **ruin bound**
(`packages/lab/src/ruin.ts`) is Lundberg's: the `R > 0` solving
`E[exp(−R·X)] = 1` by bisection, with `P(ruin from u) ≤ exp(−R·u)` — an upper
bound that tightens with capital, the conservative direction for a solvency
number; `capacity` bisects the largest per-event loss keeping ruin under a
tolerance. The tests assert **a bound, not an equality**:
`ruinSimulation.stat.test.ts` requires the ruin frequency over 2 000 simulated
paths of up to 20 000 events to come in at or below it, within 0.02;
`ruin.test.ts` requires the limit to bind with ruin at it at most
`tolerance × 1.001`, ruin of exactly 1 at a fair payout, a growth-optimal
fraction under 1% at the promotional payout, and negative log growth at 20%.

None of this can reach generation, three ways. **Direction**: `@otc/trading`
depends on `@otc/core` alone and the engine cannot import it
(`dependencies.test.ts`). **Vocabulary**: the guardrail scan rejects economic
terms in the generation roots. **Behaviour**, because Cycle Audit 4 defeated the
first two with neutral naming: `tools/sim/src/limiterBlindness.stat.test.ts` runs
every catalogue asset with the limiter accepting more than 10 and refusing more
than 100 contracts and requires the tick stream `toEqual` the quiet market's,
with a teeth test that one lattice step fails it. In the service,
`VenueService` publishes first and only then hands ticks to the publisher and
the history recorder; both are views of what happened (`venue.service.ts`).

## 7. Where this is written down

| Concern                               | Module                                   | Guarding test                                      |
| ------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Lease, token, the reference store     | `packages/runtime/src/lease.ts`          | `lease.test.ts`, `leaseConformance.test.ts`        |
| Fence token and refusal               | `packages/runtime/src/fence.ts`          | `leaseConformance.test.ts`, `replication.test.ts`  |
| Record, seam marker, batch rule       | `packages/runtime/src/replication.ts`    | `replication.test.ts`                              |
| Follower                              | `packages/runtime/src/follower.ts`       | `follower.test.ts`, `singleWriter.test.ts`         |
| Leader loop, retry, stepping aside    | `packages/runtime/src/failover.ts`       | `failover.test.ts`, `failoverBound.test.ts`        |
| Resume, seam, catch-up staleness      | `packages/runtime/src/resume.ts`         | `resume.test.ts`                                   |
| Record versioning                     | `packages/runtime/src/state.ts`          | `resume.test.ts`                                   |
| SQLite store, transactions, schema    | `packages/runtime/src/sqliteStore.ts`    | `sqliteStore.test.ts`, `sqliteConcurrency.test.ts` |
| Shared open path: WAL, `user_version` | `packages/runtime/src/sqlite.ts`         | `sqliteStore.test.ts`                              |
| Atomic, durable files                 | `packages/runtime/src/atomicFile.ts`     | `resume.test.ts`, `registry.test.ts`               |
| Stalled markets, `/health`            | `apps/api/src/venue.service.ts`          | `apps/api/src/adminSurface.test.ts`                |
| Key rotation                          | `packages/distribution/src/rotation.ts`  | `rotation.test.ts`, `signing.test.ts`              |
| Retention                             | `packages/distribution/src/retention.ts` | `retention.test.ts`                                |
| Anchor                                | `packages/distribution/src/anchor.ts`    | `anchor.test.ts`                                   |
| Standing verdict                      | `packages/lab/src/standing.ts`           | `standing.test.ts`                                 |
| Exposure by event                     | `packages/trading/src/exposure.ts`       | `exposure.test.ts`                                 |
| Limiter                               | `packages/trading/src/limiter.ts`        | `limiter.test.ts`, `limiterBlindness.stat.test.ts` |
| Ruin and capacity                     | `packages/lab/src/ruin.ts`               | `ruin.test.ts`, `ruinSimulation.stat.test.ts`      |
| Settlement across a seam              | `packages/trading/src/settle.ts`         | `settle.test.ts`                                   |
| All of it together                    | `tools/sim/src/operations.stat.test.ts`  | `cluster.test.ts`, `multiNode.test.ts`             |

## 8. What is deliberately not offered, and what remains open

**The service is single-process and composes none of §1–§4's coordination.**
`apps/api/src/app.module.ts` wires `FileStateStore`, `SqliteCandleHistory` and
`FileAssetRegistry`; `VenueService` resumes with `resumeMarket`, checkpoints
through the **unfenced** `save` every 5 000 ms, and nothing in `apps/api`
references `LeaderSession`, `FollowerMarket`, `AssetLease` or
`SqliteCoordinatedStore`. PH-14.3 §9 deferred the holder id, the follower's
polling and the topology to PH-15, and PH-15 built the store, not the wiring. A
second process against the same state directory today is not a follower; it is
a second writer with no fence.

**Rotation, retention, the anchor and the standing run are library
capabilities.** `PublicationService` signs with the one key in
`OTC_PUBLISHING_KEY`; no code outside tests calls `signRotation`,
`partitionForRetention`, `buildAnchor` or `runStandingAssurance`. Pushing an
anchor needs a credential and a schedule, operational acts with no code here
(PH-15.2 §6); scheduling the standing run is in the same position. That run is
**monitoring**: its result is recorded, a failure is an incident, and no engine
parameter changes because of it (PH-15 §4).

**Settlement and the limiter have no venue endpoint.** `apps/api` imports
nothing from `@otc/trading`, so nothing composes seams into a `TickRecord` in the
service. The limit is one number per venue, and nothing removes a settled
contract from an `ExposureBook`, so exposure only accumulates (PH-13 §10).

**Multi-machine.** The SQLite store is correct for several processes on one
machine and nowhere else (§4). A networked `CoordinatedStore` is a drop-in
against the conformance battery, and is not built.

**B-019's history.** Cycle Audit 5 found the two stores disagreeing: the SQLite
store read the clock before `BEGIN IMMEDIATE` blocked, so a lease could be
granted or renewed against a moment that had passed (SQL-1), and differential
fuzzing found 19 of 400 seeds diverging on duplicate ticks within one batch
(SQL-3). Both are closed in code by a5-05 (§1, §4); the backlog row still reads
open and is the orchestrator's to update.

**Event-loop stalls.** A contended write blocks the thread for up to the busy
timeout (§4). That is `node:sqlite`, not this code, and it is stated rather than
hidden.
