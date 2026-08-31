import type {
  Environment,
  EpochMillis,
  InstrumentSpec,
  MasterKeyring,
  TickSource,
} from '@otc/core';

/**
 * Options shared by every fixture.
 *
 * `strength` is the single knob that scales a fixture's planted defect. At zero
 * every fixture must be indistinguishable from the symmetric control, so that
 * the knob isolates the defect and nothing else — that property is what makes a
 * power curve interpretable.
 */
export interface FixtureOptions {
  readonly instrument: InstrumentSpec;
  readonly keyring: MasterKeyring;
  /** Never `production`: these engines leak by design. */
  readonly env: Environment;
  readonly ticks: number;
  readonly startInstant: EpochMillis;
  readonly meanIntervalMs: number;
  /**
   * Defect strength on a uniform `[0, 1]` scale: 0 plants nothing, 1 is the
   * strongest setting that keeps the generator well-behaved. Each fixture maps
   * this onto its own stable parameter range, so a strength is comparable in
   * intent across the corpus even though the mechanisms differ.
   */
  readonly strength: number;
  /** Distinguishes independent runs of the same fixture. */
  readonly keyEpoch?: number;
}

export function assertFixtureOptions(options: FixtureOptions): void {
  if (options.env === 'production') {
    // These engines leak by construction. They must never be able to produce a
    // stream under a production label.
    throw new RangeError('Fixtures may not be created in the production environment.');
  }
  if (!Number.isInteger(options.ticks) || options.ticks <= 0) {
    throw new RangeError(`ticks must be a positive integer, received ${options.ticks}.`);
  }
  if (!Number.isFinite(options.meanIntervalMs) || options.meanIntervalMs <= 0) {
    throw new RangeError(`meanIntervalMs must be positive, received ${options.meanIntervalMs}.`);
  }
  if (!(options.strength >= 0 && options.strength <= 1)) {
    throw new RangeError(`strength must lie in [0, 1], received ${options.strength}.`);
  }
}

export interface Fixture {
  readonly name: string;
  readonly description: string;
  /** The statistic an attacker would exploit. Reported alongside results. */
  readonly defect: string;
  /** Horizons, in ticks, where the defect is expected to be most visible. */
  readonly targetHorizons: readonly number[];
  create(options: FixtureOptions): TickSource;
}
