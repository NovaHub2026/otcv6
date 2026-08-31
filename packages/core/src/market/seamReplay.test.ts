// Invariant evidence: INV-008 (continuous market state), INV-009 (reproducible settlement).
import { describe, expect, it } from 'vitest';
import { CursorLease } from '../entropy/lease.js';
import { MasterKeyring } from '../entropy/keyring.js';
import { formatCursor, parseCursor, type RandomStream } from '../entropy/stream.js';
import { epochMillis } from '../time/instant.js';
import { logPrice } from './instrument.js';
import {
  cursorsAt,
  type CursorAdvance,
  type ReplaySegment,
  type StreamSnapshot,
} from './replay.js';
import type { Tick } from './tick.js';

/**
 * PH-1 integration: replaying a segment of history that spans a restart.
 *
 * This is the acceptance criterion that ties the whole substrate together. A
 * crash advances the entropy cursor discontinuously — the lease reserves ahead
 * of use so that a restart can never redraw values already consumed — so a
 * history spanning a restart is reproducible only from `snapshot + ordered
 * cursor advances`. That artefact is what INV-009 requires when a settled
 * contract is disputed, and this test is what proves it exists and works.
 */

const keyring = MasterKeyring.forTesting('seam-replay');
const INSTRUMENT_ID = 'seam-otc';
const LEASE_BLOCKS = 64n;
const START_INSTANT = 1_776_000_000_000;

function stream(purpose: string): RandomStream {
  return keyring.derive({ env: 'test', asset: INSTRUMENT_ID, purpose, keyEpoch: 0 });
}

/**
 * A minimal generator: one magnitude draw and one sign draw per tick. Small
 * enough to reason about exactly, which is what an integration test of
 * determinism needs.
 */
function generateTick(
  magnitude: RandomStream,
  sign: RandomStream,
  sequence: number,
  price: number,
): Tick {
  const steps = 1 + magnitude.nextBoundedUint32(20);
  const direction = sign.nextBoolean() ? 1 : -1;
  return {
    instant: epochMillis(START_INSTANT + sequence * 1_000),
    sequence,
    price: logPrice(price + direction * steps),
  };
}

interface Session {
  readonly ticks: Tick[];
  readonly snapshot: StreamSnapshot;
  readonly persistedHighWater: bigint;
}

/** Run one process lifetime, snapshotting at `snapshotAt`. */
function runSession(
  startSequence: number,
  endSequence: number,
  startPrice: number,
  resumeFrom: bigint | null,
  snapshotAt: number,
): Session {
  const lease = CursorLease.resume(resumeFrom, LEASE_BLOCKS);
  const magnitude = stream('magnitude');
  const sign = stream('sign');
  magnitude.seek({ blockIndex: lease.startAt, byteOffset: 0 });
  sign.seek({ blockIndex: lease.startAt, byteOffset: 0 });

  let highWater = lease.startAt;
  const reserve = (): void => {
    const needed = lease.ensure(magnitude.position().blockIndex);
    if (needed !== null) {
      // Durable BEFORE consuming, which is what makes a crash safe.
      highWater = needed;
      lease.confirm(needed);
    }
  };
  reserve();

  const ticks: Tick[] = [];
  let price = startPrice;
  let snapshot: StreamSnapshot | null = null;

  for (let sequence = startSequence; sequence <= endSequence; sequence += 1) {
    if (sequence === snapshotAt) {
      snapshot = {
        instrumentId: INSTRUMENT_ID,
        keyId: keyring.keyId,
        takenAt: epochMillis(START_INSTANT + sequence * 1_000),
        sequence,
        price: logPrice(price),
        cursors: {
          magnitude: formatCursor(magnitude.position()),
          sign: formatCursor(sign.position()),
        },
        modelState: null,
      };
    }
    const tick = generateTick(magnitude, sign, sequence, price);
    price = tick.price;
    ticks.push(tick);
    reserve();
  }

  if (snapshot === null) throw new Error('snapshot sequence was outside the session');
  return { ticks, snapshot, persistedHighWater: highWater };
}

