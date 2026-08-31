import { epochMillis, priceAtOrBefore, type EpochMillis } from '@otc/core';
import {
  assertContract,
  DEFAULT_AT_MONEY_POLICY,
  type AtMoneyPolicy,
  type Contract,
  type Outcome,
  type Settlement,
} from './contract.js';

/**
 * The published record a settlement is computed against.
 *
 * Deliberately not an engine, a keyring or a runtime — just the ticks. Anyone
 * holding the published series can recompute any outcome and get the same
 * answer, which is what INV-009 asks for. A settlement that had to re-run the
 * engine would require the master secret, and every dispute would become a
 * matter of trust.
 */
export interface TickRecord {
  readonly instants: Float64Array;
  readonly prices: Int32Array;
}

export class NotSettleableError extends Error {
  constructor(
    readonly contractId: string,
    readonly detail: string,
  ) {
    super(`Contract ${contractId} cannot be settled: ${detail}`);
    this.name = 'NotSettleableError';
  }
}

/**
 * Settle one contract against the record.
 *
 * Both the entry and the expiry use `priceAtOrBefore` — the price in force at an
 * instant is the last tick at or before it. That is the same rule the charts
 * draw, the same rule the attack battery samples, and the same rule
 * `query.ts` reserved for this phase, so that what was attacked and what settles
 * are the same quantity. One rule, everywhere, is worth more here than any
 * refinement: a settlement rule that differs from the sampling rule would mean
 * the battery had been clearing a market nobody trades.
 */
export function settle(
  contract: Contract,
  record: TickRecord,
  policy: AtMoneyPolicy = DEFAULT_AT_MONEY_POLICY,
): Settlement {
  assertContract(contract);
  const expiryInstant = epochMillis(contract.entryInstant + contract.horizonMs);

  const entry = priceAtOrBefore(record.instants, record.prices, contract.entryInstant);
  if (entry === null) {
    throw new NotSettleableError(contract.id, 'the record starts after the entry instant');
  }
  const last = record.instants[Math.min(record.instants.length, record.prices.length) - 1];
  if (last === undefined || expiryInstant > last) {
    // Refusing is the point. A contract whose expiry is past the end of the
    // record has not expired yet, and guessing would invent an outcome.
    throw new NotSettleableError(
      contract.id,
      `expiry ${expiryInstant} is beyond the record, which ends at ${String(last)}`,
    );
  }
  const expiry = priceAtOrBefore(record.instants, record.prices, expiryInstant);
  if (expiry === null) {
    throw new NotSettleableError(contract.id, 'no price in force at expiry');
  }

  const outcome = resolve(contract.direction, entry.price, expiry.price, policy);
  const returned =
    outcome === 'win'
      ? contract.stake * (1 + contract.payoutRatio)
      : outcome === 'refund'
        ? contract.stake
        : 0;

  return {
    contractId: contract.id,
    outcome,
    entryPrice: entry.price,
    expiryPrice: expiry.price,
    entryIndex: entry.index,
    expiryIndex: expiry.index,
    expiryInstant,
    returned,
    net: returned - contract.stake,
  };
}

function resolve(
  direction: Contract['direction'],
  entryPrice: number,
  expiryPrice: number,
  policy: AtMoneyPolicy,
): Outcome {
  if (expiryPrice === entryPrice) {
    // Not an edge case: PH-4.2 calibrates each asset's lattice so about 1% of
    // 30-second contracts land here.
    return policy === 'refund' ? 'refund' : policy;
  }
  const moved = expiryPrice > entryPrice ? 'up' : 'down';
  return moved === direction ? 'win' : 'loss';
}

/** Aggregate economics over many settlements. */
export interface Ledger {
  readonly contracts: number;
  readonly wins: number;
  readonly losses: number;
  readonly refunds: number;
  readonly staked: number;
  readonly returned: number;
  /** Operator margin as a fraction of everything staked. */
  readonly operatorMargin: number;
  /** Fraction of decided (non-refunded) contracts the trader won. */
  readonly winRateOfDecided: number;
}

export function tally(settlements: readonly Settlement[], stakes: readonly number[]): Ledger {
  if (settlements.length !== stakes.length) {
    throw new RangeError(
      `Need one stake per settlement: ${settlements.length} settlements, ${stakes.length} stakes.`,
    );
  }
  let wins = 0;
  let losses = 0;
  let refunds = 0;
  let staked = 0;
  let returned = 0;
  settlements.forEach((settlement, index) => {
    if (settlement.outcome === 'win') wins += 1;
    else if (settlement.outcome === 'loss') losses += 1;
    else refunds += 1;
    staked += stakes[index]!;
    returned += settlement.returned;
  });
  const decided = wins + losses;
  return {
    contracts: settlements.length,
    wins,
    losses,
    refunds,
    staked,
    returned,
    operatorMargin: staked === 0 ? 0 : (staked - returned) / staked,
    winRateOfDecided: decided === 0 ? 0 : wins / decided,
  };
}

/** Instant a contract expires at. */
export function expiryOf(contract: Contract): EpochMillis {
  return epochMillis(contract.entryInstant + contract.horizonMs);
}
