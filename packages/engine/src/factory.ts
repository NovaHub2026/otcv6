import {
  type Environment,
  type InstrumentSpec,
  type MasterKeyring,
  type RandomSource,
  parseCursor,
} from '@otc/core';
import { CascadeMagnitudeModel, DEFAULT_CASCADE, type CascadeConfig } from './cascade.js';
import { MarketEngine, type EngineStart } from './engine.js';
import {
  DEFAULT_DURATION_COUPLING,
  DEFAULT_HAWKES,
  DurationCouplingModulator,
  HawkesArrivalModel,
  type HawkesConfig,
} from './hawkes.js';
import { ModulatedMagnitudeModel } from './modulator.js';
import { DEFAULT_REGIMES, VolatilityRegimeModulator, type RegimeConfig } from './regime.js';
import { DEFAULT_STRUCTURE, StructurePhaseModulator, type StructureConfig } from './structure.js';

/**
 * The complete parameter set for one synthetic asset.
 *
 * Everything a market's behaviour depends on, in one object. PH-4 varies this to
 * give assets distinct personalities; PH-5 stores it alongside the sealed key.
 */
export interface MarketEngineConfig {
  readonly instrument: InstrumentSpec;
  /** Typical per-tick move in log units, before any modulation. */
  readonly baseVolatility: number;
  readonly cascade: CascadeConfig;
  readonly regimes: RegimeConfig;
  readonly structure: StructureConfig;
  readonly arrival: HawkesConfig;
  /** Amplitude–duration coupling exponent, in `[0, 1]`. */
  readonly durationCoupling: number;
}

/**
 * Defaults calibrated against the PH-2 realism battery.
 *
 * `baseVolatility` puts a typical tick at about ten lattice steps on a
 * `1e-6` grid, which keeps ties rare and the quote grid far from being a
 * tradeable signal in its own right.
 */
export const DEFAULT_ENGINE_CONFIG: Omit<MarketEngineConfig, 'instrument'> = {
  baseVolatility: 1e-5,
  cascade: DEFAULT_CASCADE,
  regimes: DEFAULT_REGIMES,
  structure: DEFAULT_STRUCTURE,
  arrival: DEFAULT_HAWKES,
  durationCoupling: DEFAULT_DURATION_COUPLING,
};

/** Stream purposes the engine derives. Each gets its own key. */
export const ENGINE_STREAM_PURPOSES = [
  'sign',
  'rounding',
  'cascade',
  'shock',
  'arrival',
  'regime',
  'structure',
] as const;

export interface CreateEngineOptions {
  readonly config: MarketEngineConfig;
  readonly keyring: MasterKeyring;
  readonly environment: Environment;
  readonly keyEpoch?: number;
  readonly start: EngineStart;
  readonly maxTicks?: number;
  /**
   * Stream positions to resume from, by purpose.
   *
   * A restart supplies the **leased** high-water mark rather than the position
   * recorded in the snapshot, so no keystream position is ever consumed twice
   * (ADR-0002 §4).
   */
  readonly cursors?: Readonly<Record<string, string>>;
  /**
   * Streams to use instead of deriving them.
   *
   * For a runtime that manages stream lifetimes itself, and for the mirror
   * harness, which must substitute the sign source while leaving every other
   * stream identical.
   */
  readonly streams?: Readonly<Partial<Record<string, RandomSource>>>;
}

/**
 * Build the canonical engine.
 *
 * Every stream is derived under a label carrying the environment, the instrument
 * and the purpose, so two assets are cryptographically isolated from each other
 * and a simulation can never collide with production — that separation is a
 * property of the key derivation, not of configuration discipline.
 */
export function createMarketEngine(options: CreateEngineOptions): MarketEngine {
  const { config, keyring, environment, start } = options;
  const keyEpoch = options.keyEpoch ?? 0;

  const streams: Record<string, RandomSource> = {};
  for (const purpose of ENGINE_STREAM_PURPOSES) {
    const stream =
      options.streams?.[purpose] ??
      keyring.derive({
        env: environment,
        asset: config.instrument.id,
        purpose,
        keyEpoch,
      });
    const cursor = options.cursors?.[purpose];
    if (cursor !== undefined) stream.seek(parseCursor(cursor));
    streams[purpose] = stream;
  }

  const magnitude = new ModulatedMagnitudeModel(
    new CascadeMagnitudeModel(
      config.baseVolatility,
      config.cascade,
      streams.cascade!,
      streams.shock!,
    ),
    [
      new VolatilityRegimeModulator(config.regimes, streams.regime!),
      new StructurePhaseModulator(config.structure, streams.structure!),
      new DurationCouplingModulator(config.durationCoupling, config.arrival.baseIntervalMs),
    ],
  );

  return new MarketEngine({
    instrument: config.instrument,
    magnitude,
    arrival: new HawkesArrivalModel(config.arrival, streams.arrival!),
    streams: {
      sign: streams.sign!,
      rounding: streams.rounding!,
      models: {
        cascade: streams.cascade!,
        shock: streams.shock!,
        arrival: streams.arrival!,
        regime: streams.regime!,
        structure: streams.structure!,
      },
    },
    start,
    ...(options.maxTicks === undefined ? {} : { maxTicks: options.maxTicks }),
  });
}

/** Convenience: the default configuration for a given instrument. */
export function defaultConfigFor(instrument: InstrumentSpec): MarketEngineConfig {
  return { instrument, ...DEFAULT_ENGINE_CONFIG };
}
