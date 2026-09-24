import {
  type Environment,
  type InstrumentSpec,
  type MasterKeyring,
  type RandomSource,
  parseCursor,
} from '@otc/core';
import {
  cascadeTypicalProduct,
  CascadeMagnitudeModel,
  DEFAULT_CASCADE,
  type CascadeConfig,
} from './cascade.js';
import { MarketEngine, type EngineStart } from './engine.js';
import {
  DEFAULT_DURATION_COUPLING,
  DEFAULT_HAWKES,
  DurationCouplingModulator,
  HawkesArrivalModel,
  type HawkesConfig,
} from './hawkes.js';
import { VolatilityFloorModulator, type VolatilityFloorConfig } from './floor.js';
import { ModulatedMagnitudeModel, type Modulator } from './modulator.js';
import {
  DEFAULT_REGIMES,
  relativeRegimeLevel,
  VolatilityRegimeModulator,
  type RegimeConfig,
} from './regime.js';
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
  /**
   * The floor under the volatility level (PH-34), or null for none. Null is
   * what every configuration before PH-34 meant, and the mechanism tests use
   * it to isolate a layer.
   */
  readonly volatilityFloor: VolatilityFloorConfig | null;
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
  // Calm is the floor: nothing takes the market below the compressed regime's
  // level at the cascade's typical state.
  volatilityFloor: {
    level: relativeRegimeLevel('compressed'),
    cascadeReference: cascadeTypicalProduct(DEFAULT_CASCADE),
  },
};

/**
 * Which market model this engine is (PH-34).
 *
 * The runtime folds it into every checkpoint's personality fingerprint, so a
 * checkpoint written by an engine with other regimes, arrivals or floor is
 * seamed rather than restored into this one. The traits alone did not say it:
 * PH-34 changed what every trait means without changing a single one, and a
 * snapshot restored across that line would continue a market with one model's
 * latent state under another's rules.
 */
export const ENGINE_MODEL = 'ph-37';

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

  // One regime, read by both halves of a tick: its multiplier sizes the move,
  // and its activity sets the arrival rate the move came at (PH-34).
  const regime = new VolatilityRegimeModulator(config.regimes, streams.regime!);
  const structure = new StructurePhaseModulator(config.structure, streams.structure!);
  const inner = new CascadeMagnitudeModel(
    config.baseVolatility,
    config.cascade,
    streams.cascade!,
    streams.shock!,
  );
  const modulators: Modulator[] = [
    regime,
    structure,
    new DurationCouplingModulator(config.durationCoupling, config.arrival.baseIntervalMs),
  ];
  if (config.volatilityFloor !== null) {
    // Last, because it reads the layers above it after they have advanced.
    modulators.push(
      new VolatilityFloorModulator(config.volatilityFloor, {
        regimeLevel: () => regime.levelInForce,
        cascadeProduct: () => inner.cascade.current(),
        structureMultiplier: () => structure.multiplierInForce,
      }),
    );
  }
  const magnitude = new ModulatedMagnitudeModel(inner, modulators);

  return new MarketEngine({
    instrument: config.instrument,
    magnitude,
    arrival: new HawkesArrivalModel(config.arrival, streams.arrival!, regime),
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
