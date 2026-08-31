import { bucketStart, epochMillis, timeframe } from '@otc/core';
import { standardNormal } from '@otc/core';
import { FixtureSource, nextMagnitude, quantise } from './base.js';
import type { Fixture, FixtureOptions } from './types.js';

/**
 * The planted-edge corpus.
 *
 * Each generator is the sign-blind core of `base.ts` with exactly one violation
 * introduced. That one-violation-each discipline is what makes the corpus a
 * clean instrument: when a battery detects a fixture, it has detected that
 * specific defect and not some incidental difference.
 */

const MINUTE = timeframe('1m');

/**
 * Each fixture maps `strength` in `[0, 1]` onto its own stable range. The
 * ceilings are the largest values at which the generator still behaves like a
 * market: past them a fixture is broken rather than more strongly planted.
 */
const MAX_DRIFT_FRACTION = 0.1;
const MAX_LEVERAGE = 0.09;
const MAX_SIGN_PERSISTENCE = 0.25;
const MAX_COARSENING_STEPS = 200;
const MAX_TIMING_BIAS = 0.25;
const MAX_LEVEL_MODULATION = 0.9;

/** The cell width of the level-anchored fixture, in lattice steps. */
export const LEVEL_ANCHOR_CELL_STEPS = 4_000;

/**
 * The negative control. No defect: magnitude is sign-blind, sign is an
 * independent fair coin, so `P(up) = P(down)` exactly at every horizon under
 * every public conditioning (ADR-0003). A battery that reports an edge here is
 * broken.
 */
class SymmetricControl extends FixtureSource {
  protected step(intervalMs: number): number {
    const volatility = this.volatility.advance(this.streams, intervalMs);
    const magnitude = nextMagnitude(this.streams, volatility);
    const steps = quantise(this.streams.magnitude, magnitude, this.instrument.logQuantum);
    const sign = this.streams.sign.nextBoolean() ? 1 : -1;
    this.price += sign * steps;
    return this.price;
  }
}

/**
 * Constant directional drift. The most elementary leak, and the one every
 * battery must catch: edge grows as `sqrt(H)`, so it is most visible at the
 * longest horizon.
 */
class DriftFixture extends FixtureSource {
  protected step(intervalMs: number): number {
    const volatility = this.volatility.advance(this.streams, intervalMs);
    const magnitude = nextMagnitude(this.streams, volatility);
    const steps = quantise(this.streams.magnitude, magnitude, this.instrument.logQuantum);
    const sign = this.streams.sign.nextBoolean() ? 1 : -1;
    // Drift in units of the typical per-tick move. The ceiling keeps the walk
    // recognisable as a market rather than a ramp.
    const drift =
      (this.options.strength * MAX_DRIFT_FRACTION * volatility) / this.instrument.logQuantum;
    this.price += Math.round(sign * steps + drift);
    return this.price;
  }
}

/**
 * The leverage effect: volatility responds to the *signed* return.
 *
 * The most dangerous fixture in the corpus, because it is the one a competent
 * quantitative developer would add on purpose. It is one of the most robust
 * stylized facts of real markets, it leaves the process an exact martingale, and
 * it still moves `P(up)` by percentage points — because a binary contract pays
 * on the median, and skew separates the median from the mean.
 */
class LeverageFixture extends FixtureSource {
  // An asymmetric GARCH recursion, rather than the shared two-timescale core:
  // the leak needs high volatility persistence to express itself, and this is
  // the parameterisation whose edge was measured directly.
  #variance = 1;

  protected step(intervalMs: number): number {
    // Advance the shared latent state so stream consumption matches the other
    // fixtures tick for tick, keeping runs comparable.
    this.volatility.advance(this.streams, intervalMs);

    const shock = Math.abs(standardNormal(this.streams.magnitude));
    const scaled = Math.sqrt(this.#variance) * shock;
    const magnitude = LEVERAGE_BASE_VOLATILITY * scaled;
    const steps = quantise(this.streams.magnitude, magnitude, this.instrument.logQuantum);
    const sign = this.streams.sign.nextBoolean() ? 1 : -1;
    this.price += sign * steps;

    // The defect: variance responds to the SIGN of the return, not just its
    // size. The process remains an exact martingale; what moves is the skew of
    // the horizon sum, and therefore its median.
    const w = 0.01;
    const a = 0.05;
    const b = 0.9;
    // The ceiling keeps a + leverage/2 + b below 1. Above that the variance
    // recursion is non-stationary and the price runs away — which is a broken
    // fixture, not a stronger one.
    const leverage = sign < 0 ? this.options.strength * MAX_LEVERAGE : 0;
    this.#variance = w + (a + leverage) * scaled * scaled + b * this.#variance;
    return this.price;
  }
}

/** Chosen so the leverage fixture's typical tick move matches the other fixtures'. */
const LEVERAGE_BASE_VOLATILITY = 1.25e-5;

/** Persistent signs: `P(same sign as previous) = 0.5 + strength`. Directly tradeable at H = 1. */
class SignAutocorrelationFixture extends FixtureSource {
  #previousSign = 1;

