import { describe, expect, it } from 'vitest';
import { MasterKeyring } from '@otc/core';
import { INTERVENTIONS, nextShock, selectContinuation } from './intervention.js';

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
    // not already have. A level beyond the sum of the steps is unreachable
    // however long it samples, because the steps are the engine's.
    const remaining = [2, 3, 4, 5];
    const result = selectContinuation({
      steps: remaining,
      random: stream('draws-f'),
      criterion: INTERVENTIONS.touches(15),
      maxAttempts: 2_000,
    });
    expect(
      result.chosen,
      'an intervention manufactured a step the engine never produced',
    ).toBeNull();
  });
});

describe('every intervention is a choice the signs can make (LA-01)', () => {
  /**
   * LAB-SPECIFICATION-AUDIT-001, LA-01. `INTERVENTIONS.shock` accepted the
   * first vector drawn or none of them, under every seed, because a
   * displacement's absolute value is the step and the steps do not depend on
   * the signs. A criterion the signs cannot change is not an intervention; it
   * is a detector, and a Lab that offered it as an intervention would report
   * an acceptance rate of 1 for something nobody chose.
   *
   * So every entry is exercised at a parameter inside its own range and must
   * accept some natural continuations and reject others. The table is keyed by
   * name and compared against the object's keys, so a new entry has to be
   * added here — with a parameter that makes it discriminating — before it can
   * exist.
   */
  it('has no criterion that is constant across sign vectors', () => {
    const remaining = steps(30, 'la01');
    const total = remaining.reduce((a, b) => a + b, 0);
    const table: Record<
      keyof typeof INTERVENTIONS,
      (c: Parameters<ReturnType<typeof INTERVENTIONS.touches>>[0]) => boolean
    > = {
      bullishPressure: INTERVENTIONS.bullishPressure(Math.floor(total / 6)),
      bearishPressure: INTERVENTIONS.bearishPressure(Math.floor(total / 6)),
      expandedVolatility: INTERVENTIONS.expandedVolatility(Math.floor(total / 3)),
      compressedVolatility: INTERVENTIONS.compressedVolatility(Math.floor(total / 3)),
      touches: INTERVENTIONS.touches(Math.floor(total / 6)),
      trendThenPullback: INTERVENTIONS.trendThenPullback(Math.floor(total / 10), 0.3),
      directionAt: INTERVENTIONS.directionAt(3, 1),
      // PH-24.4: one parameterisation per new criterion, inside its range.
      sideways: INTERVENTIONS.sideways(Math.floor(total / 3)),
      bearTrendThenPullback: INTERVENTIONS.bearTrendThenPullback(Math.floor(total / 10), 0.3),
      breakout: INTERVENTIONS.breakout(Math.floor(total / 8), Math.floor(total / 8)),
      falseBreakout: INTERVENTIONS.falseBreakout(Math.floor(total / 8)),
      reversal: INTERVENTIONS.reversal(Math.floor(total / 10), Math.floor(total / 10)),
      noise: INTERVENTIONS.noise(Math.floor(remaining.length / 2)),
    };
    expect(Object.keys(table).sort()).toEqual(Object.keys(INTERVENTIONS).sort());
    const draws = stream('la01-draws');
    const vectors = Array.from({ length: 2_000 }, () =>
      remaining.map((): 1 | -1 => (draws.nextBoolean() ? 1 : -1)),
    );
    for (const [name, predicate] of Object.entries(table)) {
      let accepted = 0;
      for (const signs of vectors) {
        // The same walk `selectContinuation` performs, inlined so this test
        // does not depend on the sampler it is checking the inputs of.
        const path: number[] = [];
        let net = 0;
        let high = 0;
        let low = 0;
        for (const [i, step] of remaining.entries()) {
          net += signs[i]! * step;
          path.push(net);
          if (net > high) high = net;
          if (net < low) low = net;
        }
        if (predicate({ signs, path, net, high, low })) accepted += 1;
      }
      expect(accepted, `${name} accepts every sign vector`).toBeLessThan(vectors.length);
      expect(accepted, `${name} accepts no sign vector`).toBeGreaterThan(0);
    }
  });

  it('locates the next shock instead of pretending to select it', () => {
    expect(nextShock([2, 3, 9, 1], 9)).toEqual({ atTick: 2, step: 9 });
    expect(nextShock([2, 3, 9, 1], 10)).toBeNull();
    expect(nextShock([], 1)).toBeNull();
  });

  it('chooses the direction of a shock the engine is about to produce', () => {
    // What "a positive shock" honestly means: the engine placed the step; the
    // coin picks its sign; a criterion over the coin is accepted about half
    // the time — and the acceptance rate says so.
    const remaining = [2, 3, 9, 1];
    const shock = nextShock(remaining, 9)!;
    const result = selectContinuation({
      steps: remaining,
      random: stream('draws-shock'),
      criterion: INTERVENTIONS.directionAt(shock.atTick, -1),
    });
    expect(result.chosen).not.toBeNull();
    expect(result.chosen!.signs[shock.atTick]).toBe(-1);
    expect(result.chosen!.path[shock.atTick]! - result.chosen!.path[shock.atTick - 1]!).toBe(-9);
    expect(result.attempts).toBeLessThanOrEqual(12);
  });
});

