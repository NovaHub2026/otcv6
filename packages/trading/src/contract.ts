import type { DurationMillis, EpochMillis, LogPrice } from '@otc/core';

/** Which way the trader says the price will go. */
export type Direction = 'up' | 'down';

/**
 * What happens when a contract expires exactly at its entry price.
 *
 * Decided by the Human Owner in ADR-0007: **refund**. The house edge is the
 * payout and nothing else. The alternatives stay implemented and tested because
 * a venue operating under different rules is a configuration change rather than
 * a fork — but `refund` is the default and the policy the product claims.
 */
export type AtMoneyPolicy = 'refund' | 'loss' | 'win';

export const DEFAULT_AT_MONEY_POLICY: AtMoneyPolicy = 'refund';

export interface Contract {
  readonly id: string;
  readonly assetId: string;
  readonly direction: Direction;
  /** Units of account. Who owns them is a PH-7 concern; this is a number. */
  readonly stake: number;
  readonly entryInstant: EpochMillis;
  readonly horizonMs: DurationMillis;
  /** Profit per unit staked on a win, e.g. 0.85 for an 85% payout. */
  readonly payoutRatio: number;
}

export type Outcome = 'win' | 'loss' | 'refund';

/**
 * A settled contract, with everything needed to check the result.
 *
 * The prices and the indices are recorded, not just the outcome. INV-009 asks
 * for a historical outcome to be *explainable*, and "you lost" is not an
 * explanation — "you entered at tick 41,209 at price -3,118 and expired at tick
 * 41,238 at price -3,140" is, and anyone holding the published ticks can check
 * it.
 */
export interface Settlement {
  readonly contractId: string;
  readonly outcome: Outcome;
  readonly entryPrice: LogPrice;
  readonly expiryPrice: LogPrice;
  readonly entryIndex: number;
  readonly expiryIndex: number;
  readonly expiryInstant: EpochMillis;
  /** Total returned to the trader: stake plus profit, the stake, or nothing. */
  readonly returned: number;
  /** Change in the trader's balance. Negative on a loss, zero on a refund. */
  readonly net: number;
}

export function assertContract(contract: Contract): void {
  if (!(contract.stake > 0) || !Number.isFinite(contract.stake)) {
    throw new RangeError(`Stake must be positive and finite, received ${contract.stake}.`);
  }
  if (!(contract.payoutRatio > 0) || !Number.isFinite(contract.payoutRatio)) {
    throw new RangeError(
      `Payout ratio must be positive and finite, received ${contract.payoutRatio}.`,
    );
  }
  if (!Number.isInteger(contract.horizonMs) || contract.horizonMs <= 0) {
    throw new RangeError(`Horizon must be a positive integer, received ${contract.horizonMs}.`);
  }
  if (contract.direction !== 'up' && contract.direction !== 'down') {
    throw new RangeError(`Unknown direction ${String(contract.direction)}.`);
  }
}
