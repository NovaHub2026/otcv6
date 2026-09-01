# What ninety days of history costs

Type: RECORDED EVIDENCE
Produced: 2026-09-01
Method: `backfillMarket` from genesis to genesis + 90 days, one asset per run,
15-second steps, in-memory history, Node 24 on one core
Command: `node backfillScale.mjs <asset> 90` against `packages/runtime/dist`

---

## Why this exists

PH-17.3 had to choose what a ninety-day chart is made of before it could build
one. The two candidates were ticks and candles, and the difference between them
is three orders of magnitude — so the choice deserved a measurement rather than
an estimate.

## Result

| Asset  | ticks generated | minute bars | hourly bars | seconds | ticks/s | candles as JSON |
| ------ | --------------- | ----------- | ----------- | ------- | ------- | --------------- |
| spx    | 2,302,010       | 129,599     | 2,160       | 7.1     | 324k    | 21.3 MB         |
| xauusd | 3,877,620       | 129,599     | 2,160       | 11.6    | 335k    | 22.2 MB         |
| eurusd | 5,541,871       | 129,599     | 2,160       | 15.7    | 353k    | 21.6 MB         |
| gbpjpy | 10,674,532      | 129,599     | 2,160       | 21.2    | 504k    | 21.7 MB         |
| btcusd | 22,782,030      | 129,599     | 2,160       | 59.0    | 386k    | 21.9 MB         |

Peak resident memory stayed between 237 MB and 265 MB across every run, because
the retained tick tail is bounded and the candles are flushed as they close.

## What it says

**The candle count is fixed by the calendar, not by the asset.** `btcusd`
generates ten times the ticks of `spx` over the same ninety days and stores
exactly the same 131,759 bars. That single fact is what makes a hundred-asset
catalogue affordable: the storage bill is a property of how long the venue has
existed, not of how busy its markets are.

**Ticks were never a candidate.** The five current assets alone would be 45.2
million tick rows for one quarter. A hundred assets at the catalogue's mean pace
is of order a billion, for data whose only consumer is a chart that reduces it to
a few hundred columns.

**Provisioning a catalogue is minutes, not hours.** 115 seconds for five assets
on one core. A hundred assets at the same mean is roughly 38 minutes
single-threaded and proportionally less across cores, and it happens once.

**JSON is the wrong number for storage, and it is the number that was measured.**
21–22 MB per asset is the serialised form; the SQLite table stores ten integers
and a short string per row, so the real figure is smaller. It is quoted as
measured rather than as estimated, and the conclusion — that history is bounded
by time rather than by pace — does not depend on which encoding is used.

## What was not measured

Read latency against a populated database, and the cost with a hundred assets
sharing one file. Both belong to a deployment that does not exist yet, and
guessing at them here would be the kind of number that reads as a guarantee.
