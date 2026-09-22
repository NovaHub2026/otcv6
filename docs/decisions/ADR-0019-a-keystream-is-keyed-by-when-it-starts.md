# ADR-0019 — A keystream is keyed by when it starts

Status: ACCEPTED
Date: 2026-09-22
Phase: outside the phase sequence — a defect in the released `v2.0.0`, fixed on `fix/fresh-genesis-key` at the Human Owner's direction
Amends: ADR-0002 (what `keyEpoch` is for); Cycle Audit 10 a6-06 and a6-07 (which epoch a seam takes)

## Context

On 2026-09-22 the Human Owner reported what their broker's deployment of
`v2.0.0` showed on a five-minute chart: every one of the thirty assets drew the
same figure over and over — a vertical candle to one level, the same climb, the
same spike to the same high, the same fall, and again. Invisible on a
one-minute chart, obvious on five, and "totally predictable". The deployment,
they said, does not restart.

The engine was not the cause and could not have been: increments are
`sign × magnitude` with the sign an independent fair coin (ADR-0003), and the
same build, served locally with its state intact, gave an ordinary walk on the
same five-minute view. What repeated was **the walk itself**.

Every genesis derived its streams at `keyEpoch: 0` and started at lattice 0.
The keyring is a pure function of the master secret and the label
`{env, asset, purpose, keyEpoch}`, so under one secret a market started from an
empty state directory was the same market as every other market started from
one — tick for tick, interval for interval, shifted only in time. Measured on
the shipped build: two production processes started twenty seconds apart, each
on its own empty directory, agreed on the first thirty ticks of EUR/USD, BTC
and NVDA exactly. In the runtime's own tests, two geneses agreed on the
direction of **100%** of 400 ticks, in every one of four cases below.

It needs no restart an operator notices. A container brought back by its
restart policy, a state directory on no volume, a second replica behind the
same balancer — each is a fresh genesis on epoch 0, and each replays. With
`OTC_BACKFILL_DAYS` set it is worse: the backfill is a genesis too, so every
boot on an empty directory generated the same days and joined the live market
at the same point of the same walk, which is the chart the Human Owner sent —
the same level after every vertical candle.

Reading the recovery paths for the same mistake found two more:

- **A seam took `keyEpoch + 1`.** New relative to the record, and the same for
  anyone holding the record: a backup restored twice, or onto two machines,
  seamed twice onto one keystream, floored its cursors on the same leases and
  opened at the same price — the same increments from the same level.
- **A reopening past the record took epoch 1**, a constant (a6-06). Two of them
  were one market.

This is INV-006 broken in the most complete way available — anyone who recorded
one run holds the next — and INV-010 with it, since recorded history became a
predictor of the future. The predictability battery cannot see it: within one
run nothing is wrong.

## Decision

1. **Every keystream a market starts is keyed by the instant it starts.** A
   genesis, a backfill's genesis, a seam and a reopening past the record all
   take `startKeyEpoch(instant, previous)` (`packages/runtime/src/genesis.ts`):
   the instant in milliseconds times `START_EPOCH_SPAN` (1,024), and never at or
   below the epoch the market was on.
2. **Each millisecond owns a run of 1,024 epochs.** The run is what lets a start
   on a clock that has not moved — only a test clock does — take the next epoch
   without landing on the epoch a start one millisecond later would take. Every
   instant before the year 2248 keeps its whole run inside the safe integers the
   stream label requires; an instant outside that is refused.
3. **The label does not change.** `canonicalLabel` is a durable contract
   (ADR-0002) and nothing here needs a new component: the epoch was already a
   label field, already written into every checkpoint and already carried by
   every fork. What changes is which epoch a start chooses.
4. **A running market does not move.** A checkpoint on epoch 0 resumes on epoch
   0, exactly as before, so no deployment re-keys on upgrade and no published
   tick is regenerated differently. A legacy market moves onto its instant's
   run at its next seam, which is a keystream change it was going to make
   anyway.

## Consequences

- **Two starts at different milliseconds under one secret are unrelated
  markets.** Measured after the fix: direction agreement 0.418–0.480 over the
  same four cases (a replay reads 1.000), and the two production processes
  twenty seconds apart share almost no prices.
- **Reproducibility is unchanged (INV-009).** The epoch is written into the
  first checkpoint now rather than being the absent default, so a resume
  indexes the keystream its cursors belong to; `genesis.test.ts` asserts the
  resumed market continues tick for tick.
- **Nothing private is exposed (INV-010).** The instant is public and the epoch
  is a label; the stream key is still derived from the master secret.
- **What this does not fix is a deployment that keeps losing its state.** Each
  lost directory is still a genesis: the price returns to the reference price
  and the market starts again — a different market now, but a discontinuity
  every observer sees and a record that starts over. The integration guide says
  how to see it (`recovery.kind` of `fresh` after the first boot) and what it
  means.
- **Two processes started in the same millisecond with the same secret are
  still one market.** That is two engines on one deployment, which ADR-0018
  already forbids and ADR-0012's lease exists to prevent; this decision does
  not pretend to make it safe.
- **Tests that leaned on the epoch-0 realisation** — a hard-coded offset that
  set up a tie, ten minutes that happened to hold a regime change, a pace bound
  one millisecond tighter than the bisection that produces it — now search for
  what they need, or assert the mechanism's own tolerance. None was retuned to
  a new lucky seed.
