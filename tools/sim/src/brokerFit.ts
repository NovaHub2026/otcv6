import {
  epochMillis,
  logPrice,
  MasterKeyring,
  toDisplayPrice,
  yieldToLoop,
  type InstrumentSpec,
} from '@otc/core';
import {
  CALIBRATION_CHUNK_TICKS,
  configFor,
  createMarketEngine,
  type RegisteredAsset,
} from '@otc/engine';

/**
 * What a broker's own rules cost it on this engine (PH-40.3, PH-40.6): the
 * measurements behind `npm run evidence:broker-fit`, apart from the runner so
 * they can be tested.
 *
 * 1. **Ties at the broker's precision.** A broker that settles by comparing
 *    prices formatted to fewer decimals than the engine publishes calls a real
 *    move a draw. Per asset: the tie rate as `settle()` sees it (equal
 *    integers) against the rate at five decimals.
 * 2. **A stale quote.** A broker that opens at a price the client was quoted up
 *    to `lag` ms earlier lets the client watch the market first: the win rate of
 *    a client who opens in the direction the price already moved.
 *
 * Deterministic: every stream is drawn from `broker-fit-<measure>-<asset>-<n>`.
 */
export const START = 1_776_000_000_000;
export const HORIZONS = [30_000, 60_000, 300_000, 900_000] as const;
export const LAGS = [1_000, 2_000, 5_000] as const;
export const QUOTE_HORIZONS = [30_000, 60_000, 300_000] as const;
/** The decimals a broker displays and settles at, below 10,000 (Orbit's rule). */
export const BROKER_DECIMALS = 5;
/** One unit of the fifth decimal, written out: `**` is not portable (a2-04). */
export const FIFTH_DECIMAL = 0.00001;

export interface Series {
  readonly instants: readonly number[];
  readonly prices: readonly number[];
}

export interface BrokerFitSizes {
  /** Windows per horizon for ties, at the longest horizon. */
  readonly windows: number;
  readonly replicates: number;
  /** Quotes per cell for the stale quote. */
  readonly trials: number;
}

/** One market's ticks from `START` for `spanMs`, on the instrument given. */
export async function draw(
  asset: RegisteredAsset,
  instrument: InstrumentSpec,
  label: string,
  spanMs: number,
): Promise<Series> {
  const engine = createMarketEngine({
    config: { ...configFor(asset), instrument },
    keyring: MasterKeyring.forTesting(label),
    environment: 'simulation',
    start: { instant: epochMillis(START), price: logPrice(0) },
  });
  const instants: number[] = [];
  const prices: number[] = [];
  for (;;) {
    const tick = engine.next();
    if (tick === null || tick.instant > START + spanMs) break;
    instants.push(tick.instant);
    prices.push(tick.price);
    if (instants.length % CALIBRATION_CHUNK_TICKS === 0) await yieldToLoop();
  }
  return { instants, prices };
}

/**
 * The price in force at an instant: the last tick at or before it. Before the
 * first tick it is the price the engine started at, which `draw` makes 0.
 */
