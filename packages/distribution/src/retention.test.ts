// Invariant evidence: INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { commit } from './commitment.js';
import {
  commitmentIsPruneable,
  DEFAULT_DISPUTE_WINDOW_MS,
  DEFAULT_RETENTION,
  journalIsPruneable,
  partitionForRetention,
  RetentionError,
  type JournalWindow,
} from './retention.js';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function window(agedDays: number, assetId = 'eurusd'): JournalWindow {
  return {
    assetId,
    fromSequence: 1,
    toSequence: 100,
    newestInstant: NOW - agedDays * DAY,
  };
}

function ticks(from: number, count: number): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: from + i,
    instant: epochMillis(1_776_000_000_000 + (from + i) * 250),
    price: logPrice((from + i) * 3 - 7),
  }));
}

describe('the dispute window is the input, not the storage', () => {
  it('is 90 days', () => {
    expect(DEFAULT_DISPUTE_WINDOW_MS).toBe(90 * DAY);
    expect(DEFAULT_RETENTION.disputeWindowMs).toBe(DEFAULT_DISPUTE_WINDOW_MS);
  });

  it('keeps a journal inside the window', () => {
    expect(journalIsPruneable(window(1), NOW)).toBe(false);
    expect(journalIsPruneable(window(89), NOW)).toBe(false);
  });

  it('keeps a journal exactly on the boundary', () => {
    // The last day of a dispute window is a day on which a dispute may be
    // raised. Rounding the other way means answering it with "we deleted that
    // yesterday".
    expect(journalIsPruneable(window(90), NOW)).toBe(false);
  });

  it('prunes a journal past the window', () => {
    expect(journalIsPruneable(window(91), NOW)).toBe(true);
    expect(journalIsPruneable(window(400), NOW)).toBe(true);
  });

  it('honours a shorter window when one is set', () => {
    expect(journalIsPruneable(window(10), NOW, { disputeWindowMs: 7 * DAY })).toBe(true);
    expect(journalIsPruneable(window(10), NOW, { disputeWindowMs: 30 * DAY })).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a dispute window of %s',
    (disputeWindowMs) => {
      expect(() => journalIsPruneable(window(400), NOW, { disputeWindowMs })).toThrow(
        RetentionError,
      );
    },
  );

  it('refuses to age a journal whose newest instant is unusable', () => {
    // An unknown age is not an old one. Guessing here deletes a record that may
    // still be under dispute.
    expect(() => journalIsPruneable({ ...window(400), newestInstant: Number.NaN }, NOW)).toThrow(
      RetentionError,
    );
  });
});

describe('a commitment is never pruneable', () => {
  const commitment = commit('eurusd', ticks(1, 8));

  it('is false at any age', () => {
    for (const days of [0, 90, 365, 36_500]) {
      expect(commitmentIsPruneable(commitment, NOW + days * DAY)).toBe(false);
    }
  });

  it('is false under any policy, including a one-millisecond window', () => {
    expect(commitmentIsPruneable(commitment, NOW, { disputeWindowMs: 1 })).toBe(false);
  });

  // Each root binds its predecessor, so discarding one breaks the chain at that
  // point permanently. Pruning journals gives up the ability to *recompute* an
  // old outcome; pruning the chain would give up the ability to prove the record
  // was not altered, which is the whole of what PH-12 built.
});

describe('partitioning a set of journals', () => {
  it('splits on the window and keeps every journal accounted for', () => {
    const windows = [window(1), window(89), window(90), window(91), window(500)];
    const { pruneable, retained } = partitionForRetention(windows, NOW);
    expect(pruneable).toHaveLength(2);
    expect(retained).toHaveLength(3);
    expect(pruneable.length + retained.length).toBe(windows.length);
  });

  it('is per journal, not per asset', () => {
    const windows = [window(1, 'eurusd'), window(500, 'eurusd'), window(500, 'gbpusd')];
    const { pruneable, retained } = partitionForRetention(windows, NOW);
    // An asset with old journals and new ones keeps the new ones.
    expect(retained.map((w) => w.assetId)).toEqual(['eurusd']);
    expect(pruneable).toHaveLength(2);
  });

  it('prunes nothing from an empty set', () => {
    expect(partitionForRetention([], NOW)).toEqual({ pruneable: [], retained: [] });
  });
});
