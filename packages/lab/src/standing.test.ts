// Invariant evidence: INV-006 (no exploitable directional rules), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type Tick } from '@otc/core';
import { ATTACK_FAMILIES, WITHHELD_FAMILY_NAMES, withheldFamilies } from './attacks/index.js';
import type { AttackFamily } from './attacks/types.js';
import type { PublicInstrument } from './observer.js';
import {
  assertIndependentFamilies,
  classifyStanding,
  composeFamilies,
  DEFAULT_STANDING_CADENCE_MS,
  isStandingRunDue,
  PRODUCT_MARGIN_PP,
  runStandingAssurance,
  StandingAssuranceError,
} from './standing.js';

const GENESIS = 1_776_000_000_000;

const INSTRUMENT: PublicInstrument = {
  id: 'standing',
  family: 'forex',
  logQuantum: 1e-5,
  displayPrecision: 5,
  referencePrice: 1,
};

/**
 * A fair random walk, seeded.
 *
 * `intervalMs` is short so a modest tick count still spans several 30-second
 * windows; the battery needs windows, not ticks.
 */
function walk(count: number, seed: string, intervalMs = 1_000): Tick[] {
  const source = MasterKeyring.forTesting(seed).derive({
    env: 'test',
    asset: 'standing',
    purpose: 'walk',
    keyEpoch: 0,
  });
  const out: Tick[] = [];
  let price = 0;
  for (let index = 0; index < count; index += 1) {
    price += source.nextFloat64() < 0.5 ? 1 : -1;
    out.push({
      sequence: index + 1,
      instant: epochMillis(GENESIS + index * intervalMs),
      price: logPrice(price),
    });
  }
  return out;
}

/**
 * A record whose direction is a published function of the clock.
 *
 * **Cycle Audit 5, CA5-06.** The auditor's construction, kept as a permanent
 * test. The price marches one way for a whole hour, and the direction of hour
 * `r` is the Thue-Morse parity of `r` — arithmetic any observer can do. Every
 * contract at every horizon the product sells is won with certainty.
 *
 * The unconditional up-rate is 0.5 by construction, so the statistic the old
 * implementation computed sees **nothing**, and it reported `clean`. Anything
 * that reports `clean` here is not a standing guarantee.
 */
function predictableByTheClock(hours: number, ticksPerHour = 60): Tick[] {
  const parity = (n: number): number => {
    let bits = 0;
    for (let v = n; v > 0; v >>= 1) bits ^= v & 1;
    return bits;
  };
  const out: Tick[] = [];
  let price = 0;
  const interval = 3_600_000 / ticksPerHour;
  for (let hour = 0; hour < hours; hour += 1) {
    const step = parity(hour) === 0 ? 1 : -1;
    for (let k = 0; k < ticksPerHour; k += 1) {
      price += step;
      out.push({
        sequence: out.length + 1,
        instant: epochMillis(GENESIS + Math.round((hour * ticksPerHour + k) * interval)),
        price: logPrice(price),
      });
    }
  }
  return out;
}

const family = (name: string): AttackFamily => ({ name }) as unknown as AttackFamily;

/**
 * Battery settings that let a unit-sized record test anything at all.
 *
 * The default `minimumBucketSamples` is 500, which at the 15-minute horizon
 * needs five days of history per bucket — right for a venue, impossible for a
 * fast test. Lowering the occupancy floor keeps every other part of the battery
 * exactly as it runs in production, and the alternative would be a test that
 * silently exercises nothing: a 4,000-tick record skipped **every** bucket and
 * reported zero hypotheses tested.
 */
const SMALL = { minimumBucketSamples: 25 } as const;