export function inForce(series: Series, at: number): number {
  let lo = 0;
  let hi = series.instants.length - 1;
  if (hi < 0 || at < series.instants[0]!) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series.instants[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return series.prices[lo]!;
}

/** The kernel's portable rendering, to a broker's decimals rather than the engine's. */
export const render = (instrument: InstrumentSpec, price: number, decimals: number): string =>
  toDisplayPrice(instrument, logPrice(price)).toFixed(decimals);

/**
 * Consecutive windows of `horizon` from `start` to `end`: how many there were,
 * how many ended on the integer they began on, and how many a broker at
 * `decimals` would call a draw.
 */
export function tieCounts(
  series: Series,
  instrument: InstrumentSpec,
  horizon: number,
  start: number,
  end: number,
  decimals: number = BROKER_DECIMALS,
): { n: number; integer: number; broker: number } {
  const counts = { n: 0, integer: 0, broker: 0 };
  for (let open = start; open + horizon <= end; open += horizon) {
    const a = inForce(series, open);
    const z = inForce(series, open + horizon);
    counts.n += 1;
    if (a === z) counts.integer += 1;
    if (render(instrument, a, decimals) === render(instrument, z, decimals)) counts.broker += 1;
  }
  return counts;
}

/**
 * How often a client wins who, quoted at each of `quotes`, watches the market
 * for `lag` ms and opens at the quoted price in the direction it moved, on a
 * contract of `horizon` from that moment. Quotes after which nothing moved, and
 * contracts that end on the quoted price, decide nothing and are left out.
 */
export function staleQuoteWinRate(
  series: Series,
  quotes: readonly number[],
  lag: number,
  horizon: number,
): number {
  let win = 0;
  let decided = 0;
  for (const quoted of quotes) {
    const p0 = inForce(series, quoted);
    const seen = inForce(series, quoted + lag);
    if (seen === p0) continue;
    const close = inForce(series, quoted + lag + horizon);
    if (close === p0) continue;
    decided += 1;
    if (close > p0 === seen > p0) win += 1;
  }
  return decided === 0 ? Number.NaN : win / decided;
}

/** Tie rates per horizon for one asset on one instrument. */
export async function measureTies(
  asset: RegisteredAsset,
  instrument: InstrumentSpec,
  sizes: BrokerFitSizes,
): Promise<{ integer: number[]; broker: number[] }> {
  const longest = HORIZONS[HORIZONS.length - 1]!;
  const end = START + sizes.windows * longest;
  const counts = HORIZONS.map(() => ({ n: 0, integer: 0, broker: 0 }));
  for (let r = 0; r < sizes.replicates; r += 1) {
    const series = await draw(
      asset,
      instrument,
      `broker-fit-ties-${asset.definition.id}-${String(instrument.logQuantum)}-${String(r)}`,
      sizes.windows * longest,
    );
    HORIZONS.forEach((horizon, h) => {
      const c = tieCounts(series, instrument, horizon, START, end);
      counts[h]!.n += c.n;
      counts[h]!.integer += c.integer;
      counts[h]!.broker += c.broker;
    });
    await yieldToLoop();
  }
  return {
    integer: counts.map((c) => c.integer / c.n),
    broker: counts.map((c) => c.broker / c.n),
  };
}

/** The stale-quote win rate for one asset, per lag and contract horizon. */
export async function measureStaleQuote(
  asset: RegisteredAsset,
  sizes: BrokerFitSizes,
): Promise<number[][]> {
  const span = sizes.trials * 400_000;
  const series = await draw(
    asset,
    asset.instrument,
    `broker-fit-quote-${asset.definition.id}-0`,
    span,
  );
  const quotes = Array.from(
    { length: sizes.trials },
    (_, k) => START + 1_000 + ((k * 97_331) % (span - 400_000)),
  );
  return LAGS.map((lag) =>
    QUOTE_HORIZONS.map((horizon) => staleQuoteWinRate(series, quotes, lag, horizon)),
  );
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

/** The whole report, as `BROKER-FIT-*.md` records it. */
export async function brokerFitReport(
  assets: readonly RegisteredAsset[],
  sizes: BrokerFitSizes,
  progress: (id: string) => void = () => undefined,
): Promise<string> {
  const tieRows: string[] = [];
  const quoteRows: string[] = [];
  for (const asset of assets) {
    const base = asset.instrument;
    const step = (base.referencePrice * base.logQuantum) / FIFTH_DECIMAL;
    const measured = await measureTies(asset, base, sizes);
    let coarse = '—';
    if (step < 1) {
      const factor = Math.ceil(1 / step);
      const coarser = { ...base, logQuantum: base.logQuantum * factor, displayPrecision: 5 };
      coarse = `×${String(factor)}: ${pct((await measureTies(asset, coarser, sizes)).integer[0]!)}`;
    }
    tieRows.push(
      `| ${asset.definition.id} | ${step.toFixed(2)} | ` +
        HORIZONS.map((_, h) => `${pct(measured.integer[h]!)} / ${pct(measured.broker[h]!)}`).join(
          ' | ',
        ) +
        ` | ${coarse} |`,
    );
    const quote = await measureStaleQuote(asset, sizes);
    quoteRows.push(
      `| ${asset.definition.id} | ` +
        quote.map((row) => row.map(pct).join(' · ')).join(' | ') +
        ' |',
    );
    progress(asset.definition.id);
  }
  return (
    `## Ties: \`settle()\` / at ${String(BROKER_DECIMALS)} decimals\n\n` +
    `| asset | step in 5th decimals | ${HORIZONS.map((h) => `${String(h / 1000)} s`).join(' | ')} | coarsened to one 5th decimal, 30 s |\n` +
    `| --- | --- | ${HORIZONS.map(() => '---').join(' | ')} | --- |\n${tieRows.join('\n')}\n\n` +
    `## A stale quote: the win rate of a client who opens in the direction already moved\n\n` +
    `| asset | ${LAGS.map((l) => `${String(l / 1000)} s old (${QUOTE_HORIZONS.map((h) => `${String(h / 1000)} s`).join(' · ')})`).join(' | ')} |\n` +
    `| --- | ${LAGS.map(() => '---').join(' | ')} |\n${quoteRows.join('\n')}\n\n` +
    `Procedure: ${String(sizes.replicates)} replicates × ${String(sizes.windows)} windows per horizon for ties; ` +
    `${String(sizes.trials)} quotes per cell for the stale quote; streams \`broker-fit-*\`.\n`
  );
}
