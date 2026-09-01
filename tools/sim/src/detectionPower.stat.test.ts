// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine } from '@otc/engine';
import {
  BINARY_HORIZONS,
  designEffect,
  HorizonAccumulator,
  minimumDetectableEffect,
  minimumDetectableEffectUnderDependence,
  type HorizonOutcome,
} from '@otc/lab';

/**
 * Is the error bar every verdict is quoted with actually honest?
 *
 * Every clean verdict in this project reports a minimum detectable effect
 * computed as `(z_alpha + z_power) * sqrt(0.25 / n)` — a formula for `n`
 * **independent** trials. PH-10 found the realised lattice tie rate carrying
 * roughly four times its binomial variance, because a tie's probability tracks
 * the volatility level and volatility is autocorrelated over days. If direction
 * behaved the same way, every floor the project quotes would be optimistic and
 * every "clean" verdict would overstate its own sensitivity.
 *
 * ADR-0003 says it does not: `P(up) = 1/2` exactly, under every public
 * conditioning, whatever the volatility. Clustering changes how far a window
 * moves, never which way.
 *
 * This measures it, on the real engine, at every horizon the product sells.
 *
 * ## The control that makes the measurement worth something
 *
 * A design-effect estimator that returned 1 unconditionally would pass every
 * direction assertion here. So the **tie rate is accumulated from the same
 * runs, the same windows and the same ticks**, and it must come out clearly
 * above 1. One pass, two statistics, opposite expected answers: the estimator
 * cannot satisfy both by being broken.
 */

const ASSET = ASSET_CATALOGUE[0]!;
const GENESIS = 1_776_000_000_000;
/**
 * Replicates, chosen for the power to see the value that would break the phase.
 *
 * **Cycle Audit 4, Material 4.** At 40 the design-effect estimate carries a ±23%
 * relative error, so the acceptance band was [0.32, 1.68] — wide enough to admit
 * `deff = 1.5`, which is precisely the value that breaks the headline. A true
 * 1.5 makes every floor √1.5 = 1.22× coarser, and **all five 15-minute cells
 * cross the 0.2513pp payout threshold**: "forty of forty policed" fails. The
 * guard would have missed it 70% of the time.
 *
 * At 100 the relative error is 14.2%, the band is [0.57, 1.43], and a true 1.5
 * sits 3.5 standard errors outside it — roughly 90% power against the case that
 * matters. The cost is about 140 seconds.
 *
 * An acceptance band must be narrower than the effect it is meant to exclude.
 * This one was not.
 */
const REPLICATES = 100;
/** Windows at the slowest horizon; sets each replicate's simulated length. */
const SLOWEST_WINDOWS = 800;
const YIELD_TICKS = 250_000;

const breathe = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

async function replicate(index: number): Promise<HorizonOutcome[]> {
  const keyring = MasterKeyring.forTesting(`detection-power-${index}`);
  const engine = createMarketEngine({
    config: configFor(ASSET),
    keyring,
    environment: 'simulation',
    start: { instant: epochMillis(GENESIS), price: logPrice(0) },
  });
  const accumulator = new HorizonAccumulator(BINARY_HORIZONS, GENESIS, engine.price);

  let ticks = 0;
  while (accumulator.slowestHorizonWindows < SLOWEST_WINDOWS) {
    const tick = engine.next();
    if (tick === null) break;
    accumulator.observe(tick.instant, tick.price);
    ticks += 1;
    // B-010: a synchronous block this long starves the worker's RPC channel and
    // the gate exits non-zero while reporting every test as passed.
    if (ticks % YIELD_TICKS === 0) await breathe();
  }
  return accumulator.outcomes();
}

describe('the independent error bar is honest for direction', () => {
  it('reads a design effect near 1 at every horizon, and above 1 for ties', async () => {
    const runs: HorizonOutcome[][] = [];
    for (let index = 0; index < REPLICATES; index += 1) {
      runs.push(await replicate(index));
      await breathe();
    }

    const rows: string[] = [];
    const directionFailures: string[] = [];

    for (let h = 0; h < BINARY_HORIZONS.length; h += 1) {
      const label = BINARY_HORIZONS[h]!.label;
      const perRun = runs.map((run) => run[h]!);
      const decidedPerRun = Math.round(
        perRun.reduce((sum, o) => sum + o.decided, 0) / perRun.length,
      );
      const direction = designEffect(
        perRun.map((o) => o.upRate),
        decidedPerRun,
      );

      const totalDecided = perRun.reduce((sum, o) => sum + o.decided, 0);
      const independentFloor = minimumDetectableEffect(totalDecided) * 100;
      const honestFloor =
        minimumDetectableEffectUnderDependence(totalDecided, direction.designEffect) * 100;

      rows.push(
        `${label}: up-rate ${direction.mean.toFixed(5)}, design effect ` +
          `${direction.designEffect.toFixed(2)} ±${(direction.relativeStandardError * 100).toFixed(0)}%, ` +
          `n=${totalDecided}, floor ${independentFloor.toFixed(3)}pp -> ${honestFloor.toFixed(3)}pp`,
      );

      // Three relative standard errors. A design effect is a variance estimate
      // and variance estimates are noisy — but the band must still be narrower
      // than the effect it excludes. At 100 replicates it is ±43%, which puts
      // `deff = 1.5` (the value that would break the phase's headline) outside
      // it. See the note on REPLICATES.
      const tolerance = 3 * direction.relativeStandardError;
      if (Math.abs(direction.designEffect - 1) > tolerance) {
        directionFailures.push(
          `${label}: design effect ${direction.designEffect.toFixed(2)} is more than ` +
            `${tolerance.toFixed(2)} from 1`,
        );
      }
    }

    // The positive control, from the same windows: ties are overdispersed
    // because their probability follows the volatility level.
    const shortest = runs.map((run) => run[0]!);
    const tieWindows = Math.round(
      shortest.reduce((sum, o) => sum + o.windows, 0) / shortest.length,
    );
    const ties = designEffect(
      shortest.map((o) => o.tieRate),
      tieWindows,
    );
    rows.push(
      `30s ties (control): rate ${(ties.mean * 100).toFixed(3)}%, design effect ` +
        `${ties.designEffect.toFixed(2)} ±${(ties.relativeStandardError * 100).toFixed(0)}%`,
    );

    console.info(rows.join('\n'));

    expect(directionFailures).toEqual([]);

    // If this fails, the estimator is blind and every assertion above is vacuous.
    expect(
      ties.designEffect,
      'the tie-rate control did not register as overdispersed, so the estimator is not measuring anything',
    ).toBeGreaterThan(1 + 3 * ties.relativeStandardError);

    // And the two must differ, which is the whole point of running them on one
    // pass: same ticks, same windows, opposite answers.
    const shortestDirection = designEffect(
      shortest.map((o) => o.upRate),
      Math.round(shortest.reduce((sum, o) => sum + o.decided, 0) / shortest.length),
    );
    expect(ties.designEffect).toBeGreaterThan(shortestDirection.designEffect * 1.5);
  });
});
