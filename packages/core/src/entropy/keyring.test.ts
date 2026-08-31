import { describe, expect, it } from 'vitest';
import { ProductionStreamFromTestKeyringError } from './errors.js';
import { MasterKeyring } from './keyring.js';
import type { StreamLabel } from './label.js';

const base: StreamLabel = {
  env: 'simulation',
  asset: 'eurusd-otc',
  purpose: 'magnitude',
  keyEpoch: 0,
};

function draws(keyring: MasterKeyring, label: StreamLabel, count = 64): number[] {
  const s = keyring.derive(label);
  return Array.from({ length: count }, () => s.nextUint32());
}

describe('MasterKeyring — derivation', () => {
  it('is deterministic for a given secret and label', () => {
    const secret = new Uint8Array(32).fill(9);
    const a = MasterKeyring.fromSecret('k1', secret);
    const b = MasterKeyring.fromSecret('k1', secret);
    expect(draws(a, base)).toEqual(draws(b, base));
  });

  it('produces different streams for different secrets', () => {
    const a = MasterKeyring.fromSecret('k1', new Uint8Array(32).fill(1));
    const b = MasterKeyring.fromSecret('k1', new Uint8Array(32).fill(2));
    expect(draws(a, base)).not.toEqual(draws(b, base));
  });

  it('requires at least 32 bytes of secret', () => {
    expect(() => MasterKeyring.fromSecret('k', new Uint8Array(31))).toThrow(TypeError);
    expect(() => MasterKeyring.fromSecret('k', new Uint8Array(32))).not.toThrow();
  });

  it('copies the secret so later mutation of the caller buffer has no effect', () => {
    const secret = new Uint8Array(32).fill(3);
    const keyring = MasterKeyring.fromSecret('k', secret);
    const before = draws(keyring, base);
    secret.fill(200);
    expect(draws(keyring, base)).toEqual(before);
  });
});

describe('MasterKeyring — stream isolation', () => {
  const keyring = MasterKeyring.forTesting('isolation');

  it.each([
    ['environment', { ...base, env: 'test' as const }],
    ['asset', { ...base, asset: 'gbpusd-otc' }],
    ['purpose', { ...base, purpose: 'arrival' }],
    ['key epoch', { ...base, keyEpoch: 1 }],
  ])('a different %s yields a disjoint stream', (_name, other) => {
    const a = draws(keyring, base, 256);
    const b = draws(keyring, other, 256);
    expect(a).not.toEqual(b);
    // Not merely different sequences: no shared values at all, as independent
    // 32-bit streams of this length should collide with probability ~1.5e-5.
    expect(new Set(a).size + new Set(b).size).toBe(new Set([...a, ...b]).size);
  });

  it('derives distinct keys for every distinct label', () => {
    const labels: StreamLabel[] = [
      base,
      { ...base, env: 'test' },
      { ...base, env: 'staging' },
      { ...base, asset: 'gbpusd-otc' },
      { ...base, purpose: 'sign' },
      { ...base, keyEpoch: 1 },
    ];
    const keys = labels.map((l) => Buffer.from(keyring.deriveKey(l)).toString('hex'));
    expect(new Set(keys).size).toBe(labels.length);
  });
});

describe('MasterKeyring — production safety', () => {
  it('refuses to derive a production stream from a test keyring', () => {
    const keyring = MasterKeyring.forTesting('safety');
    expect(() => keyring.derive({ ...base, env: 'production' })).toThrow(
      ProductionStreamFromTestKeyringError,
    );
    expect(() => keyring.deriveKey({ ...base, env: 'production' })).toThrow(
      ProductionStreamFromTestKeyringError,
    );
  });

  it('allows non-production environments from a test keyring', () => {
    const keyring = MasterKeyring.forTesting('safety');
    for (const env of ['staging', 'simulation', 'test'] as const) {
      expect(() => keyring.derive({ ...base, env })).not.toThrow();
    }
  });

  it('allows production from a real keyring', () => {
    const keyring = MasterKeyring.fromSecret('prod-1', new Uint8Array(32).fill(42));
    expect(() => keyring.derive({ ...base, env: 'production' })).not.toThrow();
  });

  it('gives different test keyrings different entropy', () => {
    expect(draws(MasterKeyring.forTesting('a'), base)).not.toEqual(
      draws(MasterKeyring.forTesting('b'), base),
    );
  });
});

describe('MasterKeyring — secret containment', () => {
  it('does not expose the master secret through enumeration or serialisation', () => {
    // A distinctive byte so its presence anywhere in a representation is obvious.
    const marker = 0xab;
    const keyring = MasterKeyring.fromSecret('kr', new Uint8Array(32).fill(marker));

    const serialised = JSON.stringify(keyring);
    expect(serialised).toBe('{"keyId":"kr","secret":"[redacted]"}');
    expect(serialised).not.toContain(String(marker)); // decimal byte form
    expect(serialised).not.toContain(marker.toString(16)); // hex byte form

    expect(Object.keys(keyring)).toEqual(['keyId']);
    expect(JSON.stringify({ ...keyring })).not.toContain(String(marker));
    expect(String(keyring)).toBe('MasterKeyring(kr)');
  });

  it('does not expose a derived stream key through serialisation', () => {
    const keyring = MasterKeyring.forTesting('containment');
    const s = keyring.derive(base);
    const keyHex = Buffer.from(keyring.deriveKey(base)).toString('hex');
    const serialised = JSON.stringify(s);
    expect(serialised).not.toContain(keyHex);
    expect(serialised).toContain('"position":"0:0"');
    expect(Object.keys(s)).not.toContain('keyWords');
    expect(String(s)).toContain('RandomStream(');
  });

  it('exposes only a key identifier for snapshots to reference', () => {
    const keyring = MasterKeyring.fromSecret('prod-2026-08', new Uint8Array(32).fill(1));
    expect(keyring.keyId).toBe('prod-2026-08');
  });
});
