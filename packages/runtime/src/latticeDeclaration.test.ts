// Invariant evidence: INV-002 (shared market), INV-009 (reproducible settlement).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import {
  CONTINUITY_BAND_PERCENT,
  dateCandlesAgainstRecord,
  epochsOf,
  proposeBackfill,
  proposeDeclaration,
  RESCALE_TOLERANCE,
} from './latticeDeclaration.js';
import { frameAtOrBefore, frameOfSpan, type PriceFrame } from './priceFrame.js';
import { SqliteTickRecord } from './tickRecord.js';

const directories: string[] = [];
async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-declare-'));
  directories.push(directory);
  return directory;
}
afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const GENESIS = 1_776_000_000_000;
// eurusd-otc's real numbers: the lattice it published on before PH-37 and the
// one it publishes on now, a coarsening of 12.92x.
const OLD: PriceFrame = {
  logQuantum: 3.131447750503912e-7,
  referencePrice: 1.1,
  displayPrecision: 5,
};
const NEW: PriceFrame = {
  logQuantum: 4.044597092506429e-6,
  referencePrice: 1.1,
  displayPrecision: 5,
};
const RATIO = NEW.logQuantum / OLD.logQuantum;

function run(from: number, to: number, price: (i: number) => number): Tick[] {
  const ticks: Tick[] = [];
  for (let s = from; s <= to; s += 1) {
    ticks.push({
      sequence: s,
      instant: epochMillis(GENESIS + s * 250),
      price: logPrice(price(s - from)),
    });
  }
  return ticks;
}

/**
 * A record shaped like the live one: a run on the old lattice, the relattice
 * seam where the resume re-expressed the price, a run on the new lattice, and
 * then an **ordinary** restart seam that must not be mistaken for the first.
 */
async function recordWithBoundary(): Promise<{
  record: SqliteTickRecord;
  boundary: number;
  ordinary: number;
}> {
  const file = path.join(await scratch(), 'record.db');
  const record = new SqliteTickRecord(file);
  // Far from the reference, where continuity is sharp.
  await record.append([{ assetId: 'a', ticks: run(1, 400, (i) => 8795 + i), frame: OLD }]);
  // The relattice: the resume re-expressed the price onto the coarser lattice.
  const boundary = 100_402;
  const rescaled = Math.round(9194 / RATIO);
  // Then the market drifts down to the reference price, which is where the
  // continuity leg goes blind — `usdjpy-otc`'s integers were around −190.
  await record.append([
    {
      assetId: 'a',
      ticks: run(boundary, boundary + 399, (i) =>
        Math.round(rescaled - (i * (rescaled - 190)) / 399),
      ),
      frame: NEW,
    },
  ]);
  // An **ordinary** restart down there: same frame both sides, no rescale. It
  // passes the continuity leg at a gap of about 0.07% and must be refused by
  // the rescale leg alone. This is the case that made the live tool report
  // four candidate boundaries for `usdjpy-otc` before the second leg existed.
  const ordinary = boundary + 100_400;
  await record.append([
    { assetId: 'a', ticks: run(ordinary, ordinary + 99, (i) => 190 + i), frame: NEW },
  ]);
  // **A record built with this release's code already declares its frames**, so
  // a fixture that stopped here would test a case that cannot occur. The records
  // this subphase exists for were written by the *previous* release, which had
  // no frame log at all, so the log is cleared to get there.
  record.close();
  const strip = new DatabaseSync(file);
  strip.exec('DELETE FROM lattice');
  strip.close();
  return { record: new SqliteTickRecord(file), boundary, ordinary };
}

