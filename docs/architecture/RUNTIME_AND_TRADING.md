# Runtime and trading

Type: SUPPORTING DOCUMENTATION (living)
Describes: the hosting, persistence and trading layers as they exist today
Added: Cycle Audit 2, which found these layers described in no architecture
document at all while `OVERVIEW.md` still marked `apps/api` "(not yet built)"

---

## Why this document exists

PH-5 and PH-6 built three packages and an application, and `docs/architecture/`
did not mention any of them. `OVERVIEW.md`'s own header promises "the system as it
exists today" and says "layers that do not appear here do not exist yet" — so a
fresh agent following `GOVERNANCE.md` §71 was being told, in writing, that the
runtime, the persistence layer and the trading boundary did not exist.

## The layers

```
apps/api            NestJS: lifecycle, scheduling, checkpoint cadence, HTTP
  └── @otc/runtime  hosted markets, venue supervision, sealed persistence
        └── @otc/engine   the generative model
              └── @otc/core   kernel: time, entropy, market primitives

@otc/trading        contracts and settlement — depends only on @otc/core,
                    and NOTHING depends on it
```

Direction is enforced by `dependencies.test.ts`, not by convention: an allowlist
per workspace, a ban on frameworks below `apps/`, a requirement that every
`@otc/*` import be declared, and — since Cycle Audit 2 — detection of dynamic
`import()` and of relative paths that escape a package.

## A market advances with the clock, not with polling

`HostedMarket` publishes everything **due** at the clock's reading. Polling twice
as fast produces the same ticks at the same instants; not polling for a minute
produces a minute of ticks at once. That is what makes the market shared
(INV-002) rather than an artefact of process scheduling.

The engine cannot report when its next tick falls without producing it, so the
runtime draws one ahead and holds it un-published. That pending tick is the only
thing the runtime knows about the future.

Catch-up is bounded, and the bound applies from the engine's start instant rather
than from the first publication — it did not, and a fresh market with a past
genesis published 68,160 ticks against a one-second bound.

## The venue shares a clock and nothing else

Separate engines, separate key material, separate latent state. Markets are
advanced in isolation: a fault in one asset must not lose another's already
consumed ticks or stop it advancing, which it did until Cycle Audit 2. Enforced
by a test that requires an asset hosted in the venue to produce the **identical**
tick array it produces alone.

## Persistence: three fields and a policy

A checkpoint is `(snapshot, pending, lastPublished)`. `pending` is stored
separately because restoring the snapshot alone skips a tick.

Recovery has two branches:

- **Snapshot intact** — restore and let the clock pull the market forward.
  Regenerated ticks are identical, which is what INV-009 asks for.
- **Snapshot unusable** — seam: continue from the last published price, forward
  only. The seam opens at the clock rather than at the stale checkpoint, and both
  keystream cursors and **sequence numbers** are leased ahead, so nothing is ever
  published twice under one asset id. A checkpoint older than the 15 s catch-up
  bound is unusable by definition, so **every deploy-length restart seams**.
  With a durable record (PH-28) the seamed market's feed begins at the seam
  rather than at the record's tail — the feed is gapless by contract and the
  next tick lands a lease ahead — and the commitment chain is restarted there,
  in the file and at the next boot's priming, with the break named by the
  verifier. Found by the release run (PH-30.4): primed with the pre-seam tail,
  the venue refused every post-seam tick and served nothing, and the following
  boot died folding the record across the jump.

A record that exists but cannot be read is neither: the market refuses to start,
because the information needed to seam safely is exactly what was lost. So does
a record whose `version` is newer than this code's (a5-11); only an _older_
version is seamed past.

Checkpoint and registration files are written to a per-call temporary name,
`fsync`ed — file, then directory — and renamed into place (`atomicFile.ts`,
a5-10); before 2026-09-02 nothing in the repository called `fsync`, so a power
loss could leave an empty or stale checkpoint. Both SQLite databases carry a
schema version (`PRAGMA user_version`) and refuse a file written by newer code
before any statement runs. A leader keeps every tick the store refused and
appends it before anything newer; no checkpoint is written while ticks are
unrecorded, and after three consecutive refusals it releases the lease (a5-03).
The multi-node design is described in
[`MULTI_NODE_AND_OPERATIONS.md`](MULTI_NODE_AND_OPERATIONS.md).

