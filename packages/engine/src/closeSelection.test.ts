import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import { selectClose } from './closeSelection.js';

/**
 * The Lab's exact close, and the properties that make it honest.
 *
 * Every one of these is about the *path*, not the endpoint. Landing on a
 * requested price is easy; landing on it by a route the engine could have taken
 * anyway is the whole point, and it is what stops the mechanism from developing
 * the signature §28 and §70 forbid.
 */
const keyring = MasterKeyring.forTesting('close-selection-spec');
const stream = (label: string) =>
  keyring.derive({ env: 'test', asset: 'eurusd', purpose: label, keyEpoch: 0 });

/** A plausible run of unsigned step sizes for a one-minute bucket. */
function steps(count: number, seed: string): number[] {
  const source = stream(seed);
  return Array.from({ length: count }, () => 1 + Math.floor(source.nextFloat64() * 40));
}

describe('an exact close is selected, never steered', () => {
  it('lands exactly on a reachable target', () => {
    const remaining = steps(40, 'a');
    // A target the engine itself would reach: take a random assignment's sum.
    const source = stream('probe');
    const delta = remaining.reduce((sum, step) => sum + (source.nextBoolean() ? step : -step), 0);

    const selected = selectClose({ steps: remaining, delta, random: stream('draws') });
    expect(selected.signs, `unreachable: ${selected.impossible ?? ''}`).not.toBeNull();
    const closed = remaining.reduce((sum, step, i) => sum + selected.signs![i]! * step, 0);
    expect(closed, 'the selected path did not close on the target').toBe(delta);
  });

  it('uses the engine steps unchanged, in order', () => {
    // The magnitudes are the engine's. Selection may choose the signs and
    // nothing else — if it could change a step it would be steering.
    const remaining = steps(30, 'b');
    const source = stream('probe2');
    const delta = remaining.reduce((sum, step) => sum + (source.nextBoolean() ? step : -step), 0);
    const selected = selectClose({ steps: remaining, delta, random: stream('draws2') });
    expect(selected.signs).toHaveLength(remaining.length);
    for (const sign of selected.signs!) expect(Math.abs(sign)).toBe(1);
  });

  it('produces a different path for the same target on a different draw', () => {
    // Uniform over the vectors that hit the target. A constructive solver would
    // return the same shape every time, and an identical convergence shape is
    // exactly what §71 tells the Lab to flag as detectable.
    const remaining = steps(40, 'c');
    const source = stream('probe3');
    const delta = remaining.reduce((sum, step) => sum + (source.nextBoolean() ? step : -step), 0);
    const first = selectClose({ steps: remaining, delta, random: stream('draws3') });
    const second = selectClose({ steps: remaining, delta, random: stream('draws4') });
    expect(first.signs).not.toBeNull();
    expect(second.signs).not.toBeNull();
    expect(first.signs).not.toEqual(second.signs);
  });

  it('allows the path to cross the target before it closes there', () => {
    // §21: the constraint is terminal, not a path constraint. A selected path
    // that never went above or below its own close would be a straight line,
    // which is §22's prohibition.
    const remaining = steps(60, 'd');
    const source = stream('probe4');
    const delta = remaining.reduce((sum, step) => sum + (source.nextBoolean() ? step : -step), 0);
    const selected = selectClose({ steps: remaining, delta, random: stream('draws5') });
    let running = 0;
    let crossings = 0;
    let above = false;
    for (const [i, step] of remaining.entries()) {
      running += selected.signs![i]! * step;
      const nowAbove = running > delta;
      if (i > 0 && nowAbove !== above) crossings += 1;
      above = nowAbove;
    }
    expect(
      crossings,
      'the path never crossed its own close: that is a straight line',
    ).toBeGreaterThan(0);
  });

  it('refuses a target of the wrong parity, by name and without sampling', () => {
    // `sum(±steps)` always shares a parity with `sum(steps)`, so half of every
    // lattice is unreachable no matter how long one samples. Saying so beats
    // discovering it by exhaustion.
    const remaining = [2, 4, 6];
    const wrong = selectClose({ steps: remaining, delta: 1, random: stream('draws6') });
    expect(wrong.signs).toBeNull();
    expect(wrong.attempts, 'it sampled a target it could have refused').toBe(0);
    expect(wrong.impossible).toMatch(/parity/);
    expect(wrong.reachability).toBe('outside-natural-range');
  });

  it('refuses a target beyond what the remaining ticks can move', () => {
    const remaining = [3, 5, 7];
    const far = selectClose({ steps: remaining, delta: 100, random: stream('draws7') });
    expect(far.signs).toBeNull();
    expect(far.attempts).toBe(0);
    expect(far.impossible).toMatch(/at most 15 lattice steps/);
  });

  it('reports reachability as a measured rate, not a rule of thumb (§36)', () => {
    // The sampler's acceptance rate *is* the answer §36 asks for.
    const remaining = steps(40, 'e');
    const easy = selectClose({ steps: remaining, delta: 0, random: stream('draws8') });
    if (easy.signs !== null) {
      expect(easy.acceptanceRate).toBeGreaterThan(0);
      expect(easy.acceptanceRate).toBeCloseTo(1 / easy.attempts, 12);
      expect(['easy', 'normal', 'difficult', 'critical']).toContain(easy.reachability);
    }

    // A target at the very edge of the range: reachable, and only one way.
    const total = remaining.reduce((sum, step) => sum + step, 0);
    const edge = selectClose({
      steps: remaining,
      delta: total,
      random: stream('draws9'),
      maxAttempts: 2_000,
    });
    expect(edge.signs, 'one vector in 2^40 was found in 2,000 draws').toBeNull();
    expect(edge.reachability).toBe('outside-natural-range');
    expect(edge.impossible).toMatch(/natural range/);
  });

  it('closes on the price it is already at when no ticks remain', () => {
    expect(selectClose({ steps: [], delta: 0, random: stream('draws10') }).signs).toEqual([]);
    expect(selectClose({ steps: [], delta: 3, random: stream('draws11') }).signs).toBeNull();
  });
});
