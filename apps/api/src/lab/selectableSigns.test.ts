import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type RandomSource, type Tick } from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine, type MarketEngine } from '@otc/engine';
import { SelectableSigns, SignSelector } from './selectableSigns.js';

/**
 * PH-24.1's acceptance criteria 1–4, on the shipped engine.
 *
 * Every assertion compares a wrapped engine against a plain one built from the
 * same keyring: transparent means identical; armed means the signs are the
 * script and everything else is identical; released means identical again,
 * cursors included; restored mid-script means the keystream's continuation.
 */
const asset = ASSET_CATALOGUE[0]!;
const config = configFor(asset);
const keyring = MasterKeyring.fromSecret('selectable-spec', new Uint8Array(32).fill(11));
const START = { instant: epochMillis(1_776_000_000_000), price: logPrice(0) };

const keystreamSign = (): RandomSource =>
  keyring.derive({ env: 'simulation', asset: config.instrument.id, purpose: 'sign', keyEpoch: 0 });

const plainEngine = (): MarketEngine =>
  createMarketEngine({ config, keyring, environment: 'simulation', start: START });

function wrappedEngine(): { engine: MarketEngine; signs: SelectableSigns } {
  const signs = new SelectableSigns(keystreamSign(), asset.definition.id);
  const engine = createMarketEngine({
    config,
    keyring,
    environment: 'simulation',
    start: START,
    streams: { sign: signs },
  });
  return { engine, signs };
}

function ticks(engine: MarketEngine, count: number): Tick[] {
  const out: Tick[] = [];
  for (let i = 0; i < count; i += 1) {
    const tick = engine.next();
    if (tick === null) break;
    out.push(tick);
  }
  return out;
}

const signOf = (delta: number): 1 | -1 | 0 => (delta > 0 ? 1 : delta < 0 ? -1 : 0);

describe('SelectableSigns', () => {
  it('1. transparent, it is invisible: identical ticks, identical cursors', () => {
    const plain = plainEngine();
    const { engine, signs } = wrappedEngine();
    expect(signs.armed).toBe(false);
    expect(ticks(engine, 1_000)).toEqual(ticks(plain, 1_000));
    expect(engine.snapshot().cursors).toEqual(plain.snapshot().cursors);
  });

  it("2. armed, the next N signs are the script and the steps, intervals and rounding are the engine's", () => {
    const plain = plainEngine();
    const { engine, signs } = wrappedEngine();
    const a = ticks(plain, 300);
    const before = ticks(engine, 100);
    expect(before).toEqual(a.slice(0, 100));

    const script = Array.from({ length: 50 }, (_, i): 1 | -1 => (i % 3 === 0 ? -1 : 1));
    signs.arm(script);
    expect(signs.remaining).toBe(50);
    const during = ticks(engine, 50);
    expect(signs.armed).toBe(false);

    let previous = before[before.length - 1]!.price;
    for (const [i, tick] of during.entries()) {
      const delta = tick.price - previous;
      const plainDelta = a[100 + i]!.price - a[99 + i]!.price;
      // Same magnitude and same instant as the plain engine's tick...
      expect(Math.abs(delta), `step ${i}`).toBe(Math.abs(plainDelta));
      expect(tick.instant, `instant ${i}`).toBe(a[100 + i]!.instant);
      // ...and the script's sign, wherever the step is not zero.
      if (delta !== 0) expect(signOf(delta), `sign ${i}`).toBe(script[i]);
      previous = tick.price;
    }
    // The script actually changed something: not every plain sign matched it.
    const disagreements = during.filter((tick, i) => {
      const plainDelta = a[100 + i]!.price - a[99 + i]!.price;
      const delta = tick.price - (i === 0 ? before[99]!.price : during[i - 1]!.price);
      return plainDelta !== 0 && signOf(delta) !== signOf(plainDelta);
    });
    expect(disagreements.length).toBeGreaterThan(5);
  });

  it("3. released, the cursor is where the keystream would have put it and the continuation is the keystream's", () => {
    const plain = plainEngine();
    const { engine, signs } = wrappedEngine();
    // Both engines at 150 ticks: the wrapped one drew 100 plain and 50 scripted.
    ticks(plain, 150);
    ticks(engine, 100);
    signs.arm(Array.from({ length: 50 }, (): 1 => 1));
    ticks(engine, 50);
    expect(signs.armed).toBe(false);
    expect(engine.snapshot().cursors).toEqual(plain.snapshot().cursors);
    // From here the two engines stand at different prices — the scripted span
    // moved differently — so what must agree is what the keystream decides:
    // every instant and every *signed* step, the coin included.
    const fromPlain = plain.snapshot().price;
    const fromWrapped = engine.snapshot().price;
    const a = ticks(plain, 200);
    const b = ticks(engine, 200);
    expect(b.length).toBe(a.length);
    for (const [i, tick] of b.entries()) {
      expect(tick.instant, `instant ${i}`).toBe(a[i]!.instant);
      const stepB = tick.price - (i === 0 ? fromWrapped : b[i - 1]!.price);
      const stepA = a[i]!.price - (i === 0 ? fromPlain : a[i - 1]!.price);
      expect(stepB, `signed step ${i}`).toBe(stepA);
    }
  });

  it('4. a snapshot taken mid-script restores to the keystream: the cursors never learned', () => {
    const plain = plainEngine();
    const { engine, signs } = wrappedEngine();
    const a = ticks(plain, 400);
    ticks(engine, 100);
    signs.arm(Array.from({ length: 50 }, (): -1 => -1));
    ticks(engine, 20); // 30 scripted signs remain
    const snapshot = engine.snapshot();
    expect(signs.remaining).toBe(30);

    // A fresh engine — a restart — restored from that snapshot, with a fresh
    // transparent wrapper, as `resumeMarket` would build it.
    const restored = createMarketEngine({
      config,
      keyring,
      environment: 'simulation',
      start: START,
      streams: { sign: new SelectableSigns(keystreamSign(), asset.definition.id) },
    });
    restored.restore(snapshot);
    const c = ticks(restored, 100);
    // The keystream's continuation from tick 121: same instants and same signed
    // steps as the plain engine, which never saw a script.
    for (const [i, tick] of c.entries()) {
      expect(tick.instant).toBe(a[120 + i]!.instant);
      const stepC = tick.price - (i === 0 ? snapshot.price : c[i - 1]!.price);
      const stepA = a[120 + i]!.price - a[119 + i]!.price;
      expect(stepC, `signed step ${i}`).toBe(stepA);
    }
    // And a seek on the live wrapper released it.
    signs.seek(signs.position());
    expect(signs.armed).toBe(false);
  });

  it('refuses an empty script and reports what a release discarded', () => {
    const signs = new SelectableSigns(keystreamSign(), 'eurusd');
    expect(() => signs.arm([])).toThrow(RangeError);
    signs.arm([1, -1, 1]);
    signs.nextBoolean();
    expect(signs.release()).toBe(2);
    expect(signs.remaining).toBe(0);
  });
});

describe('SignSelector', () => {
  it('keeps the last wrapper per asset, which is the hosted one', () => {
    const selector = new SignSelector();
    const first = selector.wrap(keystreamSign(), 'eurusd');
    const second = selector.wrap(keystreamSign(), 'eurusd');
    selector.wrap(keystreamSign(), 'btcusd');
    expect(selector.for('eurusd')).toBe(second);
    expect(selector.for('eurusd')).not.toBe(first);
    expect(selector.for('spx')).toBeNull();
    expect(selector.assetIds).toEqual(['btcusd', 'eurusd']);
  });
});
