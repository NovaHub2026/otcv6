// Invariant evidence: INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { commit } from './commitment.js';
import {
  commitmentIsPruneable,
  DEFAULT_DISPUTE_WINDOW_MS,
  DEFAULT_RETENTION,
  journalIsPruneable,
  LONGEST_HORIZON_MS,
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

  it('keeps a journal on the last day of the window', () => {
    // The last day of a dispute window is a day on which a dispute may be
    // raised. Rounding the other way means answering it with "we deleted that
    // yesterday". Not the boundary: the reach is the window plus the longest
    // horizon, and the boundary itself is tested below (a5-02).
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

describe('Cycle Audit 5: contracts reach backwards, and so must retention', () => {
  const MINUTE = 60 * 1000;

  it('keeps a journal just past the dispute window, because a contract there still needs its entry', () => {
    // A settlement whose expiry is 89 days and 23 hours old is still disputable,
    // and answering it needs the entry tick up to fifteen minutes earlier. The
    // rule had no horizon term, so there was a rolling band one horizon wide of
    // settlements whose expiry was inside the window and whose entry price had
    // been deleted.
    const justPast: JournalWindow = {
      assetId: 'eurusd',
      fromSequence: 1,
      toSequence: 100,
      newestInstant: NOW - (90 * DAY + 5 * MINUTE),
    };
    expect(journalIsPruneable(justPast, NOW)).toBe(false);
  });

  it('prunes once the window and the longest horizon have both elapsed', () => {
    const wellPast: JournalWindow = {
      assetId: 'eurusd',
      fromSequence: 1,
      toSequence: 100,
      newestInstant: NOW - (90 * DAY + 16 * MINUTE),
    };
    expect(journalIsPruneable(wellPast, NOW)).toBe(true);
  });

  it('keeps a journal exactly at the reach, and prunes it one millisecond later (a5-02)', () => {
    // The boundary the docstring states, at the millisecond. Before this test a
    // `>=` in place of `>` — pruning *on* the boundary — passed all twenty-four
    // retention tests, because the nearest cases sat five and sixteen minutes
    // away from it. The only deleting rule in the repository had a documented
    // edge and no guard on it.
    const reach = 90 * DAY + LONGEST_HORIZON_MS;
    const atReach: JournalWindow = {
      assetId: 'eurusd',
      fromSequence: 1,
      toSequence: 100,
      newestInstant: NOW - reach,
    };
    expect(journalIsPruneable(atReach, NOW)).toBe(false);
    expect(journalIsPruneable({ ...atReach, newestInstant: NOW - reach - 1 }, NOW)).toBe(true);
    // And through the partition, which is what a cleanup task actually calls.
    const { pruneable, retained } = partitionForRetention(
      [atReach, { ...atReach, newestInstant: NOW - reach - 1 }],
      NOW,
    );
    expect(retained).toEqual([atReach]);
    expect(pruneable).toHaveLength(1);
  });

  it('states the horizon it reaches back by', () => {
    expect(LONGEST_HORIZON_MS).toBe(15 * MINUTE);
    expect(DEFAULT_RETENTION.longestHorizonMs).toBe(LONGEST_HORIZON_MS);
  });

  it('honours a horizon supplied by the caller', () => {
    const aged: JournalWindow = {
      assetId: 'eurusd',
      fromSequence: 1,
      toSequence: 100,
      newestInstant: NOW - (90 * DAY + 30 * MINUTE),
    };
    expect(journalIsPruneable(aged, NOW, { disputeWindowMs: 90 * DAY })).toBe(true);
    expect(
      journalIsPruneable(aged, NOW, { disputeWindowMs: 90 * DAY, longestHorizonMs: 60 * MINUTE }),
    ).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses to prune against a clock reading of %s',
    (now) => {
      // Forward clock skew is the hazard PH-14.1's lease exists to handle, and
      // here it deletes records that are still under dispute. Irreversibly.
      const aged: JournalWindow = {
        assetId: 'eurusd',
        fromSequence: 1,
        toSequence: 100,
        newestInstant: NOW - 400 * DAY,
      };
      expect(() => journalIsPruneable(aged, now)).toThrow(RetentionError);
      expect(() => partitionForRetention([aged], now)).toThrow(RetentionError);
    },
  );

  it.each([-1, Number.NaN])('refuses a longest horizon of %s', (longestHorizonMs) => {
    const aged: JournalWindow = {
      assetId: 'eurusd',
      fromSequence: 1,
      toSequence: 100,
      newestInstant: NOW - 400 * DAY,
    };
    expect(() =>
      journalIsPruneable(aged, NOW, { disputeWindowMs: 90 * DAY, longestHorizonMs }),
    ).toThrow(RetentionError);
  });
});
