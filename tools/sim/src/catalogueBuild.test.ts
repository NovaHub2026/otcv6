import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type RandomSource } from '@otc/core';
import {
  ASSET_SEATS,
  AUTHORING_RETREAT,
  seatById,
  TailWeightUnreachableError,
  type RegisteredAsset,
} from '@otc/engine';
import {
  entry,
  evidenceRow,
  parse,
  reachableTarget,
  registrationKeyring,
  requestFor,
} from './catalogueBuild.js';

/**
 * PH-26.3, tested under PH-26's phase gate: the builder's pure half.
 *
 * `entry()` is what writes the numbers of thirty markets into
 * `packages/engine/src/catalogue.ts`. A transcription defect there — a dropped
 * digit, a field emitted under the wrong name, a `1_000` that is not 1000 —
 * would ship a market nobody drew, and the reproduction check in PH-26.3 §5.1
 * would not catch it, because that compares the builder's output with the
 * builder's output. This compares it with the values that went in.
 */
const seat = seatById('eurusd-otc');

/** A registered asset with values chosen to be told apart from each other. */
const asset: RegisteredAsset = {
  definition: {
    id: seat.id,
    family: seat.family,
    displayName: seat.displayName,
    referencePrice: seat.referencePrice,
    traits: {
      tempoMs: 706.5268874215556,
      volatility: 6.123456789e-6,
      clustering: 0.15372586708243324,
      burstiness: 0.5870230727400713,
      regimeSpread: 0.9722267597484684,
      structureSpread: 1.0247632649957992,
      durationCoupling: 0.24849584307641298,
      cascadeDepth: 16,
      cascadeSpanMs: 147_401_773.697_707,
      cascadeSpacing: 1.921_501_039_601_74,
      regimeTempo: 1.914818009109728,
      arrivalMemoryMs: 387_519.240_613_385_8,
    },
  },
  instrument: {
    id: seat.id,
    family: seat.family,
    // Deliberately not `evidence.logQuantum`: they are the same number in every
    // real entry, which is exactly why a fixture that made them equal could not
    // tell the two apart. A plant that emitted the evidence's quantum as the
    // instrument's survived the first version of this file.
    logQuantum: 3.1315e-7,
    displayPrecision: 7,
    referencePrice: seat.referencePrice,
  },
  authored: {
    excessKurtosis: 51.7,
    tickRms: 7.5e-6,
    drawnExcessKurtosis: 51.700000000000131,
    retreats: 0,
  },
  evidence: {
    predictedExcessKurtosis: 51.68,
    logQuantum: 3.1314e-7,
    tieRate: 0.0095,
    medianSteps: 72.4,
    meanIntervalMs: 348.0,
    logVariancePerMs: 1.23e-13,
    horizonMs: 30_000,
    simulatedMs: 786_240_000,
    replicates: 3,
    horizons: 78_624,
    volatilityScale: 0.9812,
  },
};

