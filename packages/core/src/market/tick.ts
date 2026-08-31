import type { EpochMillis } from '../time/instant.js';
import type { LogPrice } from './instrument.js';

/**
 * The single canonical market artefact.
 *
 * Every other representation — candles on every timeframe, chart data, entry and
 * expiration prices — is a pure function of the tick stream (INV-003).
 *
 * Ordering is by `sequence`, never by `instant`. Two ticks may share a
 * millisecond, and a stream whose order depended on clock resolution could not
 * be audited: `open` and `close` would become ambiguous exactly when a dispute
 * needed them to be definite.
 */
export interface Tick {
  readonly instant: EpochMillis;
  /** Per-asset, strictly increasing. */
  readonly sequence: number;
  readonly price: LogPrice;
}

export function assertTickOrder(previous: Tick | null, next: Tick): void {
  if (previous === null) return;
  if (next.sequence <= previous.sequence) {
    throw new RangeError(
      `Tick sequence must strictly increase: received ${next.sequence} after ${previous.sequence}.`,
    );
  }
  if (next.instant < previous.instant) {
    throw new RangeError(
      `Tick instants must not move backwards: received ${next.instant} after ${previous.instant}.`,
    );
  }
}
