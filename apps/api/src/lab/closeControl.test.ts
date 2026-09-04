import { describe, expect, it } from 'vitest';
import {
  bucketEnd,
  epochMillis,
  logPrice,
  MasterKeyring,
  timeframe,
  toDisplayPrice,
  type EpochMillis,
  type LogPrice,
} from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  closeInstant,
  planClose,
  planConditionedClose,
  readWindow,
  resolveTarget,
  type ForkSource,
} from './closeControl.js';

/**
 * PH-24.2 §2–§3, each decision pinned.
 */
const spec = ASSET_CATALOGUE[0]!.instrument; // eurusd, 7 decimals
const random = MasterKeyring.forTesting('close-control-spec').derive({
  env: 'test',
  asset: 'eurusd',
  purpose: 'draws',
  keyEpoch: 0,
});

const t0 = epochMillis(1_776_000_000_000);

/** A scripted fork: ticks at given instants with given prices. */
function fork(from: LogPrice, ticks: readonly { instant: number; price: number }[]): ForkSource {
  let at = 0;
  return {
    price: from,
    instant: t0,
    next: () => {
      const tick = ticks[at];
      at += 1;
      return tick === undefined
        ? null
        : { instant: epochMillis(tick.instant), price: logPrice(tick.price) };
    },
  };
}

describe('a typed price is a lattice level or nothing', () => {
  it('accepts a price that renders back to what was typed', () => {
    const level = logPrice(1234);
    const typed = toDisplayPrice(spec, level).toFixed(spec.displayPrecision);
    const resolved = resolveTarget(spec, typed);
    expect(resolved.kind).toBe('level');
    if (resolved.kind === 'level') {
      expect(resolved.level).toBe(level);
      expect(resolved.display).toBe(typed);
    }
  });

  it('refuses a price between two levels and names both, never rounding silently', () => {
    // Halfway between two adjacent lattice prices, to seven decimals.
    const below = toDisplayPrice(spec, logPrice(1234));
    const above = toDisplayPrice(spec, logPrice(1235));
    const between = ((below + above) / 2).toFixed(spec.displayPrecision);
    const resolved = resolveTarget(spec, between);
    expect(resolved.kind).toBe('between');
    if (resolved.kind === 'between') {
      expect(resolved.below).toBe(below.toFixed(spec.displayPrecision));
      expect(resolved.above).toBe(above.toFixed(spec.displayPrecision));
      expect(resolved.requested).toBe(between);
    }
  });

  it('refuses nonsense by name', () => {
    expect(() => resolveTarget(spec, 'abc')).toThrow(RangeError);
    expect(() => resolveTarget(spec, '-1')).toThrow(RangeError);
    expect(() => resolveTarget(spec, '0')).toThrow(RangeError);
  });
});

describe('the close is defined at the end of the current or the next bucket', () => {
  it('computes both ends from now', () => {
    const now = epochMillis(t0 + 17_000);
    const end = bucketEnd(now, timeframe('1m'));
    expect(closeInstant(now, '1m', 'current')).toBe(end);
    expect(closeInstant(now, '1m', 'next')).toBe(end + 60_000);
  });
});

describe('the window (ADR-0017, PH-24.2 §2)', () => {
  const end: EpochMillis = epochMillis(t0 + 60_000);

  it('includes a tick exactly at the close instant and stops at the first beyond it', () => {
    const window = readWindow(
      fork(logPrice(100), [
        { instant: t0 + 10_000, price: 103 },
        { instant: t0 + 59_990, price: 101 },
        { instant: t0 + 60_000, price: 106 }, // exactly at the end: in
        { instant: t0 + 60_100, price: 107 }, // beyond: out
      ]),
      end,
    );
    expect(window.steps).toEqual([3, 2, 5]);
    expect(window.lastInstant).toBe(end);
    expect(window.fromPrice).toBe(100);
  });

  it("measures from the fork's current price — the pending tick's — not from the last published one", () => {
    // A fork restored from a snapshot taken after the pending draw stands at the
    // pending price. The first step is measured from there. A window measured
    // from the last *published* price would count the pending tick's step twice.
    const window = readWindow(fork(logPrice(250), [{ instant: t0 + 5_000, price: 254 }]), end);
    expect(window.fromPrice).toBe(250);
    expect(window.steps).toEqual([4]);
  });

  it('is empty when the next tick is already beyond the close', () => {
    const window = readWindow(fork(logPrice(100), [{ instant: t0 + 61_000, price: 105 }]), end);
    expect(window.steps).toEqual([]);
    expect(window.lastInstant).toBeNull();
  });
});

