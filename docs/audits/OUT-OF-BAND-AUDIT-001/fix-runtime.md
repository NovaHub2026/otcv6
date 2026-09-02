# Fix report — runtime / distribution / trading (a5 findings)

Worktree: `/home/alejo/.otc-audit7/fix` (branch `feature/out-of-band-audit`). No git command that changes the tree was run. Every edit is under `packages/runtime/src/`, `packages/distribution/src/`, or `apps/api/src/history.service.ts`; `packages/trading/src/` needed no change (a5-08 skipped as instructed). All commands below were run from the worktree root; every exit code quoted was observed.

## Files changed or added (27)

Modified:

```
apps/api/src/history.service.ts
packages/distribution/src/feed.test.ts
packages/distribution/src/feed.ts
packages/distribution/src/index.ts
packages/distribution/src/retention.test.ts
packages/distribution/src/signing.ts
packages/runtime/src/backfill.test.ts
packages/runtime/src/backfill.ts
packages/runtime/src/failover.test.ts
packages/runtime/src/failover.ts
packages/runtime/src/fileStore.ts
packages/runtime/src/history.test.ts
packages/runtime/src/history.ts
packages/runtime/src/historyConformance.test.ts
packages/runtime/src/index.ts
packages/runtime/src/lease.ts
packages/runtime/src/leaseConformance.test.ts
packages/runtime/src/registry.test.ts
packages/runtime/src/registry.ts
packages/runtime/src/replication.ts
packages/runtime/src/resume.test.ts
packages/runtime/src/sqliteHistory.ts
packages/runtime/src/sqliteStore.test.ts
packages/runtime/src/sqliteStore.ts
packages/runtime/src/state.ts
```

Added:

```
packages/runtime/src/atomicFile.ts
packages/runtime/src/sqlite.ts
```

Also emitted (deliberately, as the brief allows): `packages/runtime/dist/**` via `npx tsc -p packages/runtime/tsconfig.json` — needed by `sqliteConcurrency.test.ts` and by `apps/api`'s typecheck, which resolves `@otc/runtime` through the emitted declarations. Only runtime was emitted (`-p`, not `-b`), so the engine the other agent is editing was not rebuilt.

**One process slip, verified harmless.** My first `npx prettier --write` took its file list from `git status`, which also lists the other agent's and the orchestrator's in-flight files. Prettier rewrites a file only when its formatting differs; it rewrote exactly four files, all mine (`history.ts`, `registry.ts`, `registry.test.ts`, `sqliteStore.test.ts`, mtimes 10:40:52.56–10:40:52.89). No out-of-lane file has an mtime in that window; the nearest (`packages/lab/src/attacks/battery.ts`, 10:40:51.784) sits inside a burst of writes to files I never passed to Prettier (`fixtures.ts` 51.143, `battery.test.ts` 51.856, `realism.ts` 52.016), i.e. the other agent's own write, and `prettier --check` on those files passes. The `git diff` of any out-of-lane file is theirs, not mine.

## Per finding

### a5-01 (material) — partial first minute stored at every recorder handoff

**Changed:** `packages/runtime/src/history.ts` (`HistoryRecorder`, `FIRST_SEQUENCE`, `HistoryRecorderStart`, `lastStoredSequence`), `backfill.ts` (`BackfillResult.recorder`), `apps/api/src/history.service.ts`, `index.ts` (exports), `history.test.ts`, `backfill.test.ts`, `historyConformance.test.ts` (constructor call).

**Rule.** A recorder must be told where it joins the stream: `new HistoryRecorder({ continuesAfter })`, where `continuesAfter` is the `lastSequence` of the newest stored base bar, `null` when nothing is stored, or `'unknown'` (then `continueAfter(n)` must be called before the first `drain()`, which otherwise throws `HistoryError` rather than quietly returning nothing). The first bucket it opens is stored only if its first tick's sequence is `(continuesAfter ?? 0) + 1` — the tick that immediately follows the stored head, or sequence 1 when nothing is stored (nothing precedes genesis). Otherwise the bucket is **withheld** (`recorder.withheld` names it) and the minute tier shows a hole, visible because the bars either side are not contiguous in sequence. A first tick at or below `continuesAfter` is refused (`HistoryError`): that is a different stream under the same id, not a replay. `open()` returns null while the open bucket is an unproven first one.

