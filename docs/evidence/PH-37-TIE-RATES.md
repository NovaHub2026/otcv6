| asset        | lattice tie rate | 3se      | vs 1.0% nominal | time |
| ------------ | ---------------- | -------- | --------------- | ---- |
| eurusd-otc   | 3.530%           | ±0.402pp | ABOVE           | 5s   |
| gbpusd-otc   | 4.305%           | ±0.425pp | ABOVE           | 4s   |
| usdjpy-otc   | 4.273%           | ±0.656pp | ABOVE           | 5s   |
| audusd-otc   | 4.504%           | ±0.450pp | ABOVE           | 5s   |
| usdchf-otc   | 3.852%           | ±0.600pp | ABOVE           | 4s   |
| eurgbp-otc   | 4.079%           | ±0.359pp | ABOVE           | 4s   |
| gbpjpy-otc   | 3.867%           | ±0.284pp | ABOVE           | 7s   |
| eurjpy-otc   | 4.768%           | ±0.364pp | ABOVE           | 7s   |
| aapl-otc     | 3.447%           | ±0.499pp | ABOVE           | 6s   |
| msft-otc     | 3.857%           | ±0.273pp | ABOVE           | 6s   |
| nvda-otc     | 3.683%           | ±0.456pp | ABOVE           | 9s   |
| tsla-otc     | 4.305%           | ±0.322pp | ABOVE           | 10s  |
| meta-otc     | 3.939%           | ±0.497pp | ABOVE           | 9s   |
| amzn-otc     | 3.948%           | ±0.397pp | ABOVE           | 8s   |
| pbr-otc      | 4.142%           | ±0.382pp | ABOVE           | 9s   |
| nu-otc       | 4.215%           | ±0.431pp | ABOVE           | 9s   |
| btcusdt-otc  | 3.782%           | ±0.272pp | ABOVE           | 13s  |
| ethusdt-otc  | 4.343%           | ±0.499pp | ABOVE           | 16s  |
| bnbusdt-otc  | 3.499%           | ±0.450pp | ABOVE           | 20s  |
| solusdt-otc  | 3.991%           | ±0.277pp | ABOVE           | 13s  |
| xrpusdt-otc  | 4.053%           | ±0.264pp | ABOVE           | 13s  |
| dogeusdt-otc | 3.969%           | ±0.328pp | ABOVE           | 14s  |
| mmx-idx-otc  | 3.735%           | ±0.300pp | ABOVE           | 21s  |
| cgx-idx-otc  | 3.603%           | ±0.321pp | ABOVE           | 14s  |
| aix-idx-otc  | 3.587%           | ±0.494pp | ABOVE           | 9s   |
| tcx-idx-otc  | 3.886%           | ±0.431pp | ABOVE           | 6s   |
| scx-idx-otc  | 4.005%           | ±0.530pp | ABOVE           | 8s   |
| gmx-idx-otc  | 3.809%           | ±0.490pp | ABOVE           | 7s   |
| evx-idx-otc  | 4.235%           | ±0.690pp | ABOVE           | 11s  |
| brx-idx-otc  | 3.601%           | ±0.373pp | ABOVE           | 8s   |

Procedure: 12 replicates × 8000 horizons of 30 s on `ties-verify-<asset>-<n>`. Total run time: 4.7 minutes.

```ts
export const MEASURED_LATTICE_TIE_RATES = {
  'eurusd-otc': 0.0353,
  'gbpusd-otc': 0.04305,
  'usdjpy-otc': 0.04273,
  'audusd-otc': 0.04504,
  'usdchf-otc': 0.03852,
  'eurgbp-otc': 0.04079,
  'gbpjpy-otc': 0.03867,
  'eurjpy-otc': 0.04768,
  'aapl-otc': 0.03447,
  'msft-otc': 0.03857,
  'nvda-otc': 0.03683,
  'tsla-otc': 0.04305,
  'meta-otc': 0.03939,
  'amzn-otc': 0.03948,
  'pbr-otc': 0.04142,
  'nu-otc': 0.04215,
  'btcusdt-otc': 0.03782,
  'ethusdt-otc': 0.04343,
  'bnbusdt-otc': 0.03499,
  'solusdt-otc': 0.03991,
  'xrpusdt-otc': 0.04053,
  'dogeusdt-otc': 0.03969,
  'mmx-idx-otc': 0.03735,
  'cgx-idx-otc': 0.03603,
  'aix-idx-otc': 0.03587,
  'tcx-idx-otc': 0.03886,
  'scx-idx-otc': 0.04005,
  'gmx-idx-otc': 0.03809,
  'evx-idx-otc': 0.04235,
  'brx-idx-otc': 0.03601,
} as const;
```
