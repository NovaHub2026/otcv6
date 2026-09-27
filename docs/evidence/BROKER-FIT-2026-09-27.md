# What a broker's own rules cost it on this engine — 2026-09-27

Type: EVIDENCE RECORD
Build: `4602d7b` plus the tool (`tools/sim/src/brokerFitEvidence.ts`)
Command: `node tools/sim/dist/brokerFitEvidence.js --assets eurusd-otc,gbpusd-otc,audusd-otc,usdchf-otc,eurgbp-otc,dogeusdt-otc,xrpusdt-otc,usdjpy-otc,tsla-otc,btcusdt-otc` (8 min 18 s; `npm run evidence:broker-fit` builds first)
Read by: [PH-40.3](../phases/PH-40.3-the-lattice-a-broker-can-display.md), [PH-40.6](../phases/PH-40.6-the-guide-a-broker-integrates-from.md), [`ORBIT.md`](../integration/ORBIT.md)

---

Two measurements the Orbit guide rests on, from the engine itself on
deterministic streams (`broker-fit-*`), so anyone can re-run them.

**Ties.** Each cell is the at-the-money rate as `settle()` sees it (equal
integers) / as a broker comparing prices formatted to five decimals sees it.
The broker's rule is five decimals below 10,000 and two above; `btcusdt-otc` is
shown at five here and its step is 168 digits at two, so nothing changes for it
either way. The last column is the engine's own rate on a lattice coarsened
until one step is at least one fifth decimal — option 2 of PH-40.3 §4.

**A stale quote.** A client quoted at an instant watches the market for 1, 2 or
5 s, then opens — at the quoted price — in the direction it already moved; the
cell is how often that wins, over contracts of 30 s, 60 s and 5 min. A market
with no memory gives 50%; the edge is the look, not the engine. At an 85% payout
the break-even is 54%.

## Ties: `settle()` / at 5 decimals

| asset        | step in 5th decimals | 30 s           | 60 s           | 300 s         | 900 s         | coarsened to one 5th decimal, 30 s |
| ------------ | -------------------- | -------------- | -------------- | ------------- | ------------- | ---------------------------------- |
| eurusd-otc   | 0.47                 | 3.47% / 7.43%  | 2.43% / 5.16%  | 0.93% / 2.14% | 0.51% / 1.14% | ×3: 9.20%                          |
| gbpusd-otc   | 0.55                 | 4.41% / 8.35%  | 3.07% / 5.83%  | 1.20% / 2.28% | 0.59% / 1.15% | ×2: 7.80%                          |
| usdjpy-otc   | 75.08                | 4.42% / 4.42%  | 3.08% / 3.08%  | 1.37% / 1.37% | 0.74% / 0.74% | —                                  |
| audusd-otc   | 0.41                 | 4.24% / 10.40% | 2.99% / 7.26%  | 1.21% / 2.97% | 0.64% / 1.66% | ×3: 10.28%                         |
| usdchf-otc   | 0.24                 | 3.90% / 16.01% | 2.62% / 11.18% | 1.28% / 4.82% | 0.54% / 2.61% | ×5: 13.29%                         |
| eurgbp-otc   | 0.25                 | 3.75% / 14.88% | 2.56% / 10.12% | 0.98% / 4.35% | 0.54% / 2.06% | ×4: 11.60%                         |
| tsla-otc     | 1352.15              | 4.50% / 4.50%  | 3.13% / 3.13%  | 1.39% / 1.39% | 0.73% / 0.73% | —                                  |
| btcusdt-otc  | 168065.89            | 3.92% / 3.92%  | 2.68% / 2.68%  | 1.07% / 1.07% | 0.59% / 0.59% | —                                  |
| xrpusdt-otc  | 4.06                 | 4.01% / 4.01%  | 2.71% / 2.71%  | 1.14% / 1.14% | 0.56% / 0.56% | —                                  |
| dogeusdt-otc | 0.58                 | 4.03% / 7.95%  | 2.78% / 5.52%  | 1.17% / 2.27% | 0.50% / 1.13% | ×2: 6.79%                          |

## A stale quote: the win rate of a client who opens in the direction already moved

| asset        | 1 s old (30 s · 60 s · 300 s) | 2 s old (30 s · 60 s · 300 s) | 5 s old (30 s · 60 s · 300 s) |
| ------------ | ----------------------------- | ----------------------------- | ----------------------------- |
| eurusd-otc   | 59.40% · 56.86% · 53.08%      | 59.97% · 57.35% · 52.54%      | 63.88% · 60.17% · 54.41%      |
| gbpusd-otc   | 60.54% · 56.32% · 51.54%      | 60.81% · 56.63% · 53.44%      | 63.94% · 60.34% · 55.14%      |
| usdjpy-otc   | 59.00% · 55.93% · 53.57%      | 60.85% · 57.95% · 54.35%      | 64.67% · 60.72% · 55.07%      |
| audusd-otc   | 57.41% · 53.47% · 50.84%      | 59.56% · 56.37% · 52.09%      | 62.29% · 59.31% · 54.75%      |
| usdchf-otc   | 56.27% · 55.11% · 52.94%      | 59.18% · 56.05% · 52.53%      | 62.50% · 59.37% · 54.60%      |
| eurgbp-otc   | 58.38% · 57.99% · 50.45%      | 59.71% · 58.72% · 51.69%      | 63.85% · 60.90% · 52.21%      |
| tsla-otc     | 59.71% · 57.39% · 53.68%      | 59.76% · 56.68% · 54.31%      | 62.84% · 59.24% · 55.49%      |
| btcusdt-otc  | 56.88% · 54.81% · 52.14%      | 60.17% · 57.11% · 52.61%      | 63.19% · 58.95% · 53.91%      |
| xrpusdt-otc  | 56.77% · 53.82% · 52.18%      | 60.53% · 56.89% · 51.72%      | 61.51% · 57.93% · 54.39%      |
| dogeusdt-otc | 58.31% · 54.34% · 50.44%      | 60.79% · 56.54% · 53.30%      | 62.53% · 57.80% · 55.43%      |

Procedure: 4 replicates × 2000 windows per horizon for ties; 3000 quotes per cell for the stale quote; streams `broker-fit-*`.
