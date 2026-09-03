import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  MasterKeyring,
  SteppableClock,
  type RandomSource,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { resumeMarket, type SignSourceFactory } from './resume.js';
import { MemoryStateStore } from './fileStore.js';
import type { HostedMarket } from './hosted.js';

/**
 * The sign-source hook is identity unless a composition says otherwise.
 *
 * PH-24.1. `resumeMarket` may be given a factory over the keystream's sign
 * stream; the Lab uses it to play a chosen vector. Two things have to be true
 * of the hook itself, and they are tested here rather than promised: absent,
 * the market is the market — tick for tick, cursor for cursor; present, the
 * engine draws its coin from what the factory returned and from nothing else.
 */
const asset = ASSET_CATALOGUE[0]!;
const GENESIS = epochMillis(1_776_000_000_000);
const keyring = (): MasterKeyring =>
  MasterKeyring.fromSecret('sign-source-spec', new Uint8Array(32).fill(5));

async function fresh(signSource?: SignSourceFactory): Promise<{
  market: HostedMarket;
  clock: SteppableClock;
}> {
  const clock = new SteppableClock(GENESIS);
  const { market } = await resumeMarket({
    asset,
    keyring: keyring(),
    environment: 'simulation',
    clock,
    store: new MemoryStateStore(),
    genesisInstant: GENESIS,
    ...(signSource === undefined ? {} : { signSource }),
  });
  market.prime();
  return { market, clock };
}

/** Advance in steps inside the catch-up bound, collecting every tick. */
function run(market: HostedMarket, clock: SteppableClock, steps: number): Tick[] {
  const ticks: Tick[] = [];
  for (let i = 0; i < steps; i += 1) {
    clock.advance(durationMillis(10_000));
    ticks.push(...market.advanceTo(clock.now()));
  }
  return ticks;
}

describe('the sign-source hook', () => {
  it('is identity when absent: the same market, tick for tick and cursor for cursor', async () => {
    const plain = await fresh();
    const identity = await fresh((keystream) => keystream);
    const a = run(plain.market, plain.clock, 60);
    const b = run(identity.market, identity.clock, 60);
    expect(a.length).toBeGreaterThan(100);
    expect(b).toEqual(a);
    expect(identity.market.snapshotEngine().cursors).toEqual(plain.market.snapshotEngine().cursors);
  });

  it('hands the factory the keystream sign stream and the asset id, once, for the hosted engine', async () => {
    const calls: { label: string; assetId: string }[] = [];
    await fresh((keystream, assetId) => {
      calls.push({ label: keystream.label, assetId });
      return keystream;
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.assetId).toBe(asset.definition.id);
    expect(calls[0]!.label).toMatch(/sign/);
  });

  it('draws the coin from what the factory returned, and only the coin', async () => {
    // A source that says "up" forever, delegating everything else. If the hook
    // reached anything but the sign, the steps would differ from the plain
    // market's; if it did not reach the sign, some step would go down.
    const allUp = (keystream: RandomSource): RandomSource => ({
      get label() {
        return `${keystream.label}#up`;
      },
      nextBoolean: () => {
        keystream.nextBoolean();
        return true;
      },
      nextUint32: () => keystream.nextUint32(),
      nextUint64: () => keystream.nextUint64(),
      nextFloat64: () => keystream.nextFloat64(),
      nextBoundedUint32: (bound) => keystream.nextBoundedUint32(bound),
      nextBytes: (count) => keystream.nextBytes(count),
      position: () => keystream.position(),
      seek: (target) => {
        keystream.seek(target);
      },
    });
    const plain = await fresh();
    const hooked = await fresh(allUp);
    const a = run(plain.market, plain.clock, 60);
    const b = run(hooked.market, hooked.clock, 60);
    expect(b.length).toBe(a.length);
    let previous = 0;
    for (const [i, tick] of b.entries()) {
      expect(tick.price, `tick ${i} went down under an all-up coin`).toBeGreaterThanOrEqual(
        previous,
      );
      // The step is the engine's: identical magnitude and instant to the plain market's tick.
      const step = Math.abs(a[i]!.price - (i === 0 ? 0 : a[i - 1]!.price));
      expect(tick.price - previous, `step ${i}`).toBe(step);
      expect(tick.instant).toBe(a[i]!.instant);
      previous = tick.price;
    }
    // And the keystream was consumed in lockstep: the cursors agree.
    expect(hooked.market.snapshotEngine().cursors).toEqual(plain.market.snapshotEngine().cursors);
  });
});
