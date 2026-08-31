// Invariant evidence: INV-006 (no deterministic exploitable directional rules),
// INV-007 (asset differentiation).
import { describe, expect, it } from 'vitest';
import { MasterKeyring, type InstrumentSpec, type RandomSource } from '@otc/core';
import { DEFAULT_CASCADE, VolatilityCascade } from './cascade.js';
import { DEFAULT_HAWKES } from './hawkes.js';
import { DEFAULT_REGIMES } from './regime.js';
import { createMarketEngine } from './factory.js';
import { runMirrorTest, SignInvertingStream } from './mirror.js';
import {
  cascadeInflation,
  cascadeInflationOfClustering,
  cascadeRmsGain,
  cascadeTimescalesMs,
  DEFAULT_TRAITS,
  expandPersonality,
  MIN_FASTEST_COMPONENT_TICKS,
  personalityConfig,
  predictedExcessKurtosis,
  solveClustering,
  TRAIT_BOUNDS,
  type PersonalityTraits,
} from './personality.js';
import { epochMillis, logPrice } from '@otc/core';

/**
 * Rhythm is the time structure of a market: how many timescales its volatility
 * has, how far apart they sit, how long it holds a regime, how long a burst
 * keeps exciting the next arrival.
 *
 * PH-10.1 moved all of it into the personality vector. Two things had to stay
 * true through that move, and both are checked here rather than argued:
 *
 *  1. **The tail did not come along for the ride.** Four of the five new traits
 *     are exactly kurtosis-neutral. Not approximately — the regime layer's
 *     tempo cancels between a numerator and denominator, and the other three do
 *     not appear in the moment product at all. `toBe` is the right assertion,
 *     and a `toBeCloseTo` here would hide the very drift the claim denies.
 *  2. **The market still cannot see a sign.** Every added quantity is a
 *     function of elapsed time and its own randomness, so ADR-0003's involution
 *     is untouched. The mirror test is the check, not the reasoning.
 */

const instrument: InstrumentSpec = {
  id: 'rhythm-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const keyring = MasterKeyring.forTesting('rhythm-spec');
const derive = (purpose: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'rhythm', purpose, keyEpoch: 0 });

const withTraits = (overrides: Partial<PersonalityTraits>): PersonalityTraits => ({
  ...DEFAULT_TRAITS,
  ...overrides,
});

/** Predicted excess kurtosis, from a stream at a known position every time. */
const kurtosisOf = (traits: PersonalityTraits): number =>
  predictedExcessKurtosis(expandPersonality(traits, instrument), derive('structure-probe'));

describe('the default traits still reproduce the calibrated time structure', () => {
  // The five new traits are expressed as times; the engine wants hazards. If the
  // reciprocal were even an ulp off the hand-written constants, every asset the
  // personality system produces would start from an unvalidated baseline — and
  // `toEqual` on the config object would still pass, because it compares values
  // that had already drifted together.
  const config = personalityConfig(DEFAULT_TRAITS);

  it('reproduces the cascade hazard exactly', () => {
    expect(config.cascade.slowestHazardPerMs).toBe(DEFAULT_CASCADE.slowestHazardPerMs);
    expect(config.cascade.components).toBe(DEFAULT_CASCADE.components);
    expect(config.cascade.hazardRatio).toBe(DEFAULT_CASCADE.hazardRatio);
  });

  it('reproduces the Hawkes decay exactly', () => {
    expect(config.arrival.decayPerMs).toBe(DEFAULT_HAWKES.decayPerMs);
  });

  it('reproduces every regime sojourn scale exactly', () => {
    expect(config.regimes.compressed.scaleMs).toBe(DEFAULT_REGIMES.compressed.scaleMs);
    expect(config.regimes.normal.scaleMs).toBe(DEFAULT_REGIMES.normal.scaleMs);
    expect(config.regimes.elevated.scaleMs).toBe(DEFAULT_REGIMES.elevated.scaleMs);
    expect(config.regimes.stressed.scaleMs).toBe(DEFAULT_REGIMES.stressed.scaleMs);
  });
});