describe('the run refuses a verdict it could not stand behind', () => {
  it('refuses a family set missing a withheld family it could have run', () => {
    // The check now reads the family objects, not a list of strings a caller
    // supplied — which is the whole of what CA5-06 found.
    for (const dropped of WITHHELD_FAMILY_NAMES) {
      const partial = WITHHELD_FAMILY_NAMES.filter((name) => name !== dropped).map(family);
      expect(() => assertIndependentFamilies(partial, [...WITHHELD_FAMILY_NAMES])).toThrow(
        StandingAssuranceError,
      );
    }
  });

  it('refuses the tuning registry alone, however many families it holds', () => {
    const tuning = ['second-of-minute', 'run-length', 'minute-of-hour'].map(family);
    expect(() => assertIndependentFamilies(tuning, [...WITHHELD_FAMILY_NAMES])).toThrow(
      StandingAssuranceError,
    );
  });

  it('accepts exactly the families it could build', () => {
    const built = WITHHELD_FAMILY_NAMES.map(family);
    expect(() => assertIndependentFamilies(built, [...WITHHELD_FAMILY_NAMES])).not.toThrow();
  });

  it('names what is missing, so an operator can fix it', () => {
    const error = (() => {
      try {
        assertIndependentFamilies([family('second-of-minute')], [...WITHHELD_FAMILY_NAMES]);
        return null;
      } catch (thrown) {
        return thrown as Error;
      }
    })();
    expect(error?.message).toContain('wh-arrival-gap');
  });

  it('refuses a history too short to measure', async () => {
    await expect(
      runStandingAssurance({ assetId: 'x', instrument: INSTRUMENT, ticks: [], at: GENESIS }),
    ).rejects.toBeInstanceOf(StandingAssuranceError);
  });

  it('refuses an unusable instant rather than stamping it on a published verdict', async () => {
    for (const at of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        runStandingAssurance({
          assetId: 'x',
          instrument: INSTRUMENT,
          ticks: walk(200, 'a'),
          at,
          battery: SMALL,
        }),
      ).rejects.toBeInstanceOf(StandingAssuranceError);
    }
  });
});

describe('the verdict is derived from families that actually ran', () => {
  it('reports the families it built and the withheld ones it could not', async () => {
    const verdict = await runStandingAssurance({
      assetId: 'standing',
      instrument: INSTRUMENT,
      ticks: walk(4_000, 'a'),
      at: GENESIS,
      battery: SMALL,
    });
    // With no seam indices and no reference series, two of the four withheld
    // families cannot be constructed. That is recorded, not glossed.
    expect(verdict.families.length).toBeGreaterThan(0);
    for (const name of WITHHELD_FAMILY_NAMES.filter(
      (n) => !verdict.withheldUnavailable.includes(n),
    ))
      expect(verdict.families).toContain(name);
    expect(verdict.withheldUnavailable.length).toBeGreaterThan(0);
    expect(verdict.hypothesesTested).toBeGreaterThan(0);
    // The registry runs too, and the verdict names what it ran. Asserting only
    // the withheld names let a plant hardcode them and pass.
    expect(verdict.families).toContain('second-of-minute');
    expect(verdict.families.length).toBeGreaterThan(WITHHELD_FAMILY_NAMES.length);
    // **Out-of-band audit, a4-04.** The registry is not the full battery: the
    // learned family — the catch-all for combinations no hand-written family
    // enumerates, and the one PH-2 records as also seeing the level-anchored
    // leak — lives in `defaultFamilies()`, not in `ATTACK_FAMILIES`. A standing
    // verdict composed from the registry ran one feature kind fewer than every
    // offline verdict while the documents called it the full battery.
    expect(verdict.families).toContain('learned-logistic');
  });

  it('cannot report clean while a withheld family is unavailable', async () => {
    // Four families were withheld from tuning. A clean result from two of them
    // is a weaker claim, and reporting it under the same word overstates it.
    const verdict = await runStandingAssurance({
      assetId: 'standing',
      instrument: INSTRUMENT,
      ticks: walk(4_000, 'a'),
      at: GENESIS,
      battery: SMALL,
    });
    expect(verdict.withheldUnavailable.length).toBeGreaterThan(0);
    expect(verdict.outcome).not.toBe('clean');
  });

  it('records the coverage it measured', async () => {
    const ticks = walk(3_000, 'b');
    const verdict = await runStandingAssurance({
      assetId: 'standing',
      instrument: INSTRUMENT,
      ticks,
      at: GENESIS + 500,
      battery: SMALL,
    });
    expect(verdict.ticks).toBe(3_000);
    expect(verdict.coveredMs).toBe(ticks[ticks.length - 1]!.instant - ticks[0]!.instant);
    expect(verdict.at).toBe(GENESIS + 500);
  });
});

