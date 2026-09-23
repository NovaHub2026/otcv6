# Release 2.3.1 — The Quiet Notice Is About The Engine, Not About The Market

Type: EVIDENCE (the release record)
Recorded: 2026-09-23
Tag: `v2.3.1` — `efef599`, gated green locally on `18db5cd` and corroborated by hosted CI on both jobs
Supersedes: [`RELEASE-2.3.0.md`](RELEASE-2.3.0.md) for deployment
Package: `tools/sim/scripts/integration-package.sh v2.3.1 <dir>`

---

## 1. Why this release exists

Running `v2.3.0`, the Human Owner reported that the chart "no está rodando el
precio actual y aparece como parpadeando". The price was rolling. What flickered
was the panel's own notice: it called a market stalled after **three mean tick
intervals** without a tick, and at the tick rates PH-34 and PH-35 settled on,
ordinary silence reaches that length constantly.

Measured from each asset's own mean interval, as a Poisson process at the
catalogue's realised rates:

| Asset   | mean interval | false notices an hour at 3× | at 20× and ≥15 s |
| ------- | ------------: | --------------------------: | ---------------: |
| EUR/USD |      1,010 ms |                   **193.4** |          **0.0** |
| AAPL    |        559 ms |                   **385.0** |          **0.0** |
| DOGE    |        255 ms |                 **1,095.7** |          **0.0** |

A notice that appears and disappears a hundred times an hour is not a health
signal; it is the flicker.

## 2. What changed

- **`STALL_MULTIPLE` 3 → 20**, and a new **`MIN_QUIET_MS` of 15 seconds**, so
  the threshold is `max(20 × meanInterval, 15 s)` and the fastest assets are not
  held to a threshold of a few hundred milliseconds.
- **The text says what it means**: a market that has not ticked for that long
  is a reason to check the engine's health, not a property of the market. It
  moved into `es.ts` with the rest of the panel's Spanish.
- **The hole bounds survive the notice**: a gap in the record is still named
  while the market is quiet, which the previous status string dropped.

Nothing in the engine, the catalogue or the contract changed. This is the panel
only, and the API contract stays at `2.1.0`.

## 3. What was measured

| Measure                                   | Result                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| False notices an hour, before and after   | 193–1,096 at 3×; **0.0** at 20× with a 15 s floor, across the thirty                                |
| A genuinely stopped engine                | still detected — the threshold is seconds, not minutes                                              |
| The guard                                 | both defects planted back (the multiple, the floor) and each watched failing                        |
| In a real browser                         | 10 samples over 30 s, all "en vivo", price rolling, zero console errors                             |
| The quality gate                          | `GATE_EXIT=0` on `18db5cd` — unit 168 files / 3,488 tests; statistical 47 / 411 with a real browser |
| Hosted CI on `efef599`                    | green on both jobs                                                                                  |
| The browser case that was red on CI twice | fixed in the case, not the panel — see §5                                                           |

## 5. The case that was red on hosted CI, twice

`panel.stat.test.ts` asserts that a hole after a lost record reads as a hole.
It lost the record, restarted the engine after **one second**, and expected the
chart to be told where the record picks up. One second decides nothing: a
checkpoint younger than the fifteen-second catch-up bound is _resumed_, and a
resumed market republishes from that checkpoint — so whether the chart's stored
sequence fell below the window the new process serves depended on whether the
candle history happened to lag the checkpoint or lead it. Locally it lagged and
the hole was 34 sequences wide; on hosted CI it led, the resume served what the
chart asked for, the chart joined live with nothing to report, and the matcher
polled `en vivo` for two minutes.

The restart now waits past the bound, which is what the helper's own docstring
always claimed: the market seams, the record picks up a whole lease further on
— one hole of 100,041 sequences instead of 34 — and the precondition is
asserted rather than hoped for. The old behaviour now fails as
`expected 'resumed' to be 'seam'` in seconds. Watched failing with the
one-second restart planted back.

## 4. Upgrading

Replace the binary and restart with the state directory intact. Markets resume
exactly where they were: the panel is the only thing that changed, so there is
no seam and no price movement attributable to this release.
