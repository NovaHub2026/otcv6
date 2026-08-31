import { ln, type RandomSource } from '@otc/core';
import type { ArrivalModel, MagnitudeContext } from './magnitude.js';

/**
 * Poisson tick arrivals: exponential inter-arrival times with a fixed mean.
 *
 * Deliberately the simplest thing that works. Self-exciting arrivals — where a
 * burst of activity begets more activity — arrive in PH-3.3, and separating them
 * makes it possible to attribute a realism change to the mechanism that caused
 * it rather than to the pair.
 *
 * Sign-blind: it reads only elapsed time and its own randomness.
 */
export class PoissonArrivalModel implements ArrivalModel {
  constructor(
    private readonly meanIntervalMs: number,
    private readonly stream: RandomSource,
  ) {
    if (!(meanIntervalMs > 0) || !Number.isFinite(meanIntervalMs)) {
      throw new RangeError(
        `meanIntervalMs must be finite and positive, received ${meanIntervalMs}.`,
      );
    }
  }

  nextIntervalMs(_context: MagnitudeContext): number {
    // 1 - u lies in (0, 1], so the logarithm can never be -Infinity.
    const raw = -ln(1 - this.stream.nextFloat64()) * this.meanIntervalMs;
    // At least 1ms: two ticks in the same millisecond would still be ordered by
    // sequence, but a zero-length interval makes elapsed-time hazards degenerate.
    return Math.max(1, Math.floor(raw));
  }

  snapshot(): unknown {
    return null;
  }

  restore(_state: unknown): void {
    // Stateless beyond its stream cursor, which the engine snapshot records.
  }
}