describe('planning a close', () => {
  const window = readWindow(
    fork(logPrice(1000), [
      { instant: t0 + 1_000, price: 1003 },
      { instant: t0 + 2_000, price: 1001 },
      { instant: t0 + 3_000, price: 1005 },
      { instant: t0 + 4_000, price: 1004 },
    ]),
    epochMillis(t0 + 60_000),
  ); // steps 3, 2, 4, 1 — total 10, parity even

  it('lands exactly on a reachable target and reports the measured rate', () => {
    const plan = planClose(spec, logPrice(1000 + 4), window, random); // 3 - 2 + 4 - 1 = 4
    expect(plan.selection.signs).not.toBeNull();
    const sum = plan.selection.signs!.reduce((acc, sign, i) => acc + sign * window.steps[i]!, 0);
    expect(sum).toBe(4);
    expect(plan.selection.acceptanceRate).toBeGreaterThan(0);
    expect(plan.reachableNeighbours).toBeNull();
  });

  it('names the two reachable neighbours of an off-parity target', () => {
    const plan = planClose(spec, logPrice(1000 + 3), window, random); // odd: unreachable
    expect(plan.selection.signs).toBeNull();
    expect(plan.selection.impossible).toMatch(/parity/);
    expect(plan.reachableNeighbours).toEqual([
      toDisplayPrice(spec, logPrice(1002)).toFixed(spec.displayPrecision),
      toDisplayPrice(spec, logPrice(1004)).toFixed(spec.displayPrecision),
    ]);
  });

  it("refuses a target beyond the window's range with no neighbours to offer", () => {
    const plan = planClose(spec, logPrice(1000 + 12), window, random);
    expect(plan.selection.signs).toBeNull();
    expect(plan.selection.impossible).toMatch(/at most 10 lattice steps/);
    expect(plan.reachableNeighbours).toBeNull();
  });
});

describe('a sided close ends strictly beyond the mark (PH-24.21)', () => {
  // Steps 3, 2, 4, 1 with the market's own signs +, −, +, − : a close 4 above
  // where the window starts, so a mark at +4 is the case the seeded route test
  // never draws — the natural path landing exactly on it.
  const window = readWindow(
    fork(logPrice(1000), [
      { instant: t0 + 1_000, price: 1003 },
      { instant: t0 + 2_000, price: 1001 },
      { instant: t0 + 3_000, price: 1005 },
      { instant: t0 + 4_000, price: 1004 },
    ]),
    epochMillis(t0 + 60_000),
  );

  it("refuses the market's own path when it closes on the mark, and chooses one beyond it", () => {
    const mark = logPrice(1004);
    // A close *on* the entry mark is a tie, which settlement refunds (ADR-0007).
    // Relaxing either comparison to >= turns an operator's WIN into a REFUND
    // with nothing to show for it (Cycle Audit 8, a8).
    const above = planConditionedClose(spec, mark, 'above', window, random);
    expect(above.natural, 'a close on the mark was taken as above it').toBe(false);
    expect(above.selection.signs).not.toBeNull();
    expect(above.delta).toBeGreaterThan(4);
    expect(above.target).toBeGreaterThan(mark);

    const below = planConditionedClose(spec, mark, 'below', window, random);
    expect(below.natural, 'a close on the mark was taken as below it').toBe(false);
    expect(below.selection.signs).not.toBeNull();
    expect(below.delta).toBeLessThan(4);
    expect(below.target).toBeLessThan(mark);
  });

  it("arms the market's own path when it already ends beyond the mark, choosing nothing", () => {
    const plan = planConditionedClose(spec, logPrice(1003), 'above', window, random);
    expect(plan.natural).toBe(true);
    expect(plan.selection.attempts).toBe(0);
    expect(plan.delta).toBe(4);
  });
});
