#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { epochMillis, logPrice, MasterKeyring, yieldToLoop, type InstrumentSpec } from '@otc/core';
import {
  ASSET_CATALOGUE,
  CALIBRATION_CHUNK_TICKS,
  configFor,
  createMarketEngine,
} from '@otc/engine';

/**
 * What a broker's own rules cost it on this engine (PH-40.3, PH-40.6).
 *
 * Two measurements the integration guide rests on, reproducible from here:
 *
 * 1. **Ties at the broker's precision.** A broker that settles by comparing
 *    prices formatted to fewer decimals than the engine publishes calls a real
 *    move a draw. For each asset: the tie rate as `settle()` sees it (equal
 *    integers) against the rate at five decimals, and under a lattice coarsened
 *    until one step is at least one fifth decimal.
 * 2. **A stale quote.** A broker that opens at a price the client was quoted up
 *    to `lag` ms earlier lets the client watch the market first. The win rate of
 *    a client who opens in the direction the price already moved.
 *
 * Deterministic: every stream is drawn from `broker-fit-<measure>-<asset>-<n>`.
 *
 * Usage:
 *   node tools/sim/dist/brokerFitEvidence.js [--out FILE] [--assets a,b]
 *                                           [--windows N] [--replicates N] [--trials N]
 */
interface Options {
  out: string | null;
  assets: string[] | null;
  windows: number;
  replicates: number;
  trials: number;
}

function parse(argv: readonly string[]): Options {
  const options: Options = {
    out: null,
    assets: null,
    windows: 2_000,
    replicates: 4,
    trials: 3_000,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1] ?? '';
    if (flag === '--out') options.out = value;
    else if (flag === '--assets') options.assets = value.split(',').filter((a) => a.length > 0);
    else if (flag === '--windows') options.windows = Number.parseInt(value, 10);
    else if (flag === '--replicates') options.replicates = Number.parseInt(value, 10);
    else if (flag === '--trials') options.trials = Number.parseInt(value, 10);
    else throw new Error(`Unknown option ${String(flag)}`);
  }
  for (const [name, n] of [
    ['--windows', options.windows],
    ['--replicates', options.replicates],
    ['--trials', options.trials],
  ] as const) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  }
  return options;
}

const START = 1_776_000_000_000;
const HORIZONS = [30_000, 60_000, 300_000, 900_000] as const;
const LAGS = [1_000, 2_000, 5_000] as const;
const QUOTE_HORIZONS = [30_000, 60_000, 300_000] as const;
/** The decimals a broker displays and settles at, below 10,000 (Orbit's rule). */
const BROKER_DECIMALS = 5;

interface Series {
  readonly instants: number[];
  readonly prices: number[];
}

