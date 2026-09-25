/**
 * The lattice each catalogue asset published on before PH-37 coarsened it.
 *
 * **Why a table, and why it is not optional.** A published price is an integer
 * count of quanta, so a market resuming onto a different lattice has to
 * re-express it (PH-37.2). The quantum it counted in is written into every
 * checkpoint — and that field ships in the *same release* as the lattice change
 * that needs it, so on the one upgrade where it matters it is not there. The
 * code called that corner rare. It is not rare: it is the upgrade path of every
 * deployment that was running.
 *
 * Measured on the live venue when that was believed rather than checked: thirty
 * markets resumed and their prices moved by a median of 31.7% and as much as
 * 1,474% — TSLA from 305.99 to 65.56, DOGE from 0.0895 to 1.4084. The seams were
 * recorded and `settle` refused across them, so nothing settled wrongly; what
 * was wrong was every price published afterwards.
 *
 * So the release that moves a lattice carries the lattice it moved from. A
 * checkpoint that declares its own quantum uses that and never reaches here;
 * this answers only for one written before the field existed, which is the
 * last time this table can be needed for these values.
 */
/**
 * The whole frame each catalogue asset published on before PH-37, not just its
 * quantum.
 *
 * **A quantum alone is not what a price counted in, and shipping only the
 * quantum lost a digit on all thirty assets.** `toDisplayPrice` is
 * `referencePrice * exp(logQuantum * price)` rendered to `displayPrecision`
 * decimals, so re-expressing a stored integer needs all three. PH-38.2 declared
 * the past by taking today's frame and overriding its quantum, which silently
 * carried today's precision back over history: eurusd published seven decimals
 * and was answered with six, `tsla-otc` and `meta-otc` published four and were
 * answered with two — 307.9080 served as 307.91. A broker reconciling its own
 * archive sees string mismatches, and for those two a real loss of two
 * significant figures.
 *
 * Found by an independent refuter comparing every frame-1 declaration against
 * this release's predecessor, not by any assertion in the suite.
 */
export const FRAME_BEFORE_PH37: Readonly<
  Record<
    string,
    {
      readonly logQuantum: number;
      readonly referencePrice: number;
      readonly displayPrecision: number;
    }
  >
