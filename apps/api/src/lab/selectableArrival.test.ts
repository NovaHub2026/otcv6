import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import { ArrivalSelector, SelectableArrival } from './selectableArrival.js';

/**
 * PH-24.13's arrival script, and the one rule the retract path rests on.
 *
 * `retractPending` restores the engine, a restore seeks, and a seek releases —
 * so the push that follows re-arms both scripts from the same place. Lose the
 * release here and the arrival script outlives the sign script: the two run out
 * of alignment and a burst's instants stop belonging to the signs the operator
 * asked for, with nothing red (Cycle Audit 8, a6).
 */
const keyring = MasterKeyring.fromSecret('selectable-arrival-spec', new Uint8Array(32).fill(23));
const keystream = (): RandomSource =>
  keyring.derive({ env: 'simulation', asset: 'eurusd', purpose: 'arrival', keyEpoch: 0 });

const draws = (source: RandomSource, count: number): number[] =>
  Array.from({ length: count }, () => source.nextFloat64());

describe('SelectableArrival', () => {
  it('unarmed, it is the keystream: same draws, same cursor', () => {
    const plain = keystream();
    const arrival = new SelectableArrival(keystream(), 'eurusd');
    expect(arrival.armed).toBe(false);
    expect(draws(arrival, 20)).toEqual(draws(plain, 20));
    expect(arrival.position()).toEqual(plain.position());
  });

  it('armed, it plays the script, passes a null through, and the keystream still advances', () => {
    const plain = keystream();
    const arrival = new SelectableArrival(keystream(), 'eurusd');
    const expected = draws(plain, 3);
    arrival.arm([0.25, null, 0.75]);
    expect(arrival.remaining).toBe(3);
    // The scripted draws are the script's; the null entry is the keystream's own.
    expect(draws(arrival, 3)).toEqual([0.25, expected[1], 0.75]);
    // Exhausted, it releases itself, and the cursor is where the keystream would
    // have put it — a snapshot taken here records nothing of the script.
    expect(arrival.armed).toBe(false);
    expect(arrival.position()).toEqual(plain.position());
  });

  it('a seek releases: the script was armed against one particular future', () => {
    const arrival = new SelectableArrival(keystream(), 'eurusd');
    arrival.arm([0.1, 0.2, 0.3]);
    expect(arrival.armed).toBe(true);
    arrival.seek(arrival.position());
    expect(arrival.armed, 'a restore left the arrival script armed').toBe(false);
    expect(arrival.remaining).toBe(0);
    expect(arrival.remainingScript()).toEqual([]);
    // And what it draws afterwards is the keystream's, not the script's.
    expect(arrival.nextFloat64()).toBe(keystream().nextFloat64());
  });

  it('extends what is left rather than replacing it, and refuses a draw that is not one', () => {
    const arrival = new SelectableArrival(keystream(), 'eurusd');
    arrival.arm([0.1, 0.2]);
    arrival.nextFloat64();
    arrival.extend([0.3]);
    expect(arrival.remainingScript()).toEqual([0.2, 0.3]);
    expect(() => arrival.arm([])).toThrow(RangeError);
    expect(() => arrival.arm([1])).toThrow(RangeError);
    expect(() => arrival.arm([-0.1])).toThrow(RangeError);
  });
});

describe('the selector', () => {
  it('keeps the last wrapper made for an asset id, and knows no other', () => {
    const selector = new ArrivalSelector();
    selector.wrap(keystream(), 'eurusd');
    const second = selector.wrap(keystream(), 'eurusd');
    expect(selector.for('eurusd')).toBe(second);
    expect(selector.for('btcusd')).toBeNull();
  });
});
