import type { RandomSource } from '@otc/core';

/**
 * An exact close, chosen from the engine's own futures rather than steered.
 *
 * ## Why this is not a violation of INV-001
 *
 * The obvious way to make a candle close at a requested price is to push the
 * price toward it. That would put a mechanism in this repository that reads a
 * desired outcome and moves the market — which is precisely what INV-001
 * forbids, and it would turn ADR-0003's theorem into a claim about which flag
 * is switched off.
 *
 * There is a better way, and the theorem itself supplies it.
 *
 * ADR-0003: an increment is `sign × magnitude`, the sign is an **independent
 * fair coin**, and the magnitude engine is structurally unable to observe a
 * sign, a price, or anything derived from them. Two consequences follow, and
 * the second is the useful one:
 *
 * 1. Every sign sequence is exactly as legitimate as every other. There is no
 *    "correct" one the engine would have produced; the coin is fair, so all
 *    2^n of them are the engine's own output.
 * 2. **The magnitude sequence does not depend on the signs.** Running the engine
 *    once yields the steps; every sign assignment reuses them unchanged. That is
 *    not an optimisation to be verified — it is what `mirror.ts` asserts on
 *    every gate, and what makes the whole product unexploitable.
 *
 * So the Lab does not run the engine many times. It runs it **once**, takes the
 * step sizes, and samples sign vectors until one lands on the target. Every path
 * it produces is an unmodified engine path: the same magnitudes, the same
 * intervals, the same rounding, and a sign sequence the fair coin could have
 * produced.
 *
 * ## What comes free
 *
 * Because the path is genuinely the engine's, the specification's hard parts are
 * properties of the construction rather than things an implementation must
 * remember:
 *
 * - it cannot interpolate toward the target in a straight line (§22);
 * - it keeps the engine's microstructure, because it *is* the microstructure
 *   (§25);
 * - the OHLC is valid and the wicks are free, because nothing constrains the
 *   path before its last tick (§31, §32);
 * - it overshoots and comes back as often as chance says (§29);
 * - there is no last-seconds convergence rule, because there is no convergence
 *   mechanism at all (§28);
 * - and §70's terminal-convergence diagnostics find nothing, because there is
 *   no signature to find.
 *
 * ## Reachability is measured, not estimated
 *
 * §36 asks the Lab to say whether a requested close is Easy, Normal, Difficult,
 * Critical, or Outside Natural Range. The sampler's **acceptance rate is that
 * answer** — a probability, not a heuristic. A target the market cannot reach
 * does not appear in a million draws, and the Lab can say exactly that.
 */

export interface CloseSelectionRequest {
  /**
   * Unsigned step sizes, in lattice units, for the ticks that remain in the
   * bucket. Taken from one run of the engine.
   */
  readonly steps: readonly number[];
  /** Lattice distance from the current price to the requested close. */
  readonly delta: number;
  /** Where the sign draws come from. A Lab stream, never a market one. */
  readonly random: RandomSource;
  /** How many sign vectors to try before reporting the target unreachable. */
  readonly maxAttempts?: number;
}

export interface CloseSelection {
  /** The chosen signs, one per step, or null when the target was not reached. */
  readonly signs: readonly (1 | -1)[] | null;
  /** Vectors drawn. Its reciprocal is the measured reachability. */
  readonly attempts: number;
  /** Measured probability that a random path lands exactly on the target. */
  readonly acceptanceRate: number;
  /** What §36 calls this, from the measured rate rather than from a rule of thumb. */
  readonly reachability: Reachability;
  /** Why it can never be reached, when that is knowable without sampling. */
  readonly impossible: string | null;
}

export type Reachability = 'easy' | 'normal' | 'difficult' | 'critical' | 'outside-natural-range';

/** Bands over the measured acceptance rate, coarsest first. */
function bandFor(rate: number, found: boolean): Reachability {
  if (!found) return 'outside-natural-range';
  if (rate >= 1 / 100) return 'easy';
  if (rate >= 1 / 2_000) return 'normal';
  if (rate >= 1 / 50_000) return 'difficult';
  return 'critical';
}

/**
 * Two things make a target unreachable no matter how long one samples, and both
 * are worth saying instead of discovering by exhaustion.
 *
 * **Parity.** `sum(±steps)` and `sum(steps)` differ by twice the negated
 * subset, so they always share a parity. A delta of the other parity cannot
 * occur, ever.
 *
 * **Range.** No sign assignment reaches beyond `±sum(steps)`.
 */
function impossibilityOf(steps: readonly number[], delta: number): string | null {
  const total = steps.reduce((sum, step) => sum + step, 0);
  if (!Number.isSafeInteger(delta)) {
    return `A lattice distance must be a whole number of steps, received ${String(delta)}.`;
  }
  if (Math.abs(delta) > total) {
    return (
      `The remaining ticks can move at most ${String(total)} lattice steps and the target is ` +
      `${String(Math.abs(delta))} away, so no path reaches it.`
    );
  }
  if (((total - delta) & 1) === 1) {
    return (
      `The target is unreachable by parity: the remaining steps sum to ${String(total)}, so every ` +
      `attainable close differs from it by an even number of steps and this one differs by an odd.`
    );
  }
  return null;
}