Why sequences and not instants: `assertTickOrder` allows two ticks to share a millisecond, so "the first tick lands exactly on the bucket start" proves nothing; "nothing was missed since the stored head" is exactly what `lastSequence + 1` proves.

**Backfill → live join.** `backfillMarket` now returns its own recorder (`BackfillResult.recorder`), constructed `{ continuesAfter: null }` behind the guard that already proves the history empty; it has folded every tick and holds the target's minute open. `HistoryService.provision` adopts it (`this.recorders.set(id, result.recorder)`) before `#catchUp`, so the join minute closes on the live side with all its ticks. Preferred over seeding a fresh recorder from `retainedTicks` because the recorder has _seen_ the ticks — no second fold, and correct even if `tickRetentionMs` is shorter than a minute.

**Plain restart.** `HistoryService.observe` is synchronous and the store is not, so a recorder created there starts `'unknown'`; `flush()` calls `recorder.continueAfter(await lastStoredSequence(history, assetId))` before draining, and logs once per asset when a minute was withheld. On a plain restart the previous process's open bar is always lost (a clean shutdown flushes closed bars only), so the restart minute is always withheld: an honest one-minute hole instead of a short bar. This is fallback (a) of the brief; the ticks needed for (b) exist in no source `HistoryService` can reach in the single-node deployment (the publication journal lives in `apps/api`, which is outside my lane). Closing that hole is a follow-up: persist the recorder's open-bucket ticks alongside the checkpoint, or read them back from the publication journal — either is a small addition once decided.

**Reproduction (before), `npx vitest run --project unit packages/runtime/src/history.test.ts packages/runtime/src/backfill.test.ts`:**

```
× a recorder that begins inside a minute never stores that minute (a5-01) > withholds the bucket it did not see from its start, and stores every later one whole
  → minute 1776000120000: expected { openInstant: 1776000120000, …(8) } to deeply equal { … }
     -   "tickCount": 10,
     +   "tickCount": 7,
× the minute containing the target is stored whole (a5-01) > hands the live path a recorder that has seen the open minute, so the join minute is not short
  → TypeError: Cannot read properties of undefined (reading 'accept')
Tests  9 failed | 55 passed
```

The restart minute is stored with 7 of its 10 ticks; there is no recorder to carry across the join.

**After:** `history.test.ts` 29/29 (eight new tests: withheld restart bucket with every stored bar equal to `foldTicks('1m', all)`; exact continuation keeps its first bucket; unaligned genesis bucket kept; empty store + non-genesis stream withheld; deferred `continueAfter`; restart-behind-head refused; `open()` null on an unproven first bucket; `lastStoredSequence`). `backfill.test.ts` join test: the minute containing a target 30 s into a minute, stored via the handed-over recorder, `toEqual`s the live fold of that minute. `apps/api/src/adminSurface.test.ts` 30/30 unchanged.

**Test the orchestrator should add in `apps/api/src/adminSurface.test.ts`** (outside my lane): construct a `HistoryService` over an `InMemoryCandleHistory` already holding minutes through `k`, `observe` ticks from `k+3`, `flush`, and assert the first stored minute after the head is the one whose first tick is the first seen tick's _next_ bucket and that `service.read` shows a hole (no bar) for the join minute.

### a5-02 (material) — retention boundary untested

**Changed:** `packages/distribution/src/retention.test.ts` only. The mislabelled "exactly on the boundary" test (90 days, 15 minutes inside the reach) is renamed "keeps a journal on the last day of the window" with a comment saying it is not the boundary; a new test holds `newestInstant = NOW − (90 d + LONGEST_HORIZON_MS)` (kept) and one millisecond older (pruned), through `journalIsPruneable` and `partitionForRetention`.

