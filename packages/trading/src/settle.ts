import { epochMillis, priceAtOrBefore, type EpochMillis } from '@otc/core';
import {
  assertContract,
  DEFAULT_AT_MONEY_POLICY,
  type AtMoneyPolicy,
  type Contract,
  type Outcome,
  type Settlement,
  payoutMinor,
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
/** A recorded discontinuity in the published record, as the runtime writes it. */
export interface RecordSeam {
  /** Instant of the last tick before the gap. */
  readonly lastInstant: number;
  /** Instant the record resumes at. */
  readonly resumesAtInstant: number;
  /**
   * Whether the lattice changed at this seam (ADR-0021).
   *
   * An ordinary seam — a restart, a deploy, a host that withheld the CPU — reopens
   * the market at the price it last published, on the same lattice, so the
   * integers either side of it count in the same unit and a contract across it
   * settles like any other. A seam that is also a **change of lattice** is a
   * release recalibrating the asset: the integers either side count in different
   * quanta, and comparing them would decide a contract by rounding. That is the
   * one seam settlement still refuses.
   *
   * Required, for Cycle Audit 12's reason: a caller that does not know must say
   * so by refusing to settle, not by leaving the field out and having silence read
   * as "no".
   */
  readonly reframes: boolean;
}

export interface TickRecord {
  readonly instants: Float64Array;
  readonly prices: Int32Array;
  /**
   * Discontinuities the record carries, if any.
   *
   * **Cycle Audit 5.** `spansSeam` was built in PH-14.3 with the docstring "the
   * settlement path needs to be able to ask", and then nothing asked: `settle`
   * used `priceAtOrBefore` with no seam awareness at all. An auditor produced a
   * real 93-second failover gap and a contract whose expiry landed inside it —
   * `priceAt` returned null for that instant while the contract settled as a
   * loss against the last pre-seam tick, for real money.
   *
   * **Required since Cycle Audit 12, and that is the fix.** It was optional
   * "so every existing caller keeps working", which made silence and "this
   * record has no seams" the same input. A caller that *has* seams and forgets
   * to pass them settles straight across one — and after PH-37 a seam can also
   * be a lattice change, so the two integers being compared are counted in
   * different quanta and the comparison is meaningless as well as unobserved.
   *
   * A deployment that keeps no seams passes `[]` and says so. Omitting it is
   * refused at runtime too, for a caller without types.
   */
  readonly seams: readonly RecordSeam[];
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
  // Silence is not an answer about discontinuities: a record that has none says
  // so with an empty array (Cycle Audit 12).
  if (record.seams === undefined) {
    throw new NotSettleableError(
      contract.id,
      'the record did not state its discontinuities: pass `seams: []` if this deployment ' +
        'keeps none, or the seams it holds. A contract settled across an unstated seam ' +
        'compares two prices nobody published together',
    );
  }
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
  // **A contract settles at its final millisecond, across any seam** (ADR-0021,
  // the Human Owner, 2026-09-26). This used to refuse every contract whose window
  // touched a seam — the fix for Cycle Audit 5's real-money defect — and a broker
  // turned that refusal into a refund. On a loaded host that was a fifth of all
  // 15-minute contracts. It also protected nothing: a seam reopens the market at
  // the price it last published (ADR-0020) on a fresh keystream (ADR-0019), so the
  // price in force at any instant inside it is a price every observer was shown,
  // the rule below is the same one that applies in any quiet stretch between
  // ticks, and P(up) = P(down) after it exactly as before. What Cycle Audit 5 saw
  // was a record that said nothing about its seams; that is still refused above.
  //
  // The one seam that still refuses is a change of lattice, because there the two
  // integers count in different units and the comparison would be rounding, not
  // market. A release must never make one with contracts in flight; this exists
  // to make that operator error loud.
  const crossed = record.seams.filter(
    (seam) => contract.entryInstant < seam.resumesAtInstant && expiryInstant > seam.lastInstant,
  );
  for (const seam of crossed) {
    if (typeof seam.reframes !== 'boolean') {
      throw new NotSettleableError(
        contract.id,
        `the seam ${seam.lastInstant}..${seam.resumesAtInstant} does not say whether the lattice ` +
          `changed there, and settling across a lattice change compares two different units`,
      );
    }
    if (seam.reframes) {
      throw new NotSettleableError(
        contract.id,
        `the window ${contract.entryInstant}..${expiryInstant} crosses a change of lattice at ` +
          `${seam.resumesAtInstant}: the entry and expiry integers count in different quanta, so ` +
          `comparing them would decide the contract by rounding. A release must never change a ` +
          `lattice with contracts in flight (ADR-0021)`,
      );
    }
  }

  const expiry = priceAtOrBefore(record.instants, record.prices, expiryInstant);
  if (expiry === null) {
    throw new NotSettleableError(contract.id, 'no price in force at expiry');
  }

  const outcome = resolve(contract.direction, entry.price, expiry.price, policy);
  // Exact, in the stake's minor unit (PH-29.4, Issue #11): the audit measured
  // 124 of 100 000 cent stakes disagreeing with exact arithmetic under the
  // floating-point `stake × (1 + payout)` this replaced.
  const returned =
    outcome === 'win'
      ? contract.stake + payoutMinor(contract.stake, contract.payoutRatio)
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
    seamsCrossed: crossed.length,
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