  protected step(intervalMs: number): number {
    const volatility = this.volatility.advance(this.streams, intervalMs);
    const magnitude = nextMagnitude(this.streams, volatility);
    const steps = quantise(this.streams.magnitude, magnitude, this.instrument.logQuantum);
    const repeat =
      this.streams.sign.nextFloat64() < 0.5 + this.options.strength * MAX_SIGN_PERSISTENCE;
    const sign = repeat ? this.#previousSign : -this.#previousSign;
    this.#previousSign = sign;
    this.price += sign * steps;
    return this.price;
  }
}

/**
 * A fine internal lattice published on a coarse grid.
 *
 * Demonstrates the channel ADR-0004 exists to close. Symmetry holds about the
 * unrounded internal price, so immediately after the published value steps up
 * the internal price sits near the bottom of its new cell and the next published
 * step is biased downward. *Fade the last displayed quantum.*
 */
class DisplayQuantizationFixture extends FixtureSource {
  #internal = 0;

  protected step(intervalMs: number): number {
    const volatility = this.volatility.advance(this.streams, intervalMs);
    const magnitude = nextMagnitude(this.streams, volatility);
    const steps = quantise(this.streams.magnitude, magnitude, this.instrument.logQuantum);
    const sign = this.streams.sign.nextBoolean() ? 1 : -1;
    this.#internal += sign * steps;
    const coarse = 1 + Math.round(this.options.strength * MAX_COARSENING_STEPS);
    // Round the SIGNED price, which is exactly what makes this asymmetric.
    this.price = Math.round(this.#internal / coarse) * coarse;
    return this.price;
  }
}

/**
 * Direction biased by position within the minute.
 *
 * Present because a battery conditioning only on translation-invariant price
 * features will not see it at all. Catching it requires conditioning on
 * wall-clock phase.
 */
class BoundaryTimingFixture extends FixtureSource {
  protected step(intervalMs: number): number {
    const volatility = this.volatility.advance(this.streams, intervalMs);
    const magnitude = nextMagnitude(this.streams, volatility);
    const steps = quantise(this.streams.magnitude, magnitude, this.instrument.logQuantum);
    const withinMinute = this.instant - bucketStart(epochMillis(this.instant), MINUTE);
    const inFirstThird = withinMinute < MINUTE.durationMs / 3;
    const upProbability = inFirstThird ? 0.5 + this.options.strength * MAX_TIMING_BIAS : 0.5;
    const sign = this.streams.sign.nextFloat64() < upProbability ? 1 : -1;
    this.price += sign * steps;
    return this.price;
  }
}

/**
 * Volatility modulated by absolute price level, on a fixed lattice of cells.
 *
 * The level is a public statistic, so an adversary can recompute the generator's
 * own rule from the tape and trade toward the nearest low-volatility node. It is
 * present in the corpus because every conventional attack battery conditions on
 * *translation-invariant* features — multi-lag returns, realized volatility,
 * candle shapes, run lengths — and not one of them is a proxy for absolute price
 * modulo a cell width. This fixture is the corpus's test of that blind spot.
 */
class LevelAnchoredFixture extends FixtureSource {
  protected step(intervalMs: number): number {
    const volatility = this.volatility.advance(this.streams, intervalMs);
    // Triangle wave in price, using only exactly-specified arithmetic.
    const cell = LEVEL_ANCHOR_CELL_STEPS;
    const phase = (((this.price % cell) + cell) % cell) / cell;
    const triangle = 1 - 2 * Math.abs(2 * phase - 1);
    // Additive rather than multiplicative in log-volatility. A stronger
    // multiplicative contrast was measured and was harder to detect, not easier:
    // it traps the walk in the low-volatility cells, so the conditioning buckets
    // become wildly unbalanced and the effective sample size collapses.
    const modulated = volatility * (1 + this.options.strength * MAX_LEVEL_MODULATION * triangle);
    const magnitude = nextMagnitude(this.streams, modulated);
    const steps = quantise(this.streams.magnitude, magnitude, this.instrument.logQuantum);
    const sign = this.streams.sign.nextBoolean() ? 1 : -1;
    this.price += sign * steps;
    return this.price;
  }
}

/**
 * A memoryless Gaussian random walk: constant volatility, no clustering, no fat
 * tails, no regimes.
 *
 * The realism **negative control**. It has no directional edge at any horizon
 * under any conditioning, so it passes the entire attack battery — which is
 * exactly the point. `PROJECT_INTRODUCTION.md` names it as anti-goal 31.1, and
 * without a realism gate it is the cheapest way to pass PH-2 while building
 * something worthless.
 */
class GaussianRandomWalkFixture extends FixtureSource {
  protected step(): number {
    const magnitude = FLAT_VOLATILITY * Math.abs(standardNormal(this.streams.magnitude));
    const steps = quantise(this.streams.magnitude, magnitude, this.instrument.logQuantum);
    const sign = this.streams.sign.nextBoolean() ? 1 : -1;
    this.price += sign * steps;
    return this.price;
  }
}

/** Constant per-tick volatility, matching the other fixtures' typical move. */
const FLAT_VOLATILITY = 1e-5;

function fixture(
  name: string,
  description: string,
  defect: string,
  targetHorizons: readonly number[],
  make: (options: FixtureOptions) => FixtureSource,
): Fixture {
  return { name, description, defect, targetHorizons, create: make };
}

export const FIXTURES: readonly Fixture[] = [
  fixture(
    'gaussianRandomWalk',
    'A memoryless Gaussian random walk with constant volatility.',
    'none directionally — it is the REALISM negative control, not an anti-predictability one',
    [30, 60, 300],
    (o) => new GaussianRandomWalkFixture(o, 'gaussian-random-walk'),
  ),
  fixture(
    'symmetricControl',
    'Sign-blind two-timescale stochastic volatility with heavy tails and jumps.',
    'none — the negative control',
    [30, 60, 300],
    (o) => new SymmetricControl(o, 'symmetric-control'),
  ),
  fixture(
    'drift',
    'The control plus a constant directional drift.',
    'non-zero conditional mean; edge grows as sqrt(horizon)',
    [300, 900],
    (o) => new DriftFixture(o, 'drift'),
  ),
  fixture(
    'leverageEffect',
    'The control with volatility responding to the signed return.',
    'negative skew moves the median away from the mean while the process stays an exact martingale',
    [60, 300, 900],
    (o) => new LeverageFixture(o, 'leverage-effect'),
  ),
  fixture(
    'signAutocorrelation',
    'The control with signs following a persistent Markov chain.',
    'directly tradeable sign autocorrelation',
    [1, 5, 30],
    (o) => new SignAutocorrelationFixture(o, 'sign-autocorrelation'),
  ),
  fixture(
    'displayQuantization',
    'A fine internal lattice published on a coarse grid.',
    'rounding a signed price is asymmetric about the unrounded value; fade the last displayed quantum',
    [1, 5, 30],
    (o) => new DisplayQuantizationFixture(o, 'display-quantization'),
  ),
  fixture(
    'boundaryTiming',
    'The control with direction biased during the first third of each minute.',
    'wall-clock phase dependence, invisible to translation-invariant features',
    [30, 60],
    (o) => new BoundaryTimingFixture(o, 'boundary-timing'),
  ),
  fixture(
    'levelAnchoredVolatility',
    'The control with volatility modulated by absolute price modulo a fixed cell.',
    'level-anchored volatility, invisible to every translation-invariant feature set',
    [60, 300],
    (o) => new LevelAnchoredFixture(o, 'level-anchored-volatility'),
  ),
];

export function fixtureByName(name: string): Fixture {
  const found = FIXTURES.find((f) => f.name === name);
  if (found === undefined) {
    throw new RangeError(
      `Unknown fixture ${JSON.stringify(name)}. Known: ${FIXTURES.map((f) => f.name).join(', ')}.`,
    );
  }
  return found;
}