describe('the emitted entry carries every value it was given', () => {
  const source = entry(seat, asset);

  it('is a `recorded(` call naming the seat, and nothing else', () => {
    expect(source.trimStart().startsWith('recorded(')).toBe(true);
    expect(source).toContain(`id: '${seat.id}'`);
    expect(source).toContain(`family: '${seat.family}'`);
    expect(source).toContain(JSON.stringify(seat.displayName));
    // One entry, not two: a builder that emitted a stray call would compile and
    // duplicate a market.
    expect(source.split('recorded(')).toHaveLength(2);
  });

  it('emits every trait, to the digit', () => {
    for (const [name, value] of Object.entries(asset.definition.traits)) {
      const emitted = new RegExp(`${name}: ([^,\\n]+),`).exec(source);
      expect(emitted, `${name} was not emitted`).not.toBeNull();
      expect(Number(emitted![1]!.replace(/_/g, '')), `${name} lost precision`).toBe(value);
    }
  });

  it('emits every measured field of the evidence, to the digit', () => {
    // Within the evidence block alone: `logQuantum` appears twice in an entry —
    // once as the instrument's lattice and once as the evidence's — and a
    // whole-source search read the first for the second.
    const block = source.slice(source.indexOf('displayPrecision:', source.indexOf('logQuantum')));
    for (const [name, value] of Object.entries(asset.evidence)) {
      const emitted = new RegExp(`${name}: ([^,\\n]+),`).exec(block);
      expect(emitted, `${name} was not emitted`).not.toBeNull();
      expect(Number(emitted![1]!.replace(/_/g, '')), `${name} lost precision`).toBe(value);
    }
  });

  it('emits the lattice as the instrument holds it, not as the evidence does', () => {
    // The record carries both, and an entry that emitted one for the other
    // would publish a lattice the calibration never derived.
    expect(asset.instrument.logQuantum).not.toBe(asset.evidence.logQuantum);
    expect(source).toContain(
      `{ logQuantum: ${String(asset.instrument.logQuantum)}, displayPrecision: ${String(
        asset.instrument.displayPrecision,
      )} }`,
    );
  });

  it('carries the provenance a draw has and a hand-authored asset does not', () => {
    // The literal as JavaScript holds it: `51.700000000000131` is not a double,
    // and an emitter that wrote the digits it was handed rather than the number
    // it holds would emit a value the next parse changes.
    expect(source).toContain(`drawnExcessKurtosis: ${String(asset.authored.drawnExcessKurtosis!)}`);
    expect(source).toContain('retreats: 0');
    expect(source).not.toContain('clampedFrom');

    const clamped = entry(seat, {
      ...asset,
      authored: { ...asset.authored, clampedFrom: 130 },
    });
    expect(clamped).toContain('clampedFrom: 130');
    // And the retreats a draw actually took, not a constant (CA9 a8-09).
    const retreated = entry(seat, { ...asset, authored: { ...asset.authored, retreats: 2 } });
    expect(retreated).toContain('retreats: 2');
    expect(retreated).not.toContain('retreats: 0');
  });

  it('writes a round integer as a readable literal that is still the integer', () => {
    // `1_000` reads as a thousand and is one; `1,000` would not compile.
    const index = entry(seatById('mmx-idx-otc'), {
      ...asset,
      definition: { ...asset.definition, id: 'mmx-idx-otc', referencePrice: 1_000 },
      instrument: { ...asset.instrument, id: 'mmx-idx-otc', referencePrice: 1_000 },
    });
    expect(index).toContain('referencePrice: 1_000,');
    expect(index).not.toMatch(/referencePrice: [\d,]*,\d/);
  });
});

describe('the evidence row says what the run did', () => {
  it('carries the seat, the archetype, the tail weight it drew and what it reached', () => {
    const row = evidenceRow({
      seat,
      asset,
      sample: {
        traits: asset.definition.traits,
        excessKurtosis: 51.7,
        tickRms: 7.5e-6,
        dispersion: 0.038,
      },
      retreats: 0,
      simulatedMs: 786_240_000,
      replicates: 3,
      seconds: 10,
    });
    const cells = row.split('|').map((cell) => cell.trim());
    expect(cells[1]).toBe(seat.id);
    expect(cells[2]).toBe(seat.archetype);
    expect(cells[3]).toBe('51.7 → 51.7 (0 retreats)');
    expect(cells[6]).toBe('0.950%');
    // The span each replicate simulated, as the entry records it — not the
    // fit's need (CA9 a3-01).
    expect(cells[9]).toBe('9.1 d × 3');
    const floored = evidenceRow({
      seat,
      asset: { ...asset, evidence: { ...asset.evidence, simulatedMs: 288_000_000 } },
      sample: {
        traits: asset.definition.traits,
        excessKurtosis: 51.7,
        tickRms: 7.5e-6,
        dispersion: 0.038,
      },
      retreats: 0,
      simulatedMs: 288_000_000,
      replicates: 3,
      seconds: 10,
    });
    expect(floored.split('|').map((c) => c.trim())[9]).toBe('3.3 d × 3');
    expect(cells[10]).toBe('10s');
  });

  it('says when the archetype asked for more tail than the rhythm could give', () => {
    const row = evidenceRow({
      seat,
      asset,
      sample: {
        traits: asset.definition.traits,
        excessKurtosis: 117,
        tickRms: 7.5e-6,
        dispersion: 0.038,
        clampedFrom: 130,
      },
      retreats: 2,
      simulatedMs: 786_240_000,
      replicates: 3,
      seconds: 10,
    });
    expect(row).toContain('117.0 → 51.7 (2 retreats, clamped from 130)');
  });
});