describe('the detection floor is the battery own, and it moves with the history', () => {
  it('carries a floor and a sufficiency flag on every horizon it tested', async () => {
    const verdict = await runStandingAssurance({
      assetId: 'standing',
      instrument: INSTRUMENT,
      ticks: walk(6_000, 'a'),
      at: GENESIS,
      battery: SMALL,
    });
    expect(verdict.horizons.length).toBeGreaterThan(0);
    for (const horizon of verdict.horizons) {
      expect(horizon.detectionFloorPp).toBeGreaterThan(0);
      expect(horizon.samples).toBeGreaterThanOrEqual(0);
      expect(typeof horizon.sufficientForPayout).toBe('boolean');
      expect(typeof horizon.sufficientForProductMargin).toBe('boolean');
    }
  });

  it('is finer with more history', async () => {
    const short = await runStandingAssurance({
      assetId: 'standing',
      instrument: INSTRUMENT,
      ticks: walk(3_000, 'a'),
      at: GENESIS,
      battery: SMALL,
    });
    const long = await runStandingAssurance({
      assetId: 'standing',
      instrument: INSTRUMENT,
      ticks: walk(30_000, 'a'),
      at: GENESIS,
      battery: SMALL,
    });
    const floorAt = (v: typeof short, label: string): number =>
      v.horizons.find((h) => h.horizon === label)!.detectionFloorPp;
    expect(floorAt(long, '30s')).toBeLessThan(floorAt(short, '30s'));
  });

  it('states the margin it is judging against', () => {
    expect(PRODUCT_MARGIN_PP).toBeCloseTo(0.2513, 3);
  });
});

describe('a record predictable from the clock is not clean', () => {
  it('reports exploitable on a market whose direction is published arithmetic', async () => {
    // The construction that broke the previous implementation, which reported
    // `clean` because the unconditional up-rate is 0.5 by construction.
    //
    // Asserting `exploitable` rather than "not clean" on purpose. The weaker
    // assertion passes for the wrong reason — a missing withheld family already
    // forces `undecided` — and a test that cannot fail for the right reason is
    // the defect Cycle Audit 5 found seven times. So every family is made
    // available here, and the verdict has to be the alarm.
    const reference = predictableByTheClock(600, 61);
    const verdict = await runStandingAssurance({
      assetId: 'standing',
      instrument: INSTRUMENT,
      ticks: predictableByTheClock(600),
      at: GENESIS,
      withheld: {
        seamIndices: [1_000, 5_000],
        reference: {
          instants: Float64Array.from(reference.map((t) => t.instant)),
          prices: Int32Array.from(reference.map((t) => t.price)),
        },
      },
      battery: SMALL,
    });
    expect(verdict.withheldUnavailable).toEqual([]);
    expect(verdict.outcome).toBe('exploitable');
    expect(verdict.exploitable.length).toBeGreaterThan(0);
    expect(Math.abs(verdict.worstZ ?? 0)).toBeGreaterThan(10);
  }, 300_000);

  it('runs the registry as well as the withheld families', () => {
    // Measured: the withheld four alone returned 88 hypotheses and **zero**
    // exploitable on the record above, worst z = -1.15. None of them conditions
    // on wall-clock phase. The withheld families make the verdict independent
    // evidence; the registry gives it coverage. Neither alone is a standing
    // guarantee.
    expect(ATTACK_FAMILIES.length).toBeGreaterThan(4);
  });

  it('a short fair record is not clean either, for want of power', async () => {
    const verdict = await runStandingAssurance({
      assetId: 'standing',
      instrument: INSTRUMENT,
      ticks: walk(600, 'a'),
      at: GENESIS,
      battery: SMALL,
    });
    expect(verdict.outcome).toBe('undecided');
  });
});

