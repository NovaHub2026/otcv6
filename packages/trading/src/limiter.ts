import type { Contract } from './contract.js';
import { eventKey, exposureByEvent, type EntryResolver, type EventExposure } from './exposure.js';

/**
 * Declines a trade that would put too much on one settlement event.
 *
 * ## The invariant this threatens
 *
 * Every cycle before this one could rely on a simple fact: **the venue had no
 * economic state to leak.** The engine could not observe positions because
 * positions existed nowhere it could reach.
 *
 * This module creates exactly such a quantity. Net exposure per event is, by
 * construction, the number that says which resolution costs the operator money.
 * A price path able to observe it could prefer the cheaper outcome, and INV-001
 * would be gone.
 *
 * ## Why the guarantee is behavioural, not lexical
 *
 * Cycle Audit 4 (M-4) showed the vocabulary scan being defeated by neutral
 * naming: a module-level channel in `core/market/`, written from `settle.ts`,
 * read into the engine through an alias table — naming no economic term at all.
 * Only the behavioural test caught it.
 *
 * So the guarantee here is the one PH-6 established and PH-7 extended: **a venue
 * enforcing limits produces a bit-identical tick stream to one that is not.**
 * `tools/sim/src/limiterBlindness.stat.test.ts` is that demonstration.
 *
 * ## Ordering is the safety argument
 *
 * The limiter sees a contract **before** it is accepted and a tick **after** it
 * has been produced. It never sits between the engine and the record — the same
 * shape PH-12.3 used for publication. That is what makes bit-identity the
 * available claim rather than a statistical comparison.
 *
 * ## A limit is a refusal, never an adjustment
 *
 * Too much on one event means the trade is **declined**, and the trader is told
 * why. The price does not move, the payout is not shaded, the tick is not
 * delayed. Each of those would be the operator's interest reaching the trader's
 * terms through a channel the product promises is blind, and each is a small,
 * reasonable-looking change of exactly the kind Cycle 1 recorded about the
 * leverage effect.
 */

export interface LimiterPolicy {
  /**
   * Largest net exposure permitted on one settlement event.
   *
   * Derived from `capacity()` in `@otc/lab` against a bankroll and a ruin
   * tolerance. It is a number, not a policy object, because the venue must not
   * need to understand where it came from.
   */
  readonly maxEventExposure: number;
}

export type Admission =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: string;
      readonly event: EventExposure['event'];
      readonly wouldBe: number;
      readonly limit: number;
    };

/**
 * Whether a contract may join an open book.
 *
 * Netting is respected on purpose: a contract on the *opposite* side of an event
 * that is already at its limit **reduces** net exposure and is accepted. A
 * limiter that refused it would push the book further from balance while
 * believing it was being careful.
 */
export function admit(
  open: readonly Contract[],
  incoming: Contract,
  policy: LimiterPolicy,
  /**
   * How an entry instant maps onto the settlement event it belongs to.
   *
   * **Cycle Audit 6, A6-04.** PH-16.3 threaded an `EntryResolver` through
   * `exposureByEvent`, `assessBookRisk` and `ExposureBook` and stopped there —
   * so this function, which is the one a venue calls to decide whether to take a
   * trade, still grouped by raw entry instant. Cycle Audit 5's construction was
   * rebuilt against it exactly: 200 contracts one millisecond apart, on a market
   * ticking every 11.4 seconds, are **one** settlement event and were counted as
   * 200. All 200 were admitted against a limit of 500 while the true single-event
   * net exposure reached 19,800 — **39.6x** — and `breaches` returned nothing.
   *
   * Optional, because a caller with no tick record to resolve against is honest
   * to have; but a caller that has one and does not pass it is measuring
   * something other than its own risk.
   */
  resolve?: EntryResolver,
): Admission {
  if (!(policy.maxEventExposure > 0)) {
    throw new RangeError(`maxEventExposure must be positive, received ${policy.maxEventExposure}.`);
  }
  const before = exposureByEvent(open, resolve);
  const after = exposureByEvent([...open, incoming], resolve);

  // Matched on the grouping key, not on the event's instants: the event carries
  // the *first* contract of its group and therefore that contract's raw entry,
  // while the grouping happens on resolved ones. Comparing the two is how the
  // first attempt at this fix admitted all 200 contracts again — it looked for
  // an event whose raw entry equalled a resolved instant, found none, and
  // concluded there was nothing to cap.
  const key = eventKey(incoming, resolve);
  const target = after.find((e) => e.key === key);
  if (target === undefined) return { accepted: true };

  if (target.netExposure <= policy.maxEventExposure) return { accepted: true };

  // Already over the limit, and this contract reduces it: accepting is strictly
  // safer than refusing.
  const previous = before.find((e) => e.key === target.key);
  if (previous !== undefined && target.netExposure < previous.netExposure) {
    return { accepted: true };
  }

  return {
    accepted: false,
    reason:
      `Net exposure on ${target.event.assetId} ` +
      `${target.event.entryInstant}→${target.event.expiryInstant} would reach ` +
      `${target.netExposure.toFixed(2)}, past the ${policy.maxEventExposure.toFixed(2)} limit. ` +
      `Contracts on the opposite side of this event are still accepted.`,
    event: target.event,
    wouldBe: target.netExposure,
    limit: policy.maxEventExposure,
  };
}

