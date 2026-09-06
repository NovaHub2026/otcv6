import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import {
  EntryPriceDisagreementError,
  LabPositions,
  presetLevel,
  PRESETS,
  recordOf,
  type LabPosition,
} from './positions.js';

/**
 * PH-24.3 §4: the presets, on the lattice, and a position's entry read as
 * settlement reads.
 */
const t0 = epochMillis(1_776_000_000_000);
const tick = (offset: number, sequence: number, price: number): Tick => ({
  instant: epochMillis(t0 + offset),
  sequence,
  price: logPrice(price),
});

describe('presets compute a lattice level from the entry (§41)', () => {
  const entry = logPrice(1000);
  it.each([
    ['win-minimum', 'up', 1001],
    ['win-minimum', 'down', 999],
    ['loss-minimum', 'up', 999],
    ['loss-minimum', 'down', 1001],
    ['tie', 'up', 1000],
    ['exact-entry', 'down', 1000],
    ['entry-plus-tick', 'down', 1001],
    ['entry-minus-tick', 'up', 999],
  ] as const)('%s for a %s position → %i', (preset, direction, level) => {
    expect(presetLevel(preset, entry, direction)).toBe(level);
  });

  it('names every preset the specification lists, and no other', () => {
    expect([...PRESETS].sort()).toEqual(
      [
        'entry-minus-tick',
        'entry-plus-tick',
        'exact-entry',
        'loss-minimum',
        'tie',
        'win-minimum',
      ].sort(),
    );
  });
});

describe('a simulated position', () => {
  const ticks = [tick(1_000, 1, 100), tick(4_000, 2, 105), tick(9_000, 3, 103)];

  it('takes its entry price as the price in force at opening (ADR-0017)', () => {
    const positions = new LabPositions();
    // Opened between the second and third tick: the second is in force.
    const position = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
      null,
    );
    expect(position.entryPrice).toBe(105);
    expect(position.expiryInstant).toBe(t0 + 66_000);
    expect(position.contract.id).toBe('lab-1');
  });

  it('several coexist, and several may share an expiry (O6, O7)', () => {
    const positions = new LabPositions();
    const a = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
      null,
    );
    const b = positions.open(
      { assetId: 'eurusd', direction: 'down', stake: 20, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
      null,
    );
    expect(a.expiryInstant).toBe(b.expiryInstant);
    expect(positions.list('eurusd')).toHaveLength(2);
    expect(positions.list('btcusd')).toHaveLength(0);
  });

  it('refuses to open before any price is in force, and refuses nonsense', () => {
    const positions = new LabPositions();
    expect(() =>
      positions.open(
        { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
        epochMillis(t0),
        ticks,
        null,
      ),
    ).toThrow(RangeError);
    expect(() =>
      positions.open(
        { assetId: 'eurusd', direction: 'up', stake: 0, horizonMs: 60_000 },
        epochMillis(t0 + 6_000),
        ticks,
        null,
      ),
    ).toThrow(RangeError);
    expect(() =>
      positions.open(
        { assetId: 'eurusd', direction: 'up', stake: 1, horizonMs: 10 },
        epochMillis(t0 + 6_000),
        ticks,
        null,
      ),
    ).toThrow(RangeError);
  });

  it('expects win, loss or refund from a close level, and says what the expectation rests on', () => {
    const positions = new LabPositions();
    const call = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
      null,
    );
    expect(LabPositions.expected(call, logPrice(106), 'armed-target')).toMatchObject({
      outcome: 'win',
      basis: 'armed-target',
    });
    expect(LabPositions.expected(call, logPrice(104), 'current-price')).toMatchObject({
      outcome: 'loss',
      basis: 'current-price',
    });
    expect(LabPositions.expected(call, logPrice(105), 'armed-target').outcome).toBe('refund');
  });

  it('settles with the production settle, against the record, only once the record covers expiry', () => {
    const positions = new LabPositions();
    const put = positions.open(
      { assetId: 'eurusd', direction: 'down', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
      null,
    );
    expect(LabPositions.actual(put, ticks)).toBeNull(); // record ends before expiry: refused, not guessed
    expect(LabPositions.status(put, ticks).kind).toBe('pending');
    const later = [...ticks, tick(65_000, 4, 101), tick(70_000, 5, 99)];
    const settlement = LabPositions.actual(put, later)!;
    expect(settlement.outcome).toBe('win'); // 101 < 105 for a put
    expect(settlement.expiryPrice).toBe(101);
    expect(recordOf(later).prices.length).toBe(5);
    expect(LabPositions.status(put, later)).toEqual({ kind: 'settled', settlement });
  });

  it('tells a position that is waiting from one whose entry the window no longer holds', () => {
    const positions = new LabPositions();
    const call = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
      null,
    );
    // The retained window has rolled past the entry: expiry is covered, the
    // entry is not. This position will never settle, and reporting it as "not
    // expired yet" would leave it on the panel for ever.
    const rolled = [tick(7_000, 4, 106), tick(65_000, 5, 101), tick(70_000, 6, 99)];
    const status = LabPositions.status(call, rolled);
    expect(status.kind).toBe('evicted');
    expect(status.kind === 'evicted' && status.reason).toMatch(/starts after the entry instant/);
    expect(LabPositions.actual(call, rolled)).toBeNull();
  });

  it('raises what settlement refuses for any other reason, instead of reading it as pending', () => {
    // A contract the production `settle` rejects outright — the shape of a
    // disagreement between the Lab and the engine. Swallowed, it was
    // indistinguishable from a position whose clock has not run out.
    const positions = new LabPositions();
    const sound = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_000),
      ticks,
      null,
    );
    const malformed: LabPosition = {
      ...sound,
      contract: { ...sound.contract, payoutRatio: Number.NaN },
    };
    const later = [...ticks, tick(65_000, 4, 101), tick(70_000, 5, 99)];
    expect(() => LabPositions.status(malformed, later)).toThrow(RangeError);
    expect(() => LabPositions.actual(malformed, later)).toThrow(RangeError);
  });
});

