// Invariant evidence: INV-002 (shared market).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core/browser';
import { ContiguityError, TickWindow } from './window.js';

function ticks(from: number, count: number): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: from + i,
    instant: epochMillis(1_000_000 + (from + i) * 250),
    price: logPrice((from + i) * 7),
  }));
}

describe('the window refuses to draw across a hole', () => {
  it('rejects a batch that does not continue it', () => {
    // A client that absorbs a gap and draws over it has reintroduced
    // interpolation through the network layer: a line between two prices with no
    // evidence about what happened between them.
    const window = new TickWindow();
    window.append(ticks(1, 100));
    expect(() => window.append(ticks(150, 10))).toThrow(ContiguityError);
    expect(window.size).toBe(100);
  });

  it('rejects a gap inside a single batch', () => {
    const window = new TickWindow();
    expect(() => window.append([...ticks(1, 5), ...ticks(9, 5)])).toThrow(ContiguityError);
  });

  it('names the sequence to resume from', () => {
    const window = new TickWindow();
    window.append(ticks(1, 40));
    try {
      window.append(ticks(60, 5));
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(ContiguityError);
      expect((error as ContiguityError).expected).toBe(41);
      expect((error as ContiguityError).received).toBe(60);
    }
  });

  it('accepts an exact continuation', () => {
    const window = new TickWindow();
    window.append(ticks(1, 50));
    window.append(ticks(51, 50));
    expect(window.size).toBe(100);
    expect(window.range).toEqual({ oldest: 1, newest: 100 });
  });
});

describe('resumption is exact, never approximate', () => {
  it('knows precisely where to resume', () => {
    const window = new TickWindow();
    expect(window.resumeFrom).toBeUndefined();
    window.append(ticks(1, 30));
    expect(window.resumeFrom).toBe(31);
  });

  it('survives a backgrounded tab: a long stall then an exact continuation', () => {
    // The ordinary case, not the exotic one. Browsers throttle timers, the socket
    // stalls, and the client returns needing to know exactly what it missed.
    const window = new TickWindow();
    window.append(ticks(1, 500));
    const resume = window.resumeFrom!;
    expect(resume).toBe(501);

    // Server sends exactly what was asked for after the stall.
    window.append(ticks(resume, 4_000));
    const range = window.range!;
    expect(range.oldest).toBe(1);
    expect(range.newest).toBe(4_500);

    // And the reconstruction is contiguous end to end.
    const { prices } = window.series();
    expect(prices).toHaveLength(4_500);
    for (let i = 0; i < 4_500; i += 1) expect(prices[i]).toBe((i + 1) * 7);
  });

  it('still knows where to resume after everything it held was evicted', () => {
    const window = new TickWindow({ capacity: 100 });
    window.append(ticks(1, 100));
    window.append(ticks(101, 100));
    expect(window.range).toEqual({ oldest: 101, newest: 200 });
    expect(window.resumeFrom).toBe(201);
  });
});

describe('eviction is from the oldest end only', () => {
  it('keeps the window contiguous under capacity pressure', () => {
    // Dropping from the middle to "keep both ends" leaves a window that looks
    // contiguous and is not — the worst possible outcome, because nothing
    // downstream can detect it.
    const window = new TickWindow({ capacity: 1_000 });
    for (let batch = 0; batch < 10; batch += 1) {
      window.append(ticks(1 + batch * 500, 500));
    }
    expect(window.size).toBe(1_000);
    const { prices } = window.series();
    const range = window.range!;
    expect(range.newest - range.oldest).toBe(999);
    // Every retained tick follows the previous one.
    for (let i = 1; i < prices.length; i += 1) {
      expect(prices[i]! - prices[i - 1]!).toBe(7);
    }
  });

  it('rejects a nonsensical capacity', () => {
    expect(() => new TickWindow({ capacity: 0 })).toThrow(RangeError);
  });
});

describe('the window feeds the reduction directly', () => {
  it('exposes a series the chart can reduce', () => {
    const window = new TickWindow();
    window.append(ticks(1, 1_000));
    const { instants, prices } = window.series();
    expect(instants).toHaveLength(1_000);
    expect(prices).toHaveLength(1_000);
    expect(window.latest!.sequence).toBe(1_000);
    expect(window.span).toEqual({ from: instants[0], to: instants[999] });
  });

  it('reports nothing for an empty window', () => {
    const window = new TickWindow();
    expect(window.range).toBeNull();
    expect(window.latest).toBeNull();
    expect(window.span).toBeNull();
    expect(window.series().prices).toHaveLength(0);
  });
});
