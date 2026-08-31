import type { RandomSource } from '@otc/core';
import type { MarketEngine } from './engine.js';

/**
 * The mirror test.
 *
 * ADR-0003's guarantee rests on one precondition: the magnitude and timing
 * engine never observes a sign. That is testable directly and exactly.
 *
 * Negate the sign stream from a snapshot taken at a random interior point. If
 * the precondition holds, every latent variable continues **bit-identically** —
 * the magnitude engine cannot tell the difference, because nothing it reads has
 * changed — and every increment is **exactly negated**.
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
 * **The snapshot must be interior.** Run from a symmetric initial state the test
 * passes vacuously: with no accumulated asymmetry there is nothing for a
 * sign-reading mechanism to have latched onto yet.
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
  readonly steps: number;
  readonly divergences: readonly MirrorDivergence[];
  readonly mirrored: boolean;
}

export interface MirrorOptions {
  /** Ticks to run before comparing, so the latent state is genuinely asymmetric. */
  readonly burnInTicks: number;
  /** Ticks to compare after the burn-in. */
  readonly compareTicks: number;
}

/**
 * Run the mirror test.
 *
 * `build` must construct a complete, fresh engine from the sign source it is
 * given — every other stream identical between calls. The harness then hands one
 * engine the real sign source and the other an inverted one, so the two runs
 * differ in exactly one thing.
 */
export function runMirrorTest(
  build: (signSource: RandomSource) => MarketEngine,
  signSource: () => RandomSource,
  options: MirrorOptions,
): MirrorResult {
  const { burnInTicks, compareTicks } = options;
  if (!Number.isInteger(burnInTicks) || burnInTicks < 1) {
    throw new RangeError(`burnInTicks must be a positive integer, received ${burnInTicks}.`);
  }
  if (!Number.isInteger(compareTicks) || compareTicks < 1) {
    throw new RangeError(`compareTicks must be a positive integer, received ${compareTicks}.`);
  }

  const straight = build(signSource());
  const mirrored = build(new SignInvertingStream(signSource()));
  const divergences: MirrorDivergence[] = [];

  for (let i = 0; i < burnInTicks; i += 1) {
    straight.next();
    mirrored.next();
  }

  const latentAfterBurnIn = JSON.stringify(straight.snapshot().magnitudeState);
  const mirroredLatentAfterBurnIn = JSON.stringify(mirrored.snapshot().magnitudeState);
  if (latentAfterBurnIn !== mirroredLatentAfterBurnIn) {
    divergences.push({
      kind: 'latent-state',
      step: 0,
      detail: `latent state diverged during burn-in: ${latentAfterBurnIn} vs ${mirroredLatentAfterBurnIn}`,
    });
  }

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

    // A mechanism that reads a sign diverges immediately. A long list of
    // consequences of one defect is noise, not evidence.
    if (divergences.length >= 5) break;
  }

  return { steps: compared, divergences, mirrored: divergences.length === 0 };
}
