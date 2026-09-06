// Invariant evidence: INV-009 (reproducible settlement), INV-003 (single stream).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { CommitmentError, proveInclusion, verifyInclusion } from './commitment.js';
import { CommitmentPublisher, type ClosedWindow } from './publisher.js';
import { publicKeyHex, publishingKeyFromSeed, verifySignedChain } from './signing.js';

const key = publishingKeyFromSeed('33'.repeat(32));
const identity = publicKeyHex(key);

function ticks(from: number, count: number): Tick[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: from + i,
    instant: epochMillis(1_776_000_000_000 + (from + i) * 400),
    price: logPrice((from + i) * 2 - 11),
  }));
}

const publisher = (over: Partial<ConstructorParameters<typeof CommitmentPublisher>[0]> = {}) =>
  new CommitmentPublisher({ assetId: 'eurusd', windowTicks: 10, privateKey: key, ...over });

describe('windows close on count and tile the sequence space', () => {
  it('emits nothing until a window fills', () => {
    const p = publisher();
    expect(p.observe(ticks(1, 9))).toEqual([]);
    expect(p.pendingTicks).toBe(9);
    expect(p.chainTip).toBe('');
    expect(p.observe(ticks(10, 1))).toHaveLength(1);
    expect(p.pendingTicks).toBe(0);
  });

  it('leaves the partial tail uncommitted rather than committing it twice', () => {
    // Committing a partial window and then extending it would produce two roots
    // over overlapping ranges, which a verifier cannot tell from an operator
    // restating history.
    const p = publisher();
    p.observe(ticks(1, 25));
    expect(p.pendingTicks).toBe(5);
    const closed = p.observe(ticks(26, 5));
    expect(closed).toHaveLength(1);
    expect(closed[0]!.signed.commitment.fromSequence).toBe(21);
    expect(closed[0]!.signed.commitment.toSequence).toBe(30);
  });

  it('tiles without gap or overlap across many windows', () => {
    const p = publisher();
    const closed: ClosedWindow[] = [];
    for (let batch = 0; batch < 20; batch += 1) closed.push(...p.observe(ticks(1 + batch * 7, 7)));
    expect(closed).toHaveLength(14);
    for (let i = 0; i < closed.length; i += 1) {
      expect(closed[i]!.signed.commitment.fromSequence).toBe(1 + i * 10);
      expect(closed[i]!.signed.commitment.toSequence).toBe(10 + i * 10);
    }
  });

  it('produces a chain that verifies end to end', () => {
    const p = publisher();
    const closed = p.observe(ticks(1, 100));
    expect(
      verifySignedChain(
        closed.map((w) => w.signed),
        identity,
      ),
    ).toBeNull();
  });

  it('handles a window size of one', () => {
    const p = publisher({ windowTicks: 1 });
    const closed = p.observe(ticks(1, 5));
    expect(closed).toHaveLength(5);
    expect(
      verifySignedChain(
        closed.map((w) => w.signed),
        identity,
      ),
    ).toBeNull();
  });
});