/** Events in an open book that are at or beyond the limit. */
export function breaches(
  open: readonly Contract[],
  policy: LimiterPolicy,
  resolve?: EntryResolver,
): EventExposure[] {
  return exposureByEvent(open, resolve).filter((e) => e.netExposure > policy.maxEventExposure);
}

/**
 * An open book that maintains its own per-event exposure.
 *
 * `admit` above recomputes the whole book on every call, which is O(n) per
 * admission and O(n²) over a session. That is fine for a fixed book and wrong
 * for a venue: a market ticking every 333 ms with thousands of open contracts
 * would spend its time re-deriving what it already knew.
 *
 * PH-13.3 found this the way performance defects should be found — a test that
 * could not finish. The stateless functions remain for one-off analysis; a
 * running venue uses this.
 *
 * It holds exposure and nothing else. No prices, no engine, no clock: the
 * quantity INV-001 protects lives here and cannot travel from here to the price
 * path, which is what `limiterBlindness.stat.test.ts` demonstrates by comparing
 * bytes.
 */
export class ExposureBook {
  readonly #resolve: EntryResolver | undefined;

  /**
   * A book that knows which tick an entry resolves to, or one that does not.
   *
   * Without a resolver, sub-tick jitter splits one comparison into many events
   * and the book under-reports concentration (Cycle Audit 5, CA5-09). A venue
   * has the record and must pass one.
   */
  constructor(resolve?: EntryResolver) {
    this.#resolve = resolve;
  }

  readonly #call = new Map<string, number>();
  readonly #put = new Map<string, number>();
  #contracts = 0;

  /**
   * The settlement event a contract belongs to.
   *
   * **Cycle Audit 5, CA5-09.** Keyed on the raw instant, one millisecond of
   * entry jitter split a single comparison into two hundred "events" and let a
   * book through at 39.6× its limit. With a resolver the key is the tick the
   * record settles against, which is what makes two contracts the same bet.
   */
  static keyOf(contract: Contract, resolve?: EntryResolver): string {
    const entry = resolve
      ? resolve(contract.assetId, contract.entryInstant)
      : contract.entryInstant;
    const expiry = resolve
      ? resolve(contract.assetId, contract.entryInstant + contract.horizonMs)
      : contract.entryInstant + contract.horizonMs;
    return `${contract.assetId}|${entry}|${expiry}`;
  }

  get size(): number {
    return this.#contracts;
  }

  /** Net exposure on the event a contract belongs to. */
  netExposureFor(contract: Contract): number {
    const key = ExposureBook.keyOf(contract, this.#resolve);
    return Math.abs((this.#call.get(key) ?? 0) - (this.#put.get(key) ?? 0));
  }

  /**
   * Whether this contract may join, without recomputing the book.
   *
   * Netting is respected exactly as in {@link admit}: a contract that *reduces*
   * net exposure on an event already at its limit is accepted, because refusing
   * it would push the book further from balance while believing it was being
   * careful.
   */
  admit(contract: Contract, policy: LimiterPolicy): Admission {
    if (!(policy.maxEventExposure > 0)) {
      throw new RangeError(
        `maxEventExposure must be positive, received ${policy.maxEventExposure}.`,
      );
    }
    if (!(contract.stake > 0) || !Number.isFinite(contract.stake)) {
      throw new RangeError(`Stake must be finite and positive, received ${contract.stake}.`);
    }
    const key = ExposureBook.keyOf(contract, this.#resolve);
    const call = this.#call.get(key) ?? 0;
    const put = this.#put.get(key) ?? 0;
    const obligation = contract.stake * contract.payoutRatio;
    const before = Math.abs(call - put);
    const after =
      contract.direction === 'up'
        ? Math.abs(call + obligation - put)
        : Math.abs(call - (put + obligation));

    if (after <= policy.maxEventExposure || after < before) return { accepted: true };

    const expiryInstant = contract.entryInstant + contract.horizonMs;
    return {
      accepted: false,
      reason:
        `Net exposure on ${contract.assetId} ` +
        `${contract.entryInstant}→${expiryInstant} would reach ${after.toFixed(2)}, past the ` +
        `${policy.maxEventExposure.toFixed(2)} limit. Contracts on the opposite side of this ` +
        `event are still accepted.`,
      event: { assetId: contract.assetId, entryInstant: contract.entryInstant, expiryInstant },
      wouldBe: after,
      limit: policy.maxEventExposure,
    };
  }

  /** Record an accepted contract. */
  add(contract: Contract): void {
    const key = ExposureBook.keyOf(contract, this.#resolve);
    const obligation = contract.stake * contract.payoutRatio;
    if (contract.direction === 'up') this.#call.set(key, (this.#call.get(key) ?? 0) + obligation);
    else this.#put.set(key, (this.#put.get(key) ?? 0) + obligation);
    this.#contracts += 1;
  }

  /** Largest net exposure across every event in the book. */
  peakExposure(): number {
    let peak = 0;
    for (const key of new Set([...this.#call.keys(), ...this.#put.keys()])) {
      const net = Math.abs((this.#call.get(key) ?? 0) - (this.#put.get(key) ?? 0));
      if (net > peak) peak = net;
    }
    return peak;
  }
}