describe('four of the five rhythm traits are tail-neutral', () => {
  const baseline = kurtosisOf(DEFAULT_TRAITS);

  // Three of the four are neutral by **absence**: no hazard, spacing or arrival
  // constant is read anywhere in the moment product, so the computation is
  // bit-for-bit the same one and `toBe` is the honest assertion.
  //
  // `regimeTempo` is different. It is neutral by **cancellation** — it enters
  // the stationary time share in both a numerator and its own normalising
  // total. That is exact in real arithmetic and lands within a few ulps in
  // floating point, because `(scale * tempo) * gamma` and
  // `tempo * (scale * gamma)` are not the same double. Asserting `toBe` there
  // would be asserting something false; asserting `toBeCloseTo` on the other
  // three would hide real drift. The two claims are different, so they get
  // different assertions.

  it('has a baseline inside the realism band', () => {
    expect(baseline).toBeGreaterThan(1.5);
    expect(baseline).toBeLessThan(200);
  });

  it('is unmoved by the cascade span', () => {
    // Rescaling *when* components switch cannot change the moments of their
    // product. Nothing in the inflation product reads a hazard.
    expect(kurtosisOf(withTraits({ cascadeSpanMs: 12 * 3_600_000 }))).toBe(baseline);
    expect(kurtosisOf(withTraits({ cascadeSpanMs: 40 * 3_600_000 }))).toBe(baseline);
  });

  it('is unmoved by the cascade spacing', () => {
    expect(kurtosisOf(withTraits({ cascadeSpacing: 1.4 }))).toBe(baseline);
    expect(kurtosisOf(withTraits({ cascadeSpacing: 2.2 }))).toBe(baseline);
  });

  it('is unmoved by the regime tempo', () => {
    // This one is a cancellation, not an absence: the stationary time share is
    // `embedded x meanSojourn` normalised by its own total, so a common factor
    // on every sojourn divides out. A tempo applied to only *some* regimes
    // would not be neutral, and this assertion is what would catch that.
    for (const regimeTempo of [0.4, 2.75]) {
      const moved = kurtosisOf(withTraits({ regimeTempo }));
      expect(Math.abs(moved - baseline) / baseline, `tempo ${regimeTempo}`).toBeLessThan(1e-13);
    }
    // And the drift really is ulp-scale rather than absent, so nobody later
    // "tightens" this to toBe and gets a test that fails on a different CPU.
    expect(kurtosisOf(withTraits({ regimeTempo: 2.75 }))).not.toBe(baseline);
  });

  it('is unmoved by the arrival memory', () => {
    expect(kurtosisOf(withTraits({ arrivalMemoryMs: 20_000 }))).toBe(baseline);
    expect(kurtosisOf(withTraits({ arrivalMemoryMs: 800_000 }))).toBe(baseline);
  });

  it('is moved, hard, by the cascade depth', () => {
    // The trait that is not neutral, stated as a test so nobody has to take
    // PH-10.1 4's word for which is which.
    expect(kurtosisOf(withTraits({ cascadeDepth: 6 }))).toBeLessThan(baseline);
    // The span is widened only to keep the fastest component above the tick
    // floor at depth 14. It is safe to vary here precisely because the assertion
    // three tests above proved the span is exactly tail-neutral.
    expect(
      kurtosisOf(
        withTraits({ cascadeDepth: 14, cascadeSpanMs: 40 * 3_600_000, cascadeSpacing: 1.9 }),
      ),
    ).toBeGreaterThan(baseline);
  });
});

describe('depth enters the cascade inflation as an exponent', () => {
  it('doubles as a square', () => {
    const clustering = 0.22;
    const single = cascadeInflationOfClustering(clustering);
    for (const depth of [4, 6, 9, 12, 18]) {
      const config = { ...DEFAULT_CASCADE, components: depth, lowMultiplier: 1 - clustering };
      expect(cascadeInflation(config) / Math.pow(single, depth)).toBeCloseTo(1, 12);
    }
  });

  it('agrees with the closed form in clustering', () => {
    // (1 + 6c^2 + c^4) / (1 + c^2)^2, derived independently of the low/high path
    // the implementation uses.
    for (const c of [0, 0.05, 0.15, 0.22, 0.31, 0.4]) {
      const u = c * c;
      const expected = (1 + 6 * u + u * u) / ((1 + u) * (1 + u));
      expect(cascadeInflationOfClustering(c)).toBeCloseTo(expected, 12);
    }
  });

  it('is strictly increasing, which is what makes the bisection sound', () => {
    let previous = -Infinity;
    let monotone = true;
    for (let step = 0; step <= 400; step += 1) {
      const value = cascadeInflationOfClustering((step / 400) * TRAIT_BOUNDS.clustering.max);
      if (value <= previous) monotone = false;
      previous = value;
    }
    expect(monotone).toBe(true);
  });
});

