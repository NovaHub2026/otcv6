import type { InstrumentSpec } from './instrument.js';
import type { Tick } from './tick.js';

/**
 * The minimal contract a producer of market data satisfies.
 *
 * Deliberately tiny. The simulation runner, the planted-edge fixtures and the
 * real generative model of PH-3 all satisfy it, which is what lets the
 * validation harness be pointed at any of them without knowing which.
 */
export interface TickSource {
  readonly instrument: InstrumentSpec;
  /** The next tick, or `null` when the source is exhausted. */
  next(): Tick | null;
}
