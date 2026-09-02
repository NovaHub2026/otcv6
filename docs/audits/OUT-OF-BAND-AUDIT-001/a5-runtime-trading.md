# Auditor a5 — runtime, trading, distribution, chart

Worktree: `/home/alejo/.otc-audit7/a5`, detached at `36bbf89`. Final `git status --short` prints only `?? node_modules` (the symlink that was present at the start). All probe files deleted, all `mkdtemp` directories removed, every plant restored with `git checkout --`.

## Method (what you ran, what you planted, what you could not do)

**Read** (all in the worktree): `CLAUDE.md`, `PROJECT_INTRODUCTION.md` §16–§22, `docs/architecture/{RUNTIME_AND_TRADING,CONSISTENCY_CONTRACT,PUBLICATION,CATALOGUE_AND_PANEL §4}.md`, ADR-0007/0010/0012, `docs/BACKLOG.md` (B-016/017/019), `CYCLE-AUDIT-006.md` §4, PH-16.3/PH-17.3/PH-19/PH-20.3 §5, and every source file in `packages/runtime/src`, `packages/trading/src`, `packages/distribution/src`, `packages/chart/src`, plus `apps/api/src/{venue,history}.service.ts` and the history/stream handlers of `market.controller.ts` (to answer "then what?" questions).

**Ran** (all `npx vitest run --project unit <file>` from the worktree root; exit codes seen):

| Probe file (throwaway, deleted)                           | What it exercised                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/runtime/src/a5stores.test.ts`                   | truncated record; stray temp file; 100 concurrent `FileStateStore.save`; two `SqliteCoordinatedStore` handles on one file + stale-leader fence; forced `SQLITE_BUSY`; older SQLite schema; newer state-record version; `readTimeframe` edges (30m from minutes, 1h from rollup, `[from,to)`, mid-gap); `refreshRollup` consistency on memory and SQLite; minute-tier recorder handoff |
| `packages/runtime/src/a5lease.test.ts`                    | differential fuzz Memory vs SQLite, 400 seeds × 40 ops; stale leader on both stores; seam markers (gap refused / `priceAt` null / `spansSeam`); `LeaderSession` after one transient `appendTicks` failure                                                                                                                                                                             |
| `packages/runtime/src/a5backfill.test.ts`                 | backfill→live join tick identity, gaplessness, resume identity; step independence (15 000 vs 7 001 ms); minute bar at the join                                                                                                                                                                                                                                                        |
| `packages/runtime/src/a5registry.test.ts`                 | truncated JSON; filename≠inner id; `retiredAt` persistence; 10 concurrent `add`; 20 concurrent `putOverlay`; path traversal                                                                                                                                                                                                                                                           |
| `packages/trading/src/a5trading.test.ts`                  | expiry-price policy (tick at expiry, just before, none in last minute, record ending early, seam across / ending at expiry); ATM on integers; float payouts over 100 000 cent-stakes; `EntryResolver`                                                                                                                                                                                 |
| `packages/distribution/src/a5dist.test.ts`                | feed ordering/resumption/eviction/unknown/backpressure; Merkle over n∈{1,2,3,5,7,8,9,16,17} with leaf tamper, path tamper, over-long path, level-short proof, empty tree; signature over altered range/asset/count/key; rotation (old key after rotation, new key re-attributing old windows, chain without rotation log)                                                             |
| `packages/chart/src/a5chart.test.ts`                      | 3 000-seed property test of `reduceToColumns` against a brute-force reference (duplicates, gaps, single tick, ticks at column boundaries); 500-seed `LiveBarBuilder` join property; `TickWindow`/`toBars` refusals                                                                                                                                                                    |
| `packages/runtime/src/a5leak.test.ts`                     | 500 open/close of both SQLite stores with `/proc/self/fd` count; 20 unclosed stores; 600 `FileStateStore` saves                                                                                                                                                                                                                                                                       |
| existing `packages/runtime/src/sqliteConcurrency.test.ts` | needs `packages/runtime/dist`; I built it with `npx tsc -b packages/runtime/tsconfig.json` (exit 0) and then ran it (2/2 passed, 900 contended acquisitions)                                                                                                                                                                                                                          |

**Planted** (each: edit → run → `git checkout --` → status verified):

| Plant                                                             | File                                         | Result                                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| retention boundary `>` → `>=` (off-by-one)                        | `packages/distribution/src/retention.ts:137` | **24/24 retention tests still pass** (finding a5-02)                                                                                |
| backfill guard reads the state store only (history check deleted) | `packages/runtime/src/backfill.ts:169-178`   | 1 test fails: `refuses when the history holds candles and the record does not` (guard real)                                         |
| a third field (`logQuantum`) in `OVERLAY_FIELDS`                  | `packages/runtime/src/registry.ts:63`        | 3 tests fail — all in `registry.test.ts`; `apps/api/src/adminSurface.test.ts` passed 44/44 (PH-20.3 §5 says "registry and surface") |
| `eventKey` and `ExposureBook.keyOf` ignore the resolver           | `packages/trading/src/{exposure,limiter}.ts` | 4 tests fail in `limiter.test.ts` (guard real)                                                                                      |

**Could not do**: multi-machine SQLite (out of the design's scope by its own docstring); power-loss fault injection below the filesystem; a `COMMIT` failure inside `#inTransaction`; restarting the NestJS service itself (a5-01 is demonstrated at the runtime layer with the same classes `apps/api` composes); the statistical suite (forbidden for shared-machine reasons). The differential fuzz uses my own operation mix, so its rate is not comparable to B-019's 19/400 except in kind.

