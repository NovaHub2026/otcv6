import {
  durationMillis,
  epochMillis,
  logPrice,
  priceAtOrBefore,
  type EpochMillis,
  type LogPrice,
  type Tick,
} from '@otc/core';
import {
  NotSettleableError,
  settle,
  type Contract,
  type Direction,
  type Outcome,
  type Settlement,
} from '@otc/trading';

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

/**
 * A settlement, or the reason there is not one yet. `reason` is `settle`'s own
 * wording, so the panel shows what refused rather than a Lab paraphrase of it.
 */
export type SettlementStatus =
  | { readonly kind: 'settled'; readonly settlement: Settlement }
  | { readonly kind: 'pending'; readonly reason: string }
  | { readonly kind: 'evicted'; readonly reason: string };

export interface LabPosition {
  readonly contract: Contract;
  /** The price in force at entry, read as settlement reads (ADR-0017). */
  readonly entryPrice: LogPrice;
  readonly expiryInstant: EpochMillis;
  /** The clock's reading when the operator opened it; see {@link LabPositions.open}. */
  readonly openedAt: EpochMillis;
}

/**
 * The Lab read one entry price and `settle` later read another for the same
 * contract (PH-30 / Cycle Audit 10).
 *
 * Named rather than shown, because the panel's own words for it — "esperado
 * gana … real empate … NO COINCIDE" — describe an engine that disagreed with
 * the Lab, and this is the one cause that is neither: the entry the row
 * displays is simply not the entry the settlement used. It cost a hosted
 * Statistical Gate a red run that a green local gate could not explain.
 */
export class EntryPriceDisagreementError extends Error {
  constructor(
    readonly contractId: string,
    readonly shown: LogPrice,
    readonly settled: LogPrice,
    readonly entryInstant: EpochMillis,
  ) {
    super(
      `Position ${contractId} was opened at level ${String(shown)} but settles from level ` +
        `${String(settled)} at the same entry instant ${String(entryInstant)}: the record gained ` +
        `a tick at or before the entry after the position was opened, so every expectation the ` +
        `Lab computed from ${String(shown)} — presets included — is about a different contract.`,
    );
    this.name = 'EntryPriceDisagreementError';
  }
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

  /**
   * Open a position, entered at an instant the published record is final for.
   *
   * `nextTickInstant` is the instant of the tick this market has drawn and not
   * yet published, or null when it has none. It is what makes the entry price
   * stable, and the reason is the whole of PH-30's hosted red run:
   *
   * The entry price here and the entry price `settle` computes are two reads of
   * the same rule (`priceAtOrBefore` at `contract.entryInstant`) against a
   * record that is **not** the same at the two moments. The clock passes the
   * pending tick's instant before the scheduler pass that publishes it, so a
   * position opened in that window stores the previous tick's price while the
   * record acquires, seconds later, a tick at or before its entry instant. The
   * preset then arms `entry ± 1` from a price that no longer is the entry, the
   * close lands exactly there, and settlement — reading the *newer* entry —
   * calls it a tie. The screen shows «esperado gana … real empate … NO
   * COINCIDE» and nothing about it is a flake.
   *
   * So the entry is pinned to the last instant the published record can still
   * speak for: the millisecond before the next tick, when the clock has already
   * passed it. Ticks are only ever appended after the pending one, so no later
   * publication can change what was in force then. When the market is up to
   * date — every ordinary open — `nextTickInstant` is in the future and the
   * entry is `now`, unchanged.
   *
   * The caller must read `now`, the record and `nextTickInstant` in one
   * critical section (`VenueService.betweenAdvances`), or an advance can
   * publish between the three reads and hand back a record that is behind a
   * `nextTickInstant` already drawn past it.
   */
  open(
    request: PositionRequest,
    now: EpochMillis,
    ticks: readonly Tick[],
    nextTickInstant: EpochMillis | null,
  ): LabPosition {
    // A whole number in the broker's minor unit, as `settle()` requires since
    // PH-29.4 (Issue #11); the Lab's positions settle through the same library.
    if (!Number.isSafeInteger(request.stake) || request.stake <= 0) {
      throw new RangeError(
        `stake must be a positive whole number of minor units, received ${String(request.stake)}.`,
      );
    }
    if (!Number.isSafeInteger(request.horizonMs) || request.horizonMs < 1_000) {
      throw new RangeError(
        `horizonMs must be at least 1000, received ${String(request.horizonMs)}.`,
      );
    }
    const record = recordOf(ticks);
    const entryInstant =
      nextTickInstant !== null && nextTickInstant <= now ? epochMillis(nextTickInstant - 1) : now;
    const entry = priceAtOrBefore(record.instants, record.prices, entryInstant);
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
      entryInstant,
      horizonMs: durationMillis(request.horizonMs),
      payoutRatio: request.payoutRatio ?? 0.85,
    };
    const position: LabPosition = {
      contract,
      entryPrice: entry.price,
      expiryInstant: epochMillis(entryInstant + request.horizonMs),
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

  /**
   * The production settlement, against the Lab's record, or why there is none.
   *
   * Two refusals are ordinary and neither is the other: `pending` is a position
   * whose expiry the record has not reached, and `evicted` is one whose entry
   * the retained window no longer covers — the second will never settle and the
   * first will. Anything else `settle` refuses is a disagreement between what
   * the Lab armed and what the engine published, which is a finding about the
   * engine (O9, L5) and is raised rather than reported as a status: a bare
   * `catch { return null }` read a malformed record, an out-of-range instant and
   * a genuine disagreement as "not expired yet" (Cycle Audit 8, a8).
   *
   * The guard on the entry price belongs to the same rule. `settle` recomputes
   * the entry from the record, so a settlement whose `entryPrice` is not the
   * one the position was opened at means the record changed underneath a
   * position — the one disagreement the "COINCIDE / NO COINCIDE" column cannot
   * express, because both of its sides are then talking about different
   * contracts. It is raised by name rather than rendered as a mismatched
   * outcome (PH-30 / Cycle Audit 10).
   */
  static status(position: LabPosition, ticks: readonly Tick[]): SettlementStatus {
    const record = recordOf(ticks);
    let settlement: Settlement;
    try {
      settlement = settle(position.contract, record);
    } catch (error) {
      if (error instanceof NotSettleableError) {
        const last = record.instants[record.instants.length - 1];
        if (last === undefined || position.expiryInstant > last) {
          return { kind: 'pending', reason: error.detail };
        }
        const first = record.instants[0];
        if (first === undefined || first > position.contract.entryInstant) {
          return { kind: 'evicted', reason: error.detail };
        }
      }
      throw error;
    }
    if (settlement.entryPrice !== position.entryPrice) {
      throw new EntryPriceDisagreementError(
        position.contract.id,
        position.entryPrice,
        settlement.entryPrice,
        position.contract.entryInstant,
      );
    }
    return { kind: 'settled', settlement };
  }

  /** The settlement alone; null for either refusal, which {@link status} tells apart. */
  static actual(position: LabPosition, ticks: readonly Tick[]): Settlement | null {
    const status = LabPositions.status(position, ticks);
    return status.kind === 'settled' ? status.settlement : null;
  }
}
