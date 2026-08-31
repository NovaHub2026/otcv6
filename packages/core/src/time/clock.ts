import { epochMillis, type DurationMillis, type EpochMillis } from './instant.js';

/**
 * Source of the canonical present.
 *
 * Everything in the engine that needs "now" takes a Clock. Nothing reads
 * ambient time directly, because a component that can reach the wall clock
 * cannot be replayed, and replay is a product invariant (INV-009).
 */
export interface Clock {
  now(): EpochMillis;
}

/**
 * The authoritative server clock.
 *
 * This is the only place in `@otc/core` permitted to read ambient time, and the
 * guardrail suite enforces that. Settlement-relevant timing is defined by this
 * clock; client-supplied timestamps are never authoritative.
 */
export class SystemClock implements Clock {
  now(): EpochMillis {
    // eslint-disable-next-line no-restricted-properties -- the single sanctioned ambient time read
    return epochMillis(Date.now());
  }
}

/** A clock frozen at a single instant. */
export class FixedClock implements Clock {
  constructor(private readonly instant: EpochMillis) {}

  now(): EpochMillis {
    return this.instant;
  }
}

/** A clock that only moves when told to. The default clock for tests. */
export class SteppableClock implements Clock {
  private current: EpochMillis;

  constructor(start: EpochMillis) {
    this.current = start;
  }

  now(): EpochMillis {
    return this.current;
  }

  advance(by: DurationMillis): EpochMillis {
    this.current = epochMillis(this.current + by);
    return this.current;
  }

  set(instant: EpochMillis): void {
    this.current = instant;
  }
}