## Findings

### a5-01 — The minute tier stores a partial bar labelled whole at every recorder handoff: restart, failover, and the backfill→live join

**Severity**: material

**Where**: `packages/runtime/src/history.ts:382-405` (`HistoryRecorder` wraps a fresh `CandleAggregator`; `packages/core/src/market/candle.ts:69-95` opens its first bucket wherever the first tick lands); `apps/api/src/history.service.ts:177-185` (a new `HistoryRecorder` per process per asset), `:160` (`#catchUp` feeds `this.observe`, i.e. a _new_ recorder, after `backfillMarket` has discarded its own recorder's open bar at `packages/runtime/src/backfill.ts:191,198-207,229`); `packages/runtime/src/resume.ts:66-71` (a resumed market regenerates the ticks since its checkpoint, so the new process's recorder starts mid-minute).

**Claim**: Cycle Audit 6 recorded CA6-06 (hourly tier disagrees with minute tier "at every recorder handoff") and PH-19 §5 lists CA6-06 and CA6-29 as "already closed". The fix moved the _hourly_ tier to derive from the stored minute series (`refreshRollup`). The _minute_ tier — the permanent base everything folds from — still has the handoff defect at its source, and the rollup now faithfully inherits it.

**Evidence**:

Runtime-level handoff (`a5stores.test.ts` › 1g). Ticks for `spx` from 10:00 to 10:04 via `HostedMarket`; process 1's recorder sees everything through a checkpoint at 10:02:10 and drains; process 2's fresh recorder sees the regenerated ticks after 10:02:10 (exactly what `resumeMarket` + a new `HistoryService` produce):

```
minute 10:02 after handoff: tickCount 13 vs truth 15 | open 68 vs 134 | high 103 vs 134 | low -331 vs -331 | firstSequence 26 vs 24
flushed by process 1: [ 0, 1 ] by process 2: [ 2 ]
× expected 13 to be 15
```

`InMemoryCandleHistory.append` accepted the partial bar (head was 10:01). The stored 10:02 bar is missing the minute's true high (134, at sequences 24–25) — the extreme-preserving contract broken in the base tier.

Backfill→live join (`a5backfill.test.ts` › "the minute bar containing T"): `backfillMarket` to a target 30 s into a minute, then the returned market advanced through a fresh `HistoryRecorder` (as `HistoryService.#catchUp` does):

```
join minute 1776010800000 stored: { tickCount: 8, open: 713, high: 713, low: 663, first: 3580 } | truth: { tickCount: 18, open: 672, high: 743, low: 663, first: 3570 }
× expected 8 to be 18
```

The same test file confirmed the tick stream across the join is identical, gapless and resume-identical — the defect is only in the candle tier.

**Impact**: Every restart, failover seam-free resume, `retire`/`host` cycle and every provisioned asset leaves one wrong minute bar in the permanent history, with a wrong open, wrong high/low and wrong `firstSequence`/`tickCount`, presented as closed; `refreshRollup` folds it into the hour; `readTimeframe`'s edge logic cannot see it because the source row exists. This is the class of defect CA6-06 named, one tier down, and the record cannot be repaired from candles once the retention window has deleted the ticks.

