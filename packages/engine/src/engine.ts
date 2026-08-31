import {
  epochMillis,
  formatCursor,
  ln,
  parseCursor,
  logPrice,
  type EpochMillis,
  type InstrumentSpec,
  type LogPrice,
  type RandomSource,
  type Tick,
  type TickSource,
} from '@otc/core';
import type {
  ArrivalContext,
  ArrivalModel,
  MagnitudeContext,
  MagnitudeModel,
} from './magnitude.js';

/**
 * The market engine.
 *
 * The whole anti-predictability architecture lives in one line of {@link next}:
 * a non-negative magnitude, quantised to the lattice, multiplied by a fair coin
 * drawn from a stream that nothing else touches.
 *
 * Everything else — the cascade, regimes, structure, arrivals — is machinery for
 * producing that magnitude, and none of it can see the coin or the price.
 */

export interface EngineStreams {
  /** Drives the fair coin. Its own key, touched by nothing else. */
  readonly sign: RandomSource;
  /** Drives stochastic rounding to the lattice. Sign-blind. */
  readonly rounding: RandomSource;
  /**
   * Every other stream the magnitude and arrival models consume, by purpose.
   *
   * The engine needs to know about them even though it never draws from them,
   * because a snapshot has to record where *every* stream stands. Recording the
   * models' latent state without their cursors produces a snapshot that looks
   * complete and cannot actually be restored.
   */
  readonly models: Readonly<Record<string, RandomSource>>;
}

export interface EngineSnapshot {
  readonly sequence: number;
  readonly instant: EpochMillis;
  readonly price: LogPrice;
  readonly previousMagnitude: number;
  readonly previousIntervalMs: number;
  readonly magnitudeState: unknown;
  readonly arrivalState: unknown;
  /** Position of every stream, by name. `sign` and `rounding` are always present. */
  readonly cursors: Readonly<Record<string, string>>;
}

export interface EngineStart {
  readonly instant: EpochMillis;
  readonly price: LogPrice;
}

export interface MarketEngineOptions {
  readonly instrument: InstrumentSpec;
  readonly magnitude: MagnitudeModel;
  readonly arrival: ArrivalModel;
  readonly streams: EngineStreams;
  readonly start: EngineStart;
  /** Stop after this many ticks. Omit for an unbounded stream. */
  readonly maxTicks?: number;
}

export class MarketEngine implements TickSource {
  readonly instrument: InstrumentSpec;
  #sequence = 0;
  #instant: number;
  #price: number;
  #previousMagnitude = 0;
  #previousIntervalMs = 0;

  constructor(private readonly options: MarketEngineOptions) {
    this.instrument = options.instrument;
    this.#instant = options.start.instant;
    this.#price = options.start.price;
  }

  next(): Tick | null {
    if (this.options.maxTicks !== undefined && this.#sequence >= this.options.maxTicks) {
      return null;
    }

    // The arrival model is deciding the interval about to elapse, so it is told
    // the one already elapsed. Passing this tick's interval would be circular,
    // and passing zero silently disables any time-based decay it performs.
    const arrivalContext: ArrivalContext = {
      elapsedSincePreviousMs: this.#previousIntervalMs,
      previousMagnitude: this.#previousMagnitude,
      instant: epochMillis(this.#instant),
      sequence: this.#sequence,
    };
    const intervalMs = this.options.arrival.nextIntervalMs(arrivalContext);
    if (!Number.isInteger(intervalMs) || intervalMs < 1) {
      throw new RangeError(
        `Arrival interval must be an integer of at least 1ms, received ${intervalMs}.`,
      );
    }
    this.#instant += intervalMs;
    this.#sequence += 1;

    const context: MagnitudeContext = {
      intervalMs,
      previousMagnitude: this.#previousMagnitude,
      instant: epochMillis(this.#instant),
      sequence: this.#sequence,
    };
    const magnitude = this.options.magnitude.advance(context);
    if (!(magnitude >= 0) || !Number.isFinite(magnitude)) {
      throw new RangeError(`Magnitude must be finite and non-negative, received ${magnitude}.`);
    }

    // Quantise the MAGNITUDE, before the sign. Rounding a magnitude is a
    // symmetric operation; rounding a signed price is not, and that asymmetry is
    // worth up to 22 percentage points of directional edge (ADR-0004).
    const steps = Math.floor(
      magnitude / this.instrument.logQuantum + this.options.streams.rounding.nextFloat64(),
    );

    // The only line in the engine that touches direction.
    const sign = this.options.streams.sign.nextBoolean() ? 1 : -1;

    this.#price += sign * steps;
    this.#previousMagnitude = steps;
    this.#previousIntervalMs = intervalMs;

    return {
      instant: epochMillis(this.#instant),
      sequence: this.#sequence,
      price: logPrice(this.#price),
    };
  }

  snapshot(): EngineSnapshot {
    return {
      sequence: this.#sequence,
      instant: epochMillis(this.#instant),
      price: logPrice(this.#price),
      previousMagnitude: this.#previousMagnitude,
      previousIntervalMs: this.#previousIntervalMs,
      magnitudeState: this.options.magnitude.snapshot(),
      arrivalState: this.options.arrival.snapshot(),
      cursors: this.#cursors(),
    };
  }

  #cursors(): Record<string, string> {
    const cursors: Record<string, string> = {
      sign: formatCursor(this.options.streams.sign.position()),
      rounding: formatCursor(this.options.streams.rounding.position()),
    };
    for (const [name, stream] of Object.entries(this.options.streams.models)) {
      cursors[name] = formatCursor(stream.position());
    }
    return cursors;
  }

  /**
   * Restore the engine to a snapshot: latent model state and the position of
   * every stream.
   *
   * The engine holds no keyring, so it cannot *derive* streams — but it does
   * hold them, so it can seek them. Restore is therefore complete: after it, the
   * engine continues exactly as the original did.
   */
  restore(snapshot: EngineSnapshot): void {
    const expected = new Set(Object.keys(this.#cursors()));
    for (const name of Object.keys(snapshot.cursors)) {
      if (!expected.has(name)) {
        throw new RangeError(
          `Snapshot references stream ${JSON.stringify(name)}, which this engine does not hold.`,
        );
      }
    }
    for (const name of expected) {
      const cursor = snapshot.cursors[name];
      if (cursor === undefined) {
        throw new RangeError(`Snapshot is missing the cursor for stream ${JSON.stringify(name)}.`);
      }
    }

    this.options.streams.sign.seek(parseCursor(snapshot.cursors.sign!));
    this.options.streams.rounding.seek(parseCursor(snapshot.cursors.rounding!));
    for (const [name, stream] of Object.entries(this.options.streams.models)) {
      stream.seek(parseCursor(snapshot.cursors[name]!));
    }

    this.#sequence = snapshot.sequence;
    this.#instant = snapshot.instant;
    this.#price = snapshot.price;
    this.#previousMagnitude = snapshot.previousMagnitude;
    this.#previousIntervalMs = snapshot.previousIntervalMs ?? 0;
    this.options.magnitude.restore(snapshot.magnitudeState);
    this.options.arrival.restore(snapshot.arrivalState);
  }

  /** Current canonical price, without generating a tick. */
  get price(): LogPrice {
    return logPrice(this.#price);
  }

  get sequence(): number {
    return this.#sequence;
  }
}

/** Convert a relative volatility target into log units per tick. */
export function logUnitsPerRelativeMove(relative: number): number {
  if (!(relative > -1) || !Number.isFinite(relative)) {
    throw new RangeError(`Relative move must be finite and greater than -1, received ${relative}.`);
  }
  return ln(1 + relative);
}
