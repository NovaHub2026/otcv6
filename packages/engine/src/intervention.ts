import type { RandomSource } from '@otc/core';

/**
 * A Lab intervention, expressed as a criterion over futures the engine already
 * produces rather than as a force applied to it.
 *
 * §13 of the specification asks for "Bullish Pressure · Medium · 30s"; §48 for
 * `Bull Trend → Pullback`. Both read as steering, and neither has to be.
 *
 * PH-23.1 established why. The magnitudes are the engine's and the sign is an
 * independent fair coin, so **every sign vector is the engine's own output**
 * (ADR-0003). A bullish intervention is therefore a *selection criterion* — keep
 * a continuation whose shape matches what was asked for — and the engine still
 * decides the path, which is the sentence §49 and §81 both insist on. Here it is
 * literally true: nothing is produced, only chosen.
 *
 * The same honesty follows as for an exact close. A criterion nothing satisfies
 * reports **an acceptance rate of zero**, not a best effort. "This market does
 * not do that" is an answer; a nudged path that nearly does is not.
 */

/** A path, as the displacement after each remaining tick. */
export interface Continuation {
  readonly signs: readonly (1 | -1)[];
  /** Running displacement in lattice steps, one entry per tick. */
  readonly path: readonly number[];
  /** Net displacement over the whole continuation. */
  readonly net: number;
  /** Highest and lowest displacement reached along the way. */
  readonly high: number;
  readonly low: number;
}

export interface InterventionRequest {
  readonly steps: readonly number[];
  readonly random: RandomSource;
  /** What the operator asked for, as a predicate over a natural continuation. */
  readonly criterion: (continuation: Continuation) => boolean;
  readonly maxAttempts?: number;
}

export interface InterventionResult {
  readonly chosen: Continuation | null;
  readonly attempts: number;
  /** Measured probability that a natural continuation satisfies the criterion. */
  readonly acceptanceRate: number;
}

function walk(steps: readonly number[], signs: readonly (1 | -1)[]): Continuation {
  const path: number[] = [];
  let net = 0;
  let high = 0;
  let low = 0;
  for (const [i, step] of steps.entries()) {
    net += signs[i]! * step;
    path.push(net);
    if (net > high) high = net;
    if (net < low) low = net;
  }
  return { signs, path, net, high, low };
}

/** Draw natural continuations until one matches, and report how rare that was. */
export function selectContinuation(request: InterventionRequest): InterventionResult {
  const { steps, random, criterion } = request;
  const maxAttempts = request.maxAttempts ?? 20_000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const signs: (1 | -1)[] = steps.map(() => (random.nextBoolean() ? 1 : -1));
    const candidate = walk(steps, signs);
    if (criterion(candidate)) {
      return { chosen: candidate, attempts: attempt, acceptanceRate: 1 / attempt };
    }
  }
  return { chosen: null, attempts: maxAttempts, acceptanceRate: 0 };
}

/**
 * The criteria the specification names, as predicates.
 *
 * Each is a shape a natural market sometimes has. None of them is a force, and
 * none of them can produce a shape the engine would not produce on its own —
 * which is exactly why an intervention here cannot manufacture an edge.
 */
export const INTERVENTIONS = {
  /** §13. Net displacement at least this many steps upward. */
  bullishPressure: (steps: number) => (c: Continuation) => c.net >= steps,
  /** §13, the other way. */
  bearishPressure: (steps: number) => (c: Continuation) => c.net <= -steps,
  /** §14. Realised range wider than this. */
  expandedVolatility: (range: number) => (c: Continuation) => c.high - c.low >= range,
  /** §14, compressed. */
  compressedVolatility: (range: number) => (c: Continuation) => c.high - c.low <= range,
  /**
   * The direction of one particular tick.
   *
   * With {@link nextShock} this is what "a positive shock" honestly means here:
   * the engine decides *whether* a large step happens and *when*; the coin
   * decides which way; and a criterion over the coin is a selection like any
   * other, accepted about half the time.
   */
  directionAt: (tick: number, direction: 1 | -1) => (c: Continuation) =>
    c.signs[tick] === direction,
  /** §16. Reaches a region without being required to end there. */
  touches: (level: number) => (c: Continuation) => (level >= 0 ? c.high >= level : c.low <= level),
  /**
   * §48. A rise, then a counter-move of a stated depth, then anything.
   *
   * Expressed as a shape and not as a script: the peak must come before the
   * trough that follows it, the rise must be at least `rise`, and the pullback
   * at least `depth` of that rise. What happens afterwards is the engine's, as
   * §49 requires — the trend may resume, flatten or reverse.
   */
  trendThenPullback: (rise: number, depth: number) => (c: Continuation) => {
    let peak = 0;
    let peakAt = -1;
    for (const [i, value] of c.path.entries()) {
      if (value > peak) {
        peak = value;
        peakAt = i;
      }
    }
    if (peak < rise || peakAt < 0) return false;
    const after = c.path.slice(peakAt + 1);
    if (after.length === 0) return false;
    const trough = Math.min(...after);
    return peak - trough >= depth * peak;
  },
} as const;

/**
 * Where the engine's next large step is in this window, if there is one.
 *
 * **LAB-SPECIFICATION-AUDIT-001, LA-01.** This was `INTERVENTIONS.shock`: a
 * predicate accepting any continuation containing a single-tick displacement
 * of at least `size`. Executed, it accepted the first vector drawn or none of
 * them, under every seed — a displacement is `sign × step` and its absolute
 * value is the step. A shock is a **magnitude** event; magnitudes do not depend
 * on the signs (ADR-0003, `stepIndependence.test.ts`); so a selection over
 * signs cannot produce one, and the predicate was a detector wearing the name
 * of an intervention. Its docstring said "keep one containing a displacement
 * above a threshold" as if there were a choice being made.
 *
 * So it is a detector, named as one. What the Lab can honestly say about a
 * shock is whether the engine is about to produce one and at which tick; what
 * it cannot do is order one. `directionAt` then chooses its sign.
 */
export function nextShock(
  steps: readonly number[],
  size: number,
): { readonly atTick: number; readonly step: number } | null {
  const atTick = steps.findIndex((step) => step >= size);
  return atTick < 0 ? null : { atTick, step: steps[atTick]! };
}
