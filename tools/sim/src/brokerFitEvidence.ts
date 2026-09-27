#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { ASSET_CATALOGUE } from '@otc/engine';
import { brokerFitReport } from './brokerFit.js';

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

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const selected = ASSET_CATALOGUE.filter(
    (a) => options.assets === null || options.assets.includes(a.definition.id),
  );
  if (selected.length === 0) throw new Error('No assets selected.');
  const report = await brokerFitReport(selected, options, (id) => {
    process.stderr.write(`${id}: done\n`);
  });
  if (options.out === null) process.stdout.write(report);
  else writeFileSync(options.out, report);
}

await main();