describe('the scenario criteria PH-24.4 adds find the shape they name, on real steps', () => {
  const remaining = steps(40, 'ph244');
  const total = remaining.reduce((a, b) => a + b, 0);
  const find = (
    criterion: (c: Parameters<ReturnType<typeof INTERVENTIONS.touches>>[0]) => boolean,
    label: string,
  ) => {
    const result = selectContinuation({
      steps: remaining,
      random: stream(label),
      criterion,
      maxAttempts: 50_000,
    });
    expect(result.chosen, `${label}: nothing satisfied it in 50,000 draws`).not.toBeNull();
    return result.chosen!;
  };

  it('P3 sideways: narrow range and little net movement', () => {
    const c = find(INTERVENTIONS.sideways(Math.floor(total / 3)), 'p3');
    expect(c.high - c.low).toBeLessThanOrEqual(Math.floor(total / 3));
    expect(Math.abs(c.net)).toBeLessThanOrEqual(Math.floor(total / 6));
  });

  it('P5 bear trend then pullback: the trough comes first, the recovery after', () => {
    const fall = Math.floor(total / 10);
    const c = find(INTERVENTIONS.bearTrendThenPullback(fall, 0.3), 'p5');
    const trough = Math.min(...c.path);
    const troughAt = c.path.indexOf(trough);
    expect(-trough).toBeGreaterThanOrEqual(fall);
    expect(Math.max(...c.path.slice(troughAt + 1)) - trough).toBeGreaterThanOrEqual(0.3 * -trough);
  });

  it('P6 / P7 breakout: reaches the level, holds, ends beyond it — both ways', () => {
    const level = Math.floor(total / 8);
    const up = find(INTERVENTIONS.breakout(level, level), 'p6');
    const at = up.path.findIndex((v) => v >= level);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(up.path.slice(at).every((v) => v >= 0)).toBe(true);
    expect(up.net).toBeGreaterThanOrEqual(level);
    const down = find(INTERVENTIONS.breakout(-level, level), 'p7');
    expect(down.low).toBeLessThanOrEqual(-level);
    expect(down.net).toBeLessThanOrEqual(-level);
  });

  it('P6 breakout requires the hold: a level reached, given back and regained is not one', () => {
    // Deterministic, because the shape test above draws real paths and a plant
    // that dropped the hold requirement slipped past it by chance. Two
    // continuations by hand: one gives back more than `hold` after reaching the
    // level and ends above it anyway; one holds.
    const path = (values: number[]) => ({
      signs: values.map((v, i): 1 | -1 => (v >= (i === 0 ? 0 : values[i - 1]!) ? 1 : -1)),
      path: values,
      net: values[values.length - 1]!,
      high: Math.max(0, ...values),
      low: Math.min(0, ...values),
    });
    const givesBack = path([5, 12, 20, 3, 9, 22]); // reaches 20, falls to 3 (gives back 17), ends 22
    const holds = path([5, 12, 20, 15, 18, 22]); // never below 20 - 10 after reaching 20
    expect(INTERVENTIONS.breakout(20, 10)(givesBack)).toBe(false);
    expect(INTERVENTIONS.breakout(20, 10)(holds)).toBe(true);
    expect(INTERVENTIONS.breakout(-20, 10)(path([-5, -12, -20, -3, -9, -22]))).toBe(false);
    expect(INTERVENTIONS.breakout(-20, 10)(path([-5, -12, -20, -15, -18, -22]))).toBe(true);
  });

  it('P8 / P9 false breakout: touches the level and ends back across it', () => {
    const level = Math.floor(total / 8);
    const up = find(INTERVENTIONS.falseBreakout(level), 'p8');
    expect(up.high).toBeGreaterThanOrEqual(level);
    expect(up.net).toBeLessThan(level);
    const down = find(INTERVENTIONS.falseBreakout(-level), 'p9');
    expect(down.low).toBeLessThanOrEqual(-level);
    expect(down.net).toBeGreaterThan(-level);
  });

  it('P10 / P11 reversal: a move one way, a net the other', () => {
    const size = Math.floor(total / 12);
    const bullBear = find(INTERVENTIONS.reversal(size, size), 'p10');
    expect(bullBear.high).toBeGreaterThanOrEqual(size);
    expect(bullBear.net).toBeLessThanOrEqual(-size);
    const bearBull = find(INTERVENTIONS.reversal(-size, size), 'p11');
    expect(bearBull.low).toBeLessThanOrEqual(-size);
    expect(bearBull.net).toBeGreaterThanOrEqual(size);
  });

  it('P14 noise: at least the stated number of direction changes', () => {
    const c = find(INTERVENTIONS.noise(30), 'p14');
    let changes = 0;
    for (let i = 1; i < c.signs.length; i += 1) if (c.signs[i] !== c.signs[i - 1]) changes += 1;
    expect(changes).toBeGreaterThanOrEqual(30);
  });
});
