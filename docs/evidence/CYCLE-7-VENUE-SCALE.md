# A hundred markets, hosted

Type: RECORDED EVIDENCE
Produced: 2026-09-02
Runner: `tools/sim/src/venueScale.ts` — in the repository, and reproducible
Command: `node tools/sim/dist/venueScale.js`
Seed: `venue-scale` (`OTC_VENUE_SEED`; every stream derives from it)
Machine: 16 cores, no other load — the demo engine and panel were stopped for
this run, because the scheduling figure is a wall-clock measurement and Cycle
Audit 6 (CA6-01) is the record of what happens when one is taken under
contention.

---

## Why this exists

`CYCLE-7-CATALOGUE-SCALE.md` answers whether a hundred assets can be
**registered**. This answers whether they can be **run**: what one advance of
the venue costs when it loops a hundred markets instead of five, and what a
quarter of history costs on disk. Both were extrapolations until this run —
"the markets share a clock and nothing else, so the cost should be linear" and
"131,759 candles per asset per quarter is what makes this affordable" — and an
extrapolation is what PH-21 exists to replace.

## Scheduling

Four venue sizes, built once and sliced, each advanced through six simulated
hours in 15-second steps — the catch-up bound, which is the step the service
itself uses (ADR-0010).

| markets | ticks published | wall seconds | µs per market-advance | ticks/s |
| ------- | --------------- | ------------ | --------------------- | ------- |
| 5       | 85,751          | 0.2          | 26.8                  | 444,716 |
| 25      | 836,443         | 1.9          | 52.9                  | 439,250 |
| 50      | 1,723,904       | 4.2          | 57.9                  | 413,723 |
| 100     | 3,311,069       | 8.0          | 55.7                  | 413,177 |

**The cost is linear in ticks, and the constant is small.** Twenty times the
markets cost forty times the wall clock — 0.2 s to 8.0 s — and forty times the
_ticks_: 85,751 to 3,311,069. Throughput is flat to within 7% across the whole
range, and that is the linearity this table establishes. Scheduling cost tracks
ticks published, not markets hosted.

The per-market-advance column is therefore not a cost curve, and reading it as
one was the first mistake made here. It doubles from 5 to 25 markets and then
stops, because **the sizes are not samples of the same catalogue**: the runner
assigns archetypes in rotation, so the 5-market slice is `major-fx`, `cross-fx`,
`blue-chip-index`, `sector-etf` and `metal` — and excludes `energy`,
`major-crypto` and `alt-crypto`, which are the three fastest tempo boxes. The
small venue is slower per market because it is made of slower markets, not
because a fixed cost is being amortised. Found by the PH-21 closure audit,
which recomputed the ratio from the table's own columns.

What that means for the product: at a hundred markets the venue spends **8
seconds of CPU per six simulated hours**, so a real-time venue of a hundred
assets uses on the order of **0.04% of one core** for generation. Generation is
not what will limit this catalogue.

The number that would have mattered if it had come out differently is the
second column of the last row: 3.3 million ticks in six hours is 153 ticks per
second across the venue, and every one is published, journalled and folded into
a candle by code this measurement does not include. The scheduling loop is
cheap; the paths downstream of it are the ones to watch next.

## Storage

Eight assets backfilled through two days into a real SQLite candle history.

```
8 assets x 2 days = 23,032 minute bars, 1.2 MB on disk (52 bytes per bar)
```

| per asset-day | per asset-quarter | 100 assets, one quarter |
| ------------- | ----------------- | ----------------------- |
| 75 kB         | 6.7 MB            | **0.67 GB**             |

Minute bars only; the hourly tier is derived from them and adds a sixtieth of
the rows.

**This confirms the number the catalogue's affordability rests on.**
`CATALOGUE_AND_PANEL.md` §4 says a quarter is 131,759 candles per asset because
the count is fixed by the calendar rather than by the tick rate: 129,599 minute
bars at the 52 bytes this run measured is 6.74 MB, which is the 6.7 MB above.
The claim was arithmetic; it is a measurement now.

A hundred assets, ninety days, **under a gigabyte** — on a laptop. The tick
record is the expensive tier and it is bounded by retention (fifteen minutes
plus the dispute window), not by the calendar.

## What this run corrected in its own instrument

The first execution reported **0.0 MB on disk** and a storage budget of
**0.00 GB** for a hundred assets — from 23,032 bars that had certainly been
written. The runner measured `history.db` with `stat` immediately after the
writes, and SQLite in WAL mode keeps everything in `history.db-wal` until a
checkpoint: the file it measured was nearly empty and the data was in the file
beside it.

It is worth recording rather than quietly fixing, because the number was not
absurd enough to be caught by reading it. "A hundred assets cost nothing to
store" is a _pleasant_ result in a project whose case for a large catalogue is
exactly that storage is cheap, and a pleasant wrong number is the kind that
survives review. What caught it was the per-bar figure the table did not have:
52 bytes is a plausible row and 0 bytes is not.

The runner closes the database before measuring now, and sums `history.db`,
`-wal` and `-shm`, so neither a checkpoint that has happened nor one that has
not can move the total. The per-bar column exists so that the next wrong number
is visible in the table rather than only in the total.

## What this does not settle

**Publication and history at a hundred markets.** This measures the venue's
scheduling loop and the store's footprint. Every tick the loop produces is then
handed to the publisher and the history recorder, and those paths are not in
these numbers.

**The store under concurrent readers.** One process, one writer. The multi-node
design has its own contract and its own conformance battery
(`MULTI_NODE_AND_OPERATIONS.md`), and no deployment composes it yet (Issue #9).
