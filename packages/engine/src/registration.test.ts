// Invariant evidence: INV-003 (single underlying stream), INV-007 (asset differentiation), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import { ASSET_CATALOGUE } from './catalogue.js';
import {
  ASSET_ID_PATTERN,
  checkIdentity,
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
    displayPrecision: 2,
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
  ])('refuses %s', (_label, id) => {
    expect(checkIdentity(request({ id }), [])).not.toBeNull();
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
    ['a blank display name', { displayName: '   ' }],
  ])('refuses %s', (_label, over) => {
    expect(checkIdentity(request(over), [])).not.toBeNull();
  });

  it('shares the shape the persistence layer already imposes', () => {
    // `FileStateStore` and `assertAssetId` enforce the same pattern. An id that
    // registers and then cannot be persisted is worse than one refused here.
    expect(ASSET_ID_PATTERN.source).toBe('^[a-z0-9][a-z0-9._-]{0,63}$');
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
    expect(outcome.asset.instrument.displayPrecision).toBe(2);
    expect(outcome.asset.definition.id).toBe('usdx');
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
