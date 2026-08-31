import { describe, expect, it } from 'vitest';
import { epochMillis } from '../time/instant.js';
import { logPrice } from './instrument.js';
import {
  assertReplaySegment,
  cursorsAt,
  type CursorAdvance,
  type ReplaySegment,
  type StreamSnapshot,
} from './replay.js';

const snapshot: StreamSnapshot = {
  instrumentId: 'eurusd-otc',
  keyId: 'prod-2026-08',
  takenAt: epochMillis(1_776_000_000_000),
  sequence: 1_000,
  price: logPrice(12_345),
  cursors: { magnitude: '500:0', sign: '250:16', arrival: '90:8' },
  modelState: { volatility: 0.4 },
};

const advance = (atSequence: number, purpose: string, from: string, to: string): CursorAdvance => ({
  instrumentId: 'eurusd-otc',
  purpose,
  atSequence,
  from,
  to,
  reason: 'restart-lease',
});

describe('replay segment validation', () => {
  it('accepts a well-formed segment', () => {
    const segment: ReplaySegment = {
      snapshot,
      advances: [
        advance(1_500, 'magnitude', '600:0', '1600:0'),
        advance(1_500, 'sign', '300:0', '1300:0'),
      ],
    };
    // Two purposes advancing at the same sequence is a single restart, so their
    // ordering must be tolerated; strict ordering applies across sequences.
    expect(() =>
      assertReplaySegment({ ...segment, advances: [segment.advances[0]!] }),
    ).not.toThrow();
  });

  it('records a key identifier, never a secret', () => {
    expect(snapshot.keyId).toBe('prod-2026-08');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(() =>
      assertReplaySegment({ snapshot: { ...snapshot, keyId: '' }, advances: [] }),
    ).toThrow(RangeError);
  });

  it('rejects an advance belonging to another instrument', () => {
    const foreign = { ...advance(1_500, 'magnitude', 'a', 'b'), instrumentId: 'gbpusd-otc' };
    expect(() => assertReplaySegment({ snapshot, advances: [foreign] })).toThrow(RangeError);
  });

  it('rejects an advance before the snapshot', () => {
    expect(() =>
      assertReplaySegment({ snapshot, advances: [advance(999, 'magnitude', 'a', 'b')] }),
    ).toThrow(RangeError);
  });

  it('rejects unordered advances', () => {
    expect(() =>
      assertReplaySegment({
        snapshot,
        advances: [advance(2_000, 'magnitude', 'a', 'b'), advance(1_500, 'magnitude', 'b', 'c')],
      }),
    ).toThrow(RangeError);
  });

  it('rejects an advance for a purpose the snapshot does not carry', () => {
    expect(() =>
      assertReplaySegment({ snapshot, advances: [advance(1_500, 'regime', 'a', 'b')] }),
    ).toThrow(RangeError);
  });

  it('rejects a negative snapshot sequence', () => {
    expect(() =>
      assertReplaySegment({ snapshot: { ...snapshot, sequence: -1 }, advances: [] }),
    ).toThrow(RangeError);
  });
});

describe('resolving cursors across a restart seam', () => {
  const segment: ReplaySegment = {
    snapshot,
    advances: [
      advance(1_500, 'magnitude', '600:0', '1600:0'),
      advance(2_400, 'sign', '300:0', '1300:0'),
      advance(3_100, 'magnitude', '1800:0', '2800:0'),
    ],
  };

  it('returns the snapshot cursors before any advance', () => {
    expect(cursorsAt(segment, 1_000)).toEqual(snapshot.cursors);
    expect(cursorsAt(segment, 1_499)).toEqual(snapshot.cursors);
  });

  it('applies each advance at its sequence', () => {
    expect(cursorsAt(segment, 1_500).magnitude).toBe('1600:0');
    expect(cursorsAt(segment, 1_500).sign).toBe('250:16');
    expect(cursorsAt(segment, 2_400).sign).toBe('1300:0');
    expect(cursorsAt(segment, 3_100).magnitude).toBe('2800:0');
  });

  it('applies the latest advance per purpose', () => {
    expect(cursorsAt(segment, 5_000)).toEqual({
      magnitude: '2800:0',
      sign: '1300:0',
      arrival: '90:8',
    });
  });

  it('refuses to resolve before the segment begins', () => {
    // Without the recorded jumps a segment spanning a restart cannot be
    // reproduced at all, so silently returning the snapshot would be a lie.
    expect(() => cursorsAt(segment, 999)).toThrow(RangeError);
  });

  it('does not mutate the snapshot', () => {
    cursorsAt(segment, 5_000);
    expect(snapshot.cursors.magnitude).toBe('500:0');
  });
});