/**
 * Sample sign vectors until one closes exactly on the target.
 *
 * Rejection sampling, deliberately: a vector accepted this way is drawn
 * **uniformly from the sign vectors that hit the target**, which is the most
 * natural possible path to that close. A constructive solver would be faster
 * and would produce a recognisable shape — and a recognisable shape is the one
 * thing §28 and §70 forbid.
 */
export function selectClose(request: CloseSelectionRequest): CloseSelection {
  const { steps, delta, random } = request;
  const maxAttempts = request.maxAttempts ?? 200_000;

  const impossible = impossibilityOf(steps, delta);
  if (impossible !== null) {
    return {
      signs: null,
      attempts: 0,
      acceptanceRate: 0,
      reachability: 'outside-natural-range',
      impossible,
    };
  }
  if (steps.length === 0) {
    // No ticks remain, so the only reachable close is where the price already is.
    const signs = delta === 0 ? [] : null;
    return {
      signs,
      attempts: 0,
      acceptanceRate: delta === 0 ? 1 : 0,
      reachability: delta === 0 ? 'easy' : 'outside-natural-range',
      impossible: delta === 0 ? null : 'No ticks remain in the bucket.',
    };
  }

  const chosen: (1 | -1)[] = new Array<1 | -1>(steps.length).fill(1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let sum = 0;
    for (let i = 0; i < steps.length; i += 1) {
      const sign: 1 | -1 = random.nextBoolean() ? 1 : -1;
      chosen[i] = sign;
      sum += sign * steps[i]!;
    }
    if (sum === delta) {
      const rate = 1 / attempt;
      return {
        signs: [...chosen],
        attempts: attempt,
        acceptanceRate: rate,
        reachability: bandFor(rate, true),
        impossible: null,
      };
    }
  }
  return {
    signs: null,
    attempts: maxAttempts,
    acceptanceRate: 0,
    reachability: 'outside-natural-range',
    impossible:
      `No path in ${String(maxAttempts)} draws closed on the target. It is reachable in ` +
      `principle and vanishingly unlikely in practice, which is what §37 calls outside the ` +
      `natural range.`,
  };
}

/** A close asked as a side of a level rather than a level (PH-24.21). */
export interface ConditionedCloseRequest {
  /** Unsigned step sizes, in lattice units, for the ticks that remain in the bucket. */
  readonly steps: readonly number[];
  /** Whether a lattice distance from the current price satisfies the operator: `delta > mark`, say. */
  readonly satisfies: (delta: number) => boolean;
  /** Where the sign draws come from. A Lab stream, never a market one. */
  readonly random: RandomSource;
  /** How many sign vectors to try before reporting the condition unreachable. */
  readonly maxAttempts?: number;
}

/**
 * Sample sign vectors until one closes where the condition holds.
 *
 * The same rejection sampling as `selectClose`, with an acceptance test in place
 * of an equality: the accepted vector is drawn **uniformly from the sign vectors
 * whose close satisfies the condition**, so its endpoint has the natural
 * distribution over the satisfying closes rather than sitting on the nearest
 * one — a close asked "above 1.0850" that always landed one step above it
 * would be a shape, and §28 and §70 forbid shapes.
 *
 * Impossibility is known without sampling when no attainable distance
 * satisfies: the attainable distances are `-total, -total + 2, …, total`.
 */
export function selectCloseWhere(request: ConditionedCloseRequest): CloseSelection {
  const { steps, satisfies, random } = request;
  const maxAttempts = request.maxAttempts ?? 200_000;
  const total = steps.reduce((sum, step) => sum + step, 0);
  let attainable = false;
  for (let delta = -total; delta <= total; delta += 2) {
    if (satisfies(delta)) {
      attainable = true;
      break;
    }
  }
  if (!attainable) {
    return {
      signs: null,
      attempts: 0,
      acceptanceRate: 0,
      reachability: 'outside-natural-range',
      impossible:
        `The remaining ticks can move at most ${String(total)} lattice steps, and no close ` +
        `within that range satisfies the condition, so no path reaches it.`,
    };
  }
  if (steps.length === 0) {
    return {
      signs: [],
      attempts: 0,
      acceptanceRate: 1,
      reachability: 'easy',
      impossible: null,
    };
  }
  const chosen: (1 | -1)[] = new Array<1 | -1>(steps.length).fill(1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let sum = 0;
    for (let i = 0; i < steps.length; i += 1) {
      const sign: 1 | -1 = random.nextBoolean() ? 1 : -1;
      chosen[i] = sign;
      sum += sign * steps[i]!;
    }
    if (satisfies(sum)) {
      const rate = 1 / attempt;
      return {
        signs: [...chosen],
        attempts: attempt,
        acceptanceRate: rate,
        reachability: bandFor(rate, true),
        impossible: null,
      };
    }
  }
  return {
    signs: null,
    attempts: maxAttempts,
    acceptanceRate: 0,
    reachability: 'outside-natural-range',
    impossible:
      `No path in ${String(maxAttempts)} draws closed where the condition holds. It is ` +
      `attainable in principle and vanishingly unlikely in practice, which is what §37 calls ` +
      `outside the natural range.`,
  };
}
