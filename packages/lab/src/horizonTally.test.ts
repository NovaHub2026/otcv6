import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, priceAtOrBefore } from '@otc/core';
import { HorizonAccumulator } from './horizonTally.js';
import { BINARY_HORIZONS } from './horizons.js';

const spec = (label: string, ms: number) => ({ label, durationMs: durationMillis(ms) });

describe('the accumulator classifies windows the way settlement does', () => {
  it('counts a rise, a fall and a tie', () => {
    const acc = new HorizonAccumulator([spec('10', 10)], 0, 100);
    // Window [0,10): last price strictly before 10 is 105 -> up.
    acc.observe(5, 105);
    acc.observe(10, 105); // crosses the boundary; open becomes 105
    // Window [10,20): last before 20 is 101 -> down from 105.
    acc.observe(15, 101);
    acc.observe(20, 101); // open becomes 101
    // Window [20,30): last before 30 is 101 -> tie.
    acc.observe(25, 101);
    acc.observe(30, 101);

    const [outcome] = acc.outcomes();
    expect(outcome!.ups).toBe(1);
    expect(outcome!.downs).toBe(1);
    expect(outcome!.ties).toBe(1);
    expect(outcome!.decided).toBe(2);
    expect(outcome!.windows).toBe(3);
    expect(outcome!.upRate).toBe(0.5);
    expect(outcome!.tieRate).toBeCloseTo(1 / 3, 12);
  });

  it('closes a window at the last price AT or before the boundary', () => {
    // Cycle Audit 4 found this test asserting the opposite, and the code
    // matching it. Settlement's `priceAtOrBefore` is inclusive
    // (`instants[i] <= instant`), so a tick landing exactly on the boundary *is*
    // the closing price. Excluding it made a tally and a settlement disagree
    // about which side a contract landed on — this exact input scored a tie by
    // the tally and an UP by settlement.
    const acc = new HorizonAccumulator([spec('10', 10)], 0, 100);
    acc.observe(9, 100); // still flat at 9
    acc.observe(10, 500); // lands ON the boundary, so it closes [0,10)
    const [outcome] = acc.outcomes();
    expect(outcome!.ups).toBe(1);
    expect(outcome!.ties).toBe(0);
  });

  it('agrees with settlement on a boundary tick', () => {
    // The property the rule exists for, asserted directly against the settlement
    // helper rather than against a restatement of it.
    const instants = new Float64Array([0, 9, 10]);
    const prices = Int32Array.from([100, 100, 500]);
    const settled = priceAtOrBefore(instants, prices, epochMillis(10));
    const acc = new HorizonAccumulator([spec('10', 10)], 0, 100);
    acc.observe(9, 100);
    acc.observe(10, 500);
    const [outcome] = acc.outcomes();
    expect(settled?.price).toBe(500);
    expect(outcome!.ups).toBe(1); // both say the window closed above its open
  });

  it('closes at the LAST tick when several share the boundary instant', () => {
    // **Out-of-band audit, a4-12.** Settlement's `priceAtOrBefore` returns the
    // last tick at an instant; the accumulator closed the window on the *first*
    // tick to land on the boundary and let the second, at the same instant,
    // pass. The engine floors intervals at 1 ms so it cannot produce the case,
    // but the observer boundary accepts non-decreasing instants, so an external
    // record can — and the docstring promised agreement with settlement.
    const instants = new Float64Array([0, 9, 10, 10]);
    const prices = Int32Array.from([100, 100, 500, 90]);
    const settled = priceAtOrBefore(instants, prices, epochMillis(10));
    expect(settled?.price).toBe(90);

    const acc = new HorizonAccumulator([spec('10', 10)], 0, 100);
    acc.observe(9, 100);
    acc.observe(10, 500);
    acc.observe(10, 90);
    const [outcome] = acc.outcomes();
    expect(outcome!.windows).toBe(1);
    expect(outcome!.downs).toBe(1); // 90 < 100, as settlement says
    expect(outcome!.ups).toBe(0);

    // Once the clock moves on, the closed window is final and the next one
    // opened at the settled price.
    acc.observe(11, 700);
    const [later] = acc.outcomes();
    expect(later!.windows).toBe(1);
    expect(later!.downs).toBe(1);
    acc.observe(20, 700);
    acc.observe(21, 700);
    expect(acc.outcomes()[0]!.ups).toBe(1); // [10,20) opened at 90, closed at 700
  });

  it('revises a boundary window while ticks can still share its instant', () => {
    const acc = new HorizonAccumulator([spec('10', 10)], 0, 100);
    acc.observe(10, 500);
    expect(acc.outcomes()[0]!.ups).toBe(1);
    acc.observe(10, 90);
    expect(acc.outcomes()[0]!.ups).toBe(0);
    expect(acc.outcomes()[0]!.downs).toBe(1);
    expect(acc.slowestHorizonWindows).toBe(1);
  });

  it('tiles the timeline rather than sliding along it', () => {
    // Non-overlapping is what makes the independent error bar defensible, so it
    // is asserted rather than assumed: N windows in N durations, never more.
    const acc = new HorizonAccumulator([spec('100', 100)], 0, 0);
    for (let t = 1; t <= 1_000; t += 1) acc.observe(t, t);
    const [outcome] = acc.outcomes();
    expect(outcome!.windows).toBe(10);
  });

  it('closes every window a long gap skipped over', () => {
    // A quiet market still expires contracts. Six windows pass between ticks
    // here, and all six must be counted as ties rather than silently dropped.
    const acc = new HorizonAccumulator([spec('10', 10)], 0, 42);
    acc.observe(65, 99);
    const [outcome] = acc.outcomes();
    expect(outcome!.windows).toBe(6);
    expect(outcome!.ties).toBe(6);
  });
});