describe('a declaration is evidenced by the record or it is refused (PH-38.2)', () => {
  it('finds the relattice seam and not the ordinary one', async () => {
    const { record, boundary } = await recordWithBoundary();
    try {
      const verdict = await proposeDeclaration(record, 'a', OLD, NEW);
      expect(verdict.ok, 'the boundary is evidenced').toBe(true);
      if (!verdict.ok) return;
      expect(verdict.proposal.boundarySequence).toBe(boundary);
      expect(verdict.proposal.gapPercent).toBeLessThan(CONTINUITY_BAND_PERCENT);
      expect(verdict.proposal.rescale).toBeCloseTo(verdict.proposal.quantumRatio, 0);
      // The whole point, in two numbers: what the venue renders today, and what
      // was actually published.
      expect(verdict.proposal.renderedToday).toBeGreaterThan(verdict.proposal.published);
    } finally {
      record.close();
    }
  });

  it('refuses an ordinary seam whose prices sit near the reference — the usdjpy case', async () => {
    // The rescale leg exists for exactly this. With only continuity, three of
    // usdjpy-otc's ordinary restart seams passed at gaps of 0.08-0.09% on the
    // live record, because near the reference `exp(q x price)` is ~1 for any
    // quantum — and the tool reported four candidate boundaries and refused the
    // asset as ambiguous. The fixture's ordinary seam is down there on purpose.
    const { record, boundary } = await recordWithBoundary();
    try {
      const verdict = await proposeDeclaration(record, 'a', OLD, NEW);
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) return;
      // Exactly one candidate survived, and it is the rescaling one.
      expect(verdict.proposal.boundarySequence).toBe(boundary);
    } finally {
      record.close();
    }
  });

  it('refuses a frame wrong by a factor — the 2.58x the audit planted', async () => {
    const { record } = await recordWithBoundary();
    try {
      const wrong: PriceFrame = { ...OLD, logQuantum: OLD.logQuantum * 2.58 };
      const verdict = await proposeDeclaration(record, 'a', wrong, NEW);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.refusal).toMatch(/no seam/);
    } finally {
      record.close();
    }
  });

  it('states its own resolution: a frame wrong in its last bits is NOT refused', async () => {
    // Honest limit, written as a test so nobody reads more into the criterion
    // than it can carry. Continuity pins the quantum only to about
    // `band / (quantum x price)`, and the rescale leg to RESCALE_TOLERANCE, so
    // together they separate a right frame from a wrong-by-a-factor one and
    // from no-change-at-all — not from one wrong in the sixth decimal.
    //
    // What pins the VALUE exactly is a different guard: lattices.test.ts
    // compares LATTICE_BEFORE_PH37 against the previous tag's own catalogue.
    // The two compose, and neither alone is enough.
    const { record } = await recordWithBoundary();
    try {
      const almost: PriceFrame = { ...OLD, logQuantum: OLD.logQuantum * (1 + 1e-6) };
      const verdict = await proposeDeclaration(record, 'a', almost, NEW);
      expect(verdict.ok, 'accepted, and that is the documented resolution').toBe(true);
      expect(RESCALE_TOLERANCE).toBeGreaterThan(0);
    } finally {
      record.close();
    }
  });

  it('refuses a frame 10% wrong far from the reference, where the rescale leg alone would not', async () => {
    // The mirror of the usdjpy case, and the reason both legs are kept. The
    // rescale leg is a ratio, so its resolution does not depend on where the
    // price sits; the continuity leg is on the exponent, so it sharpens as
    // `quantum x price` grows. At `dogeusdt-otc` scale — the asset whose
    // rendering error is 1,483% — `quantum x price` is about 2.76, and a frame
    // 10% wrong moves the rendered price by 31.7% while leaving the integer
    // ratio 10% off, which RESCALE_TOLERANCE accepts.
    const file = path.join(await scratch(), 'record.db');
    const far = new SqliteTickRecord(file);
    const base = 8_800_000;
    await far.append([{ assetId: 'a', ticks: run(1, 5, (i) => base + i), frame: OLD }]);
    const boundary = 100_007;
    const rescaled = Math.round((base + 4) / RATIO);
    await far.append([
      { assetId: 'a', ticks: run(boundary, boundary + 4, (i) => rescaled + i), frame: NEW },
    ]);
    far.close();
    const strip = new DatabaseSync(file);
    strip.exec('DELETE FROM lattice');
    strip.close();

    const record = new SqliteTickRecord(file);
    try {
      expect((await proposeDeclaration(record, 'a', OLD, NEW)).ok, 'the right frame').toBe(true);
      const tenPercentOff: PriceFrame = { ...OLD, logQuantum: OLD.logQuantum * 1.1 };
      const verdict = await proposeDeclaration(record, 'a', tenPercentOff, NEW);
      expect(verdict.ok, 'refused, and only the continuity leg can refuse it').toBe(false);
    } finally {
      record.close();
    }
  });

  it('refuses an asset the release has no frame for, by name', async () => {
    const { record } = await recordWithBoundary();
    try {
      const verdict = await proposeDeclaration(record, 'a', null, NEW);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.refusal).toMatch(/no frame is recorded/);
    } finally {
      record.close();
    }
  });

  it('refuses an asset trimmed past its boundary, rather than declaring from the oldest tick', async () => {
    const { record, boundary } = await recordWithBoundary();
    try {
      await record.trim('a', 300);
      expect(await record.oldest('a')).toBeGreaterThan(boundary);
      const verdict = await proposeDeclaration(record, 'a', OLD, NEW);
      expect(verdict.ok, 'the range is gone; that is the expected steady state').toBe(false);
      if (verdict.ok) return;
      expect(verdict.refusal).toMatch(/no seam/);
    } finally {
      record.close();
    }
  });

  it('writes two epochs, and refuses a second declaration without replace', async () => {
    const { record, boundary } = await recordWithBoundary();
    try {
      const verdict = await proposeDeclaration(record, 'a', OLD, NEW);
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) return;
      const epochs = epochsOf(verdict.proposal);
      await record.declareLattice('a', epochs);
      const held = await record.frames('a');
      expect(held).toHaveLength(2);
      expect(held[1]!.fromSequence).toBe(boundary);
      // A tick below the boundary now reads on the frame it was published on.
      expect((await record.frameAt('a', boundary - 1))?.logQuantum).toBe(OLD.logQuantum);
      expect((await record.frameAt('a', boundary))?.logQuantum).toBe(NEW.logQuantum);
      await expect(record.declareLattice('a', epochs)).rejects.toThrow(/already has 2 declared/);
      await record.declareLattice('a', epochs, true);
      expect(await record.frames('a')).toHaveLength(2);
    } finally {
      record.close();
    }
  });

  it('refuses an out-of-order declaration and writes nothing', async () => {
    const { record } = await recordWithBoundary();
    try {
      const verdict = await proposeDeclaration(record, 'a', OLD, NEW);
      if (!verdict.ok) return;
      const [first, second] = epochsOf(verdict.proposal);
      await expect(record.declareLattice('a', [second, first])).rejects.toThrow(/not ordered/);
      expect(await record.frames('a')).toEqual([]);
    } finally {
      record.close();
    }
  });
});

