// Invariant evidence: INV-003 (single underlying stream), INV-007 (asset differentiation), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { assertValidInstrument, assertValidStreamLabel, MasterKeyring } from '@otc/core';
import { ASSET_CATALOGUE, registrationKeyLabel } from './catalogue.js';
import { dispersionLogSigma } from './dispersion.js';
import { cascadeRmsGain, EXCESS_KURTOSIS_BAND, TRAIT_BOUNDS } from './personality.js';
import {
  ASSET_ID_PATTERN,
  checkIdentity,
  MAX_ASSET_ID_LENGTH,
  MAX_DISPLAY_PRECISION,
  MAX_LABEL_COMPONENT_LENGTH,
  REFERENCE_PRICE_BOUNDS,
  registerAsset,
  type RegistrationRequest,
} from './registration.js';

const keyring = MasterKeyring.forTesting('registration-spec');

/**
 * A calibration small enough for a unit test.
 *
 * The venue's default is three replicates of ten simulated days, which is right
 * for an asset that will settle real contracts and impossible for a fast test.
 * Every stage still runs; only the sample behind the lattice shrinks.
 */
const QUICK = { replicates: 3, simulatedMs: 6 * 60 * 60 * 1000 } as const;

const admitEverything = () => null;

function request(over: Partial<RegistrationRequest> = {}): RegistrationRequest {
  return {
    id: 'usdx',
    family: 'index',
    displayName: 'USD Index',
    referencePrice: 100,
    traits: { ...ASSET_CATALOGUE[0]!.definition.traits },
    targets: { ...ASSET_CATALOGUE[0]!.authored },
    ...over,
  };
}

const options = (over: Record<string, unknown> = {}) => ({
  keyring,
  environment: 'test' as const,
  existing: ASSET_CATALOGUE,
  differentiates: admitEverything,
  calibration: QUICK,
  // These tests fit budgets from six hours of market against a personality
  // whose volatility remembers for thirty-six. That is far too short to fit
  // *accurately* — `DISPERSION_FIT_TURNOVERS` records the measurement — and it
  // is the right span for testing the mechanism, which is what these assert.
  // The default is exercised below, in both directions.
  dispersionTurnovers: 0.1,
  ...over,
});