describe('several horizons advance independently from one pass', () => {
  it('gives each horizon its own tiling of the same path', () => {
    const acc = new HorizonAccumulator([spec('10', 10), spec('50', 50)], 0, 0);
    for (let t = 1; t <= 1_000; t += 1) acc.observe(t, t);
    const [fast, slow] = acc.outcomes();
    expect(fast!.windows).toBe(100);
    expect(slow!.windows).toBe(20);
    // A monotonically rising path is up at every horizon.
    expect(fast!.ups).toBe(100);
    expect(slow!.ups).toBe(20);
  });

  it('reports the fewest completed windows across horizons', () => {
    const acc = new HorizonAccumulator(BINARY_HORIZONS, 0, 0);
    // Ten simulated hours, one tick per second.
    for (let t = 1_000; t <= 36_000_000; t += 1_000) acc.observe(t, t);
    const outcomes = acc.outcomes();
    expect(outcomes.find((o) => o.horizon === '30s')!.windows).toBe(1_200);
    expect(outcomes.find((o) => o.horizon === '15m')!.windows).toBe(40);
    // The slowest horizon is the one that bounds an evidence run's length.
    expect(acc.slowestHorizonWindows).toBe(40);
    expect(acc.ticks).toBe(36_000);
  });
});

describe('the accumulator refuses what it cannot handle', () => {
  it('needs at least one horizon', () => {
    expect(() => new HorizonAccumulator([], 0, 0)).toThrow(/at least one horizon/);
  });

  it('refuses ticks that arrive out of order', () => {
    // Out-of-order arrival would silently mis-close windows, and the resulting
    // tallies would look perfectly plausible.
    const acc = new HorizonAccumulator([spec('10', 10)], 0, 0);
    acc.observe(20, 1);
    expect(() => acc.observe(15, 2)).toThrow(/must arrive in order/);
  });

  it('reports NaN rather than a rate it has not measured', () => {
    const acc = new HorizonAccumulator([spec('10', 10)], 0, 0);
    const [outcome] = acc.outcomes();
    expect(outcome!.upRate).toBeNaN();
    expect(outcome!.tieRate).toBeNaN();
  });
});
