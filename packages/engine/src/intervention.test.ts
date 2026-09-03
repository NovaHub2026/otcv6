import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import { INTERVENTIONS, selectContinuation } from './intervention.js';

/**
 * An intervention chooses among the engine's futures; it never makes one.
 *
 * The specification asks for bullish pressure, volatility, shocks and
 * `Bull Trend → Pullback`, and every one of them reads as a force. None is.
 * ADR-0003 makes every sign vector the engine's own output, so an intervention
 * is a predicate over natural continuations — and the tests below are about
 * that distinction rather than about whether the shapes come out.
 */
const keyring = MasterKeyring.forTesting('intervention-spec');
const stream = (label: string) =>
  keyring.derive({ env: 'test', asset: 'eurusd', purpose: label, keyEpoch: 0 });

function steps(count: number, seed: string): number[] {
  const source = stream(seed);
  return Array.from({ length: count }, () => 1 + Math.floor(source.nextFloat64() * 30));
}

describe('an intervention selects, it does not steer', () => {
  it('returns a continuation the engine could have produced unaided', () => {
    // The signs are ±1 and the steps are untouched: the path is a real path.
    const remaining = steps(40, 'a');
    const result = selectContinuation({
      steps: remaining,
      random: stream('draws-a'),
      criterion: INTERVENTIONS.bullishPressure(20),
    });
    expect(result.chosen).not.toBeNull();
    expect(result.chosen!.signs).toHaveLength(remaining.length);
    for (const sign of result.chosen!.signs) expect(Math.abs(sign)).toBe(1);
    // And the path is the walk of those signs over those steps, exactly.
    let net = 0;
    for (const [i, step] of remaining.entries()) {
      net += result.chosen!.signs[i]! * step;
      expect(result.chosen!.path[i]).toBe(net);
    }
    expect(result.chosen!.net).toBeGreaterThanOrEqual(20);
  });

  it('reports how rare the requested shape is, as a measured rate', () => {
    // A weak criterion is common; a strong one is rare. The rate is the honest
    // description of what was asked for.
    const remaining = steps(40, 'b');
    const weak = selectContinuation({
      steps: remaining,
      random: stream('draws-b1'),
      criterion: INTERVENTIONS.bullishPressure(1),
    });
    const strong = selectContinuation({
      steps: remaining,
      random: stream('draws-b2'),
      criterion: INTERVENTIONS.bullishPressure(200),
    });
    expect(weak.chosen).not.toBeNull();
    expect(strong.attempts).toBeGreaterThan(weak.attempts);
    if (strong.chosen !== null) expect(strong.acceptanceRate).toBeLessThan(weak.acceptanceRate);
  });

  it('reports zero rather than a best effort when nothing satisfies it', () => {
    // "This market does not do that" is an answer. A nudged path that nearly
    // does is not, and returning one would be the steering this design exists
    // to avoid.
    const remaining = steps(20, 'c');
    const total = remaining.reduce((a, b) => a + b, 0);
    const impossible = selectContinuation({
      steps: remaining,
      random: stream('draws-c'),
      criterion: INTERVENTIONS.bullishPressure(total + 1),
      maxAttempts: 500,
    });
    expect(impossible.chosen).toBeNull();
    expect(impossible.acceptanceRate).toBe(0);
    expect(impossible.attempts).toBe(500);
  });

  it('finds a trend followed by a pullback, with the pullback after the peak', () => {
    // §48, as a shape rather than a script. What happens after the pullback is
    // the engine's, which is what §49 requires.
    const remaining = steps(80, 'd');
    const result = selectContinuation({
      steps: remaining,
      random: stream('draws-d'),
      criterion: INTERVENTIONS.trendThenPullback(60, 0.3),
      maxAttempts: 60_000,
    });
    if (result.chosen === null) {
      expect(result.acceptanceRate).toBe(0);
      return;
    }
    const path = result.chosen.path;
    const peak = Math.max(...path);
    const peakAt = path.indexOf(peak);
    expect(peak).toBeGreaterThanOrEqual(60);
    const after = path.slice(peakAt + 1);
    expect(after.length).toBeGreaterThan(0);
    expect(peak - Math.min(...after)).toBeGreaterThanOrEqual(0.3 * peak);
  });

  it('finds volatility on both sides of the distribution', () => {
    const remaining = steps(50, 'e');
    const wide = selectContinuation({
      steps: remaining,
      random: stream('draws-e1'),
      criterion: INTERVENTIONS.expandedVolatility(150),
    });
    const narrow = selectContinuation({
      steps: remaining,
      random: stream('draws-e2'),
      criterion: INTERVENTIONS.compressedVolatility(60),
    });
    if (wide.chosen !== null)
      expect(wide.chosen.high - wide.chosen.low).toBeGreaterThanOrEqual(150);
    if (narrow.chosen !== null)
      expect(narrow.chosen.high - narrow.chosen.low).toBeLessThanOrEqual(60);
  });

  it('keeps drawing naturally however long it takes (no giving up and pushing)', () => {
    // The plant this exists for: a sampler that draws honestly for a while and
    // then forces the signs it needs. It survives every other test in this
    // file, because those criteria are satisfied before the patience runs out.
    //
    // A narrow band around a moderate net is the criterion that catches it. It
    // is rare enough to need hundreds of draws, and it can only be satisfied by
    // a **mixed** sign vector — an all-positive path overshoots it by an order
    // of magnitude. A sampler that gave up and pushed would never satisfy it.
    const remaining = steps(40, 'g');
    const total = remaining.reduce((a, b) => a + b, 0);
    // Measured on this fixture: 830 draws. Rare enough to outlast any patience
    // limit a giving-up sampler would use, and still reachable only by a mixed
    // vector — an all-positive path lands on `total`, five times higher.
    const low = Math.round(total * 0.4);
    const result = selectContinuation({
      steps: remaining,
      random: stream('draws-g'),
      criterion: (c) => c.net >= low && c.net <= low + 2,
      maxAttempts: 40_000,
    });
    expect(result.chosen, 'a rare but reachable band was never satisfied').not.toBeNull();
    expect(
      result.attempts,
      'the fixture must be rare enough to outlast a patience limit',
    ).toBeGreaterThan(50);
    const positives = result.chosen!.signs.filter((s) => s === 1).length;
    expect(
      positives,
      'the chosen path is all one sign: that is a push, not a draw',
    ).toBeGreaterThan(0);
    expect(positives).toBeLessThan(remaining.length);
    expect(result.chosen!.net).toBeGreaterThanOrEqual(low);
    expect(result.chosen!.net).toBeLessThanOrEqual(low + 2);
  });

  it('cannot produce a shape the steps do not allow', () => {
    // The load-bearing property: an intervention has no power the engine did
    // not already have. A shock larger than the largest step is unreachable
    // however long it samples, because the steps are the engine's.
    const remaining = [2, 3, 4, 5];
    const result = selectContinuation({
      steps: remaining,
      random: stream('draws-f'),
      criterion: INTERVENTIONS.shock(6),
      maxAttempts: 2_000,
    });
    expect(
      result.chosen,
      'an intervention manufactured a step the engine never produced',
    ).toBeNull();
  });
});
