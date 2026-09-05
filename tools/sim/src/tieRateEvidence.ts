#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { epochMillis, logPrice, MasterKeyring, yieldToLoop } from '@otc/core';
import {
  ASSET_CATALOGUE,
  CALIBRATION_CHUNK_TICKS,
  configFor,
  createMarketEngine,
  TARGET_TIE_RATE,
} from '@otc/engine';

/**
 * Measure the realised lattice tie rate of every catalogue asset.
 *
 * **PH-26.3.** `MEASURED_LATTICE_TIE_RATES` in `asset.ts` is the recorded
 * at-the-money rate on the series that actually settles, one value per asset,
 * and `latticeTies.stat.test.ts` verifies a stratified sample of them on a
 * fresh stream family at every gate. This is the run that produces the values:
 * the test's own procedure — twelve replicates of 8,000 thirty-second horizons
 * — on the `ties-verify-<asset>-<n>` family the constants are recorded from,
 * for every asset rather than a sample. A deliberate act, not a test.
 *
 * Usage:
 *   node tools/sim/dist/tieRateEvidence.js [--out FILE] [--assets a,b]
 *                                          [--replicates N] [--horizons N]
 */
interface Options {
  out: string | null;
  assets: string[] | null;
  replicates: number;
  horizons: number;
}

function parse(argv: readonly string[]): Options {
  const options: Options = { out: null, assets: null, replicates: 12, horizons: 8_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--out':
        options.out = value ?? null;
        i += 1;
        break;
      case '--assets':
        options.assets = (value ?? '').split(',').filter((a) => a.length > 0);
        i += 1;
        break;
      case '--replicates':
        options.replicates = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      case '--horizons':
        options.horizons = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      default:
        throw new Error(`Unknown option ${String(flag)}`);
    }
  }
  if (!Number.isInteger(options.replicates) || options.replicates < 2) {
    throw new Error('--replicates must be an integer of at least 2');
  }
  if (!Number.isInteger(options.horizons) || options.horizons < 100) {
    throw new Error('--horizons must be an integer of at least 100');
  }
  return options;
}

const HORIZON_MS = 30_000;

/** One replicate: the fraction of consecutive 30 s horizons that settle at the money. */
async function tieRate(index: number, label: string, horizons: number): Promise<number> {
  const asset = ASSET_CATALOGUE[index]!;
  const start = 1_776_000_000_000;
  const engine = createMarketEngine({
    config: configFor(asset),
    keyring: MasterKeyring.forTesting(label),
    environment: 'simulation',
    start: { instant: epochMillis(start), price: logPrice(0) },
  });
  let boundary = start + HORIZON_MS;
  let openPrice = engine.price;
  let last = engine.price;
  let ties = 0;
  let counted = 0;
  let ticks = 0;
  while (counted < horizons) {
    const tick = engine.next();
    if (tick === null) break;
    while (tick.instant >= boundary && counted < horizons) {
      if (last === openPrice) ties += 1;
      openPrice = last;
      counted += 1;
      boundary += HORIZON_MS;
    }
    last = tick.price;
    ticks += 1;
    if (ticks % CALIBRATION_CHUNK_TICKS === 0) await yieldToLoop();
  }
  return counted === 0 ? Number.NaN : ties / counted;
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const selected = ASSET_CATALOGUE.map((a, i) => [a, i] as const).filter(
    ([a]) => options.assets === null || options.assets.includes(a.definition.id),
  );
  if (selected.length === 0) throw new Error('No assets selected.');

  const rows: string[] = [];
  const constants: string[] = [];
  const started = Date.now();
  for (const [asset, index] of selected) {
    const id = asset.definition.id;
    const assetStarted = Date.now();
    const rates: number[] = [];
    for (let replicate = 0; replicate < options.replicates; replicate += 1) {
      rates.push(await tieRate(index, `ties-verify-${id}-${String(replicate)}`, options.horizons));
      await yieldToLoop();
    }
    const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
    const variance = rates.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (rates.length - 1);
    const se = Math.sqrt(variance / rates.length);
    const seconds = ((Date.now() - assetStarted) / 1000).toFixed(0);
    rows.push(
      `| ${id} | ${(mean * 100).toFixed(3)}% | ±${(3 * se * 100).toFixed(3)}pp | ` +
        `${mean < TARGET_TIE_RATE ? 'below' : 'ABOVE'} | ${seconds}s |`,
    );
    constants.push(`  '${id}': ${mean.toFixed(5)},`);
    process.stderr.write(
      `${id}: ${(mean * 100).toFixed(3)}% ±${(3 * se * 100).toFixed(3)}pp at 3se over ` +
        `${String(options.replicates)} replicates, ${seconds}s\n`,
    );
  }
  const minutes = ((Date.now() - started) / 1000 / 60).toFixed(1);
  const report =
    `| asset | lattice tie rate | 3se | vs ${(TARGET_TIE_RATE * 100).toFixed(1)}% nominal | time |\n` +
    `| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n` +
    `Procedure: ${String(options.replicates)} replicates × ${String(options.horizons)} horizons of 30 s on ` +
    `\`ties-verify-<asset>-<n>\`. Total run time: ${minutes} minutes.\n\n` +
    `\`\`\`ts\nexport const MEASURED_LATTICE_TIE_RATES = {\n${constants.join('\n')}\n} as const;\n\`\`\`\n`;
  if (options.out === null) process.stdout.write(report);
  else writeFileSync(options.out, report, 'utf8');
}

await main();