> = {
  'eurusd-otc': { logQuantum: 3.131447750503912e-7, referencePrice: 1.16, displayPrecision: 7 },
  'gbpusd-otc': { logQuantum: 2.896342933171461e-7, referencePrice: 1.35, displayPrecision: 7 },
  'usdjpy-otc': { logQuantum: 4.1322131154383336e-7, referencePrice: 159, displayPrecision: 5 },
  'audusd-otc': { logQuantum: 3.6733805244148213e-7, referencePrice: 0.71, displayPrecision: 7 },
  'usdchf-otc': { logQuantum: 3.228056739320868e-7, referencePrice: 0.81, displayPrecision: 7 },
  'eurgbp-otc': { logQuantum: 2.7286603356753726e-7, referencePrice: 0.856, displayPrecision: 7 },
  'gbpjpy-otc': { logQuantum: 7.224507310547509e-7, referencePrice: 215, displayPrecision: 4 },
  'eurjpy-otc': { logQuantum: 6.318992264722798e-7, referencePrice: 184, displayPrecision: 4 },
  'aapl-otc': { logQuantum: 1.0382975411320733e-6, referencePrice: 310, displayPrecision: 4 },
  'msft-otc': { logQuantum: 8.772309550094163e-7, referencePrice: 495, displayPrecision: 4 },
  'nvda-otc': { logQuantum: 1.7994793022770206e-6, referencePrice: 220, displayPrecision: 4 },
  'tsla-otc': { logQuantum: 2.5479700000762076e-6, referencePrice: 340, displayPrecision: 4 },
  'meta-otc': { logQuantum: 1.635048966433398e-6, referencePrice: 575, displayPrecision: 4 },
  'amzn-otc': { logQuantum: 1.1106876236673e-6, referencePrice: 265, displayPrecision: 4 },
  'pbr-otc': { logQuantum: 1.5278920853002827e-6, referencePrice: 18.4, displayPrecision: 5 },
  'nu-otc': { logQuantum: 2.1676653092782303e-6, referencePrice: 14.4, displayPrecision: 5 },
  'btcusdt-otc': { logQuantum: 1.7544005781582127e-6, referencePrice: 70000, displayPrecision: 1 },
  'ethusdt-otc': { logQuantum: 1.6192151603799536e-6, referencePrice: 2100, displayPrecision: 3 },
  'bnbusdt-otc': { logQuantum: 1.939892365940817e-6, referencePrice: 650, displayPrecision: 3 },
  'solusdt-otc': { logQuantum: 3.4472860125230552e-6, referencePrice: 85, displayPrecision: 4 },
  'xrpusdt-otc': { logQuantum: 2.0345814952792886e-6, referencePrice: 1.2, displayPrecision: 6 },
  'dogeusdt-otc': { logQuantum: 3.528291226936427e-6, referencePrice: 0.078, displayPrecision: 7 },
  'mmx-idx-otc': { logQuantum: 4.108423145417696e-6, referencePrice: 1000, displayPrecision: 3 },
  'cgx-idx-otc': { logQuantum: 1.2807165634409132e-6, referencePrice: 1000, displayPrecision: 3 },
  'aix-idx-otc': { logQuantum: 1.8832316016661937e-6, referencePrice: 1000, displayPrecision: 3 },
  'tcx-idx-otc': { logQuantum: 1.2266628970962221e-6, referencePrice: 1000, displayPrecision: 3 },
  'scx-idx-otc': { logQuantum: 2.327597824791533e-6, referencePrice: 1000, displayPrecision: 3 },
  'gmx-idx-otc': { logQuantum: 1.5098297855443824e-6, referencePrice: 1000, displayPrecision: 3 },
  'evx-idx-otc': { logQuantum: 2.8595178951219263e-6, referencePrice: 1000, displayPrecision: 3 },
  'brx-idx-otc': { logQuantum: 1.4896821412666174e-6, referencePrice: 1000, displayPrecision: 3 },
};

export const LATTICE_BEFORE_PH37: Readonly<Record<string, number>> = {
  'eurusd-otc': 3.131447750503912e-7,
  'gbpusd-otc': 2.896342933171461e-7,
  'usdjpy-otc': 4.1322131154383336e-7,
  'audusd-otc': 3.6733805244148213e-7,
  'usdchf-otc': 3.228056739320868e-7,
  'eurgbp-otc': 2.7286603356753726e-7,
  'gbpjpy-otc': 7.224507310547509e-7,
  'eurjpy-otc': 6.318992264722798e-7,
  'aapl-otc': 1.0382975411320733e-6,
  'msft-otc': 8.772309550094163e-7,
  'nvda-otc': 1.7994793022770206e-6,
  'tsla-otc': 2.5479700000762076e-6,
  'meta-otc': 1.635048966433398e-6,
  'amzn-otc': 1.1106876236673e-6,
  'pbr-otc': 1.5278920853002827e-6,
  'nu-otc': 2.1676653092782303e-6,
  'btcusdt-otc': 1.7544005781582127e-6,
  'ethusdt-otc': 1.6192151603799536e-6,
  'bnbusdt-otc': 1.939892365940817e-6,
  'solusdt-otc': 3.4472860125230552e-6,
  'xrpusdt-otc': 2.0345814952792886e-6,
  'dogeusdt-otc': 3.528291226936427e-6,
  'mmx-idx-otc': 4.108423145417696e-6,
  'cgx-idx-otc': 1.2807165634409132e-6,
  'aix-idx-otc': 1.8832316016661937e-6,
  'tcx-idx-otc': 1.2266628970962221e-6,
  'scx-idx-otc': 2.327597824791533e-6,
  'gmx-idx-otc': 1.5098297855443824e-6,
  'evx-idx-otc': 2.8595178951219263e-6,
  'brx-idx-otc': 1.4896821412666174e-6,
};