/**
 * PH-30 / Cycle Audit 10. The entry price the Lab stores and the entry price
 * `settle` recomputes are two reads of one rule against a record that grows
 * between them, and a tick that is already due but not yet published is the
 * gap. See {@link LabPositions.open}.
 */
describe("a position's entry survives the tick that was due and unpublished", () => {
  const ticks = [tick(1_000, 1, 100), tick(4_000, 2, 105)];
  const dueButUnpublished = tick(6_000, 3, 106);

  it('pins the entry to the last instant the published record is final for', () => {
    const positions = new LabPositions();
    // The clock is past the drawn tick at t0+6 000; the feed has not got it yet.
    const position = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_100),
      ticks,
      dueButUnpublished.instant,
    );
    expect(position.contract.entryInstant).toBe(t0 + 5_999);
    expect(position.expiryInstant).toBe(t0 + 65_999);
    expect(position.openedAt).toBe(t0 + 6_100);
    expect(position.entryPrice).toBe(105);
    // And now the pass runs. Without the pin the entry instant would be
    // t0+6 100, `settle` would read 106, and "win by minimum" — armed at
    // 105 + 1 = 106 from the stored entry — would settle as a tie.
    const later = [...ticks, dueButUnpublished, tick(70_000, 4, 106)];
    const settlement = LabPositions.actual(position, later)!;
    expect(settlement.entryPrice).toBe(position.entryPrice);
    expect(presetLevel('win-minimum', position.entryPrice, 'up')).toBe(106);
    expect(settlement.outcome).toBe('win');
  });

  it('leaves an up-to-date market alone: the entry is the instant of opening', () => {
    const positions = new LabPositions();
    const position = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 5_000),
      ticks,
      epochMillis(t0 + 6_000),
    );
    expect(position.contract.entryInstant).toBe(t0 + 5_000);
    expect(position.expiryInstant).toBe(t0 + 65_000);
  });

  it('names a settlement that disagrees with the entry it was opened at', () => {
    const positions = new LabPositions();
    const position = positions.open(
      { assetId: 'eurusd', direction: 'up', stake: 10, horizonMs: 60_000 },
      epochMillis(t0 + 6_100),
      ticks,
      null, // no pin: the shape of the defect, kept so the guard has something to catch
    );
    expect(position.entryPrice).toBe(105);
    const later = [...ticks, dueButUnpublished, tick(70_000, 4, 106)];
    // 106 was in force at t0+6 100 by the time the record was complete, so
    // `settle` reads an entry the row never showed. That is not an outcome
    // the "COINCIDE / NO COINCIDE" column can express: both sides would be
    // describing different contracts.
    expect(() => LabPositions.status(position, later)).toThrow(EntryPriceDisagreementError);
    expect(() => LabPositions.actual(position, later)).toThrow(
      /was opened at level 105 but settles from level 106/,
    );
  });
});