describe('a window that has moved past the change is declared, not left null (PH-38.2)', () => {
  it('extends the declared frame back over a range that is entirely after the change', async () => {
    const { record, boundary } = await recordWithBoundary();
    try {
      // The steady state: the window has advanced past the boundary, so there
      // is no boundary seam left to find and the first pass refuses.
      await record.trim('a', 300);
      const oldest = (await record.oldest('a'))!;
      expect(oldest).toBeGreaterThan(boundary);
      expect((await proposeDeclaration(record, 'a', OLD, NEW)).ok).toBe(false);

      // What the running engine writes on its next append: one epoch at the
      // head, leaving everything below it undeclared and therefore null.
      const [head] = await record.since('a', oldest + 100, 1);
      await record.declareLattice('a', [
        { assetId: 'a', fromSequence: head!.sequence, fromInstant: head!.instant, ...NEW },
      ]);
      const [oldestTick] = await record.since('a', oldest, 1);
      const change = oldestTick!.instant - 1;

      const verdict = await proposeBackfill(record, 'a', change);
      expect(verdict.ok, 'the whole retained range postdates the change').toBe(true);
      if (!verdict.ok) return;
      expect(verdict.proposal.oldestSequence).toBe(oldest);
    } finally {
      record.close();
    }
  });

  it('refuses to extend over a range that predates the change', async () => {
    const { record, boundary } = await recordWithBoundary();
    try {
      const oldest = (await record.oldest('a'))!;
      await record.declareLattice('a', [
        { assetId: 'a', fromSequence: boundary, fromInstant: epochMillis(GENESIS), ...NEW },
      ]);
      const [oldestTick] = await record.since('a', oldest, 1);
      // A change AFTER the oldest tick: part of the range is on the other side
      // of it, so extending one frame over all of it would be a guess.
      const verdict = await proposeBackfill(record, 'a', oldestTick!.instant + 1);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.refusal).toMatch(/predates the change|at or before the/);
    } finally {
      record.close();
    }
  });
});