## The published record outlives the process (PH-28.1)

A checkpoint is what a market needs to _continue_; it says nothing about what
was _published_. PH-25.1 measured the cost across a `SIGKILL`: the feed's
replay window was process-local, so a client holding a sequence from before
the resume point was refused as evicted though nothing had been evicted, and
the minute the kill fell in was withheld by the resumed recorder because it
saw that minute from inside.

`SqliteTickRecord` (`packages/runtime/src/tickRecord.ts`) is the published
record persisted: sequence, instant and price per tick — what a `tick` frame
carries and nothing of the engine (INV-010) — in one database in the state
directory (`OTC_RECORD_DB`, default `<state dir>/record.db`), bounded per asset
(`OTC_RECORD_TICKS`, default 250 000, at least the feed's own window). The
venue appends every pass to it in one transaction **before** the feed, the
publisher and the history see the batch, and what comes back is which ticks
were new: a resumed market's republication of the ticks between its checkpoint
and the kill is compared with the record and returned as nothing, so no tick
is served twice; a held sequence offered with a different instant or price is a
fork — two streams claiming one id, INV-002 broken — and the market is unhosted
and stalled by name rather than published over the record. At boot the feed's
window is primed from the record's newest contiguous run and the history
recorder is handed the record's ticks after the newest stored minute before any
live tick, so a resume across a restart is honoured and the minute a kill fell
in is stored whole. Asserted in-process in `venueRecord.test.ts` and over the
socket, against a spawned service killed with `SIGKILL`, in
`servedRecord.stat.test.ts`. Nothing reaches the engine from any of it
(INV-001).

The directory those files live in is verified as one thing before any market
resumes and can be backed up consistently while the venue runs; the
commitment chain continues across a restart from the same record
(`MULTI_NODE_AND_OPERATIONS.md` §5, PH-28.3).

## Settlement reads the record, never the engine

`settle()` is a pure function of the published ticks and a contract. No keys, no
latent state, no engine — so anyone holding the series can recompute any outcome.
Entry and expiry both use `priceAtOrBefore`, the same rule the charts draw and the
battery samples with.

A tie is refunded ([ADR-0007](../decisions/ADR-0007-at-the-money-settlement.md)).

**Money is an integer in the broker's minor unit** (PH-29.4, Issue #11): a
stake is a positive safe integer, a payout ratio a decimal with at most four
places, and a winning contract returns `stake + floor(stake × ratio)` computed
in integer arithmetic — `payoutMinor` — so `returned`, `net` and every ledger
sum are integers. The audit had measured the floating-point form returning a
fraction of a minor unit for 95 000 of 100 000 cent stakes. The exposure book
and the limiter charge the same exact obligation.

**And the venue answers the two prices a settlement needs** (PH-29.1): the
price in force at an instant, by this rule, and the proof that it is in the
signed record; `@otc/client`'s `VenueClient` asks for them and `settle()` over
the ticks it subscribed to agrees (`conformance.stat.test.ts`).

## Where economic blindness is actually enforced

Three mechanisms, and Cycle Audit 2 showed the first two were not enough on their
own:

1. **Vocabulary** — the source scan rejects economic and contract terms in the
   generation roots. It matches names, so an unlisted identifier passes.
2. **Direction** — nothing below `apps/` may import a framework, and the engine
   cannot import trading. Ambient channels (`globalThis`, `process.env`) are now
   banned in the generation roots, because an audit backdoor used both and every
   import- and name-based check passed it.
3. **Behaviour** — the tick stream is byte-identical between a quiet market and
   one under heavy adversarial trading, and settlement is direction-symmetric.
   The second was added by Cycle Audit 2: a settlement rule shaving small wins
   into refunds left the ticks untouched and passed everything else.
