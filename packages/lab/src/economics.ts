/**
 * Edge expressed in the units the business decides on.
 *
 * A z-score says whether an effect is real. It does not say whether it matters.
 * At an 85% payout an observer needs to win 54.05% of the time to break even; at
 * the 99% promotional payout, 50.25%. **A directional bias of a quarter of a
 * percentage point is the difference between a viable product and a losing one**,
 * and that is the number a verdict has to report.
 */

/** Typical product payout. */
export const PAYOUT_TYPICAL = 0.85;
/** Promotional ceiling. The tightest budget the engine must satisfy. */
export const PAYOUT_PROMOTIONAL = 0.99;

export const STANDARD_PAYOUTS: readonly number[] = [PAYOUT_TYPICAL, PAYOUT_PROMOTIONAL];

function assertPayout(payout: number): void {
  if (!(payout > 0 && payout <= 100) || !Number.isFinite(payout)) {
    throw new RangeError(`Payout must be a finite value in (0, 100], received ${payout}.`);
  }
}

/**
 * Win rate at which an observer breaks even, given a payout.
 *
 * A win returns `+payout`, a loss `-1`, so expected value is
 * `p·payout − (1−p)` and breakeven is `1/(1+payout)`.
 */
export function breakevenWinRate(payout: number): number {
  assertPayout(payout);
  return 1 / (1 + payout);
}

/** Expected value per unit staked, over decided (non-tie) outcomes. */
export function expectedValuePerTrade(winRate: number, payout: number): number {
  assertPayout(payout);
  if (!(winRate >= 0 && winRate <= 1)) {
    throw new RangeError(`Win rate must lie in [0, 1], received ${winRate}.`);
  }
  return winRate * payout - (1 - winRate);
}

/**
 * How much of the way to profitability an observed win rate gets.
 * `1` means exactly breakeven; above `1` the observer profits.
 */
export function profitabilityRatio(winRate: number, payout: number): number {
  return winRate / breakevenWinRate(payout);
}

export interface EconomicAssessment {
  readonly payout: number;
  readonly breakeven: number;
  readonly winRate: number;
  readonly edgePoints: number;
  readonly expectedValue: number;
  readonly profitable: boolean;
}

export function assessEconomics(winRate: number, payout: number): EconomicAssessment {
  const breakeven = breakevenWinRate(payout);
  const expectedValue = expectedValuePerTrade(winRate, payout);
  return {
    payout,
    breakeven,
    winRate,
    edgePoints: (winRate - 0.5) * 100,
    expectedValue,
    profitable: winRate > breakeven,
  };
}

/**
 * The directional bias that becomes profitable at a payout, in percentage points
 * above 50%. At 85% this is 4.05pp; at 99% it is 0.25pp.
 */
export function profitabilityThresholdPoints(payout: number): number {
  return (breakevenWinRate(payout) - 0.5) * 100;
}
