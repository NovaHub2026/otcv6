#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { ASSET_CATALOGUE } from '@otc/engine';
import { formatHorizonCoverage, measureHorizonCoverage } from './horizonCoverage.js';

/**
 * Generate the long-horizon coverage evidence record.
 *
 * This is the run that closes B-002. It is a **deliberate act**, not a test: it
 * takes tens of minutes, and its output is a recorded evidence document that
 * later work cites. `horizonCoverage.stat.test.ts` re-runs the same machinery at
 * a fraction of the length on every gate, so the method stays checked even
 * though the full run does not.
 *
 * Usage:
 *   node tools/sim/dist/horizonEvidence.js [--windows N] [--segments N] [--out FILE]
 *                                          [--assets a,b] [--label NAME]
 *
 * Defaults reach 0.2368pp at the 15-minute horizon, finer than the 0.2513pp the
 * 99% promotional payout implies.
 */

interface Options {
  windows: number;
  segments: number;
  out: string | null;
  assets: string[] | null;
  /**
   * Distinguishes one realisation from another.
   *
   * The evidence run is a single price path per asset. A pattern that looks
   * striking on one path — PH-11.2 found btcusd positive at all eight horizons —
   * is settled by generating a second, independent one, not by arguing about it.
   */
  label: string;
}

function parse(argv: readonly string[]): Options {
  const options: Options = {
    windows: 350_000,
    segments: 100,
    out: null,
    assets: null,
    label: 'horizon-evidence',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--windows':
        options.windows = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      case '--segments':
        options.segments = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      case '--out':
        options.out = value ?? null;
        i += 1;
        break;
      case '--label':
        options.label = value ?? '';
        i += 1;
        break;
      case '--assets':
        options.assets = (value ?? '').split(',').filter((a) => a.length > 0);
        i += 1;
        break;
      default:
        throw new Error(`Unknown option ${String(flag)}`);
    }
  }
  if (!Number.isInteger(options.windows) || options.windows < options.segments) {
    throw new Error(`--windows must be an integer of at least --segments`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const assets = ASSET_CATALOGUE.filter(
    (a) => options.assets === null || options.assets.includes(a.definition.id),
  );
  if (assets.length === 0) throw new Error('No assets selected.');

  const sections: string[] = [];
  const started = Date.now();

  for (const asset of assets) {
    const assetStarted = Date.now();
    process.stderr.write(`${asset.definition.id}: starting\n`);
    const coverage = await measureHorizonCoverage({
      asset,
      targetSlowestWindows: options.windows,
      segments: options.segments,
      keyLabel: `${options.label}-${asset.definition.id}`,
      onProgress: (done) => {
        if (done % 10 === 0) {
          process.stderr.write(`  ${asset.definition.id}: ${done}/${options.segments} segments\n`);
        }
      },
    });
    const seconds = ((Date.now() - assetStarted) / 1000).toFixed(0);
    process.stderr.write(`${asset.definition.id}: done in ${seconds}s\n`);
    // The label is recorded with the numbers, not just accepted as an argument.
    // Cycle Audit 4 (Minor 7) found the btcusd replication — the phase's single
    // most load-bearing result — existing only as four numbers in prose, with no
    // label, seed or table. Nobody could regenerate it.
    sections.push(
      `${formatHorizonCoverage(coverage)}\n\nRun label: \`${options.label}\` ` +
        `(regenerate with \`--assets ${asset.definition.id} --windows ${options.windows} ` +
        `--segments ${options.segments} --label ${options.label}\`). Run time: ${seconds}s.`,
    );
  }

  const body = sections.join('\n\n');
  const total = ((Date.now() - started) / 1000 / 60).toFixed(1);
  const report = `${body}\n\nTotal run time: ${total} minutes.\n`;
  if (options.out === null) process.stdout.write(report);
  else writeFileSync(options.out, report, 'utf8');
}

await main();
