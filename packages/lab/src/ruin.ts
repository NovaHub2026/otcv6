import { exp, ln, type RandomSource } from '@otc/core';

/**
 * Whether a venue with a positive edge survives long enough to collect it.
 *
 * ## Why expectation is the wrong question
 *
 * Four cycles established that the operator's expected edge is exactly the
 * payout margin — 0.2513 percentage points at the 99% promotional payout. A
 * venue with a positive edge still fails if it runs out of money before the edge
 * arrives, and that is a different question with a different answer.
 *
 * Once PH-13.1 reduces a book to independent netted settlement events, this is
 * the classical gambler's-ruin problem on a biased random walk. Two quantities
 * decide it: the **edge per unit at risk**, fixed by the payout and tiny; and
 * the **size of a unit relative to bankroll**, which is entirely a function of
 * how concentrated flow is.
 *
 * The consequence is uncomfortable and worth stating plainly: **a 0.25% edge is
 * very thin protection.** Halving exposure concentration buys far more safety
 * than doubling the edge would, and no amount of volume rescues a book that is
 * effectively one bet.
 *
 * ## What this is not
 *
 * It is not a claim about the market being unfair. The edge is exactly the
 * payout margin because `P(up) = P(down)` holds exactly (ADR-0003); nothing here
 * touches that. Ruin risk is a property of **capitalisation and flow**, not of
 * the price process, and it exists for a perfectly fair game with a house edge.
 */

/**
 * A book reduced to what ruin depends on.
 *
 * Gain and loss are stated separately rather than derived from a payout ratio,
 * because they are genuinely different sizes and conflating them is where the
 * edge comes from. On a losing resolution the operator pays the winner
 * `stake × payoutRatio`; on a winning one it keeps `stake`. At the promotional
 * 0.99 that is a 0.99 loss against a 1.00 gain — the whole house edge, and the
 * reason the walk is asymmetric.
 */
export interface RuinInputs {
  /** Capital available to absorb losses. */
  readonly bankroll: number;
  /** Probability the operator wins one settlement event. A fair coin is 0.5. */
  readonly winProbability: number;
  /** What the operator pays on an adverse resolution. */
  readonly lossPerEvent: number;
  /** What the operator keeps on a favourable one. */
  readonly gainPerEvent: number;
}

export interface RuinResult {
  /** Probability the bankroll is ever exhausted. */
  readonly probability: number;
  /** Expected profit per event. Positive whenever the operator has an edge. */
  readonly edgePerEvent: number;
  /** Lundberg coefficient. Larger means ruin decays faster with capital. */
  readonly adjustmentCoefficient: number;
  /** Losses the bankroll can absorb back to back. */
  readonly unitsOfCushion: number;
}

function assertInputs(inputs: RuinInputs): void {
  const { bankroll, winProbability, lossPerEvent, gainPerEvent } = inputs;
  if (!(bankroll > 0)) throw new RangeError(`Bankroll must be positive, received ${bankroll}.`);
  if (!(lossPerEvent > 0)) {
    throw new RangeError(`Loss per event must be positive, received ${lossPerEvent}.`);
  }
  if (!(gainPerEvent > 0)) {
    throw new RangeError(`Gain per event must be positive, received ${gainPerEvent}.`);
  }
  if (!(winProbability > 0 && winProbability < 1)) {
    throw new RangeError(`Win probability must lie in (0, 1), received ${winProbability}.`);
  }
}

/**
 * The Lundberg adjustment coefficient: the unique `R > 0` solving
 * `E[exp(−R · X)] = 1`, where `X` is the operator's profit on one event.
 *
 * ## Why this rather than a grid
 *
 * The first implementation walked a discretised bankroll forward event by event.
 * It is exact and it is unusable: resolving an asymmetric gain needs a fine grid,
 * and a realistic horizon then costs billions of operations. The test timed out,
 * which was the algorithm telling the truth about itself.
 *
 * Lundberg is the standard actuarial answer to exactly this shape of problem and
 * costs one bisection. `P(ruin from capital u) ≤ exp(−R · u)`, with equality
 * asymptotically, so it is an upper bound that tightens as capital grows — the
 * conservative direction, which is the right direction for a solvency number.
 *
 * Returns 0 when the operator has no edge, because then ruin is certain and no
 * positive `R` exists.
 */
