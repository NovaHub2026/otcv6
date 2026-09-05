import { MasterKeyring, type RandomSource } from '@otc/core';
import {
  authorPersonality,
  registrationKeyLabel,
  sampleArchetype,
  seatArchetype,
  TailWeightUnreachableError,
  type ArchetypeSample,
  type AssetSeat,
  type RegisteredAsset,
  type RegistrationRequest,
} from '@otc/engine';

/**
 * The catalogue builder's pure half: options, the authoring retreat, the
 * request a seat becomes, and the source an entry is emitted as.
 *
 * **PH-26.3, split out under PH-26's phase gate.** `buildCatalogue.ts` is a
 * deliberate act — it runs for minutes and writes files — so it is
 * uncoverable by a unit suite, and three hundred uncovered lines of it dropped
 * `tools/sim` below its coverage floor. The floor is a ratchet and lowering
 * one is a decision; the honest answer was that the emitter deserved a test
 * anyway. It is what writes the numbers of thirty markets into source, and a
 * transcription defect there would ship a market nobody drew.
 *
 * The split is the one `catalogueLibrary.ts` and `catalogueLibraryWrite.ts`
 * already use: everything decidable without a simulation lives here, and the
 * runner beside it does the simulating and the writing.
 */
export interface Options {
  out: string | null;
  evidence: string | null;
  label: string;
  seats: string[] | null;
  replicates: number;
}

export function parse(argv: readonly string[]): Options {
  const options: Options = {
    out: null,
    evidence: null,
    label: 'catalogue-of-thirty',
    seats: null,
    replicates: 3,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--out':
        options.out = value ?? null;
        i += 1;
        break;
      case '--evidence':
        options.evidence = value ?? null;
        i += 1;
        break;
      case '--label':
        options.label = value ?? '';
        i += 1;
        break;
      case '--seats':
        options.seats = (value ?? '').split(',').filter((s) => s.length > 0);
        i += 1;
        break;
      case '--replicates':
        options.replicates = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      default:
        throw new Error(`Unknown option ${String(flag)}`);
    }
  }
  if (!Number.isInteger(options.replicates) || options.replicates < 1) {
    throw new Error('--replicates must be a positive integer');
  }
  return options;
}

const AUTHORING_RETREAT = 0.9;
const AUTHORING_ATTEMPTS = 6;

/**
 * The tail weight this rhythm can actually be authored to.
 *
 * The same retreat `requestFromBrief` applies — nine tenths per attempt, six
 * attempts — because the analytic gate's structure term is estimated by
 * simulation and a target the sampler thought reachable is occasionally not.
 */
export function reachableTarget(
  sample: ArchetypeSample,
  derive: (purpose: string) => RandomSource,
): { target: number; retreats: number } {
  let target = sample.excessKurtosis;
  for (let retreats = 0; retreats < AUTHORING_ATTEMPTS; retreats += 1) {
    try {
      authorPersonality(sample.traits, { excessKurtosis: target, tickRms: sample.tickRms }, derive);
      return { target, retreats };
    } catch (error) {
      if (!(error instanceof TailWeightUnreachableError)) throw error;
      target *= AUTHORING_RETREAT;
    }
  }
  // Never an unverified target (Cycle Audit 9, a8-09): a seat whose tail
  // weight is unreachable after every retreat is a seat the builder cannot
  // author, and saying so beats compiling a personality nobody solved.
  throw new TailWeightUnreachableError(
    `${String(sample.excessKurtosis)} is unreachable after ${String(AUTHORING_ATTEMPTS)} retreats ` +
      `(last tried ${String(target)})`,
  );
}

/**
 * The streams an asset is authored from.
 *
 * Exactly the convention `catalogue.test.ts` re-derives every entry with —
 * `MasterKeyring.forTesting(registrationKeyLabel(id))`, asset label the id —
 * so "the recorded personalities reproduce from their targets" stays a guard
 * over the thirty rather than a property of five hand-authored entries. The
 * label is per asset and is the id; nothing else seeds a personality.
 */
export function registrationKeyring(seat: AssetSeat): MasterKeyring {
  return MasterKeyring.forTesting(registrationKeyLabel(seat.id));
}