**Recommended fix**: `HistoryRecorder` must not emit a bucket it did not see from its start. Either (a) mark the recorder's first bucket as `partial` and drop it on close unless the recorder was started at genesis (pass `genesisInstant`/`resumeFrom` in), or (b) seed the recorder at construction with the retained tick tail the resume/backfill path already has (`BackfillResult.retainedTicks`; for a resume, replay from the record since `bucketStart(lastPublished.instant)`), so the first emitted bar is whole. Add a test that restarts a recorder mid-minute and asserts the stored series equals `foldTicks('1m', allTicks)`.

### a5-02 — The retention boundary that B-017 closed is untested: a `>=` off-by-one passes all 24 retention tests

**Severity**: material (a false test claim on the only deleting code path; practical exposure is one millisecond)

**Where**: `packages/distribution/src/retention.ts:137` (`return now - window.newestInstant > retentionReachMs(policy)`); `packages/distribution/src/retention.test.ts:47-52` ("keeps a journal exactly on the boundary" tests `window(90)` days, which is _inside_ the 90 d + 15 min reach under both operators), `:126-149` (tests 90 d + 5 min and 90 d + 16 min — neither is the boundary).

**Claim**: The code comment says "on the boundary it is kept", BACKLOG B-017 is marked closed by PH-16.3, and the brief asked which test catches an off-by-one. None does.

**Evidence**:

```
$ sed -i 's/newestInstant > retentionReachMs/newestInstant >= retentionReachMs/' packages/distribution/src/retention.ts
$ npx vitest run --project unit packages/distribution/src/retention.test.ts
      Tests  24 passed (24)
$ git checkout -- packages/distribution/src/retention.ts
```

**Impact**: The rule that decides deletion has a documented boundary and no guard on it. PH-16.3's plant table lists only "Retention without the horizon term"; the boundary plant was never watched failing.

**Recommended fix**: Add `expect(journalIsPruneable(windowAgedExactly(90*DAY + 15*MINUTE), NOW)).toBe(false)` and `+1 ms → true`; move the existing "exactly on the boundary" test to the real boundary.

### a5-03 — A single transient `appendTicks` failure wedges a `LeaderSession` permanently: it keeps generating, the record never catches up, and no seam is recorded

**Severity**: material (multi-node path; not yet composed into `apps/api`, which uses `Venue`/`resumeMarket` directly)

**Where**: `packages/runtime/src/failover.ts:305-346` — `advance()` renews, calls `market.advance()` (keystream spent, ticks published to the caller), then `appendTicks`; a throw from the store leaves `market` advanced and the record behind; the next call generates _more_ ticks and appends only those, which the store correctly refuses as a gap; nothing ever sets `#pendingSeam`.

**Claim**: ADR-0012 says a visible seam is the honest outcome of any discontinuity. Here the discontinuity is invisible and permanent.

**Evidence** (`a5lease.test.ts` › 2e; a `MemoryCoordinatedStore` wrapped so `appendTicks` throws once with a simulated `SQLITE_BUSY` after one successful advance):

```
advance outcomes: [
  'Error: SQLITE_BUSY: database is locked (simulated)',
  'RangeError: Cannot append sequence 4 to spx after 1: a gap in the record would be served to every obse',
  'RangeError: Cannot append sequence 5 to spx after 1: ...',
  'RangeError: Cannot append sequence 8 to spx after 1: ...'
] | record head: 1 | market lastPublishedSequence: 8 | appendCalls 5 | seams recorded: 0 | lost: false
```

With an _empty_ record the first run showed the opposite silence: the lost ticks were simply absent and the record began at sequence 3 (`expected = expectNext ?? tick.sequence` accepts any first sequence).

A real `SQLITE_BUSY` is reachable: see a5-06 (`acquire()` threw `database is locked` after 5 019 ms under a held write lock).

**Impact**: In a cluster, one lock timeout on the shared store turns a leader into a node that publishes ticks to its feed subscribers but writes none of them, indefinitely; followers stall at head 1 and `/health` on the leader would show nothing (the session does not lose its lease). INV-002 across nodes fails silently.

**Recommended fix**: Keep the unappended ticks in the session and retry them first on the next advance (the store already accepts identical replays); after N failures, release the lease and throw `LeadershipLostError` so the caller seams. Add a test: one failing append, then assert `recordHead === market.lastPublishedSequence` after the next advance.

