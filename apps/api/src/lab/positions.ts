import {
  durationMillis,
  epochMillis,
  logPrice,
  priceAtOrBefore,
  type EpochMillis,
  type LogPrice,
  type Tick,
} from '@otc/core';
import { settle, type Contract, type Direction, type Outcome, type Settlement } from '@otc/trading';

/**
 * Simulated positions and the presets that decide how they end (PH-24.3).
 *
 * A Lab position is a `Contract` from `packages/trading` — the production
 * shape, unchanged — kept in the Lab process and settled by the production
 * `settle` against the Lab market's own record. There is no second settlement
 * rule here, which is the point: "expected" comes from what the Lab armed and
 * "actual" from what the engine published, and the two are shown side by side
 * because a disagreement would be a finding about the engine (O9, L5).
 *
 * A preset is a close like any other. "WIN by minimum distance" is one lattice
 * level from the entry in the winning direction — the lattice is the canonical
 * tick (ADR-0004), so there is no other size to use — and the close is applied
 * to the position's expiry instant through the same window, selection and
 * critical section as `close` (PH-24.2).
 */

export type Preset =
  'win-minimum' | 'loss-minimum' | 'tie' | 'entry-plus-tick' | 'entry-minus-tick' | 'exact-entry';

export const PRESETS: readonly Preset[] = [
  'win-minimum',
  'loss-minimum',
  'tie',
  'entry-plus-tick',
  'entry-minus-tick',
  'exact-entry',
];

export function isPreset(value: string): value is Preset {
  return (PRESETS as readonly string[]).includes(value);
}

/** The lattice level a preset asks the close to be at, from the entry level. */
export function presetLevel(preset: Preset, entry: LogPrice, direction: Direction): LogPrice {
  const up = direction === 'up' ? 1 : -1;
  switch (preset) {
    case 'win-minimum':
      return logPrice(entry + up);
    case 'loss-minimum':
      return logPrice(entry - up);
    case 'tie':
    case 'exact-entry':
      return entry;
    case 'entry-plus-tick':
      return logPrice(entry + 1);
    case 'entry-minus-tick':
      return logPrice(entry - 1);
  }
}

export interface LabPosition {
  readonly contract: Contract;
  /** The price in force at entry, read as settlement reads (ADR-0017). */
  readonly entryPrice: LogPrice;
  readonly expiryInstant: EpochMillis;
  readonly openedAt: EpochMillis;
}

export interface PositionRequest {
  readonly assetId: string;
  readonly direction: Direction;
  readonly stake: number;
  /** Milliseconds from entry to expiry. */
  readonly horizonMs: number;
  readonly payoutRatio?: number;
}

/** A `TickRecord` over the ticks a Lab feed retains, for `settle`. */
export function recordOf(ticks: readonly Tick[]): { instants: Float64Array; prices: Int32Array } {
  return {
    instants: Float64Array.from(ticks.map((t) => t.instant)),
    prices: Int32Array.from(ticks.map((t) => t.price)),
  };
}

/**
 * The Lab's open and settled positions for one process.
 *
 * Entry is the instant of opening, and the entry price is read from the record
 * with the rule settlement uses — so a position opened between two ticks has
 * the earlier tick's price, as it would on the venue.
 */
export class LabPositions {
  readonly #positions = new Map<string, LabPosition>();
  #next = 1;

  open(request: PositionRequest, now: EpochMillis, ticks: readonly Tick[]): LabPosition {
    if (!(request.stake > 0) || !Number.isFinite(request.stake)) {
      throw new RangeError(`stake must be positive and finite, received ${String(request.stake)}.`);
    }
    if (!Number.isSafeInteger(request.horizonMs) || request.horizonMs < 1_000) {
      throw new RangeError(
        `horizonMs must be at least 1000, received ${String(request.horizonMs)}.`,
      );
    }
    const record = recordOf(ticks);
    const entry = priceAtOrBefore(record.instants, record.prices, now);
    if (entry === null) {
      throw new RangeError(
        'No price is in force yet for this asset; open the position after a tick.',
      );
    }
    const id = `lab-${String(this.#next)}`;
    this.#next += 1;
    const contract: Contract = {
      id,
      assetId: request.assetId,
      direction: request.direction,
      stake: request.stake,
      entryInstant: now,
      horizonMs: durationMillis(request.horizonMs),
      payoutRatio: request.payoutRatio ?? 0.85,
    };
    const position: LabPosition = {
      contract,
      entryPrice: entry.price,
      expiryInstant: epochMillis(now + request.horizonMs),
      openedAt: now,
    };
    this.#positions.set(id, position);
    return position;
  }

  get(id: string): LabPosition | null {
    return this.#positions.get(id) ?? null;
  }

  list(assetId?: string): readonly LabPosition[] {
    const all = [...this.#positions.values()];
    return assetId === undefined ? all : all.filter((p) => p.contract.assetId === assetId);
  }

  /**
   * What a position will be, given a close at `level` — or, when nothing is
   * armed, at the price the market is at now. Says which.
   */
  static expected(
    position: LabPosition,
    closeLevel: LogPrice,
    basis: 'armed-target' | 'current-price',
  ): { outcome: Outcome; basis: 'armed-target' | 'current-price'; close: LogPrice } {
    const { direction } = position.contract;
    const outcome: Outcome =
      closeLevel === position.entryPrice
        ? 'refund'
        : closeLevel > position.entryPrice === (direction === 'up')
          ? 'win'
          : 'loss';
    return { outcome, basis, close: closeLevel };
  }

  /** The production settlement, against the Lab's record. Null until expiry has passed the record. */
  static actual(position: LabPosition, ticks: readonly Tick[]): Settlement | null {
    try {
      return settle(position.contract, recordOf(ticks));
    } catch {
      return null;
    }
  }
}
