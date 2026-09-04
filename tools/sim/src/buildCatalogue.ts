#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { MasterKeyring, type RandomSource } from '@otc/core';
import {
  ASSET_SEATS,
  authorPersonality,
  minimumDispersionSpanMs,
  registerAsset,
  registrationKeyLabel,
  sampleArchetype,
  seatArchetype,
  TailWeightUnreachableError,
  traitDistanceCheck,
  type ArchetypeSample,
  type AssetSeat,
  type RegisteredAsset,
  type RegistrationRequest,
} from '@otc/engine';

/**
 * Build the catalogue of thirty: draw, author, calibrate and differentiate
 * every seat, and emit the compiled catalogue and its evidence.
 *
 * **PH-26.3.** This is the run that produces `packages/engine/src/catalogue.ts`'s
 * thirty entries. It is a **deliberate act**, not a test: it takes on the order
 * of an hour, and its output is a recorded artefact that later work cites.
 * `catalogue.stat.test.ts` re-runs the same calibration on a stratified sample
 * at every gate, so the method stays checked even though the full run does not.
 *
 * Every number in the emitted file is produced here, from a named keyring
 * label, and the label is written into the file's header with the command that
 * regenerates it. A catalogue whose constants nobody can reproduce is decoration.
 *
 * Usage:
 *   node tools/sim/dist/buildCatalogue.js [--out FILE] [--evidence FILE] [--label NAME]
 *                                         [--seats a,b] [--replicates N]
 */

interface Options {
  out: string | null;
  evidence: string | null;
  label: string;
  seats: string[] | null;
  replicates: number;
}

function parse(argv: readonly string[]): Options {
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
function reachableTarget(
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
  return { target, retreats: AUTHORING_ATTEMPTS };
}

function requestFor(
  seat: AssetSeat,
  keyring: MasterKeyring,
): { request: RegistrationRequest; sample: ArchetypeSample; retreats: number } {
  const derive = (purpose: string): RandomSource =>
    keyring.derive({
      env: 'simulation',
      asset: registrationKeyLabel(seat.id),
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

const num = (value: number): string => {
  if (Number.isInteger(value)) return value.toLocaleString('en-US').replace(/,/g, '_');
  return String(value);
};

/** One compiled entry, in the shape `catalogue.ts` holds. */
function entry(seat: AssetSeat, asset: RegisteredAsset): string {
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

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const seats = ASSET_SEATS.filter(
    (seat) => options.seats === null || options.seats.includes(seat.id),
  );
  if (seats.length === 0) throw new Error('No seats selected.');

  const keyring = MasterKeyring.forTesting(options.label);
  const differentiates = traitDistanceCheck();
  const built: RegisteredAsset[] = [];
  const entries: string[] = [];
  const evidence: string[] = [];
  const started = Date.now();

  for (const seat of seats) {
    const seatStarted = Date.now();
    process.stderr.write(`${seat.id}: drawing from ${seat.archetype}\n`);
    const { request, sample, retreats } = requestFor(seat, keyring);
    const span = minimumDispersionSpanMs(request.traits);
    const outcome = await registerAsset(request, {
      keyring,
      environment: 'simulation',
      existing: built,
      differentiates,
      // Replicates of a share of the span the dispersion fit needs, combined
      // by median — CA6-26: one realisation puts a 1% quantile of a
      // heavy-tailed variable only within 18.5%.
      calibration: { replicates: options.replicates, simulatedMs: span / options.replicates },
      onStage: (stage) => process.stderr.write(`  ${seat.id}: ${stage}\n`),
    });
    if (outcome.kind !== 'registered') {
      throw new Error(`${seat.id} refused at ${outcome.stage}: ${outcome.reason}`);
    }
    const asset = outcome.asset;
    built.push(asset);
    entries.push(entry(seat, asset));
    const seconds = ((Date.now() - seatStarted) / 1000).toFixed(0);
    evidence.push(
      `| ${seat.id} | ${seat.archetype} | ${sample.excessKurtosis.toFixed(1)} → ${asset.authored.excessKurtosis.toFixed(1)}` +
        ` (${retreats} retreats${sample.clampedFrom === undefined ? '' : `, clamped from ${sample.clampedFrom}`}) ` +
        `| ${asset.evidence.logQuantum.toExponential(4)} | ${asset.instrument.displayPrecision} ` +
        `| ${(asset.evidence.tieRate * 100).toFixed(3)}% | ${asset.evidence.medianSteps.toFixed(0)} ` +
        `| ${asset.evidence.meanIntervalMs.toFixed(1)} | ${(span / 86_400_000).toFixed(1)} d × ${options.replicates} | ${seconds}s |`,
    );
    process.stderr.write(
      `${seat.id}: registered in ${seconds}s — quantum ${asset.evidence.logQuantum.toExponential(3)}, ` +
        `precision ${asset.instrument.displayPrecision}, tie ${(asset.evidence.tieRate * 100).toFixed(3)}%\n`,
    );
  }

  const minutes = ((Date.now() - started) / 1000 / 60).toFixed(1);
  const header =
    `// GENERATED by tools/sim/src/buildCatalogue.ts — do not edit by hand.\n` +
    `// Regenerate with: npm run catalogue:build -- --label ${options.label} --replicates ${String(options.replicates)}\n` +
    `// Keyring label: ${options.label}. Run time: ${minutes} minutes.\n`;
  const body = `${header}\nexport const CATALOGUE_OF_THIRTY_ENTRIES = [\n${entries.join('\n')}\n];\n`;
  if (options.out === null) process.stdout.write(body);
  else writeFileSync(options.out, body, 'utf8');

  const table =
    `| asset | archetype | tail weight drawn → authored | quantum | precision | tie rate | median steps | mean interval ms | calibration | time |\n` +
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${evidence.join('\n')}\n\n` +
    `Keyring label: \`${options.label}\`. Replicates: ${String(options.replicates)}. Total run time: ${minutes} minutes.\n`;
  if (options.evidence !== null) writeFileSync(options.evidence, table, 'utf8');
  else process.stderr.write(`\n${table}`);
}

await main();