async function draw(
  asset: (typeof ASSET_CATALOGUE)[number],
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

/** The price in force at an instant: the last tick at or before it. */
function inForce(series: Series, at: number): number {
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

const render = (instrument: InstrumentSpec, price: number, decimals: number): string =>
  (instrument.referencePrice * Math.exp(instrument.logQuantum * price)).toFixed(decimals);

async function ties(
  asset: (typeof ASSET_CATALOGUE)[number],
  instrument: InstrumentSpec,
  options: Options,
): Promise<{ integer: number[]; broker: number[] }> {
  const longest = HORIZONS[HORIZONS.length - 1]!;
  const counts = HORIZONS.map(() => ({ n: 0, integer: 0, broker: 0 }));
  for (let r = 0; r < options.replicates; r += 1) {
    const series = await draw(
      asset,
      instrument,
      `broker-fit-ties-${asset.definition.id}-${String(instrument.logQuantum)}-${String(r)}`,
      options.windows * longest,
    );
    HORIZONS.forEach((horizon, h) => {
      for (let open = START; open + horizon <= START + options.windows * longest; open += horizon) {
        const a = inForce(series, open);
        const z = inForce(series, open + horizon);
        counts[h]!.n += 1;
        if (a === z) counts[h]!.integer += 1;
        if (render(instrument, a, BROKER_DECIMALS) === render(instrument, z, BROKER_DECIMALS)) {
          counts[h]!.broker += 1;
        }
      }
    });
    await yieldToLoop();
  }
  return {
    integer: counts.map((c) => c.integer / c.n),
    broker: counts.map((c) => c.broker / c.n),
  };
}

async function staleQuote(
  asset: (typeof ASSET_CATALOGUE)[number],
  options: Options,
): Promise<number[][]> {
  const span = options.trials * 400_000;
  const series = await draw(
    asset,
    asset.instrument,
    `broker-fit-quote-${asset.definition.id}-0`,
    span,
  );
  return LAGS.map((lag) =>
    QUOTE_HORIZONS.map((horizon) => {
      let win = 0;
      let decided = 0;
      for (let k = 0; k < options.trials; k += 1) {
        const quoted = START + 1_000 + ((k * 97_331) % (span - 400_000));
        const p0 = inForce(series, quoted);
        const seen = inForce(series, quoted + lag);
        if (seen === p0) continue;
        const close = inForce(series, quoted + lag + horizon);
        if (close === p0) continue;
        decided += 1;
        if (close > p0 === seen > p0) win += 1;
      }
      return decided === 0 ? Number.NaN : win / decided;
    }),
  );
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const selected = ASSET_CATALOGUE.filter(
    (a) => options.assets === null || options.assets.includes(a.definition.id),
  );
  if (selected.length === 0) throw new Error('No assets selected.');
  const tieRows: string[] = [];
  const quoteRows: string[] = [];
  for (const asset of selected) {
    const base = asset.instrument;
    const step = (base.referencePrice * base.logQuantum) / 10 ** -BROKER_DECIMALS;
    const measured = await ties(asset, base, options);
    let coarse = '—';
    if (step < 1) {
      const factor = Math.ceil(1 / step);
      const coarser = { ...base, logQuantum: base.logQuantum * factor, displayPrecision: 5 };
      coarse = `×${String(factor)}: ${pct((await ties(asset, coarser, options)).integer[0]!)}`;
    }
    tieRows.push(
      `| ${asset.definition.id} | ${step.toFixed(2)} | ` +
        HORIZONS.map((_, h) => `${pct(measured.integer[h]!)} / ${pct(measured.broker[h]!)}`).join(
          ' | ',
        ) +
        ` | ${coarse} |`,
    );
    const quote = await staleQuote(asset, options);
    quoteRows.push(
      `| ${asset.definition.id} | ` +
        quote.map((row) => row.map(pct).join(' · ')).join(' | ') +
        ' |',
    );
    process.stderr.write(`${asset.definition.id}: done\n`);
  }
  const report =
    `## Ties: \`settle()\` / at ${String(BROKER_DECIMALS)} decimals\n\n` +
    `| asset | step in 5th decimals | ${HORIZONS.map((h) => `${String(h / 1000)} s`).join(' | ')} | coarsened to one 5th decimal, 30 s |\n` +
    `| --- | --- | ${HORIZONS.map(() => '---').join(' | ')} | --- |\n${tieRows.join('\n')}\n\n` +
    `## A stale quote: the win rate of a client who opens in the direction already moved\n\n` +
    `| asset | ${LAGS.map((l) => `${String(l / 1000)} s old (${QUOTE_HORIZONS.map((h) => `${String(h / 1000)} s`).join(' · ')})`).join(' | ')} |\n` +
    `| --- | ${LAGS.map(() => '---').join(' | ')} |\n${quoteRows.join('\n')}\n\n` +
    `Procedure: ${String(options.replicates)} replicates × ${String(options.windows)} windows per horizon for ties; ` +
    `${String(options.trials)} quotes per cell for the stale quote; streams \`broker-fit-*\`.\n`;
  if (options.out === null) process.stdout.write(report);
  else writeFileSync(options.out, report);
}

await main();