describe('an identity has to survive being a filename and a key label', () => {
  it('accepts a usable id', () => {
    expect(checkIdentity(request(), [])).toBeNull();
  });

  it.each([
    ['upper case', 'USDX'],
    ['a slash', 'fx/usdx'],
    ['a leading dot', '.usdx'],
    ['a path escape', '../escaped'],
    ['empty', ''],
    ['too long', 'a'.repeat(65)],
    // **Cycle Audit 7, a3-13.** Distinct labels, not distinct filenames on
    // every filesystem: NTFS strips a trailing dot.
    ['a trailing dot', 'eurusd.'],
    ['a trailing hyphen', 'eurusd-'],
    ['consecutive dots', 'eur..usd'],
  ])('refuses %s', (_label, id) => {
    expect(checkIdentity(request({ id }), [])).not.toBeNull();
  });

  it.each(['a', 'eur.usd', 'eur-usd_1', 'x'.repeat(MAX_ASSET_ID_LENGTH)])('accepts %s', (id) => {
    expect(checkIdentity(request({ id }), [])).toBeNull();
  });

  it('refuses an id the key label cannot hold, and says so in characters', () => {
    // **Cycle Audit 7, a3-04.** The pattern admitted sixty-four characters and
    // `registration-` takes thirteen of the label's sixty-four, so ids of 52
    // to 64 passed here and were refused at `safety` with a stream-label
    // error. The maximum is derived from the prefix, and pinned against the
    // label rules the keyring actually applies.
    expect(MAX_ASSET_ID_LENGTH).toBe(51);
    const longest = 'a'.repeat(MAX_ASSET_ID_LENGTH);
    expect(() =>
      assertValidStreamLabel({
        env: 'test',
        asset: registrationKeyLabel(longest),
        purpose: 'brief',
        keyEpoch: 0,
      }),
    ).not.toThrow();
    expect(() =>
      assertValidStreamLabel({
        env: 'test',
        asset: registrationKeyLabel(`${longest}a`),
        purpose: 'brief',
        keyEpoch: 0,
      }),
    ).toThrow();
    const refusal = checkIdentity(request({ id: `${longest}a` }), []);
    expect(refusal).toMatch(/52 characters; the maximum is 51/);
  });

  it('shares the label component limit the keyring enforces', () => {
    const at = (length: number) => () =>
      assertValidStreamLabel({ env: 'test', asset: 'a'.repeat(length), purpose: 'p', keyEpoch: 0 });
    expect(at(MAX_LABEL_COMPONENT_LENGTH)).not.toThrow();
    expect(at(MAX_LABEL_COMPONENT_LENGTH + 1)).toThrow();
  });

  it('shares the display precision ceiling the core enforces', () => {
    const spec = { id: 'usdx', family: 'index', logQuantum: 1e-6, referencePrice: 100 } as const;
    expect(() =>
      assertValidInstrument({ ...spec, displayPrecision: MAX_DISPLAY_PRECISION }),
    ).not.toThrow();
    expect(() =>
      assertValidInstrument({ ...spec, displayPrecision: MAX_DISPLAY_PRECISION + 1 }),
    ).toThrow();
    // And refuses it here, at `identity`, rather than after the calibration.
    expect(checkIdentity(request({ displayPrecision: MAX_DISPLAY_PRECISION }), [])).toBeNull();
    expect(checkIdentity(request({ displayPrecision: MAX_DISPLAY_PRECISION + 1 }), [])).toMatch(
      /\[0, 18\]/,
    );
  });

  it.each([5e-324, 1e-16, 1e300, Number.POSITIVE_INFINITY])(
    'refuses the reference price %s before anything is simulated',
    (referencePrice) => {
      // **Cycle Audit 7, a3-07.** A subnormal reference made the derived
      // display precision infinite and 1e300 made it −292; both were refused
      // after the calibration with a message about display precision.
      expect(checkIdentity(request({ referencePrice }), [])).not.toBeNull();
    },
  );

  it('accepts every reference price a display can render', () => {
    for (const referencePrice of [
      REFERENCE_PRICE_BOUNDS.min,
      0.5,
      68_000,
      REFERENCE_PRICE_BOUNDS.max,
    ]) {
      expect(checkIdentity(request({ referencePrice }), []), String(referencePrice)).toBeNull();
    }
  });

  it('refuses an id already in the catalogue', () => {
    // Two assets with one id derive the same streams: one market published
    // under two names, which is INV-003 broken at registration time.
    const clash = checkIdentity(request({ id: 'eurusd' }), ASSET_CATALOGUE);
    expect(clash).toMatch(/already registered/);
  });

  it.each([
    ['a zero reference price', { referencePrice: 0 }],
    ['a negative reference price', { referencePrice: -1 }],
    ['a fractional precision', { displayPrecision: 2.5 }],
    ['a negative precision', { displayPrecision: -1 }],
    ['a blank display name', { displayName: '   ' }],
  ])('refuses %s', (_label, over) => {
    expect(checkIdentity(request(over), [])).not.toBeNull();
  });

  it('admits nothing the persistence layer refuses', () => {
    // `FileStateStore` and `assertAssetId` enforce the wider shape. An id that
    // registers and then cannot be persisted is worse than one refused here,
    // so this pattern is that one tightened at the tail (a3-13), never
    // loosened.
    expect(ASSET_ID_PATTERN.source).toBe('^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$');
    const persistence = /^[a-z0-9][a-z0-9._-]{0,63}$/;
    for (const id of ['a', 'eurusd', 'eur.usd', 'a-b_c.d9', 'x'.repeat(64)]) {
      if (ASSET_ID_PATTERN.test(id)) expect(persistence.test(id), id).toBe(true);
    }
  });
});