### a5-04 — `readTimeframe`'s leading-edge rule depends on the query window and on the timeframe, and it returns a bar opening at `to`

**Severity**: minor (CA6-29 residual; at genesis the bar it mislabels is whole by definition)

**Where**: `packages/runtime/src/history.ts:485-486` (`alignedTo = bucketStart(to) + duration` — one bucket past `to`), `:503-513` (the one-bucket-back check runs only when the first complete bar is the window's first bucket).

**Evidence** (`a5stores.test.ts` › 1d; minute bars from 10:07, hourly tier refreshed):

```
30m bar 10:00 (history begins 10:07) asked from 10:00 -> dropped | asked from 09:00 -> returned tickCount=69 (whole would be 90)
1h bars: [ [10, 159], [11, 180] ] | 30m bars: [ [10.5, 90], [11, 90], [11.5, 90], [12, 90] ]
1h bars for [10:00,12:00): [ 10, 11, 12 ] | 30m bars for [10:00,12:00): [ 10, 10.5, 11, 11.5, 12 ]
```

The same 10:00 half-hour is a 69-tick "whole" bar or absent depending on `from`; the 1h view draws the partial 10:00 hour (159 of 180 minutes) that the 30m view refuses to draw; `[from,to)` is documented on `CandleHistory.read` (`history.ts:272`) and the function returns the bar at `to`. The panel sends `to = Date.now()` (`apps/web/src/app/preview/PreviewChart.tsx:110`), so today the extra bar is the open bucket and is filtered as incomplete; any client paging by fixed windows would receive the boundary bar twice.

**Recommended fix**: Apply the leading-edge check to `complete[0]` unconditionally; clip the result to `openInstant < to`; add tests for both.

### a5-05 — B-019 confirmed open: the two `CoordinatedStore`s still disagree, and `acquire`/`renew`/`release`/`inspect` still read the clock outside the transaction

**Severity**: minor (already in the backlog as open; recorded here because the brief asked for the code and the rate)

**Where**: `packages/runtime/src/sqliteStore.ts:132` (`const now = this.#clock.now(); return this.#inTransaction(...)`), `:159`, `:177`, `:187` — versus `#fenceRefusal` at `:423`, which reads the clock _inside_ the transaction. `BEGIN IMMEDIATE` at `:384` blocks synchronously under `busy_timeout`, so `now` can be up to 5 s stale when the compare runs (SQL-1). Duplicate-within-batch: `:209-226` compares against rows already inserted by the same batch; `lease.ts:302-313` compares only against the pre-batch index (SQL-3).

**Evidence** (`a5lease.test.ts` › 2b, 400 seeds × 40 random ops of acquire/renew/release/append/read/head/saveFenced/advance with holders A and B, term 1 000 ms):

```
DIVERGENT SEEDS: 138/400 (excluding duplicate-within-batch: 0)
67 x append(A,[n,n]) mem={"ok":false,"name":"RangeError"} sql={"ok":true}
71 x append(B,[n,n]) mem={"ok":false,"name":"RangeError"} sql={"ok":true}
FIRST DIVERGENCE: seed 3: acquire(A) ; append(A,[1,1])
```

Every other operation, including the stale-token and expired-lease paths, agreed on all 400 seeds.

**Recommended fix**: read `now` inside `#inTransaction`; decide one batch-duplicate rule and add it to `leaseConformance.test.ts`.

### a5-06 — `SqliteCoordinatedStore` throws synchronously from a `Promise`-returning method on `SQLITE_BUSY`, after blocking the event loop for the full `busy_timeout`

**Severity**: minor

**Where**: `packages/runtime/src/sqliteStore.ts:383-394` — `this.#db.exec('BEGIN IMMEDIATE')` (line 384) and `COMMIT` (392) are outside the `try`; `lease.ts:208-210` explains why a method "whose type says Promise and which sometimes throws synchronously has two error contracts".

**Evidence** (`a5stores.test.ts` › 1c, a raw `DatabaseSync` holding `BEGIN IMMEDIATE` on the same file):

```
BUSY: sync throw = Error: database is locked | rejection = null | waited ms = 5019
after BUSY, acquire -> granted
```

**Impact**: `await store.acquire()` inside `try` catches it, `.catch()` does not; and because `node:sqlite` is synchronous the whole venue process (every asset, every HTTP handler) stalls for up to 5 s per contended write. The store recovers afterwards (next `acquire` granted), so this is not a wedge. If `COMMIT` ever threw, the connection would be left inside an open transaction and every later `BEGIN IMMEDIATE` would fail; I could not force that path.

**Recommended fix**: move `BEGIN`/`COMMIT` inside the try and convert to a rejection; on any throw after `BEGIN`, attempt `ROLLBACK` and swallow "no transaction is active".

### a5-07 — `FileAssetRegistry` has the CA6-35 temp-path race unfixed, trusts the id inside a file over its name, and fails the whole catalogue on one bad file

**Severity**: minor (with one boot-blocking consequence worth fixing first)

**Where**: `packages/runtime/src/registry.ts:176,191` (`${target}.${process.pid}.tmp` — per process, not per call; `fileStore.ts:259-280` fixed exactly this for the state store), `:173-174` (read-modify-write of `_overlays.json` with no serialisation), `:119-127` + `:282-308` (`asStored` never compares the filename to `definition.id`), `:125` (`JSON.parse` outside any `try`).

**Evidence** (`a5registry.test.ts`):

```
putOverlay x20: rejected 19 [ "Error: ENOENT: no such file or directory, rename '/tmp/a5-reg-eMOlNd/_overlays.j" ... ] | overlays stored: 1
listed ids: [ 'eurusd' ]                      # file was renamed.json
add(eurusd) after renamed.json -> added | list now: [ 'eurusd', 'eurusd' ]
truncated file -> list(): SyntaxError: Expected double-quoted property name in JSON at position 642 | instanceof CorruptRegistrationError: false
concurrent add x10: fulfilled 1 rejected [ 'Error' x9 ]   # ENOENT, not AlreadyRegisteredError
retiredAt persists across a reopen: ✓ ; path traversal ('../x', 'EURUSD') refused on add and putOverlay: ✓
```

**Impact**: Two operator edits in the same second lose one (or both: lost update); a backup copy such as `eurusd.bak.json` matches the filename regex, is read as a second registration of `eurusd`, and `new Venue(...)` then throws `Duplicate asset in venue` (`venue.ts:52-53`) — the service will not boot until the operator finds the copy; a half-written registration file makes `list()` throw a bare `SyntaxError` for every asset.

**Recommended fix**: per-call temp names as in `FileStateStore`; serialise `putOverlay` through a promise queue; refuse a file whose name is not `${definition.id}.json` with `CorruptRegistrationError`; wrap the parse.

### a5-08 — Settlement money is floating point with no unit: `returned` and `net` are not amounts a ledger can book

**Severity**: minor (no money layer exists yet; the number is what one will consume)

**Where**: `packages/trading/src/settle.ts:180-185,196` (`stake * (1 + payoutRatio)`, `returned - stake`); `contract.ts:22-23` ("Units of account… this is a number").

**Evidence** (`a5trading.test.ts` › 5e, every stake from 0.01 to 1 000.00 at an 85% payout):

```
stakes whose 85% payout is not a whole cent: 95000 | float-vs-exact rounding disagreements: 124 | example: stake 10.1: returned=18.685 net=8.584999999999999 -> float cents 1868, exact 1868.5 cents
sample: stake 0.1 -> returned: 0.18500000000000003, net: 0.08500000000000002 ; stake 19.99 -> returned 36.9815
```

**Recommended fix**: stakes and payouts in integer minor units with an explicit, documented rounding rule for `stake × payoutRatio` (the rule is a product decision; today it is whatever `Math.round` in a future caller happens to do).

### a5-09 — `TickFeed` accepts a subscription from an unpublished sequence when the asset has no history yet

**Severity**: minor

**Where**: `packages/distribution/src/feed.ts:158-160` (`if (history.length === 0) return [];` precedes the `UnknownSequenceError` check that the docstring at `:47-48` says applies "symmetrically").

**Evidence** (`a5dist.test.ts`): `subscribe(nothing, from 600) with empty history -> accepted silently`. Every other feed guarantee held: resume-from-20 delivered 20..60 exactly; gap refused; eviction → `EvictedError`; beyond newest+1 → `UnknownSequenceError`; backpressure → closed, not skipped.

**Recommended fix**: when history is empty, accept only `fromSequence === 1` (as `FollowerMarket.serve` already does at `follower.ts:255-261`).

### a5-10 — No `fsync` anywhere; the candle database reintroduces the multi-process WAL race the state store fixed

**Severity**: minor

**Where**: `grep -rn "fsync\|fdatasync" packages/ apps/ --include=*.ts` → no matches. `packages/runtime/src/fileStore.ts:273-280` writes temp + `rename` (atomic against a process crash — verified: a truncated `eurusd.json` → `CorruptRecordError`, a stray `.tmp` beside a good record is ignored, 100 concurrent saves → 0 rejections, 0 leftover files) but neither the file nor the directory is synced. `packages/runtime/src/sqliteHistory.ts:47-48` runs `PRAGMA journal_mode = WAL` once with no retry and `synchronous = NORMAL`, while `sqliteStore.ts:96-122` documents that the unretried form killed 7 of 8 processes opening one new database.

**Impact**: after a power loss (not a process crash) a checkpoint can be an empty or stale file on filesystems without rename-ordering heuristics, and the last WAL frames of the candle history can be lost — which, after retention has deleted the ticks, is a permanent hole. Two API processes provisioning into one new history file can die in the constructor.

**Recommended fix**: `fsync` the temp file before `rename` and the directory after; share `#enableWriteAheadLog` between the two SQLite classes.

### a5-11 — Schema versioning: an older SQLite schema fails closed with no migration path; a _newer_ state-record version seams the market rather than refusing

**Severity**: minor

**Where**: `packages/runtime/src/sqliteStore.ts:470-509` (`CREATE TABLE IF NOT EXISTS`, no version table); `state.ts:131-133` raises `UnusableRecordError` on any version mismatch and `resume.ts:96-101` turns that into a seam.

**Evidence** (`a5stores.test.ts` › 1c/1f):

```
older schema open -> threw: Error: table lease has no column named high_water
newer record version -> { kind: 'seam', reason: 'version 2, expected 1', fromSequence: 11 }
```

**Impact**: a downgrade or a mixed-version rollout discontinues every market's latent state silently-but-logged; an operator deploying a new schema against an old database gets a prepare error with no guidance.

**Recommended fix**: treat `version > STATE_RECORD_VERSION` as `CorruptRecordError` (refuse to start), and add a `PRAGMA user_version` check with an explicit migration or refusal.

### a5-12 — A successor publishing key can re-attribute pre-rotation windows to itself and the chain still verifies

**Severity**: minor (informational: content is unchanged, only attribution)

**Where**: `packages/distribution/src/signing.ts:239-269` — the epoch rule is non-decreasing forwards; nothing forbids epoch-1 signatures _before_ the rotation head.

**Evidence** (`a5dist.test.ts`): `new key re-attributes pre-rotation windows -> null` (verified clean); the converse `old key signs post-rotation window -> Commitment 4 is signed by key epoch 0, after the chain had reached epoch 1` is refused; a rotated chain without its rotation log is refused.

**Recommended fix**: if attribution is meant to be attested, require links at index < `requiredFrom[epoch]` to be signed at epoch < that epoch; otherwise document that the chain attests content, not which key signed a given window.

## What survived

- **Stale-leader fencing** (`a5lease.test.ts` › 2c): on both stores, A acquires, clock passes expiry, B acquires and appends, A's append and `saveFenced` → `StaleFenceError`; an expired-but-unreplaced grant is also refused. Two handles on one SQLite file agree on the lease. `sqliteConcurrency.test.ts` (child processes against the built `dist`): 2/2 passed.
- **Seam markers** (2d): a gap without a marker → `RangeError`; `priceAt` inside the gap → `null`, at the gap edges → the edge prices; `spansSeam` true on overlap, false on either side.
- **Backfill** (`a5backfill.test.ts`): backfill-then-continue is tick-for-tick identical to a market run live throughout (3 579 + 154 ticks), sequences contiguous across the join, `resumeMarket` at T → `resumed` with an identical continuation; steps of 15 000 and 7 001 ms give one tick stream and identical candle counts; the "refuses to run twice on both stores" guard is real (plant caught by one test). The join defect is in candles only (a5-01).
- **Registry**: `retiredAt` persists across a reopen; path traversal refused; the overlay closed set is guarded by exactly 3 tests as PH-20.3 §5 claims — though all three are in `registry.test.ts` and `adminSurface.test.ts` did not fail, so "and surface" overstates it.
- **Settlement policy** (`a5trading.test.ts`): documented (`RUNTIME_AND_TRADING.md` "Entry and expiry both use `priceAtOrBefore`") and matching the code: a tick exactly at expiry is used; otherwise the last tick before; a record that ends before expiry → `NotSettleableError` ("has not expired"); a seam overlapping the window → refused; a seam whose last tick is exactly at expiry settles on that tick (boundary is strict `>` at `settle.ts:163` — consistent with `follower.ts:171,299-303`). Deterministic. ATM refund compares `logPrice` integers (`settle.ts:206`): 12345 vs 12345 → refund, 12345 vs 12346 → decided.
- **INV-001**: no file under `packages/{runtime,engine,core,distribution}/src` references exposure/limiter/contract/`@otc/trading` (grep); `apps/api/src` does not import `@otc/trading` at all, so nothing in the service feeds trading state anywhere — and, equally, no venue today calls `admit`/`ExposureBook` with the `EntryResolver` that B-016 says "a venue… must pass". The resolver itself works (200 contracts 1 ms apart → 1 event, 5 admitted against a 500 limit) and the plant that ignores it fails 4 tests.
- **Distribution**: Merkle inclusion verifies for every leaf at every tested size; tampering a price or instant by 1, a path byte, an over-long path, or a level-short proof all fail; the empty tree is refused; the signature covers asset, range, count, previousRoot and root (each alteration fails; a different key fails; a key-swap fails). Rotation forward-secrecy holds.
- **Chart** (`a5chart.test.ts`): 3 000 random windows/columns/tick sets → 0 violations: every column's open/high/low/close/count equals the brute-force reference, no empty column, union of highs/lows equals `windowExtremes`, and every tick assigned to a column lies inside that column's labelled `[fromInstant,toInstant)` (ticks placed on exact column boundaries included). `LiveBarBuilder` over 500 seeds never emits a bar for a bucket that began at or before the connect instant or the history head (CA6-30 closed at this layer), and every emitted bar equals the fold of all its ticks. `TickWindow` refuses gaps and evicts oldest-only; `toBars` refuses unordered input.
- **CA6-33 today**: `apps/api/src/venue.service.ts:354-364` uses `advanceDetailed`, keeps a `stalled` map, logs `STALLED — …` once per distinct reason, and `/health` reports `degraded` (`market.controller.ts:83`). A market past the bound still never recovers without a restart, as ADR-0010 decided — but it is now observable.
- **CA6-35** in `FileStateStore`: fixed (100/100 concurrent saves resolved; the same defect survives in the registry, a5-07).
- **Resources** (`a5leak.test.ts`): 500 open/close cycles of both SQLite stores → fd count 23 → 23; an unclosed `SqliteCoordinatedStore` holds 3 fds (60 for 20 — there is no finaliser, so callers must `close()`); 600 `FileStateStore` saves leave exactly `eurusd.json`. The only timer in scope (`venue.service.ts:406`) is cleared in `stop()` after awaiting the in-flight tick; the only bare `catch {}` blocks are in verifiers that document "never throws"; the `void error` swallows in `sqliteStore.ts:106,114` are inside a bounded retry that raises after 100 attempts.
- **`refreshRollup`** on memory and SQLite: hourly rows equal `foldCandles('1h', storedMinutes)` before and after appending more minutes; the rollup lags the minute tier until the next `flush()` (a `1h` read shows 11:00 while `30m` shows 14:30) — by design, on the checkpoint cadence.

## Limits of this audit

- a5-01 is demonstrated with `HostedMarket`, `HistoryRecorder`, `InMemoryCandleHistory` and `backfillMarket` — the exact classes `apps/api` composes — but the NestJS service was not restarted; `apps/api/src/restart.stat.test.ts` asserts sequences, not candles, so it would not have seen this either.
- The differential fuzz is my operation mix (40 ops, two holders, one asset, term 1 000 ms); it found only the known SQL-3 divergence and cannot prove there are no others.
- No fault injection below the filesystem (power loss), no `COMMIT` failure, no network filesystem, no multi-machine deployment.
- The `Last-Event-ID` / SSE handler (CA6-31/32) lives in `apps/api` and was read, not re-executed.
- The statistical suite, `npm run gate`, lint and coverage were not run, per the brief.