describe('the co-varied solve', () => {
  it('hits its target at every admissible depth', () => {
    const misses: string[] = [];
    for (
      let depth = TRAIT_BOUNDS.cascadeDepth.min;
      depth <= TRAIT_BOUNDS.cascadeDepth.max;
      depth += 1
    ) {
      const target = 40;
      // Spacing tightened and span widened so the ladder still fits between the
      // slowest component and the tick rate at depth 18. Both are tail-neutral,
      // so neither can flatter the solve.
      const base = withTraits({
        cascadeDepth: depth,
        cascadeSpanMs: 40 * 3_600_000,
        cascadeSpacing: 1.9,
      });
      // The same stream label on both sides. `structureInflation` is a
      // simulation, so "the solve hits its target" is a statement about one
      // stream; the test below measures what happens across two.
      const clustering = solveClustering(base, target, derive('structure-probe'));
      const achieved = kurtosisOf({ ...base, clustering });
      const relative = Math.abs(achieved - target) / target;
      if (!(relative < 1e-9)) misses.push(`depth ${depth}: ${achieved} (rel ${relative})`);
    }
    expect(misses).toEqual([]);
  });

  it('reaches different targets at a fixed depth', () => {
    const misses: string[] = [];
    // The floor is not zero: the regime and structure layers alone predict 10.36,
    // and the cascade can only add. A target below that is refused, not clamped —
    // which is the test below this one.
    for (const target of [12, 20, 60, 150]) {
      const clustering = solveClustering(DEFAULT_TRAITS, target, derive('structure-probe'));
      const achieved = kurtosisOf({ ...DEFAULT_TRAITS, clustering });
      if (!(Math.abs(achieved - target) / target < 1e-9)) {
        misses.push(`target ${target}: ${achieved}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('needs less clustering per component as the cascade deepens', () => {
    const ladder = { cascadeSpanMs: 40 * 3_600_000, cascadeSpacing: 1.9 };
    const shallow = solveClustering(
      withTraits({ ...ladder, cascadeDepth: 5 }),
      40,
      derive('structure-probe'),
    );
    const deep = solveClustering(
      withTraits({ ...ladder, cascadeDepth: 15 }),
      40,
      derive('structure-probe'),
    );
    expect(deep).toBeLessThan(shallow);
  });

  it('is exact only with respect to the stream it was given', () => {
    // Not a defect — a property of a layer with no closed form, and the reason
    // `solveClustering` documents the stream as load-bearing. A catalogue that
    // solved against an ad-hoc stream and recorded the target rather than the
    // achieved value would be publishing a number it never computed.
    const target = 40;
    const clustering = solveClustering(DEFAULT_TRAITS, target, derive('structure-probe'));
    const sameStream = kurtosisOf({ ...DEFAULT_TRAITS, clustering });
    const otherStream = predictedExcessKurtosis(
      expandPersonality({ ...DEFAULT_TRAITS, clustering }, instrument),
      derive('a-different-probe'),
    );
    expect(Math.abs(sameStream - target) / target).toBeLessThan(1e-9);
    const drift = Math.abs(otherStream - target) / target;
    expect(drift).toBeGreaterThan(1e-9);
    expect(drift).toBeLessThan(0.05);
  });

  it('refuses a target the other layers already exceed', () => {
    // Not a clamp. A clamped solve returns a plausible number that is not the
    // answer, and the caller records it as if it were.
    expect(() =>
      solveClustering(withTraits({ regimeSpread: 2.4 }), 0.5, derive('structure-probe')),
    ).toThrow(/already above the target/);
  });

  it('refuses a target beyond what clustering can reach', () => {
    expect(() =>
      solveClustering(withTraits({ cascadeDepth: 4 }), 190, derive('structure-probe')),
    ).toThrow(/more cascade inflation than/);
  });

  it('refuses a nonsensical target', () => {
    expect(() => solveClustering(DEFAULT_TRAITS, 0, derive('structure-probe'))).toThrow(
      /finite and positive/,
    );
    expect(() => solveClustering(DEFAULT_TRAITS, Number.NaN, derive('structure-probe'))).toThrow(
      /finite and positive/,
    );
  });
});

describe('the joint bound on the fastest component', () => {
  it('accepts the default ladder', () => {
    const scales = cascadeTimescalesMs(DEFAULT_TRAITS);
    expect(scales).toHaveLength(DEFAULT_TRAITS.cascadeDepth);
    expect(scales[0]).toBe(DEFAULT_TRAITS.cascadeSpanMs);
    expect(scales[scales.length - 1]).toBeGreaterThan(
      MIN_FASTEST_COMPONENT_TICKS * DEFAULT_TRAITS.tempoMs,
    );
  });

  it('is a geometric ladder', () => {
    const scales = cascadeTimescalesMs(withTraits({ cascadeSpacing: 3 }));
    for (let k = 1; k < scales.length; k += 1) {
      expect(scales[k - 1]! / scales[k]!).toBeCloseTo(3, 9);
    }
  });

  it('rejects a ladder whose fastest component is noise, not rhythm', () => {
    // Every trait below is individually in range. Only the combination is bad,
    // which is why the check cannot live in the per-trait bounds loop.
    const noisy = withTraits({ cascadeDepth: 18, cascadeSpacing: 4.5, cascadeSpanMs: 3_600_000 });
    expect(() => personalityConfig(noisy)).toThrow(/below the .* ms floor/);
    expect(() => personalityConfig(noisy)).toThrow(/cascadeDepth \(18\)/);
  });

  it('rejects a non-integer depth', () => {
    expect(() => personalityConfig(withTraits({ cascadeDepth: 9.5 }))).toThrow(
      /must be an integer/,
    );
  });
});

describe('the RMS gain a depth change causes', () => {
  it('matches the closed form', () => {
    for (const depth of [4, 10, 16]) {
      for (const clustering of [0.1, 0.22, 0.35]) {
        const traits = withTraits({ cascadeDepth: depth, clustering });
        expect(cascadeRmsGain(traits)).toBeCloseTo(
          Math.pow(1 + clustering * clustering, depth / 2),
          12,
        );
      }
    }
  });

  it('matches a simulated cascade whose components all resample', () => {
    // An interval far longer than the slowest component's mean switching time
    // makes every component an independent draw each step, so the sample second
    // moment estimates (1 + c^2)^K directly.
    const traits = withTraits({ cascadeDepth: 8, clustering: 0.25 });
    const config = personalityConfig(traits).cascade;
    const cascade = new VolatilityCascade(config, derive('rms-probe'));
    const steps = 40_000;
    let second = 0;
    for (let step = 0; step < steps; step += 1) {
      const value = cascade.advance(10 * 24 * 3_600_000);
      second += value * value;
    }
    const simulated = Math.sqrt(second / steps);
    expect(simulated / cascadeRmsGain(traits)).toBeCloseTo(1, 1);
  });
});

describe('rhythm does not let the market see a sign', () => {
  // The whole phase rests on this. Every quantity PH-10.1 made per-asset is a
  // function of elapsed time; if any of them had picked up a dependence on the
  // signed return, the mirror test is what fails, and it fails exactly rather
  // than statistically.
  const rhythmic: PersonalityTraits = withTraits({
    cascadeDepth: 6,
    cascadeSpanMs: 90 * 60_000,
    cascadeSpacing: 3.6,
    regimeTempo: 0.45,
    arrivalMemoryMs: 25_000,
    clustering: 0.3,
  });

  const build = (signSource: RandomSource) =>
    createMarketEngine({
      config: expandPersonality(rhythmic, instrument),
      keyring,
      environment: 'test',
      start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
      streams: { sign: signSource },
    });

  it('mirrors exactly on a personality using every new trait', () => {
    const result = runMirrorTest(build, () => derive('sign'), {
      burnInTicks: 20_000,
      compareTicks: 4_000,
    });
    expect(result.divergences).toEqual([]);
    expect(result.mirrored).toBe(true);
  });

  it('mirrors from several interior points', () => {
    for (const burnInTicks of [700, 9_000, 35_000]) {
      const result = runMirrorTest(build, () => derive('sign'), { burnInTicks, compareTicks: 250 });
      expect(result.divergences, `burn-in ${burnInTicks}`).toEqual([]);
    }
  });

  it('is a harness that can still fail', () => {
    // The sign-inverting stream must actually invert something. A mirror test
    // that passes because nothing changed is the six-times-repeated defect of
    // this project, and it costs one assertion to rule out.
    const straight = derive('sign');
    const inverted = new SignInvertingStream(derive('sign'));
    expect(inverted.nextBoolean()).toBe(!straight.nextBoolean());
  });
});

describe('a rhythm change is a state-shape change', () => {
  it('refuses to restore a snapshot from a different cascade depth', () => {
    // Depth is part of the latent state's shape, so a persisted market cannot
    // silently adopt a re-authored personality. INV-008 depends on this being
    // loud.
    const ladder = { cascadeSpanMs: 40 * 3_600_000, cascadeSpacing: 1.9 };
    const six = new VolatilityCascade(
      personalityConfig(withTraits({ ...ladder, cascadeDepth: 6 })).cascade,
      derive('depth-a'),
    );
    const twelve = new VolatilityCascade(
      personalityConfig(withTraits({ ...ladder, cascadeDepth: 12 })).cascade,
      derive('depth-b'),
    );
    expect(() => twelve.restore(six.snapshot())).toThrow(/6 components, expected 12/);
  });
});