describe('inspecting a record never upgrades it (PH-38.2)', () => {
  it('leaves a version-2 file at version 2, and answers undeclared', async () => {
    const file = path.join(await scratch(), 'record.db');
    // A file as the previous release left it: the tick table, stamped 2.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE tick (
        asset_id TEXT NOT NULL, sequence INTEGER NOT NULL, instant INTEGER NOT NULL,
        price INTEGER NOT NULL, PRIMARY KEY (asset_id, sequence)
      ) WITHOUT ROWID
    `);
    old.exec(`
      CREATE TABLE seam (
        asset_id TEXT NOT NULL, last_sequence INTEGER NOT NULL, last_instant INTEGER NOT NULL,
        resumes_at_sequence INTEGER NOT NULL, resumes_at_instant INTEGER NOT NULL,
        PRIMARY KEY (asset_id, resumes_at_sequence)
      ) WITHOUT ROWID
    `);
    old.exec("INSERT INTO tick VALUES ('a', 1, 1776000000250, 8795)");
    old.exec('PRAGMA user_version = 2');
    old.close();

    const reader = new SqliteTickRecord(file, { readOnly: true });
    try {
      expect(await reader.frames('a'), 'no frame log, so nothing is declared').toEqual([]);
      expect(await reader.frameAt('a', 1)).toBeNull();
      expect(await reader.head('a')).toBe(1);
      // The hazard this guards: a v2.4.0 service holding this file would refuse
      // it on its next restart if an inspection had stamped it to 3.
      await expect(
        reader.declareLattice('a', [
          { assetId: 'a', fromSequence: 1, fromInstant: epochMillis(1), ...OLD },
        ]),
      ).rejects.toThrow(/opened read-only/);
    } finally {
      reader.close();
    }
    const after = new DatabaseSync(file);
    expect(Number(after.prepare('PRAGMA user_version').get()!['user_version'])).toBe(2);
    expect(
      after.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lattice'").get(),
    ).toBeUndefined();
    after.close();
  });
});

describe('a span that crosses a frame change counts in neither (PH-38.4)', () => {
  const epochs = [
    { assetId: 'a', fromSequence: 100, fromInstant: epochMillis(1000), ...NEW },
    { assetId: 'a', fromSequence: 500, fromInstant: epochMillis(5000), ...OLD },
    { assetId: 'a', fromSequence: 600, fromInstant: epochMillis(6000), ...NEW },
  ];

  it('refuses a span with a change inside it even when both ends agree', () => {
    // **The test that ends-comparison fails.** 400..700 begins and ends inside
    // a NEW-frame epoch, so comparing the two ends says "one frame" — but the
    // venue published under OLD for sequences 500..599 in the middle, so the
    // bar's open is in one unit and its high and low in another. Measured on a
    // live venue with the ends-only test in place: a 1h bar 5.16% away from the
    // tick the record holds at its own last sequence.
    expect(frameOfSpan(epochs, 400, 700, null)).toBeNull();
    // Both ends really do agree, or this test would pass for the wrong reason.
    expect(frameAtOrBefore(epochs, 400)?.logQuantum).toBe(NEW.logQuantum);
    expect(frameAtOrBefore(epochs, 700)?.logQuantum).toBe(NEW.logQuantum);
  });

  it('answers a span that sits inside one epoch', () => {
    expect(frameOfSpan(epochs, 520, 580, null)?.logQuantum).toBe(OLD.logQuantum);
    expect(frameOfSpan(epochs, 610, 700, null)?.logQuantum).toBe(NEW.logQuantum);
  });

  it('refuses a span below the earliest declaration rather than extending it down', () => {
    // The over-reach that put nineteen days of old-frame bars on today's
    // lattice: a store whose rows start below its first declared epoch.
    expect(frameOfSpan(epochs, 10, 50, null)).toBeNull();
  });

  it('falls back only when the log is empty', () => {
    expect(frameOfSpan([], 10, 50, NEW)?.logQuantum).toBe(NEW.logQuantum);
    expect(frameOfSpan([], 10, 50, null)).toBeNull();
  });
});

describe('dating candles against the record anchors each epoch at the BAR (PH-38.4)', () => {
  it('starts the epoch at the bar that changed frame, not at the record’s own boundary', async () => {
    const { record } = await recordWithBoundary();
    try {
      const verdict = await proposeDeclaration(record, 'a', OLD, NEW);
      if (!verdict.ok) return;
      await record.declareLattice('a', epochsOf(verdict.proposal));
      // A bar folded from ticks below the boundary, whose close equals the
      // record's own tick there: it is on the record's frame at that sequence.
      // Inside the OLD run (the fixture publishes 1..400 there), not just below
      // the boundary: `since` returns the first tick at or AFTER the sequence,
      // so asking near the boundary hands back the first NEW-frame tick.
      const [tick] = await record.since('a', 300, 1);
      const bar = { firstSequence: 260, lastSequence: tick!.sequence, close: tick!.price };
      const out = await dateCandlesAgainstRecord(record, 'a', [bar], [NEW, OLD]);
      expect(out.dated).toBe(1);
      // **The spread bug.** `frameAtOrBefore` returns a LatticeEpoch, which
      // extends PriceFrame, so `{...frame}` put the RECORD epoch's fromSequence
      // back over the bar's — the epoch was written at the record's boundary,
      // collided with an existing row and was dropped by INSERT OR IGNORE. The
      // types could not see it and the tool's own report looked right.
      expect(out.epochs[0]!.fromSequence).toBe(bar.firstSequence);
      expect(out.epochs[0]!.logQuantum).toBe(OLD.logQuantum);
    } finally {
      record.close();
    }
  });

  /**
   * **Cycle Audit 13, a8-01.** A bar whose minutes straddle the boundary has its
   * open on one lattice and its close on the other. Dating it by the close —
   * which is what `frameAtOrBefore(epochs, bar.lastSequence)` did — declared the
   * whole bar on the close's frame, and anchored the epoch at the bar's *first*
   * sequence, below the true boundary. The reader's crossing test could not see
   * it either: the span then sat inside one declared epoch.
   *
   * Measured on the live venue before the fix: 17 of 30 assets served a 1m bar
   * with a wick no tick ever printed, 2.3% to 73.0%.
   */
  it('refuses a bar whose minutes straddle the boundary, rather than dating it by its close', async () => {
    const { record, boundary } = await recordWithBoundary();
    try {
      const verdict = await proposeDeclaration(record, 'a', OLD, NEW);
      if (!verdict.ok) return;
      await record.declareLattice('a', epochsOf(verdict.proposal));
      // Open on the old lattice, close on the new one: exactly the bar the live
      // venue folded across the relattice.
      const [closing] = await record.since('a', boundary, 1);
      const bar = { firstSequence: 260, lastSequence: closing!.sequence, close: closing!.price };
      const out = await dateCandlesAgainstRecord(record, 'a', [bar], [NEW, OLD]);

      expect(out.dated, 'a bar with integers in two frames was given one').toBe(0);
      expect(out.undatable).toBe(1);
      expect(out.epochs, 'an epoch was anchored below the boundary it crosses').toEqual([]);
    } finally {
      record.close();
    }
  });
});