describe('a committed tick can be proved from the published artefacts alone', () => {
  it('proves any tick in any closed window', () => {
    const p = publisher();
    const closed = p.observe(ticks(1, 60));
    const failures: number[] = [];
    for (const window of closed) {
      for (const tick of window.ticks) {
        const proof = proveInclusion(window.ticks, tick.sequence);
        if (!verifyInclusion(window.signed.commitment, proof)) failures.push(tick.sequence);
      }
    }
    expect(failures).toEqual([]);
  });

  it('does not prove a tick from the open window', () => {
    // Uncommitted is a real state, and the honest answer is that it is not yet
    // in the chain — not a proof, and not a denial that it happened.
    const p = publisher();
    const closed = p.observe(ticks(1, 15));
    expect(p.pendingTicks).toBe(5);
    const committed = closed.flatMap((w) => w.ticks).map((t) => t.sequence);
    expect(committed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(committed).not.toContain(11);
  });
});

describe('the publisher refuses what would produce a chain that lies', () => {
  it('refuses a gap in its input', () => {
    const p = publisher();
    p.observe(ticks(1, 5));
    expect(() => p.observe(ticks(7, 5))).toThrow(/cannot bridge a gap/);
  });

  it('refuses ticks that go backwards', () => {
    const p = publisher();
    p.observe(ticks(1, 5));
    expect(() => p.observe(ticks(3, 2))).toThrow(CommitmentError);
  });

  it('refuses a resume that does not say where it resumes', () => {
    // A resumed publisher that guessed would leave a hole or an overlap, and
    // once published neither is distinguishable from tampering.
    expect(() => publisher({ previousRoot: 'ab'.repeat(32) })).toThrow(/must be told the sequence/);
  });

  it('refuses a nonsensical window size or a nameless asset', () => {
    expect(() => publisher({ windowTicks: 0 })).toThrow(CommitmentError);
    expect(() => publisher({ windowTicks: 2.5 })).toThrow(CommitmentError);
    expect(() => publisher({ assetId: '' })).toThrow(/not permitted/);
  });
});

describe('a restarted publisher continues one chain', () => {
  it('resumes from the tip and the chain still verifies', () => {
    const first = publisher();
    const before = first.observe(ticks(1, 30));

    const second = publisher({
      previousRoot: first.chainTip,
      nextSequence: first.nextSequence ?? 0,
    });
    const after = second.observe(ticks(31, 30));

    const whole = [...before, ...after].map((w) => w.signed);
    expect(verifySignedChain(whole, identity)).toBeNull();
    expect(whole).toHaveLength(6);
  });

  it('refuses to resume at the wrong sequence', () => {
    const first = publisher();
    first.observe(ticks(1, 30));
    const second = publisher({ previousRoot: first.chainTip, nextSequence: 99 });
    expect(() => second.observe(ticks(31, 10))).toThrow(/expected sequence 99/);
  });

  it('loses the open window on restart, and does not pretend otherwise', () => {
    // Ticks in the open window at a restart were published but never committed.
    // The resumed publisher starts the next window after the last *committed*
    // sequence, so those ticks are absent from the chain — visibly, rather than
    // being folded into a later window whose range would then be a lie.
    const first = publisher();
    first.observe(ticks(1, 25));
    expect(first.pendingTicks).toBe(5);
    expect(first.nextSequence).toBe(21);

    const second = publisher({ previousRoot: first.chainTip, nextSequence: first.nextSequence! });
    const closed = second.observe(ticks(21, 10));
    expect(closed[0]!.signed.commitment.fromSequence).toBe(21);
  });
});

/**
 * Cycle Audit 10, a6-03 and a6-04.
 *
 * The open window used to end with the process: the release run left 5,749
 * served ticks in no committed window, across all thirty markets, in one
 * deploy — and answered `409` to a proof of any of them, for ever. And the
 * chain that resumed afterwards began at an empty root, bound to what preceded
 * it by nothing, so a window cut from the earlier tail read exactly like the
 * honest gap.
 */
describe('a chain that stops is sealed, and one that resumes binds what it resumes after', () => {
  it('seals the open window short, then continues after it without overlapping it', () => {
    const p = publisher();
    p.observe(ticks(1, 25));
    expect(p.pendingTicks).toBe(5);
    const sealed = p.sealChain();
    expect(sealed).not.toBeNull();
    expect(sealed!.signed.commitment.fromSequence).toBe(21);
    expect(sealed!.signed.commitment.toSequence).toBe(25);
    expect(sealed!.signed.commitment.count).toBe(5);
    expect(p.pendingTicks).toBe(0);
    // Idempotent: nothing is open, so nothing is written twice.
    expect(p.sealChain()).toBeNull();
    // And the next window starts after it. A short window followed by a
    // disjoint one is not the overlap the open window exists to avoid.
    const next = p.observe(ticks(26, 10));
    expect(next[0]!.signed.commitment.fromSequence).toBe(26);
    expect(
      verifySignedChain(
        [sealed!, ...next].map((w) => w.signed),
        identity,
      ),
    ).toBeNull();
  });

  it('proves a tick that was in the open window once the chain is sealed', () => {
    const p = publisher();
    p.observe(ticks(1, 13));
    const sealed = p.sealChain()!;
    const proof = proveInclusion(sealed.ticks, 12);
    expect(verifyInclusion(sealed.signed.commitment, proof)).toBe(true);
  });

  it('writes a resume link that binds the sealed head and declares the interval', () => {
    const first = publisher();
    const before = first.observe(ticks(1, 25));
    const sealed = first.sealChain()!;

    const second = publisher({ previousRoot: first.chainTip, resumesAfter: first.tipSequence! });
    const after = second.observe(ticks(100_101, 10));
    const resume = after[0]!.signed.commitment;
    expect(resume.previousRoot).toBe(sealed.signed.commitment.root);
    expect(resume.resumesAfter).toBe(25);
    expect(resume.fromSequence).toBe(100_101);
    // One chain, still: the hash link is unbroken across the interval.
    const whole = [...before, sealed, ...after].map((w) => w.signed);
    expect(verifySignedChain(whole, identity)).toBeNull();
  });

  it('writes an ordinary link when the first tick continues the head after all', () => {
    // A market told it seamed and then publishing contiguously has no gap to
    // declare, and a declaration with nothing behind it is noise in the record.
    const first = publisher();
    first.observe(ticks(1, 20));
    const second = publisher({ previousRoot: first.chainTip, resumesAfter: first.tipSequence! });
    const closed = second.observe(ticks(21, 10));
    expect(closed[0]!.signed.commitment.resumesAfter).toBeUndefined();
    expect(closed[0]!.signed.commitment.fromSequence).toBe(21);
  });

  it('restarts at an empty root rather than restate what the head already covers', () => {
    // PH-28.3's own case: the record a market would have been folded from is
    // gone, so it resumes from a checkpoint that lies *behind* the chain's tip
    // and republishes sequences the chain has already committed. One chain
    // cannot hold two roots over one range and a resume link declaring this
    // would be a lie about where its predecessor ended, so the chain restarts
    // — the break is unbound, which is what an unbound break says. Refusing
    // would stop the market instead of recording what happened to it.
    const first = publisher();
    first.observe(ticks(1, 20));
    const second = publisher({ previousRoot: first.chainTip, resumesAfter: first.tipSequence! });
    const closed = second.observe(ticks(15, 10));
    expect(closed[0]!.signed.commitment.previousRoot).toBe('');
    expect(closed[0]!.signed.commitment.resumesAfter).toBeUndefined();
    expect(closed[0]!.signed.commitment.fromSequence).toBe(15);
  });

  it('refuses to resume after a head it is not given, or with a sequence it cannot have', () => {
    expect(() => publisher({ resumesAfter: 20 })).toThrow(/must be told the root it resumes after/);
    expect(() =>
      publisher({ previousRoot: 'ab'.repeat(32), resumesAfter: 20, nextSequence: 21 }),
    ).toThrow(/cannot both resume after a gap/);
  });
});
