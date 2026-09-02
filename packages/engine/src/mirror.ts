import type { RandomSource } from '@otc/core';
import type { MarketEngine } from './engine.js';

/**
 * The mirror test.
 *
 * ADR-0003's guarantee rests on one precondition: the magnitude and timing
 * engine never observes a sign. That is testable directly and exactly.
 *
 * Run one engine to a random interior index `N`, snapshot it, and continue two
 * engines from that snapshot — one with the sign stream negated from `N + 1`
 * onwards. If the precondition holds, every latent variable continues
 * **bit-identically** — the magnitude engine cannot tell the difference,
 * because nothing it reads has changed — and every increment is **exactly
 * negated**.
 *
 * Any mechanism that reaches a sign, directly or through the price or through a
 * level derived from either, breaks that identity immediately and
 * unambiguously.
 *
 * This is the gate a statistical battery cannot replace. PH-2 measured why: a
 * conventional attack battery returns *clean* on an engine whose volatility is
 * keyed to the price level. The mirror test catches that class of defect in
 * milliseconds, with no sampling error and no multiple-testing correction.
 *
 * ## The snapshot must be interior, and the negation must start there
 *
 * Both halves are load-bearing, and the second was missing for four cycles.
 *
 * Run from a symmetric initial state the test passes vacuously: with no
 * accumulated asymmetry there is nothing for a sign-reading mechanism to have
 * latched onto yet.
 *
 * **Cycle Audit 7, a3-01.** The previous harness built both engines at the
 * origin and inverted the second one's sign from its *first* tick, comparing
 * only after a burn-in. The mirrored path was then exactly `−p(t)` throughout —
 * reflection through the origin, not through an interior price — and any level
 * dependence `f(price)` with `f(−p) = f(p)` was invisible to it: parity, `|p|`,
 * and distance to the nearest multiple of a cell width, which is round-number
 * support and resistance, the mechanism ADR-0003 §4 bans by name. A 3×
 * volatility contrast keyed to `price mod 1000` passed 19 of 19 shipped tests.
 * Reflection through `p_N` catches it on every catalogue asset.
 *
 * ## Resolution
 *
 * The gate compares quantised lattice steps, `floor(m / q + u)`. A relative
 * perturbation `ε` of the magnitude flips that floor with probability about
 * `ε · m / q` per tick, so over `T` compared ticks the smallest leverage it can
 * see is roughly `1 / (steps per tick × T)` — about 1e-5 with ten-step
 * magnitudes and 7,000 compared ticks. A leverage of 1e-9 passes (Cycle Audit
 * 7, a3-08), as does deterministic signed rounding, which differs from its
 * negation only when `m / q` is exactly a half-integer. Neither is economically
 * exploitable at that size; the instrument for leaks below this resolution is
 * the battery's 0.217pp detection floor, not this gate.
 */

/** A stream whose boolean draws are inverted; everything else is untouched. */
export class SignInvertingStream implements RandomSource {
  constructor(private readonly inner: RandomSource) {}

  get label(): string {
    return `${this.inner.label}#mirrored`;
  }

  nextBoolean(): boolean {
    return !this.inner.nextBoolean();
  }

  nextUint32(): number {
    return this.inner.nextUint32();
  }

  nextUint64(): bigint {
    return this.inner.nextUint64();
  }

  nextFloat64(): number {
    return this.inner.nextFloat64();
  }

  nextBoundedUint32(bound: number): number {
    return this.inner.nextBoundedUint32(bound);
  }

  nextBytes(count: number): Uint8Array {
    return this.inner.nextBytes(count);
  }

  position(): ReturnType<RandomSource['position']> {
    return this.inner.position();
  }

  seek(cursor: Parameters<RandomSource['seek']>[0]): void {
    this.inner.seek(cursor);
  }
}

export interface MirrorDivergence {
  readonly kind: 'increment' | 'latent-state' | 'interval';
  readonly step: number;
  readonly detail: string;
}

export interface MirrorResult {
  /** The interior index `N`: ticks the origin engine ran before the snapshot. */
  readonly snapshotAt: number;
  /** Ticks compared after the snapshot. */
  readonly steps: number;
  readonly divergences: readonly MirrorDivergence[];
  readonly mirrored: boolean;
}

/** A range the interior index is drawn from, inclusive at both ends. */
export interface InteriorRange {
  readonly min: number;
  readonly max: number;
}