export function requestFor(seat: AssetSeat): {
  request: RegistrationRequest;
  sample: ArchetypeSample;
  retreats: number;
} {
  const keyring = registrationKeyring(seat);
  const derive = (purpose: string): RandomSource =>
    keyring.derive({
      env: 'simulation',
      asset: seat.id,
      purpose,
      keyEpoch: 0,
    });
  const sample = sampleArchetype(seatArchetype(seat), derive('brief'));
  const { target, retreats } = reachableTarget(sample, derive);
  return {
    sample,
    retreats,
    request: {
      id: seat.id,
      family: seat.family,
      displayName: seat.displayName,
      referencePrice: seat.referencePrice,
      traits: sample.traits,
      targets: {
        excessKurtosis: target,
        tickRms: sample.tickRms,
        drawnExcessKurtosis: sample.excessKurtosis,
        retreats,
        ...(sample.clampedFrom === undefined ? {} : { clampedFrom: sample.clampedFrom }),
      },
      dispersion: seat.dispersion,
    },
  };
}

export const num = (value: number): string => {
  if (Number.isInteger(value)) return value.toLocaleString('en-US').replace(/,/g, '_');
  return String(value);
};

/** One compiled entry, in the shape `catalogue.ts` holds. */
export function entry(seat: AssetSeat, asset: RegisteredAsset): string {
  const t = asset.definition.traits;
  const a = asset.authored;
  const e = asset.evidence;
  const i = asset.instrument;
  return `  recorded(
    {
      id: '${seat.id}',
      family: '${seat.family}',
      displayName: ${JSON.stringify(seat.displayName)},
      referencePrice: ${num(seat.referencePrice)},
      traits: {
        tempoMs: ${t.tempoMs},
        volatility: ${t.volatility},
        clustering: ${t.clustering},
        burstiness: ${t.burstiness},
        regimeSpread: ${t.regimeSpread},
        structureSpread: ${t.structureSpread},
        durationCoupling: ${t.durationCoupling},
        cascadeDepth: ${t.cascadeDepth},
        cascadeSpanMs: ${t.cascadeSpanMs},
        cascadeSpacing: ${t.cascadeSpacing},
        regimeTempo: ${t.regimeTempo},
        arrivalMemoryMs: ${t.arrivalMemoryMs},
      },
    },
    {
      excessKurtosis: ${a.excessKurtosis},
      tickRms: ${a.tickRms},${
        a.drawnExcessKurtosis === undefined
          ? ''
          : `\n      drawnExcessKurtosis: ${a.drawnExcessKurtosis},`
      }${a.retreats === undefined ? '' : `\n      retreats: ${a.retreats},`}${
        a.clampedFrom === undefined ? '' : `\n      clampedFrom: ${a.clampedFrom},`
      }
    },
    { logQuantum: ${i.logQuantum}, displayPrecision: ${i.displayPrecision} },
    {
      predictedExcessKurtosis: ${e.predictedExcessKurtosis},
      logQuantum: ${e.logQuantum},
      tieRate: ${e.tieRate},
      medianSteps: ${e.medianSteps},
      meanIntervalMs: ${e.meanIntervalMs},
      logVariancePerMs: ${e.logVariancePerMs},
      horizonMs: ${e.horizonMs},
      simulatedMs: ${e.simulatedMs},
      replicates: ${e.replicates},
      horizons: ${e.horizons},
      volatilityScale: ${e.volatilityScale},
    },
  ),`;
}

/** One row of the run's evidence table: what a seat drew, and what it calibrated to. */
export function evidenceRow(options: {
  readonly seat: AssetSeat;
  readonly asset: RegisteredAsset;
  readonly sample: ArchetypeSample;
  readonly retreats: number;
  /**
   * Days simulated per replicate, as the compiled entry records them
   * (`evidence.simulatedMs`). **Cycle Audit 9 (a3-01):** this column printed
   * the dispersion fit's *need* (`minimumDispersionSpanMs`), not the span the
   * calibration ran — false for the six assets whose need fell under the
   * ten-day floor (DOGE read "1.2 d × 3" for a 3.3-day replicate).
   */
  readonly simulatedMs: number;
  readonly replicates: number;
  readonly seconds: number;
}): string {
  const { seat, asset, sample, retreats, simulatedMs, replicates, seconds } = options;
  const clamped = sample.clampedFrom === undefined ? '' : `, clamped from ${sample.clampedFrom}`;
  return (
    `| ${seat.id} | ${seat.archetype} | ${sample.excessKurtosis.toFixed(1)} → ` +
    `${asset.authored.excessKurtosis.toFixed(1)} (${String(retreats)} retreats${clamped}) ` +
    `| ${asset.evidence.logQuantum.toExponential(4)} | ${String(asset.instrument.displayPrecision)} ` +
    `| ${(asset.evidence.tieRate * 100).toFixed(3)}% | ${asset.evidence.medianSteps.toFixed(0)} ` +
    `| ${asset.evidence.meanIntervalMs.toFixed(1)} | ${(simulatedMs / 86_400_000).toFixed(1)} d × ` +
    `${String(replicates)} | ${String(seconds)}s |`
  );
}
