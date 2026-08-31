import { describe, expect, it } from 'vitest';
import { InvalidStreamLabelError } from './errors.js';
import { assertValidStreamLabel, canonicalLabel, type StreamLabel } from './label.js';

const base: StreamLabel = {
  env: 'simulation',
  asset: 'eurusd-otc',
  purpose: 'magnitude',
  keyEpoch: 0,
};

describe('canonicalLabel', () => {
  it('produces the documented wire format', () => {
    expect(canonicalLabel(base)).toBe(
      'otc1|env=simulation|asset=eurusd-otc|purpose=magnitude|epoch=0',
    );
  });

  it('is stable — the format is a durable contract', () => {
    expect(
      canonicalLabel({ env: 'production', asset: 'btcusd.otc', purpose: 'sign', keyEpoch: 7 }),
    ).toBe('otc1|env=production|asset=btcusd.otc|purpose=sign|epoch=7');
  });

  it('distinguishes labels that differ in exactly one component', () => {
    const labels = new Set([
      canonicalLabel(base),
      canonicalLabel({ ...base, env: 'test' }),
      canonicalLabel({ ...base, asset: 'gbpusd-otc' }),
      canonicalLabel({ ...base, purpose: 'arrival' }),
      canonicalLabel({ ...base, keyEpoch: 1 }),
    ]);
    expect(labels.size).toBe(5);
  });

  it('cannot be made ambiguous by separator characters in a component', () => {
    // Without the character restriction these two would collide.
    expect(() => canonicalLabel({ ...base, asset: 'a|purpose=x' })).toThrow(
      InvalidStreamLabelError,
    );
    expect(() => canonicalLabel({ ...base, purpose: 'p|epoch=9' })).toThrow(
      InvalidStreamLabelError,
    );
  });
});

describe('assertValidStreamLabel', () => {
  it('accepts a well-formed label', () => {
    expect(() => assertValidStreamLabel(base)).not.toThrow();
  });

  it.each([
    ['empty asset', { ...base, asset: '' }],
    ['uppercase asset', { ...base, asset: 'EURUSD' }],
    ['asset starting with a separator', { ...base, asset: '-eurusd' }],
    ['asset with a space', { ...base, asset: 'eur usd' }],
    ['asset over 64 characters', { ...base, asset: 'a'.repeat(65) }],
    ['empty purpose', { ...base, purpose: '' }],
    ['negative key epoch', { ...base, keyEpoch: -1 }],
    ['fractional key epoch', { ...base, keyEpoch: 1.5 }],
    ['unsafe key epoch', { ...base, keyEpoch: Number.MAX_VALUE }],
  ])('rejects %s', (_name, label) => {
    expect(() => assertValidStreamLabel(label as StreamLabel)).toThrow(InvalidStreamLabelError);
  });

  it('rejects an unknown environment', () => {
    expect(() => assertValidStreamLabel({ ...base, env: 'dev' as never })).toThrow(
      InvalidStreamLabelError,
    );
  });

  it('accepts an asset of exactly 64 characters', () => {
    expect(() => assertValidStreamLabel({ ...base, asset: 'a'.repeat(64) })).not.toThrow();
  });
});
