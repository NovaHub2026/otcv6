#!/usr/bin/env node
import { epochMillis, logPrice, MasterKeyring } from '@otc/core';
import {
  ASSET_CATALOGUE,
  calibrateAssetAsync,
  configFor,
  createMarketEngine,
  dispersionLogSigma,
  dispersionPercent,
  registrationKeyLabel,
  type RegisteredAsset,
} from '@otc/engine';
import { yieldToLoop } from '@otc/lab';

/**
 * The runner behind the dispersion evidence, in the repository this time.
 *
 * **Cycle Audit 6, CA6-36.** `CYCLE-6-DRIFT.md` and `CYCLE-6-BACKFILL-SCALE.md`
 * each named a script — `runner.mjs`, `backfillScale.mjs` — that exists nowhere
 * in the tree, and neither recorded its seed. Every number in both documents was
 * therefore unreproducible by anyone but the agent that ran them, which
 * `GOVERNANCE.md` §68 does not permit of recorded evidence.
 *
 * This is a **deliberate act**, not a test: the default run is several minutes
 * and its output is a document later work cites. `dispersion.stat.test.ts`
 * exercises the same comparison at a fraction of the length on every gate.
 *
 * Two measurements, and the difference between them is the point:
 *
 *  - **calibrated** — what `calibrateAsset` reports as the diffusion rate, which
 *    is what a registration writes down and what the panel publishes;
 *  - **realised** — the spread of where the price of the *real engine*, on its
 *    published integer lattice, actually ends up over independent runs.
 *
 * Cycle Audit 6 (CA6-18) found these disagreeing by up to 29% per asset, in a
 * direction that varies by asset, with `eurusd` publishing a quarterly spread
 * about 15% wider than the market has.
 *
 * Usage:
 *   node tools/sim/dist/dispersionEvidence.js [--assets a,b] [--replicates N]
 *                                             [--days N] [--runs N] [--seed S]
 */

interface Options {
  assets: string[] | null;
  /** Calibration replicates, and days per replicate. */
  replicates: number;
  days: number;
  /** Independent engine runs behind the realised figure. */
  runs: number;
  /** Simulated days per realised run, after a one-day warm-up. */
  runDays: number;
  seed: string;
}

function parse(argv: readonly string[]): Options {
  const options: Options = {
    assets: null,
    replicates: 5,
    days: 30,
    runs: 40,
    runDays: 3,
    seed: 'dispersion-evidence',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) continue;
    if (flag === '--assets') options.assets = value.split(',');
    else if (flag === '--replicates') options.replicates = Number(value);
    else if (flag === '--days') options.days = Number(value);
    else if (flag === '--runs') options.runs = Number(value);
    else if (flag === '--run-days') options.runDays = Number(value);
    else if (flag === '--seed') options.seed = value;
  }
  return options;
}

/** The diffusion rate this asset's own calibration reports, on a fresh stream. */
async function calibratedSigma(
  asset: RegisteredAsset,
  options: Options,
): Promise<{ sigma: number; rate: number }> {
  const keyring = MasterKeyring.forTesting(`${options.seed}-calibration`);
  const fresh = await calibrateAssetAsync(
    asset.definition,
    (purpose) =>
      keyring.derive({
        env: 'simulation',
        asset: registrationKeyLabel(asset.definition.id),
        purpose,
        keyEpoch: 0,
      }),
    { replicates: options.replicates, simulatedMs: options.days * 86_400_000 },
  );
  return { sigma: dispersionLogSigma(fresh.evidence), rate: fresh.evidence.logVariancePerMs };
}

/**
 * The spread of the real engine's published price over independent runs.
 *
 * The second moment about zero rather than about the sample mean: the process is
 * a martingale, so the mean *is* zero and estimating it would spend a degree of
 * freedom on a number that is known.
 */
async function realisedSigma(asset: RegisteredAsset, options: Options): Promise<number> {
  const start = 1_776_000_000_000;
  const warmUpMs = 86_400_000;
  const spanMs = options.runDays * 86_400_000;
  let second = 0;
  let sinceYield = 0;
  for (let run = 0; run < options.runs; run += 1) {
    const engine = createMarketEngine({
      config: configFor(asset),
      keyring: MasterKeyring.forTesting(`${options.seed}-run-${run}`),
      environment: 'simulation',
      start: { instant: epochMillis(start), price: logPrice(0) },
    });
    let anchor: number | null = null;
    let last = 0;
    for (;;) {
      const tick = engine.next();
      if (tick === null) break;
      const elapsed = tick.instant - start;
      if (anchor === null && elapsed >= warmUpMs) anchor = tick.price;
      if (elapsed > warmUpMs + spanMs) break;
      last = tick.price;
      sinceYield += 1;
      if (sinceYield >= 250_000) {
        sinceYield = 0;
        await yieldToLoop();
      }
    }
    if (anchor === null)
      throw new Error(`${asset.definition.id} produced no tick past the warm-up`);
    const displacement = (last - anchor) * asset.instrument.logQuantum;
    second += displacement * displacement;
  }
  const perSpan = Math.sqrt(second / options.runs);
  // Scale to a quarter: variance is additive in time under ADR-0003.
  return perSpan * Math.sqrt((90 * 86_400_000) / spanMs);
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const chosen = ASSET_CATALOGUE.filter(
    (asset) => options.assets === null || options.assets.includes(asset.definition.id),
  );
  console.info(
    `seed ${options.seed} — calibration ${options.replicates} x ${options.days}d, ` +
      `realised ${options.runs} runs x ${options.runDays}d\n`,
  );
  console.info('asset    recorded  calibrated   realised   cal/rec  real/cal  quarterly');
  for (const asset of chosen) {
    const recorded = dispersionLogSigma(asset.evidence);
    const { sigma: calibrated, rate } = await calibratedSigma(asset, options);
    const realised = await realisedSigma(asset, options);
    console.info(
      `${asset.definition.id.padEnd(8)} ${recorded.toFixed(5)}   ${calibrated.toFixed(5)}    ` +
        `${realised.toFixed(5)}    ${(calibrated / recorded).toFixed(3)}     ` +
        `${(realised / calibrated).toFixed(3)}     ` +
        `${(100 * dispersionPercent(realised)).toFixed(2)}%   rate ${rate.toExponential(6)}`,
    );
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