describe('the cadence is decided from an injected instant', () => {
  it('is due when nothing has run', () => {
    expect(isStandingRunDue(null, GENESIS)).toBe(true);
  });

  it('is not due before the cadence has elapsed', () => {
    expect(isStandingRunDue(GENESIS, GENESIS + DEFAULT_STANDING_CADENCE_MS - 1)).toBe(false);
  });

  it('is due exactly on the cadence', () => {
    expect(isStandingRunDue(GENESIS, GENESIS + DEFAULT_STANDING_CADENCE_MS)).toBe(true);
  });

  it('is daily', () => {
    expect(DEFAULT_STANDING_CADENCE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it.each([0, -1, Number.NaN])('refuses a cadence of %s', (cadence) => {
    expect(() => isStandingRunDue(GENESIS, GENESIS + 1, cadence)).toThrow(StandingAssuranceError);
  });

  it('refuses an unusable instant rather than guessing', () => {
    expect(() => isStandingRunDue(GENESIS, Number.NaN)).toThrow(StandingAssuranceError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a stored last-run time of %s',
    (lastRunAt) => {
      // `NaN - x >= c` is false, so an unvalidated field meant "never due",
      // forever, silently — the failure this module exists to prevent.
      expect(() => isStandingRunDue(lastRunAt, GENESIS + 1e12)).toThrow(StandingAssuranceError);
    },
  );
});

describe('each rule of the classifier, on its own', () => {
  // End to end these mask one another, and `clean` needs more history than a
  // unit test can hold. Tested directly so every rule can fail for its own
  // reason.
  const powerful = [
    {
      horizon: '30s',
      samples: 1e6,
      detectionFloorPp: 0.05,
      sufficientForPayout: true,
      sufficientForProductMargin: true,
    },
    {
      horizon: '15m',
      samples: 1e5,
      detectionFloorPp: 0.2,
      sufficientForPayout: true,
      sufficientForProductMargin: true,
    },
  ];
  const weak = [
    {
      horizon: '30s',
      samples: 100,
      detectionFloorPp: 12,
      sufficientForPayout: false,
      sufficientForProductMargin: false,
    },
  ];

  /**
   * Enough power for a generous payout, and not for the product's margin.
   *
   * **Cycle Audit 6, A6-03.** The classifier read `sufficientForPayout`, which
   * the battery computes against whatever payout its caller supplied — and 0.85
   * is a payout this repository ships. A floor of 4.040pp was declared
   * sufficient and the verdict published as `clean`, sixteen times coarser than
   * the margin the product actually runs on.
   */
  const generousPayoutOnly = [
    {
      horizon: '30s',
      samples: 1e5,
      detectionFloorPp: 4.04,
      sufficientForPayout: true,
      sufficientForProductMargin: false,
    },
  ];
  const oneFinding = { length: 1 };
  const noFindings = { length: 0 };

  it('composing the family set carries every family it was given', () => {
    // A6-05: the refusal that used to sit here could not fire, because
    // composition is a concatenation. What is worth asserting is the property
    // itself — every built withheld family reaches the run — and it is asserted
    // on the function the verdict calls.
    const built = withheldFamilies({
      seamIndices: [10],
      reference: {
        instants: new Float64Array(64).map((_, i) => GENESIS + i * 1_000),
        prices: new Int32Array(64).map((_, i) => i % 7),
      },
    });
    expect(built.length).toBeGreaterThan(0);
    const names = composeFamilies(built).map((family) => family.name);
    for (const family of built) expect(names).toContain(family.name);
    for (const family of ATTACK_FAMILIES) expect(names).toContain(family.name);
    // And the learned family, which is not in the registry (a4-04).
    expect(names).toContain('learned-logistic');
  });

  it('reports clean only when everything holds', () => {
    expect(classifyStanding({ clean: true, exploitable: noFindings }, powerful, [])).toBe('clean');
  });

  it('an unavailable withheld family alone forces undecided', () => {
    expect(
      classifyStanding({ clean: true, exploitable: noFindings }, powerful, ['wh-cross-asset']),
    ).toBe('undecided');
  });

  it('an insufficient floor alone forces undecided', () => {
    expect(classifyStanding({ clean: true, exploitable: noFindings }, weak, [])).toBe('undecided');
  });

  it('a floor sufficient for a generous payout is not sufficient for the product', () => {
    // The distinction A6-03 found missing. `sufficientForPayout` answers the
    // caller's question; `clean` is published about the product.
    expect(generousPayoutOnly[0]!.sufficientForPayout).toBe(true);
    expect(classifyStanding({ clean: true, exploitable: noFindings }, generousPayoutOnly, [])).toBe(
      'undecided',
    );
  });

  it('no horizons at all is undecided, not clean', () => {
    expect(classifyStanding({ clean: true, exploitable: noFindings }, [], [])).toBe('undecided');
  });

  it('an exploitable finding wins over every other rule, at any power', () => {
    expect(
      classifyStanding({ clean: false, exploitable: oneFinding }, weak, ['wh-cross-asset']),
    ).toBe('exploitable');
  });

  it('a battery that is not clean is not reported clean', () => {
    expect(classifyStanding({ clean: false, exploitable: noFindings }, powerful, [])).toBe(
      'undecided',
    );
  });
});