export interface MirrorOptions {
  /**
   * The interior index `N`: ticks run before the snapshot the two continuations
   * start from.
   *
   * A number fixes it. A range draws it from {@link MirrorOptions.interior},
   * which is what ADR-0003 §6 asks for — "randomise `N` over many seeds per CI
   * run" — so that a level leak with a period the fixed values happen to miss
   * still gets a different reflection point on every run.
   */
  readonly burnInTicks: number | InteriorRange;
  /** Ticks to compare after the snapshot. */
  readonly compareTicks: number;
  /**
   * Draws `N` when `burnInTicks` is a range.
   *
   * Must come from the test's own seed, never from ambient randomness: a
   * failing `N` has to be reproducible, and the result reports it.
   */
  readonly interior?: RandomSource;
}

/**
 * Divergences recorded before the comparison stops.
 *
 * A mechanism that reads a sign diverges at once and then keeps diverging. A
 * long list of consequences of one defect is noise, not evidence; five is
 * enough to show the kinds involved and the step they began at.
 */
export const MAX_REPORTED_DIVERGENCES = 5;

function interiorIndex(options: MirrorOptions): number {
  const { burnInTicks } = options;
  if (typeof burnInTicks === 'number') {
    if (!Number.isInteger(burnInTicks) || burnInTicks < 1) {
      throw new RangeError(`burnInTicks must be a positive integer, received ${burnInTicks}.`);
    }
    return burnInTicks;
  }
  const { min, max } = burnInTicks;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
    throw new RangeError(
      `burnInTicks range must be positive integers with min <= max, received [${min}, ${max}].`,
    );
  }
  if (options.interior === undefined) {
    throw new RangeError('A burnInTicks range needs an `interior` stream to draw from.');
  }
  return min + options.interior.nextBoundedUint32(max - min + 1);
}

/**
 * Run the mirror test.
 *
 * `build` must construct a complete, fresh engine from the sign source it is
 * given — every other stream identical between calls. The harness runs one such
 * engine to the interior index, snapshots it, and restores that snapshot into
 * two more: one with the real sign source, one with an inverted one. `restore`
 * seeks every stream to the snapshot's cursors, the inverting wrapper included,
 * so the two continuations differ in exactly one thing — the sign of every
 * draw after `N`.
 */
export function runMirrorTest(
  build: (signSource: RandomSource) => MarketEngine,
  signSource: () => RandomSource,
  options: MirrorOptions,
): MirrorResult {
  const requested = interiorIndex(options);
  const { compareTicks } = options;
  if (!Number.isInteger(compareTicks) || compareTicks < 1) {
    throw new RangeError(`compareTicks must be a positive integer, received ${compareTicks}.`);
  }

  // One engine to the interior point. Its price there is the reflection axis:
  // whatever asymmetry the latent state and the level have accumulated is what
  // a sign- or level-reading mechanism would have latched onto.
  const origin = build(signSource());
  let snapshotAt = 0;
  for (let i = 0; i < requested; i += 1) {
    if (origin.next() === null) break;
    snapshotAt += 1;
  }
  const snapshot = origin.snapshot();

  const straight = build(signSource());
  const mirrored = build(new SignInvertingStream(signSource()));
  straight.restore(snapshot);
  mirrored.restore(snapshot);
  const divergences: MirrorDivergence[] = [];

  let straightPrevious: number = straight.price;
  let mirroredPrevious: number = mirrored.price;
  let compared = 0;

  for (let step = 1; step <= compareTicks; step += 1) {
    const a = straight.next();
    const b = mirrored.next();
    if (a === null || b === null) break;
    compared = step;

    const straightDelta = a.price - straightPrevious;
    const mirroredDelta = b.price - mirroredPrevious;
    straightPrevious = a.price;
    mirroredPrevious = b.price;

    if (straightDelta !== -mirroredDelta) {
      divergences.push({
        kind: 'increment',
        step,
        detail: `increment ${straightDelta} is not the negation of ${mirroredDelta}`,
      });
    }
    if (a.instant !== b.instant) {
      divergences.push({
        kind: 'interval',
        step,
        detail: `instants diverged: ${a.instant} vs ${b.instant}`,
      });
    }

    const latentA = JSON.stringify(straight.snapshot().magnitudeState);
    const latentB = JSON.stringify(mirrored.snapshot().magnitudeState);
    if (latentA !== latentB) {
      divergences.push({
        kind: 'latent-state',
        step,
        detail: `latent state diverged: ${latentA} vs ${latentB}`,
      });
    }

    if (divergences.length >= MAX_REPORTED_DIVERGENCES) break;
  }

  return { snapshotAt, steps: compared, divergences, mirrored: divergences.length === 0 };
}