export function adjustmentCoefficient(inputs: RuinInputs): number {
  assertInputs(inputs);
  const { winProbability, lossPerEvent, gainPerEvent } = inputs;
  const edge = winProbability * gainPerEvent - (1 - winProbability) * lossPerEvent;
  if (edge <= 0) return 0;

  // `f(R) = p·exp(−R·gain) + q·exp(R·loss) − 1` is 0 at R = 0, dips negative
  // while the edge is positive, and rises without bound. One positive root.
  const f = (r: number): number =>
    winProbability * exp(-r * gainPerEvent) + (1 - winProbability) * exp(r * lossPerEvent) - 1;

  let low = 0;
  let high = 1 / lossPerEvent;
  // Grow the bracket until the far end is above the axis again.
  for (let i = 0; i < 200 && f(high) <= 0; i += 1) high *= 2;
  for (let i = 0; i < 200; i += 1) {
    const middle = (low + high) / 2;
    if (f(middle) < 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * Probability the operator is ever ruined, given capital and per-event risk.
 *
 * This is the question that matters: not "will a bad run happen" — one will —
 * but "does the venue survive it". A positive edge guarantees the first and says
 * nothing about the second.
 */
export function ruinProbability(inputs: RuinInputs): RuinResult {
  assertInputs(inputs);
  const { bankroll, winProbability, lossPerEvent, gainPerEvent } = inputs;
  const edge = winProbability * gainPerEvent - (1 - winProbability) * lossPerEvent;
  const coefficient = adjustmentCoefficient(inputs);
  return {
    probability: edge <= 0 ? 1 : Math.min(1, exp(-coefficient * bankroll)),
    edgePerEvent: edge,
    adjustmentCoefficient: coefficient,
    unitsOfCushion: bankroll / lossPerEvent,
  };
}

/** Independent check on the bound: play the walk out over a finite horizon. */
export function simulateRuin(
  inputs: RuinInputs,
  events: number,
  stream: RandomSource,
  trials = 20_000,
): number {
  assertInputs(inputs);
  if (!Number.isInteger(events) || events < 1) {
    throw new RangeError(`Events must be a positive integer, received ${events}.`);
  }
  const { bankroll, winProbability, lossPerEvent, gainPerEvent } = inputs;
  let ruined = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    let capital = bankroll;
    for (let step = 0; step < events; step += 1) {
      capital += stream.nextFloat64() < winProbability ? gainPerEvent : -lossPerEvent;
      if (capital <= 0) {
        ruined += 1;
        break;
      }
    }
  }
  return ruined / trials;
}

/**
 * The largest per-event loss that keeps ruin under a tolerance.
 *
 * The number that becomes a limit. Found by bisection because ruin is monotone
 * in exposure — more at risk per event is never safer — and monotonicity is what
 * makes a search sound rather than a scan.
 *
 * `gainRatio` is the gain per unit of loss: `1 / payoutRatio`, so 1.0101 at the
 * promotional payout.
 */
export function capacity(options: {
  readonly bankroll: number;
  readonly winProbability: number;
  readonly gainRatio: number;
  readonly tolerance: number;
}): number {
  if (!(options.tolerance > 0 && options.tolerance < 1)) {
    throw new RangeError(`Tolerance must lie in (0, 1), received ${options.tolerance}.`);
  }
  let low = 0;
  let high = options.bankroll;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    const probability = ruinProbability({
      bankroll: options.bankroll,
      winProbability: options.winProbability,
      lossPerEvent: middle,
      gainPerEvent: middle * options.gainRatio,
    }).probability;
    if (probability > options.tolerance) high = middle;
    else low = middle;
  }
  return low;
}

/**
 * Kelly-style growth-optimal fraction, for comparison with a ruin limit.
 *
 * `gainPerUnitRisked` is **the operator's** odds, and the distinction is easy to
 * get backwards. At the 0.99 promotional payout a *trader* risks 1 to win 0.99,
 * so their Kelly fraction is zero — the bet is unfavourable, which is the
 * product working exactly as designed. The *operator* risks 0.99 to win 1, so
 * its gain per unit risked is `1 / 0.99 ≈ 1.0101`.
 *
 * Passing the trader's payout here returns 0, which reads like a broken venue
 * rather than the correct answer to a different question — so the parameter is
 * named for what it is. PH-13.2 lost two tests to exactly that confusion.
 */
export function growthOptimalFraction(winProbability: number, gainPerUnitRisked: number): number {
  const edge = winProbability * gainPerUnitRisked - (1 - winProbability);
  if (edge <= 0) return 0;
  return edge / gainPerUnitRisked;
}

/** Natural log of expected growth per event at a given exposure fraction. */
export function logGrowthPerEvent(
  winProbability: number,
  gainPerUnitRisked: number,
  fraction: number,
): number {
  if (fraction <= 0) return 0;
  if (fraction >= 1) return Number.NEGATIVE_INFINITY;
  return (
    winProbability * ln(1 + fraction * gainPerUnitRisked) + (1 - winProbability) * ln(1 - fraction)
  );
}
