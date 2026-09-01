import type { Contract } from './contract.js';

/**
 * What the operator actually stands to lose on a book.
 *
 * ## The unit of risk is the settlement event, not the contract
 *
 * A contract resolves on `sign(expiry − entry)` over an integer lattice. Two
 * contracts sharing `(assetId, entryInstant, expiryInstant)` resolve on
 * **exactly the same comparison** — one Bernoulli draw, not two.
 *
 * So a thousand CALL contracts on `eurusd` all opening at 12:00:00 and expiring
 * at 12:00:30 carry the variance of **one** bet at a thousand times the stake.
 * The operator's edge over them is 0.2513pp of a thousand stakes, with none of
 * the `√1000` dilution that independence would give.
 *
 * `economics.ts` reasons per trade and cannot see this. It is the difference
 * between a venue that is safe and one that is one crowded expiry away from
 * ruin, and until PH-13 the project had no way to state it.
 *
 * ## Why the grouping is sound rather than convenient
 *
 * Across **assets**, independence is structural: ADR-0002 derives every stream
 * under a per-asset key, so two assets share no randomness at all.
 *
 * Across **disjoint windows** of one asset, it follows from ADR-0003 — the sign
 * of each tick is an independent fair coin, so two non-overlapping comparisons
 * share no sign draw.
 *
 * Overlapping windows on one asset are **not** independent and this module does
 * not pretend they are; see {@link BookRisk.overlappingEvents}.
 *
 * ## This module is on the far side of the boundary
 *
 * Exposure is economic state. `@otc/engine` must never learn that it exists, and
 * nothing here may be reachable from the price path. `@otc/trading` depends on
 * `@otc/core` only, and the guardrail suite scans the engine for exactly this
 * vocabulary.
 */

/** A settlement event: one price comparison that many contracts may share. */
export interface SettlementEvent {
  readonly assetId: string;
  readonly entryInstant: number;
  readonly expiryInstant: number;
}

export interface EventExposure {
  readonly event: SettlementEvent;
  /** Stake on the market rising. */
  readonly callStake: number;
  readonly putStake: number;
  /**
   * What the operator loses if this event resolves the worse way.
   *
   * Netted: a CALL and a PUT of equal stake cancel **exactly**, because one pays
   * when the other does not. That is why total staked is the wrong risk number
   * and a two-sided book is safe where a one-sided book is not.
   */
  readonly netExposure: number;
  /** The direction that costs the operator, or null when perfectly hedged. */
  readonly adverseDirection: 'up' | 'down' | null;
}

export interface BookRisk {
  readonly contracts: number;
  readonly events: number;
  readonly totalStaked: number;
  /** Payout margin times total stake. The edge, and nothing else. */
  readonly expectedProfit: number;
  readonly standardDeviation: number;
  /**
   * `(Σ|net|)² / Σ(net²)` — the inverse participation ratio.
   *
   * `n` when `n` events carry equal exposure, `1` when one carries everything.
   * "A thousand traders is still one bet", as a number.
   */
  readonly effectiveBets: number;
  /**
   * Every event resolving against the operator.
   *
   * Not a tail estimate — an arithmetic fact, and finite. A venue that cannot
   * survive it is not solvent whatever its expectation says.
   */
  readonly worstCase: number;
  /**
   * Events whose windows overlap another on the same asset.
   *
   * Their outcomes are correlated and the independence this model assumes across
   * events does not hold for them. Reported rather than silently folded in,
   * because a risk number that hides its own assumption is worse than none.
   */
  readonly overlappingEvents: number;
}

function eventKey(contract: Contract): string {
  return `${contract.assetId}|${contract.entryInstant}|${contract.entryInstant + contract.horizonMs}`;
}

/** Group a book into settlement events and net the exposure within each. */
export function exposureByEvent(contracts: readonly Contract[]): EventExposure[] {
  const groups = new Map<string, { event: SettlementEvent; call: number; put: number }>();
  for (const contract of contracts) {
    if (!(contract.stake > 0) || !Number.isFinite(contract.stake)) {
      throw new RangeError(`Stake must be finite and positive, received ${contract.stake}.`);
    }
    const key = eventKey(contract);
    const existing = groups.get(key) ?? {
      event: {
        assetId: contract.assetId,
        entryInstant: contract.entryInstant,
        expiryInstant: contract.entryInstant + contract.horizonMs,
      },
      call: 0,
      put: 0,
    };
    // Exposure is the operator's payout obligation, not the stake: a winning
    // contract costs `stake * payoutRatio` and a losing one earns `stake`.
    const obligation = contract.stake * contract.payoutRatio;
    if (contract.direction === 'up') existing.call += obligation;
    else existing.put += obligation;
    groups.set(key, existing);
  }

  return [...groups.values()].map(({ event, call, put }) => ({
    event,
    callStake: call,
    putStake: put,
    netExposure: Math.abs(call - put),
    adverseDirection: call === put ? null : call > put ? 'up' : 'down',
  }));
}

/** Count events whose windows overlap another on the same asset. */
function countOverlaps(events: readonly EventExposure[]): number {
  const byAsset = new Map<string, SettlementEvent[]>();
  for (const { event } of events) {
    byAsset.set(event.assetId, [...(byAsset.get(event.assetId) ?? []), event]);
  }
  let overlapping = 0;
  for (const list of byAsset.values()) {
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]!;
      const collides = list.some(
        (b, j) => j !== i && a.entryInstant < b.expiryInstant && b.entryInstant < a.expiryInstant,
      );
      if (collides) overlapping += 1;
    }
  }
  return overlapping;
}

/**
 * The operator's risk over a book.
 *
 * The mean is the house edge and is never in doubt — ADR-0003 makes it exact.
 * Everything else here is about the spread around it, which is the part that
 * decides whether a venue survives.
 */
export function assessBookRisk(contracts: readonly Contract[]): BookRisk {
  const events = exposureByEvent(contracts);
  const totalStaked = contracts.reduce((sum, c) => sum + c.stake, 0);

  // Per contract the operator expects `stake · (1 − payoutRatio) / 2` at a fair
  // coin: it keeps the stake half the time and pays `stake · payoutRatio` the
  // other half.
  const expectedProfit = contracts.reduce((sum, c) => sum + (c.stake * (1 - c.payoutRatio)) / 2, 0);

  // Each event is one fair coin over its netted exposure, so its variance is
  // `(net/2)²·... ` — more directly, the operator's outcome on an event swings by
  // `net` between the two resolutions, giving variance `(net/2)²`.
  // Explicit multiplication, not `**`: the exponent operator is
  // implementation-approximated and the guardrail bans it in code that must
  // reproduce across machines.
  const variance = events.reduce((sum, e) => {
    const half = e.netExposure / 2;
    return sum + half * half;
  }, 0);
  const absoluteSum = events.reduce((sum, e) => sum + e.netExposure, 0);
  const squareSum = events.reduce((sum, e) => sum + e.netExposure * e.netExposure, 0);

  return {
    contracts: contracts.length,
    events: events.length,
    totalStaked,
    expectedProfit,
    standardDeviation: Math.sqrt(variance),
    effectiveBets: squareSum === 0 ? 0 : (absoluteSum * absoluteSum) / squareSum,
    worstCase: events.reduce((sum, e) => sum + e.netExposure, 0),
    overlappingEvents: countOverlaps(events),
  };
}