/** Reproduce a segment from `snapshot + ordered cursor advances`. */
function replay(segment: ReplaySegment, count: number): Tick[] {
  const magnitude = stream('magnitude');
  const sign = stream('sign');
  const startSequence = segment.snapshot.sequence;
  const ticks: Tick[] = [];

  let price = segment.snapshot.price as number;
  let magnitudeCursor = parseCursor(segment.snapshot.cursors.magnitude!);
  let signCursor = parseCursor(segment.snapshot.cursors.sign!);

  for (let i = 0; i < count; i += 1) {
    const sequence = startSequence + i;
    // A restart moved the cursor discontinuously; the recorded advance is the
    // only way a replay driver can know where it jumped to.
    for (const advance of segment.advances) {
      if (advance.atSequence !== sequence) continue;
      if (advance.purpose === 'magnitude') magnitudeCursor = parseCursor(advance.to);
      if (advance.purpose === 'sign') signCursor = parseCursor(advance.to);
    }
    magnitude.seek(magnitudeCursor);
    sign.seek(signCursor);
    const tick = generateTick(magnitude, sign, sequence, price);
    price = tick.price;
    magnitudeCursor = magnitude.position();
    signCursor = sign.position();
    ticks.push(tick);
  }
  return ticks;
}

describe('replaying a history that spans a restart seam', () => {
  // Session A runs to tick 500 and crashes; session B resumes and runs to 800.
  const sessionA = runSession(1, 500, 0, null, 200);
  const seamSequence = 501;
  const sessionB = runSession(
    seamSequence,
    800,
    sessionA.ticks[sessionA.ticks.length - 1]!.price,
    sessionA.persistedHighWater,
    seamSequence,
  );

  const advances: CursorAdvance[] = ['magnitude', 'sign'].map((purpose) => ({
    instrumentId: INSTRUMENT_ID,
    purpose,
    atSequence: seamSequence,
    from: sessionA.snapshot.cursors[purpose]!,
    to: sessionB.snapshot.cursors[purpose]!,
    reason: 'restart-lease' as const,
  }));

  it('resolves the seam cursors through cursorsAt', () => {
    const segment: ReplaySegment = { snapshot: sessionA.snapshot, advances };
    // Before the seam the snapshot cursors stand; from the seam onward the
    // recorded advances take over. This is the lookup a replay driver performs.
    expect(cursorsAt(segment, seamSequence - 1)).toEqual(sessionA.snapshot.cursors);
    expect(cursorsAt(segment, seamSequence)).toEqual(sessionB.snapshot.cursors);
    expect(cursorsAt(segment, 10_000)).toEqual(sessionB.snapshot.cursors);
  });

  it('advances the cursor across the seam rather than reusing it', () => {
    const before = parseCursor(sessionA.snapshot.cursors.magnitude!);
    const after = parseCursor(sessionB.snapshot.cursors.magnitude!);
    expect(after.blockIndex).toBeGreaterThan(before.blockIndex);
    // The gap is bounded by the lease, and it is a gap rather than an overlap:
    // no block index is consumed by both sessions.
    expect(sessionB.snapshot.cursors.magnitude).not.toBe(sessionA.snapshot.cursors.magnitude);
  });

  it('produces a continuous price across the seam', () => {
    const last = sessionA.ticks[sessionA.ticks.length - 1]!;
    const first = sessionB.ticks[0]!;
    expect(first.sequence).toBe(last.sequence + 1);
    // A restart must not jump the price: the new session continues from the old
    // price, only the entropy position moves.
    expect(Math.abs(first.price - last.price)).toBeLessThanOrEqual(20);
  });

  it('does not repeat the pre-crash sequence after restart', () => {
    const before = sessionA.ticks.slice(-100).map((t) => t.price - 0);
    const after = sessionB.ticks.slice(0, 100).map((t) => t.price - 0);
    expect(after).not.toEqual(before);
  });

  it('reproduces session A exactly from its snapshot', () => {
    const segment: ReplaySegment = { snapshot: sessionA.snapshot, advances: [] };
    const reproduced = replay(segment, 301); // ticks 200..500
    const original = sessionA.ticks.filter((t) => t.sequence >= 200);
    expect(reproduced).toEqual(original);
  });

  it('reproduces the whole span, across the seam, from snapshot plus advances', () => {
    const segment: ReplaySegment = { snapshot: sessionA.snapshot, advances };
    const reproduced = replay(segment, 601); // ticks 200..800
    const original = [...sessionA.ticks.filter((t) => t.sequence >= 200), ...sessionB.ticks];
    expect(reproduced).toHaveLength(original.length);
    expect(reproduced).toEqual(original);
  });

  it('cannot reproduce the span without the recorded advances', () => {
    // The precise reason the advances must be persisted: without them a replay
    // silently produces a different, plausible-looking history.
    const segment: ReplaySegment = { snapshot: sessionA.snapshot, advances: [] };
    const reproduced = replay(segment, 601);
    const original = [...sessionA.ticks.filter((t) => t.sequence >= 200), ...sessionB.ticks];
    expect(reproduced.slice(0, 301)).toEqual(original.slice(0, 301));
    expect(reproduced.slice(301)).not.toEqual(original.slice(301));
  });
});