describe('registration runs every stage, and any of them may refuse', () => {
  it('registers a usable asset and calibrates its own lattice', async () => {
    const outcome = await registerAsset(request(), options());
    expect(outcome.kind).toBe('registered');
    if (outcome.kind !== 'registered') throw new Error(outcome.reason);

    // The lattice is derived from this asset's own return distribution, never
    // supplied by the caller.
    expect(outcome.asset.instrument.logQuantum).toBeGreaterThan(0);
    // The instrument publishes the quantum the calibration derived, not one a
    // caller supplied. These are the same number or the lattice that settles is
    // not the lattice that was measured.
    expect(outcome.asset.instrument.logQuantum).toBe(outcome.asset.evidence.logQuantum);
    expect(outcome.asset.evidence.tieRate).toBeGreaterThan(0);
    expect(outcome.asset.evidence.medianSteps).toBeGreaterThan(0);
    expect(outcome.asset.definition.id).toBe('usdx');
    // Nothing rescaled it, so the evidence is what the simulation produced.
    expect(outcome.asset.evidence.volatilityScale).toBe(1);
  }, 120_000);

  it('takes the display precision from the lattice when none is asked for', async () => {
    const outcome = await registerAsset(request(), options());
    if (outcome.kind !== 'registered') throw new Error(outcome.reason);
    const quantum = outcome.asset.instrument.logQuantum;
    // One decimal finer than the smallest move the lattice can make.
    const needed = Math.ceil(Math.log10(1 / (quantum * 100)));
    expect(outcome.asset.instrument.displayPrecision).toBe(needed);
    expect(needed).toBeGreaterThan(2);
  }, 120_000);

  it('refuses a display coarser than the lattice that settles', async () => {
    // A trader would see an unchanged price on a contract that moved. INV-009
    // stays intact and the screen still lies, which is a fairness problem of a
    // different kind.
    const outcome = await registerAsset(request({ displayPrecision: 2 }), options());
    expect(outcome).toMatchObject({ kind: 'refused', stage: 'calibration' });
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.reason).toMatch(/coarser than the lattice/);
  }, 120_000);

  it('refuses a display the core itself would reject, before calibrating', async () => {
    // **Cycle Audit 6, CA6-20.** `checkIdentity` asked only for a non-negative
    // integer, and nothing re-validated the instrument that is actually
    // returned — so 19 and 30 registered and produced an instrument
    // `assertValidInstrument` rejects. **Cycle Audit 7, a3-06.** The refusal
    // then arrived at `calibration`, after paying for the whole simulation;
    // the ceiling is the core's and is known at `identity`.
    for (const displayPrecision of [19, 30]) {
      const outcome = await registerAsset(request({ displayPrecision }), options());
      expect(outcome, `precision ${displayPrecision}`).toMatchObject({
        kind: 'refused',
        stage: 'identity',
      });
    }
  });

  it('registers a reference price whose lattice step exceeds a display unit at zero decimals', async () => {
    // **Cycle Audit 7, a3-07.** `displayPrecisionFor` went negative here and
    // a legal asset was refused after its calibration. Zero decimals is the
    // honest display of a lattice that moves in whole units.
    const outcome = await registerAsset(request({ referencePrice: 1e12 }), options());
    expect(outcome.kind).toBe('registered');
    if (outcome.kind !== 'registered') throw new Error(outcome.reason);
    expect(outcome.asset.instrument.displayPrecision).toBe(0);
  }, 120_000);

  it('refuses a target tail weight outside the realism band at the gate', async () => {
    // **Cycle Audit 7, a3-06.** The gate read the traits before the solve, so
    // a target of 250 with a safe starting clustering passed it; the solve
    // reached 250 and the calibration refused the result a simulation later.
    for (const excessKurtosis of [EXCESS_KURTOSIS_BAND.max + 50, EXCESS_KURTOSIS_BAND.min / 2]) {
      const outcome = await registerAsset(
        request({ id: 'tail', targets: { ...request().targets, excessKurtosis } }),
        options(),
      );
      expect(outcome, `target ${excessKurtosis}`).toMatchObject({
        kind: 'refused',
        stage: 'safety',
      });
      if (outcome.kind !== 'refused') throw new Error('expected a refusal');
      expect(outcome.reason).toMatch(/realism band/);
    }
  });

  it('refuses a turnover count that would switch the span guard off', async () => {
    // CA6-21: `pooledMs < NaN` is false, so `NaN` disabled the guard rather
    // than relaxing it, as did 0 and a negative.
    for (const dispersionTurnovers of [0, -5, Number.NaN]) {
      await expect(
        registerAsset(request({ dispersion: 0.12 }), options({ dispersionTurnovers })),
      ).rejects.toThrow(/positive number/);
    }
  }, 120_000);

  it('accepts a display finer than the lattice', async () => {
    const outcome = await registerAsset(request({ displayPrecision: 12 }), options());
    if (outcome.kind !== 'registered') throw new Error(outcome.reason);
    expect(outcome.asset.instrument.displayPrecision).toBe(12);
  }, 120_000);

  it('records what the personality actually achieved, not what was asked for', async () => {
    const outcome = await registerAsset(request(), options());
    if (outcome.kind !== 'registered') throw new Error(outcome.reason);
    // PH-10.1: the solve is exact only with respect to the stream that drove it,
    // so recording the target would publish a number nothing computed.
    expect(outcome.asset.authored.excessKurtosis).toBeGreaterThan(0);
    expect(outcome.asset.authored.tickRms).toBeGreaterThan(0);

    // And the registered traits are the *solved* ones. Registering what was
    // asked for would publish a personality nothing achieved — the number and
    // the market would disagree, and only the number would be visible.
    const asked = request().traits;
    expect(outcome.asset.definition.traits.clustering).not.toBe(asked.clustering);
    expect(outcome.asset.definition.traits.cascadeDepth).toBe(asked.cascadeDepth);
  }, 120_000);

  it('refuses at the identity stage before spending a minute on a solve', async () => {
    const outcome = await registerAsset(request({ id: 'NOPE' }), options());
    expect(outcome).toMatchObject({ kind: 'refused', stage: 'identity' });
  });

  it('refuses an unsafe personality at the gate, not at the solve', async () => {
    // Every trait individually in range, and the combination compounds to an
    // excess kurtosis of ~14,900 against a ceiling of 200. That is the case the
    // gate exists for, and it answers in microseconds where the solve takes a
    // minute.
    //
    // The stage is asserted exactly. Accepting `safety` *or* `authoring` let a
    // plant that skipped the gate pass, because the solve refused it anyway —
    // the test could not tell which guard had fired.
    const unsafe = request({
      id: 'unsafe',
      traits: {
        ...request().traits,
        clustering: 0.4,
        cascadeDepth: 18,
        cascadeSpacing: 1.3,
        cascadeSpanMs: 172_800_000,
      },
    });
    const outcome = await registerAsset(unsafe, options());
    expect(outcome).toMatchObject({ kind: 'refused', stage: 'safety' });
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.reason).toMatch(/excess kurtosis/);
  }, 120_000);

  it('refuses a cascade whose fastest component is faster than the tick', async () => {
    const tooFast = request({
      id: 'toofast',
      traits: {
        ...request().traits,
        tempoMs: 60_000,
        cascadeDepth: 18,
        cascadeSpanMs: 1_800_000,
        cascadeSpacing: 4.5,
      },
    });
    const outcome = await registerAsset(tooFast, options());
    expect(outcome).toMatchObject({ kind: 'refused', stage: 'safety' });
  }, 120_000);

  it('refuses when the differentiation check says the asset is a clone', async () => {
    // INV-007 says assets have genuinely distinct statistical personalities. A
    // hundred assets from five templates would be twenty clones of each, and
    // the invariant would be false the moment the catalogue grew.
    const outcome = await registerAsset(
      request(),
      options({ differentiates: () => 'indistinguishable from eurusd' }),
    );
    expect(outcome).toMatchObject({
      kind: 'refused',
      stage: 'differentiation',
      reason: 'indistinguishable from eurusd',
    });
  }, 120_000);

  it('accepts an asynchronous differentiation check', async () => {
    const outcome = await registerAsset(
      request(),
      options({ differentiates: () => Promise.resolve(null) }),
    );
    expect(outcome.kind).toBe('registered');
  }, 120_000);
});

