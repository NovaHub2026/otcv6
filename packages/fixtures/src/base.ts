import {
  epochMillis,
  exp,
  logPrice,
  ln,
  standardNormal,
  type RandomStream,
  type Tick,
} from '@otc/core';
import { assertFixtureOptions, type FixtureOptions } from './types.js';

/**
 * The sign-blind volatility core shared by every fixture.
 *
 * This is the *correct* architecture in miniature: a two-timescale
 * log-volatility process with heavy tails, driving a magnitude that is combined
 * with an independent fair coin. The magnitude process reads only its own latent
 * state and independent randomness — never a sign, never a price level.
 *
 * `symmetricControl` uses it unmodified and is therefore provably free of
 * directional edge. Every other fixture in the corpus is this same core with one
 * specific violation introduced, which is what makes the corpus a clean
 * instrument for measuring a battery's sensitivity: the fixtures differ from the
 * control in exactly one way each.
 *
 * It is a calibration device, not a candidate product. The real generative model
 * is PH-3.
 */

/** Typical per-tick move in log space, before volatility modulation. */
const BASE_LOG_VOLATILITY = 1e-5;

const SLOW_MEAN_REVERSION_PER_MS = 1 / 3_600_000; // ~1 hour
const FAST_MEAN_REVERSION_PER_MS = 1 / 60_000; // ~1 minute
const SLOW_VOL_OF_VOL = 0.35;
const FAST_VOL_OF_VOL = 0.55;

export interface CoreStreams {
  readonly arrival: RandomStream;
  readonly slowVol: RandomStream;
  readonly fastVol: RandomStream;
  readonly magnitude: RandomStream;
  readonly sign: RandomStream;
  readonly jump: RandomStream;
}

export function openStreams(options: FixtureOptions, fixtureName: string): CoreStreams {
  const derive = (purpose: string): RandomStream =>
    options.keyring.derive({
      env: options.env,
      asset: `${options.instrument.id}-${fixtureName}`,
      purpose,
      keyEpoch: options.keyEpoch ?? 0,
    });
  return {
    arrival: derive('arrival'),
    slowVol: derive('volatility-slow'),
    fastVol: derive('volatility-fast'),
    magnitude: derive('magnitude'),
    sign: derive('sign'),
    jump: derive('jump'),
  };
}

/**
 * Latent volatility state. Sign-blind: it is updated from elapsed time and its
 * own driving noise only.
 */
export class VolatilityState {
  #slow = 0;
  #fast = 0;

  advance(streams: CoreStreams, intervalMs: number): number {
    const slowRho = exp(-SLOW_MEAN_REVERSION_PER_MS * intervalMs);
    const fastRho = exp(-FAST_MEAN_REVERSION_PER_MS * intervalMs);
    this.#slow =
      this.#slow * slowRho +
      SLOW_VOL_OF_VOL * Math.sqrt(1 - slowRho * slowRho) * standardNormal(streams.slowVol);
    this.#fast =
      this.#fast * fastRho +
      FAST_VOL_OF_VOL * Math.sqrt(1 - fastRho * fastRho) * standardNormal(streams.fastVol);
    // Clamped so a fixture can never wander into a regime where the lattice
    // itself dominates the statistics and confuses a calibration run.
    const logVol = Math.max(-4, Math.min(4, this.#slow + this.#fast));
    return BASE_LOG_VOLATILITY * exp(logVol);
  }
}

/** Exponential inter-arrival time, at least 1ms so instants never repeat backwards. */
export function nextInterval(streams: CoreStreams, meanIntervalMs: number): number {
  const u = streams.arrival.nextFloat64();
  const raw = -ln(1 - u) * meanIntervalMs;
  return Math.max(1, Math.floor(raw));
}

/**
 * Heavy-tailed magnitude in log space. Sign-blind by construction: nothing here
 * reads a sign or a price.
 */
export function nextMagnitude(streams: CoreStreams, volatility: number): number {
  const z = Math.abs(standardNormal(streams.magnitude));
  // Occasional jumps, so the corpus exercises fat tails as well as clustering.
  const u = streams.jump.nextFloat64();
  const jump = u < 0.002 ? 3 + 5 * streams.jump.nextFloat64() : 1;
  return volatility * z * jump;
}

/**
 * Unbiased stochastic rounding of a log-space magnitude to whole lattice steps.
 *
 * Applied to the MAGNITUDE, before any sign. Rounding a magnitude is a symmetric
 * operation; rounding a signed price is not, and that asymmetry is the
 * quantisation channel the `displayQuantization` fixture exists to demonstrate.
 */
export function quantise(stream: RandomStream, magnitude: number, logQuantum: number): number {
  return Math.floor(magnitude / logQuantum + stream.nextFloat64());
}

/** A tick source built from a per-step function, handling identity and exhaustion. */
export abstract class FixtureSource {
  protected sequence = 0;
  protected instant: number;
  protected price = 0;
  protected readonly streams: CoreStreams;
  protected readonly volatility = new VolatilityState();

  constructor(
    readonly options: FixtureOptions,
    fixtureName: string,
  ) {
    assertFixtureOptions(options);
    this.streams = openStreams(options, fixtureName);
    this.instant = options.startInstant;
  }

  get instrument() {
    return this.options.instrument;
  }

  next(): Tick | null {
    if (this.sequence >= this.options.ticks) return null;
    const intervalMs = nextInterval(this.streams, this.options.meanIntervalMs);
    this.instant += intervalMs;
    this.sequence += 1;
    const canonical = this.step(intervalMs);
    return {
      instant: epochMillis(this.instant),
      sequence: this.sequence,
      price: logPrice(canonical),
    };
  }

  /** Produce the canonical integer price for this tick. */
  protected abstract step(intervalMs: number): number;
}