**Plant:** `sed -i 's/newestInstant > retentionReachMs/newestInstant >= retentionReachMs/' packages/distribution/src/retention.ts`

```
× keeps a journal exactly at the reach, and prunes it one millisecond later (a5-02)
  → expected true to be false
Tests  1 failed | 24 passed (25)
```

Restored with the inverse `sed` (verified by `grep` and an empty `git diff --stat` on `retention.ts`): `Tests 25 passed (25)`.

### a5-03 (material) — one transient `appendTicks` failure wedges a `LeaderSession`

**Changed:** `packages/runtime/src/failover.ts` (`MAX_CONSECUTIVE_APPEND_FAILURES = 3`, `SessionAdvance.unrecorded` / `.recordError`, `LeadershipLostError` carries `cause`, `LeaderSession.unrecorded`, `#recordPendingSeam`, `#recordRefused`), `index.ts`, `failover.test.ts` (a delegating `FailingAppendStore`, three tests; `base`/`lead` widened to `CoordinatedStore`).

**Design.** Every generated tick is pushed onto `#unrecorded` before the append; the append writes the whole outstanding list, oldest first (the stores accept identical replays). On refusal: a `StaleFenceError` is not transient — the lease is released and `LeadershipLostError` thrown at once; anything else is counted, kept, and returned as `{ unrecorded, recordError }` so the caller keeps fanning out (throwing would make the leader's own feed gap and `TickFeed.publish` refuse the next batch); at the bound the lease is _released_ (a successor need not wait out the term) and `LeadershipLostError(assetId, cause)` thrown. **The record leads the checkpoint:** no checkpoint is written — on the cadence or via `checkpoint()` — while ticks are unrecorded, because a successor resumes from the checkpoint and its first append would otherwise be a gap, handing the wedge on. Three at the 5 s cadence is 15 s, the catch-up bound, so stepping aside there costs the successor nothing the outage had not already cost.

**Reproduction (before), `npx vitest run --project unit packages/runtime/src/failover.test.ts`:**

```
× keeps the unappended ticks and retries them first, so the record catches up
  → SQLITE_BUSY: database is locked (simulated)
× never writes a checkpoint the record has not caught up with
  → SQLITE_BUSY: database is locked (simulated)
× gives leadership up after repeated failures, so a successor takes over rather than nobody noticing
  → expected null to be an instance of LeadershipLostError
Tests  3 failed | 13 passed (16)
```

**After:** `failover.test.ts`, `cluster.test.ts`, `multiNode.test.ts`, `failoverBound.test.ts`: 25/25. The first test asserts `recordHead === market.lastPublishedSequence` after the next advance, a gapless record and no seam; the second asserts `checkpointed === false`, `store.load` unchanged, `checkpoint()` rejecting, then a checkpoint whose `lastPublished` equals the record head once caught up; the third asserts `LeadershipLostError` with an `Error` cause after exactly `MAX − 1` reported failures, `inspect` null, and a successor that resumes (not seams) and whose record catches up.

### a5-05 (minor, B-019 SQL-1 / SQL-3)

**Changed:** `sqliteStore.ts` (`now` read inside `#inTransaction` for `acquire`/`renew`/`release`/`inspect`; `malformedBatch` inside `appendTicks`), `replication.ts` (`malformedBatch`), `lease.ts` (same check in the memory store), `leaseConformance.test.ts`, `sqliteStore.test.ts`, `index.ts`.

**Batch rule decided:** a batch that repeats or reorders a sequence is refused whole with a `RangeError` _before_ any comparison with the record, on both stores. Alternative was SQLite's accept-and-deduplicate; rejected because a batch that disagrees with itself is not one writer's output (`HostedMarket` never produces one), and reconciling it against itself is where `RecordForkError` — "two concurrent leaders" — was being raised for a single writer's malformed batch. Specified in the conformance battery, so both stores are held to it.

**Reproduction (before):** conformance, SQLite: `× refuses a batch that repeats or reorders a sequence … → promise resolved "undefined" instead of rejecting` (memory already refused, via the misleading "no tick there to compare against"). Clock: a `Clock` whose `now()` tries `BEGIN IMMEDIATE` through a second connection with `busy_timeout = 0` and counts a success as a reading taken outside the lock: `× does not consult the clock before the transaction holds the lock → clock readings taken before the lock was held: expected 4 to be +0`. **After:** `sqliteStore.test.ts` 102/102 (both batteries).

### a5-06 (minor) — synchronous throw on `SQLITE_BUSY`

**Changed:** `sqliteStore.ts` `#inTransaction`: `BEGIN IMMEDIATE` in its own `try` (rejects), body + `COMMIT` in a second `try` whose catch rolls back only `if (this.#db.isTransaction)` (Node 24's `DatabaseSync.isTransaction`, verified present) and rejects; constructor gains `busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS` (5 000, in `sqlite.ts`, whose docstring states that the wait is synchronous and inherent to `node:sqlite`, and that what the store guarantees is the contract at the end of it).

**Reproduction (before):** `× turns SQLITE_BUSY into a rejection … 5014ms → expected [Function] to not throw an error but 'Error: database is locked' was thrown`. **After:** passes with a 50 ms busy timeout; the second `acquire` after the holder commits is granted, proving no transaction was left open.

### a5-07 (minor) — registry temp-path race, filename trust, bare `SyntaxError`

**Changed:** new `atomicFile.ts` (`replaceFileAtomically`, `createFileExclusively`: per-call temp names `${target}.${pid}.${n}.tmp`, `fsync` file then directory), `registry.ts` (overlay edits serialised through a promise queue that never breaks; `add` publishes with `link` — exclusive, `EEXIST` → `AlreadyRegisteredError`; `parseRegistration` wraps every `JSON.parse` into `CorruptRegistrationError` naming the file; `asStored` refuses a file not named `${definition.id}.json`), `registry.test.ts` (four new tests; the three existing refusal tests now write `eurusd.json` so the refusal they see is the one they name).

**Reproduction (before), `npx vitest run --project unit packages/runtime/src/registry.test.ts`:**

```
× stores every one of twenty concurrent overlay edits → expected [ { status: 'rejected', …(1) }, …(18) ] to deeply equal []
× refuses a file whose name is not the id it contains → expected null to be an instance of CorruptRegistrationError
× reports a truncated file as a corrupt registration naming the file … → expected SyntaxError: Expected double-quoted prope… to be an instance of CorruptRegistrationError
× admits exactly one of ten concurrent registrations of one id → expected Error: ENOENT: no such file or directory,… to be an instance of AlreadyRegisteredError
Tests  4 failed | 17 passed (21)
```

**After:** 21/21. (`resume.test.ts`'s 100-concurrent-save test for `FileStateStore` still passes through the shared helper.)

### a5-09 (minor) — feed accepts an unpublished sequence on an empty history

**Changed:** `feed.ts` (`FIRST_SEQUENCE = 1`; with empty history, only `fromSequence === 1` is accepted, else `UnknownSequenceError(assetId, requested, 0)`), `index.ts`, `feed.test.ts`. **Before:** `× refuses an unpublished sequence before anything has been published (a5-09) → expected function to throw an error, but it didn't`. **After:** 15/15; `since(…, 1)` on an empty feed returns `[]` and a subscription from 1 receives ticks 1..3 once published.

### a5-10 (minor) — no `fsync`; unretried WAL in the history database

**Changed:** `atomicFile.ts` (above; `fileStore.ts` and `registry.ts` use it — the file is `fsync`ed before `rename`/`link`, the directory after; directory sync failures with `EINVAL/EISDIR/ENOTSUP/EPERM` are tolerated as "this filesystem refuses the operation", the file's own sync never is), new `sqlite.ts` (`enableWriteAheadLog` moved out of `sqliteStore.ts` and shared; `DEFAULT_BUSY_TIMEOUT_MS`; `WAL_ATTEMPTS`), `sqliteHistory.ts` (uses the shared retried WAL enable; `synchronous = FULL` instead of `NORMAL`, with the reason in its docstring: a minute bar lost from the last WAL frames after retention has deleted its ticks is a permanent hole). Docstrings in `fileStore.ts` and `sqliteHistory.ts` say why. No test can watch a power loss; the multi-process open path is exercised by `sqliteConcurrency.test.ts` (2/2 against the rebuilt `dist`) and the history now opens through the same code the store's 'is in WAL mode' test covers.

### a5-11 (minor) — schema and record versioning

**Changed:** `state.ts` (`assertUsableRecord`: `version > STATE_RECORD_VERSION` → `CorruptRecordError` naming both versions, i.e. refuse to start; older → `UnusableRecordError` → seam, as before), `sqlite.ts` (`assertSchemaNotNewer`, `stampSchemaVersion`), `sqliteStore.ts` (`STORE_SCHEMA_VERSION = 1`, checked before any statement and stamped after the schema), `sqliteHistory.ts` (`HISTORY_SCHEMA_VERSION = 1`, same), `resume.test.ts` (the six `STATE_RECORD_VERSION + 1` "force a seam" fixtures became `STATE_RECORD_VERSION − 1`, plus a new refusal test), `sqliteStore.test.ts` (three schema tests). An unversioned (`user_version = 0`) file is stamped; an older _shape_ under 0 still fails closed at `prepare` as before — no migration exists because no schema has changed yet, and the helper's docstring says that is where one will be asked for.

**Before:** `× refuses to start on a record newer than this code understands (a5-11) → promise resolved "{ market: HostedMarket{}, …(1) }" instead of rejecting`; `× stamps a new database with the schema version it created → expected +0 to be 1`; `× refuses a database whose schema is newer … → expected [Function] to throw an error`; `× versions the candle history the same way → expected +0 to be 1`. **After:** `resume.test.ts` 26/26, `sqliteStore.test.ts` 102/102 (the refusal messages name `42` and `1`).

### a5-04 (minor) — `readTimeframe` leading edge depends on the window; bar returned at `to`

**Changed:** `history.ts` (`readTimeframe`: result clipped to `openInstant < to`; the leading-edge check runs on `complete[0]` unconditionally; `refreshRollup`: the first hour ever rolled up is skipped unless whole; shared `beginsWhole`), `history.test.ts` (three tests).

**Decision, and the alternative.** The literal "drop whenever the preceding source bucket is empty" rule would also drop the bucket _genesis_ falls inside — the existing `folds 15m/30m from the minute tier` tests fail under it, and in production every provisioned asset's daily chart would start a day late (ninety days becomes eighty-nine). So a leading bucket is kept when its first source bar opens on the bucket, **or carries sequence 1** (nothing precedes genesis, so the bucket is whole by definition — the report itself notes this), or the source series holds anything in the target bucket before it (history already running); otherwise dropped. The rollup applies the same rule to its first-ever hour, which is what makes the 1h and 30m views agree (the report's `[10, 159]` hour is no longer stored unless it is genesis). Holes _inside_ a running series are tolerated at every tier, as before, and are visible in the sequences either side.

**Before:** `× drops the bucket the history begins inside, whatever from is → expected 1775998800000 to be 1776000600000` (the 69-tick 10:00 half-hour returned when asked from 09:00); `× keeps the bucket genesis falls inside, whatever from is → expected 1776000600000 to be 1775998800000` (the genesis bucket dropped when asked from 10:00); `× returns no bar opening at to → 30m: expected 1776006000000 to be less than 1776006000000`. **After:** `history.test.ts` 32/32, `historyConformance.test.ts` and `adminSurface.test.ts` unchanged and green.

### a5-12 — documentation only

`packages/distribution/src/signing.ts`, `verifySignedChain` docstring: the chain attests content and that each link was signed by a key authorised no later than the link; it does not attest which key first signed a pre-rotation window, and a verifier that needs that must keep the signed commitments as originally published. No code change; `signing.test.ts` 30/30.

## Doc lines elsewhere that now need updating (orchestrator's lane)

- `docs/BACKLOG.md:31` (B-019 row) — append: **CLOSED 2026-09-02 (out-of-band audit, a5-05).** `acquire`/`renew`/`release`/`inspect` read the clock inside the transaction, asserted by a clock that probes the lock through a second connection; one batch rule shared by both stores — a batch that repeats or reorders a sequence is refused whole with a `RangeError` before any comparison with the record — specified in `leaseConformance.test.ts`.
- `docs/phases/PH-19-close-what-audit-six-falsified.md:64` — after "CA6-29 (partial bars)": add "— both of which an out-of-band audit (2026-09-02) found surviving one tier down: the minute tier stored a partial bar at every recorder handoff (a5-01) and the leading-edge rule depended on the query window (a5-04); closed there."
- `docs/phases/PH-16.3-operator-risk-and-retention.md:110` — add a row to the plant table: "| `>` planted as `>=` on the retention reach boundary | 0 before 2026-09-02; 1 since (a5-02) |".
- `docs/phases/PH-20.3-editing-and-retiring.md:87` — "3 tests — registry and surface" overstates: all three are in `registry.test.ts`; `adminSurface.test.ts` does not fail the plant (audit a5 measured it).
- `docs/architecture/RUNTIME_AND_TRADING.md:58` (Persistence section) — add: "Checkpoint and registration files are `fsync`ed, file then directory, before they are considered written (a5-10). Both SQLite databases carry a schema version (`PRAGMA user_version`); a file written by newer code is refused before any statement runs (a5-11)."
- `docs/architecture/RUNTIME_AND_TRADING.md:72` — after "the market refuses to start": add "so does a record whose `version` is newer than this code's (a5-11); only an _older_ version is seamed past."
- `docs/architecture/RUNTIME_AND_TRADING.md` (failover, if a section is added under B-023) — "A leader keeps every tick the store refused and appends it before anything newer; no checkpoint is written while ticks are unrecorded, and after three consecutive refusals it releases the lease (a5-03)."
- `docs/architecture/CATALOGUE_AND_PANEL.md:93` (after "Two stored tiers…") — add: "A recorder never stores a bucket it did not see from its start: its first bucket is stored only when its first tick immediately follows the newest stored bar, or is sequence 1. A restart therefore leaves a visible one-minute hole rather than a short bar labelled whole; the backfill hands its own recorder to the live path so the join minute is whole (a5-01). The first bar of any coarser read, and the first hour ever rolled up, is withheld unless the series covers it from its start or it holds genesis (a5-04)."
- `docs/architecture/CONSISTENCY_CONTRACT.md` — if it describes feed resumption: "an asset with no published history accepts a subscription from sequence 1 only (a5-09)". (No matching line found by grep; add where `TickFeed` is described.)

## Final commands (all from `/home/alejo/.otc-audit7/fix`)

```
npx vitest run --project unit packages/runtime packages/distribution packages/trading apps/api/src/adminSurface.test.ts
  Test Files  27 passed (27)   Tests  707 passed (707)   exit 0
npx tsc -p packages/runtime/tsconfig.json --noEmit        exit 0
npx tsc -p packages/distribution/tsconfig.json --noEmit   exit 0
npx tsc -p packages/trading/tsconfig.json --noEmit        exit 0
npx tsc -p apps/api/tsconfig.json --noEmit                exit 0   (after `npx tsc -p packages/runtime/tsconfig.json`, exit 0, which emits runtime's dist)
npx vitest run --project unit packages/runtime/src/sqliteConcurrency.test.ts   Tests 2 passed (2)   (against the rebuilt dist)
npx eslint <the 27 files above>                            exit 0
npx prettier --check <the 27 files above>                  exit 0  ("All matched files use Prettier code style!")
git -C /home/alejo/.otc-audit7/fix status --short | grep -E '(packages/runtime/src/|packages/distribution/src/|packages/trading/src/|apps/api/src/history\.service\.ts)'   → the 27 files listed above (25 M, 2 ??)
```

Not run, per the brief: `npm run build`, `lint`, `gate`, `npm test`, coverage, any `*.stat.test.ts`.