describe('a dispersion budget is hit by measuring once and rescaling', () => {
  it('lands on the budget exactly, and records that it rescaled', async () => {
    const outcome = await registerAsset(request({ dispersion: 0.12 }), options());
    if (outcome.kind !== 'registered') throw new Error(outcome.reason);
    expect(dispersionLogSigma(outcome.asset.evidence)).toBeCloseTo(0.12, 12);
    // The calibration ran at a different volatility from the one registered,
    // and the record says by how much — otherwise an audit could reproduce the
    // numbers and never learn which volatility produced them.
    expect(outcome.asset.evidence.volatilityScale).not.toBe(1);
    // And the recorded amplitude belongs to the volatility that was registered,
    // not to the one the calibration happened to run at. Recording the latter
    // would describe an asset nobody can trade.
    expect(outcome.asset.authored.tickRms).toBeCloseTo(
      outcome.asset.definition.traits.volatility * cascadeRmsGain(outcome.asset.definition.traits),
      18,
    );
  }, 120_000);

  it('leaves the market unchanged apart from its scale', async () => {
    // Two budgets, one personality: the tie rate and the median move in lattice
    // steps are ratios, so they cannot notice. If they do, some layer has begun
    // reading an absolute magnitude and the asset is no longer scale-free.
    const quiet = await registerAsset(request({ dispersion: 0.04 }), options());
    // The same id deliberately: the streams are derived from it, so a different
    // one would change the realisation and the comparison would prove nothing.
    const loud = await registerAsset(request({ dispersion: 0.4 }), options());
    if (quiet.kind !== 'registered' || loud.kind !== 'registered') {
      throw new Error('expected both to register');
    }
    expect(loud.asset.evidence.tieRate).toBe(quiet.asset.evidence.tieRate);
    expect(loud.asset.evidence.medianSteps).toBeCloseTo(quiet.asset.evidence.medianSteps, 6);
    expect(loud.asset.instrument.logQuantum / quiet.asset.instrument.logQuantum).toBeCloseTo(10, 6);
  }, 180_000);

  it('refuses a budget that scales the amplitude out of bounds, in budget terms', async () => {
    // **Cycle Audit 7, a3-06.** A brief with a dispersion of 50 arrives with a
    // base volatility of 0.018, and the safety gate refused it as a trait the
    // operator never typed. They supplied a budget; the refusal names the
    // budgets this personality can carry instead.
    const traits = { ...request().traits, volatility: TRAIT_BOUNDS.volatility.max * 20 };
    const outcome = await registerAsset(request({ dispersion: 0.5, traits }), options());
    expect(outcome).toMatchObject({ kind: 'refused', stage: 'dispersion' });
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.reason).toMatch(/budgets this personality can carry/);
    // Without a budget the same trait is the operator's own, and the safety
    // gate is the right place to say so.
    const bare = await registerAsset(request({ traits }), options());
    expect(bare).toMatchObject({ kind: 'refused', stage: 'safety' });
  });

  it('refuses a budget the personality cannot reach', async () => {
    // Not a clipped value and not a silent miss: the factor needed would put
    // the base volatility outside the trait bounds, which is a statement about
    // the family rather than about the asset.
    const outcome = await registerAsset(request({ dispersion: 500 }), options());
    expect(outcome).toMatchObject({ kind: 'refused', stage: 'dispersion' });
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.reason).toMatch(/cannot reach a quarterly dispersion/);
  }, 120_000);

  it('refuses to fit a budget from a run shorter than the asset remembers', async () => {
    // The failure this prevents was measured, not imagined: PH-17.2's first
    // acceptance run fitted budgets from a third of a turnover and produced an
    // index diffusing 4.9 times its own budget. Nothing was biased — two short
    // estimates missed in opposite directions and multiplied.
    const outcome = await registerAsset(
      request({ dispersion: 0.12 }),
      options({ dispersionTurnovers: undefined }),
    );
    expect(outcome).toMatchObject({ kind: 'refused', stage: 'dispersion' });
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.reason).toMatch(/measures one volatility level/);
  }, 120_000);

  it('needs no such span when no budget is asked for', async () => {
    // The guard belongs to the fit. An asset authored by amplitude the way the
    // original five were is unaffected by it.
    const outcome = await registerAsset(request(), options({ dispersionTurnovers: undefined }));
    expect(outcome.kind).toBe('registered');
  }, 120_000);

  it.each([0, -1, Number.NaN])(
    'refuses the budget %s',
    async (bad) => {
      const outcome = await registerAsset(request({ dispersion: bad }), options());
      expect(outcome).toMatchObject({ kind: 'refused', stage: 'dispersion' });
    },
    120_000,
  );
});

