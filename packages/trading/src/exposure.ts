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
  /**
   * The identity this group was formed under.
   *
   * Published because {@link EventExposure.event} is the *first* contract of the
   * group, carrying its raw instants — while the grouping happens on the
   * resolved ones. Comparing the two is how Cycle Audit 6's first fix for A6-04
   * silently admitted all 200 contracts again: the limiter looked for an event
   * whose raw entry equalled a resolved instant, found none, and concluded there
   * was nothing to cap.
   */
  readonly key: string;
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
  /** The operator's profit on this event if the market rises. */
  readonly onRise: number;
  /** The operator's profit if it falls. The distance between them is the swing. */
  readonly onFall: number;
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

/**
 * Resolves a submitted instant to the tick the record actually settles against.
 *
 * **Cycle Audit 5, CA5-09.** Events were keyed on the raw `entryInstant`, but
 * `settle` resolves entries with `priceAtOrBefore` — so every contract inside
 * one tick interval is the *same comparison*. Measured median tick spacing on
 * `eurusd` is 1.1 seconds. Two hundred contracts entered one millisecond apart
 * inside an 11.4-second gap produced one entry tick, one expiry tick and one
 * outcome, and were reported as **200 effective bets**, accepted in full by the
 * limiter at a peak of 99 against a limit of 500 — while the true
 * single-comparison obligation was 39.6× the limit. The identical book without
 * jitter was capped at five contracts.
 *
 * Reporting 200 where the truth is 1 is precisely the number PH-13 exists to
 * produce, so a venue must supply this. It is optional only because a book
 * assessed without a record cannot resolve anything, and refusing outright would
 * make the model unusable in exactly the offline analyses it was built for.
 */
export type EntryResolver = (assetId: string, instant: number) => number;

/** The identity a contract settles under: asset, entry event, expiry event. */
export function eventKey(contract: Contract, resolve?: EntryResolver): string {
  const entry = resolve ? resolve(contract.assetId, contract.entryInstant) : contract.entryInstant;
  const expiry = resolve
    ? resolve(contract.assetId, contract.entryInstant + contract.horizonMs)
    : contract.entryInstant + contract.horizonMs;
  return `${contract.assetId}|${entry}|${expiry}`;
}

/** Group a book into settlement events and net the exposure within each. */
export function exposureByEvent(
  contracts: readonly Contract[],
  resolve?: EntryResolver,
): EventExposure[] {
  const groups = new Map<
    string,
    { event: SettlementEvent; call: number; put: number; onRise: number; onFall: number }
  >();
  for (const contract of contracts) {
    if (!(contract.stake > 0) || !Number.isFinite(contract.stake)) {
      throw new RangeError(`Stake must be finite and positive, received ${contract.stake}.`);
    }
    const key = eventKey(contract, resolve);
    const existing = groups.get(key) ?? {
      event: {
        assetId: contract.assetId,
        entryInstant: contract.entryInstant,
        expiryInstant: contract.entryInstant + contract.horizonMs,
      },
      call: 0,
      put: 0,
      onRise: 0,
      onFall: 0,
    };
    // Exposure is the operator's payout obligation, not the stake: a winning
    // contract costs `stake * payoutRatio` and a losing one earns `stake`.
    const obligation = contract.stake * contract.payoutRatio;
    if (contract.direction === 'up') existing.call += obligation;
    else existing.put += obligation;

    // The operator's actual profit under each resolution, accumulated directly.
    //
    // **Cycle Audit 5, CA5-08.** Variance was computed as `(netExposure/2)²`
    // on the premise, stated in a comment, that "the operator's outcome on an
    // event swings by `net` between the two resolutions". It does not. An up
    // contract costs `stake·r` when the market rises and earns `stake` when it
    // falls, so the swing is `|C−P|·(1+r)` while `netExposure` is `r·|C−P|` —
    // short by a factor of `(1+r)/r`, which is **2.01× at the 99% payout**, in
    // the dangerous direction, on the operator's headline spread number.
    //
    // Accumulating both outcomes is also the only form that survives mixed
    // payout ratios within one event: `C` and `P` cannot be recovered from the
    // obligations once the ratios differ.
    if (contract.direction === 'up') {
      existing.onRise -= obligation;
      existing.onFall += contract.stake;
    } else {
      existing.onRise += contract.stake;
      existing.onFall -= obligation;
    }
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([key, { event, call, put, onRise, onFall }]) => ({
    key,
    event,
    callStake: call,
    putStake: put,
    netExposure: Math.abs(call - put),
    adverseDirection: call === put ? null : call > put ? 'up' : 'down',
    onRise,
    onFall,
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
export function assessBookRisk(contracts: readonly Contract[], resolve?: EntryResolver): BookRisk {
  const events = exposureByEvent(contracts, resolve);
  const totalStaked = contracts.reduce((sum, c) => sum + c.stake, 0);

  // Per contract the operator expects `stake · (1 − payoutRatio) / 2` at a fair
  // coin: it keeps the stake half the time and pays `stake · payoutRatio` the
  // other half.
  // The mean of the two resolutions, per event. Equivalent to the per-contract
  // form for a uniform payout ratio, and correct when they differ.
  const expectedProfit = events.reduce((sum, e) => sum + (e.onRise + e.onFall) / 2, 0);

  // Each event is one fair coin between its two resolutions, so its variance is
  // `(swing/2)²` where the swing is the distance between them.
  //
  // **Cycle Audit 5, CA5-08.** This used `netExposure`, which is the payout
  // obligation `r·|C−P|` and not the swing `|C−P|·(1+r)` — understating the
  // spread by `(1+r)/r`, 2.01× at the product's payout. The module was
  // internally inconsistent about it: `expectedProfit` already knew the two
  // resolutions were different sizes, and `ruin.ts` states them separately.
  //
  // The test that should have caught it simulated the model's own
  // `netExposure/2` rather than settling contracts — it validated the model
  // against itself.
  //
  // Explicit multiplication, not `**`: the exponent operator is
  // implementation-approximated and the guardrail bans it in code that must
  // reproduce across machines.
  const variance = events.reduce((sum, e) => {
    const half = (e.onRise - e.onFall) / 2;
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