describe('the options a run is given', () => {
  it('defaults to every seat, three replicates, and stdout', () => {
    const options = parse([]);
    expect(options).toEqual({
      out: null,
      evidence: null,
      label: 'catalogue-of-thirty',
      seats: null,
      replicates: 3,
    });
  });

  it('reads every flag it documents', () => {
    const options = parse([
      '--out',
      'a.ts',
      '--evidence',
      'b.md',
      '--label',
      'run-7',
      '--seats',
      'eurusd-otc,nu-otc',
      '--replicates',
      '5',
    ]);
    expect(options).toEqual({
      out: 'a.ts',
      evidence: 'b.md',
      label: 'run-7',
      seats: ['eurusd-otc', 'nu-otc'],
      replicates: 5,
    });
  });

  it('refuses what it cannot run', () => {
    expect(() => parse(['--nonsense'])).toThrow(/Unknown option/);
    expect(() => parse(['--replicates', '0'])).toThrow(/positive integer/);
    expect(() => parse(['--replicates', 'many'])).toThrow(/positive integer/);
  });
});

describe('a seat becomes a registration request', () => {
  it('derives under the label `registerAsset` derives under, per asset', () => {
    // The whole reproduction claim rests on this: the keyring is per asset and
    // is `registration-<id>`, so `catalogue.test.ts` can re-author an entry
    // from its record. A run-wide keyring made every entry unreproducible and
    // was the second of PH-26.3's three builds.
    // Under *identical* derive arguments, so what is compared is the keyring
    // and not the label: two seats deriving under their own names differ
    // whatever the keyring is, and a run-wide keyring survived that check.
    const args = { env: 'simulation', asset: 'same-label', purpose: 'x', keyEpoch: 0 } as const;
    const a = registrationKeyring(seat).derive(args);
    const b = registrationKeyring(seatById('nu-otc')).derive(args);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it('asks for the seat’s own budget, name and price, and supplies no precision', () => {
    const { request, retreats } = requestFor(seat);
    expect(request.id).toBe(seat.id);
    expect(request.family).toBe(seat.family);
    expect(request.displayName).toBe(seat.displayName);
    expect(request.referencePrice).toBe(seat.referencePrice);
    expect(request.dispersion).toBe(seat.dispersion);
    // A precision coarser than the lattice is refused after the calibration, so
    // the builder never supplies one (PH-26.2 §8).
    expect(request.displayPrecision).toBeUndefined();
    expect(retreats).toBeGreaterThanOrEqual(0);
    // The draw is inside the seat, which is what makes the asset itself.
    for (const [name, range] of Object.entries(seat.traits)) {
      const drawn = request.traits[name as keyof typeof request.traits];
      expect(drawn, name).toBeGreaterThanOrEqual(range.min);
      expect(drawn, name).toBeLessThanOrEqual(range.max);
    }
  }, 20_000);

  it('is reproducible: the same seat asks for the same thing twice', () => {
    expect(requestFor(seat).request.traits).toEqual(requestFor(seat).request.traits);
  }, 20_000);
});

describe('the authoring retreat (CA9 a8-09)', () => {
  const derive = (purpose: string): RandomSource =>
    MasterKeyring.forTesting('retreat-spec').derive({
      env: 'simulation',
      asset: 'retreat',
      purpose,
      keyEpoch: 0,
    });

  it('retreats by nine-tenths until the tail weight is reachable, and counts the steps', () => {
    const sample = requestFor(seat).sample;
    const reachable = reachableTarget(sample, derive);
    expect(reachable.retreats).toBe(0);
    expect(reachable.target).toBe(sample.excessKurtosis);
    // A drawn tail weight far above what the rhythm can carry: the builder
    // retreats, and the target it returns is the draw times 0.9 per retreat.
    // Probed on this seat: the authoring reaches 5,000 outright and refuses
    // above about 6,300, so 8,000 needs three nine-tenths steps (5,832).
    const heavy = { ...sample, excessKurtosis: 8_000 };
    const retreated = reachableTarget(heavy, derive);
    expect(retreated.retreats).toBeGreaterThan(0);
    expect(retreated.target).toBeCloseTo(
      heavy.excessKurtosis * AUTHORING_RETREAT ** retreated.retreats,
      9,
    );
  }, 60_000);

  it('never returns a target it did not verify', () => {
    // 12,000 × 0.9⁶ is still above the seat's reach: every retreat fails.
    const absurd = { ...requestFor(seat).sample, excessKurtosis: 12_000 };
    expect(() => reachableTarget(absurd, derive)).toThrow(TailWeightUnreachableError);
  }, 60_000);
});

describe('every seat can be asked for', () => {
  it('names a seat for every asset the catalogue will hold', () => {
    expect(ASSET_SEATS.length).toBe(30);
    expect(epochMillis(0)).toBe(0);
  });
});