describe('the record says what the family asked for', () => {
  // **Cycle Audit 7, a3-05.** The clamp and the retreat could put a registered
  // asset below its family's band, and `authored` recorded only what was
  // achieved. A request that carries the draw carries it into the record.
  it('carries the draw, the retreats and a clamp into the registered asset', async () => {
    const targets = {
      ...request().targets,
      drawnExcessKurtosis: 72,
      retreats: 2,
      clampedFrom: 130,
    };
    const outcome = await registerAsset(request({ id: 'asked', targets }), options());
    if (outcome.kind !== 'registered') throw new Error(outcome.reason);
    expect(outcome.asset.authored).toMatchObject({
      drawnExcessKurtosis: 72,
      retreats: 2,
      clampedFrom: 130,
    });
  }, 120_000);

  it('records nothing of the kind for a hand-authored asset', async () => {
    const outcome = await registerAsset(request(), options());
    if (outcome.kind !== 'registered') throw new Error(outcome.reason);
    expect(Object.keys(outcome.asset.authored).sort()).toEqual(['excessKurtosis', 'tickRms']);
  }, 120_000);
});

describe('two assets with one personality are two markets', () => {
  it('derives different streams from the same traits under different ids', async () => {
    // The id enters the key derivation, so a family is a character rather than a
    // chart: a hundred assets can share a personality and share no prices.
    const first = await registerAsset(request({ id: 'usdx' }), options());
    const second = await registerAsset(request({ id: 'usdy' }), options());
    if (first.kind !== 'registered' || second.kind !== 'registered') {
      throw new Error('expected both to register');
    }
    // Same traits in, so the solved personalities are close — but the lattice is
    // calibrated per asset from its own realisation, so the evidence differs.
    expect(first.asset.definition.traits.cascadeDepth).toBe(
      second.asset.definition.traits.cascadeDepth,
    );
    expect(first.asset.evidence.logQuantum).not.toBe(second.asset.evidence.logQuantum);
    expect(first.asset.instrument.logQuantum).not.toBe(second.asset.instrument.logQuantum);
  }, 180_000);
});

describe('a registration reports each stage as it enters it (a6-06)', () => {
  it('names the six stages in pipeline order on a registration that succeeds', async () => {
    const stages: string[] = [];
    const outcome = await registerAsset(request(), {
      ...options(),
      onStage: (stage) => stages.push(stage),
    });
    expect(outcome.kind).toBe('registered');
    expect(stages[0]).toBe('identity');
    expect(stages[stages.length - 1]).toBe('differentiation');
    for (const stage of ['identity', 'safety', 'authoring', 'calibration', 'differentiation']) {
      expect(stages, stage).toContain(stage);
    }
    // Every stage the pipeline names on a refusal is one it announced first.
    const order = stages.filter((stage, i) => stages.indexOf(stage) === i);
    expect(order.indexOf('safety')).toBeGreaterThan(order.indexOf('identity'));
    expect(order.indexOf('authoring')).toBeGreaterThan(order.indexOf('safety'));
    expect(order.indexOf('calibration')).toBeGreaterThan(order.indexOf('authoring'));
    expect(order.indexOf('differentiation')).toBeGreaterThan(order.indexOf('calibration'));
  }, 60_000);
});
