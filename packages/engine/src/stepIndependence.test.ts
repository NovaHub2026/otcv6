import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import { ASSET_CATALOGUE } from './catalogue.js';
import { configFor } from './catalogue.js';
import { createMarketEngine } from './factory.js';

/** A sign stream that yields a scripted bit sequence and passes everything else through. */
class ScriptedSigns implements RandomSource {
  #at = 0;
  constructor(
    private readonly inner: RandomSource,
    private readonly bits: readonly boolean[],
  ) {}
  get label(): string {
    return `${this.inner.label}#scripted`;
  }
  nextBoolean(): boolean {
    const bit = this.bits[this.#at % this.bits.length]!;
    this.#at += 1;
    this.inner.nextBoolean();
    return bit;
  }
  nextUint32(): number {
    return this.inner.nextUint32();
  }
  nextUint64(): bigint {
    return this.inner.nextUint64();
  }
  nextFloat64(): number {
    return this.inner.nextFloat64();
  }
  nextBoundedUint32(bound: number): number {
    return this.inner.nextBoundedUint32(bound);
  }
  nextBytes(count: number): Uint8Array {
    return this.inner.nextBytes(count);
  }
  position() {
    return this.inner.position();
  }
  seek(p: Parameters<RandomSource['seek']>[0]) {
    this.inner.seek(p);
  }
}

describe('the step sequence does not depend on the signs', () => {
  it('is identical under every sign assignment, on the real engine', () => {
    const asset = ASSET_CATALOGUE[0]!;
    const keyring = MasterKeyring.forTesting('steps-spec');
    const run = (bits: readonly boolean[]) => {
      const inner = keyring.derive({
        env: 'test',
        asset: asset.definition.id,
        purpose: 'sign',
        keyEpoch: 0,
      });
      const engine = createMarketEngine({
        config: configFor(asset),
        keyring,
        environment: 'test',
        start: { instant: 1_776_000_000_000 as never, price: 0 as never },
        streams: { sign: new ScriptedSigns(inner, bits) },
      });
      const out: { steps: number[]; intervals: number[] } = { steps: [], intervals: [] };
      let price = 0;
      let instant = 0;
      for (let i = 0; i < 300; i += 1) {
        const tick = engine.next();
        if (tick === null) break;
        out.steps.push(Math.abs(tick.price - price));
        out.intervals.push(instant === 0 ? 0 : tick.instant - instant);
        price = tick.price;
        instant = tick.instant;
      }
      return out;
    };
    const a = run([true]);
    const b = run([false]);
    const c = run([true, false, false, true, true]);
    expect(a.steps.length).toBeGreaterThan(200);
    expect(b.steps, 'magnitudes changed with the signs').toEqual(a.steps);
    expect(c.steps, 'magnitudes changed with the signs').toEqual(a.steps);
    expect(b.intervals).toEqual(a.intervals);
    expect(c.intervals).toEqual(a.intervals);
  });
});
