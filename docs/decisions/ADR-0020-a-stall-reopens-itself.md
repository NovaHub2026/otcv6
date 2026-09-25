# ADR-0020 — A Market Past Its Catch-Up Bound Reopens Itself As A Seam

Type: DECISION RECORD
Status: APPROVED
Date: 2026-09-23
Supersedes: nothing. **Extends** [ADR-0010](ADR-0010-catch-up-bound.md), whose bound is unchanged, and applies [ADR-0019](ADR-0019-a-keystream-is-keyed-by-when-it-starts.md) to the reopening.
Decided by: the Human Owner, 2026-09-23 ("sí, hazlo con la costura automática"), on the third host suspension to freeze the venue.

---

## Context

A venue that loses the CPU for longer than fifteen seconds — a suspended
laptop, a stop-the-world pause, a container frozen by its host, a clock the
platform resynchronises — comes back with every market behind the clock. The
runtime refuses to advance them, permanently and by design: publishing the
missing interval at once would invent a stretch of market nobody observed, and
at thirty seconds that stretch is a whole contract's lifetime (ADR-0010).

The refusal has no exit. `#lastAdvancedAt` moves only after the bound check, so
the lag grows monotonically and no later advance can succeed. The venue reports
`degraded`, `otc_markets_stalled` counts every asset, and the market stays dead
until a person restarts the process.

A restart is not a repair of the outage. It is the acceptance of it: the market
reopens at the clock from its last published price, on a key epoch derived from
that instant (ADR-0019), with its sequence a full lease past everything
published. The record sees the sequence jump and writes a `RecordedSeam`, the
feed declares where its window begins, the commitment chain is sealed and
restarted, and `settle()` refuses any contract whose window touches the gap.

Every part of that already exists and is tested. The only thing a restart
contributes is the decision to take it.

## Decision

**The runtime takes that decision itself.** A market refused by the catch-up
bound is reopened in place, as a seam, and publishes again.

The reopening is exactly the one a restart performs:

- price: the market's last published price;
- instant: the clock, so the gap stays a gap;
- sequence: `lastPublished.sequence + DEFAULT_SEQUENCE_LEASE`, past every
  reserved position;
- key epoch: `startKeyEpoch(instant, previousEpoch)` — a keystream in which
  nothing has been drawn, never at or below the epoch the market was on;
- latent state: restarted, which is what a seam means.

## Bounds

1. **Only the catch-up bound reopens a market.** A publish refusal or a record
   refusal leaves the market stalled exactly as today. Those mean the venue and
   its record disagree about what was served; a seam would hide the
   disagreement.
2. **A market must publish before it may seam again**, and at least
   `MIN_REOPEN_INTERVAL_MS` must have passed since its last automatic seam.
   A process starving on every pass therefore stalls by name instead of writing
   a seam per pass.

   **Clarified 2026-09-25 (PH-39), without moving the bound.** The sentence is a
   correct definition of when a reopening is a _new_ seam, and it was attached to
   the wrong act: the code refused to reopen at all, so a market starved twice
   inside one outage was refused for the life of the process and the venue needed
   an operator. What the bound means is that a reopening that **served nothing**
   may not be recorded, declared or counted a second time — and it need not be,
   because it reserves the same sequence from the same carried tick. So such a
   market is **re-armed** at the clock on a fresh key epoch instead: nothing is
   written to the record, the feed's window and the sealed chain are the ones
   already declared, `otc_market_reopenings_total` does not move, and the market
   goes on reporting itself stalled until it publishes. A process starving on
   every pass still writes no seam per pass, which is what this bound is for.

3. **A market that has never published is not reopened.** There is no price to
   carry over; that case is a genesis, and it is the boot path's business.
4. **The bound itself does not move.** Fifteen seconds, half the shortest
   contract. Nothing about what a catch-up may generate changes.
5. **It can be switched off.** `OTC_AUTO_REOPEN=0` restores the previous
   behaviour for an operator who would rather a human decided. The default is
   on, because the default deployment is unattended.

## Consequences

- **A venue survives its host.** The market a broker serves comes back by
  itself after a suspension, a pause or a clock jump, with the outage recorded
  rather than smoothed over.
- **Seams stop being an operator-only event.** Until now a seam meant somebody
  restarted, restored or upgraded something. Now a live venue takes them, so
  the broker-facing documents say so and the client contract's refusal across a
  seam becomes a case that happens in normal operation rather than only at a
  deploy.
- **Contracts in flight across the outage are refused, not settled.** That was
  already the rule. This makes it reachable without an operator, which is why
  PH-36.1 verifies it on a live venue rather than on a constructed record.
- **An unstable host now leaves a visible trail**: one recorded seam per
  outage per asset, a counter in `/metrics`, and a log line naming the lag.
  A deployment that accumulates them has a host problem, and the record is what
  says so.

## What was considered and rejected

- **Raising the bound.** The bound is a product invariant, not a tuning knob:
  at thirty seconds a single catch-up spans a whole contract.
- **Generating the missing interval slowly** (replaying the outage in real
  time). The market would then publish a past it never had, at instants that
  have gone, and two observers either side of the replay would hold
  irreconcilable histories — INV-002 broken outright.
- **Seaming after a grace period** rather than at once. The market cannot
  recover during the grace period; waiting only lengthens the dead stretch and
  the gap the seam records.
- **Leaving it to a supervisor restart.** A restart re-derives thirty markets
  and loses every open connection to repair one condition the process can repair
  in place; and a host that suspends does not notify a supervisor.
