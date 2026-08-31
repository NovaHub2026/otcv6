import { describe, expect, it } from 'vitest';
import { epochMillis, MasterKeyring, type InstrumentSpec } from '@otc/core';
import { fixtureByName } from '@otc/fixtures';
import { buildObserverDataset, type ObserverDataset } from '../observer.js';
import { formatVerdict, runBatteryAsync, type Verdict } from './battery.js';
import { LogisticAttackFamily } from './learned.js';
import { ATTACK_FAMILIES } from './registry.js';

/**
 * Calibration of the battery against the PH-1 planted-edge corpus.
 *
 * This is the evidence the phase exists to produce. A battery reporting "no edge
 * found" is worthless until it has been shown capable of reporting the opposite,
 * and the corpus is the only place where the right answer is known in advance.
 */

const instrument: InstrumentSpec = {
  id: 'calib-otc',
  family: 'forex',
  logQuantum: 1e-6,
  displayPrecision: 5,
  referencePrice: 1.1,
};

const keyring = MasterKeyring.forTesting('battery-calibration');

/** 5-second mean interval buys simulated years per unit of memory. */
const INTERVAL_MS = 5_000;
/**
 * Sized so the shortest horizon actually reaches a detection floor finer than
 * the 0.2513pp threshold the promotional payout implies. At three million ticks
 * the floor was 0.2588pp — just above it, which would have made a clean verdict
 * unable to police the product it exists to police.
 */
const TICKS = 4_000_000;
/** The level-anchored defect is the hardest to detect and needs more history. */
const LEVEL_TICKS = 6_000_000;

const cache = new Map<string, ObserverDataset>();

async function dataset(name: string, strength: number, ticks = TICKS): Promise<ObserverDataset> {
  const key = `${name}@${strength}@${ticks}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const built = await buildObserverDataset({
    source: fixtureByName(name).create({
      instrument,
      keyring,
      env: 'simulation',
      ticks,
      startInstant: epochMillis(1_776_000_000_000),
      meanIntervalMs: INTERVAL_MS,
      strength,
    }),
    maxTicks: ticks,
  });
  cache.set(key, built);
  return built;
}

function summarise(name: string, verdict: Verdict): void {
  const kinds: Record<string, number> = {};
  for (const finding of verdict.exploitable) {
    kinds[finding.featureKind] = (kinds[finding.featureKind] ?? 0) + 1;
  }
  console.info(
    `${name}: ${verdict.clean ? 'clean' : 'EXPLOITABLE'} — ` +
      `${verdict.coverage.hypothesesTested} hypotheses, ` +
      `worst z=${verdict.worst?.z.toFixed(2) ?? 'n/a'} (${verdict.worst?.family ?? '-'}), ` +
      `exploitable by kind ${JSON.stringify(kinds)}, ${verdict.elapsedSeconds.toFixed(1)}s`,
  );
}

describe('the control', () => {
  it('returns a clean verdict, and states the sensitivity that produced it', async () => {
    const verdict = await runBatteryAsync(await dataset('symmetricControl', 0));
    summarise('symmetricControl', verdict);
    console.info(formatVerdict(verdict));
    expect(verdict.clean).toBe(true);
    expect(verdict.coverage.hypothesesTested).toBeGreaterThan(300);
    // Every feature kind must actually have been exercised, or "clean" means
    // less than it appears.
    expect([...verdict.coverage.featureKinds].sort()).toEqual([
      'learned',
      'level-anchored',
      'temporal',
      'translation-invariant',
    ]);
    // The shortest horizon must reach a floor finer than the payout threshold,
    // or the battery cannot police the product at all.
    const shortest = verdict.sensitivity[0]!;
    expect(shortest.minimumDetectableEffectPoints).toBeLessThan(0.2513);
  });
});

describe('planted defects are detected', () => {
  it.each([
    ['drift', 1],
    ['leverageEffect', 1],
    ['signAutocorrelation', 1],
    ['displayQuantization', 1],
    ['boundaryTiming', 1],
  ])('%s at strength %i is caught', async (name, strength) => {
    const verdict = await runBatteryAsync(await dataset(name, strength));
    summarise(name, verdict);
    expect(verdict.clean).toBe(false);
    expect(verdict.exploitable.length).toBeGreaterThan(0);
  });

  it('names the family that caught each defect', async () => {
    const verdict = await runBatteryAsync(await dataset('signAutocorrelation', 1));
    const families = new Set(verdict.exploitable.map((f) => f.family));
    // Sign persistence is exactly what the simplest family exists to catch.
    expect(families).toContain('previous-move');
  });

  it('boundary timing is caught by a temporal family, as its defect implies', async () => {
    const verdict = await runBatteryAsync(await dataset('boundaryTiming', 1));
    const temporal = verdict.exploitable.filter((f) => f.featureKind === 'temporal');
    expect(temporal.length).toBeGreaterThan(0);
    expect(temporal.map((f) => f.family)).toContain('second-of-minute');
  });
});

describe('the level-anchored blind spot', () => {
  /**
   * The single most important result in this phase.
   *
   * A conventional battery — translation-invariant and temporal features, which
   * is everything a normal validation suite contains — certifies a demonstrably
   * exploitable engine as clean. Only the level-anchored families see it.
   */
  it('a conventional battery certifies the leaking engine as clean', async () => {
    const conventional = ATTACK_FAMILIES.filter(
      (f) => f.featureKind === 'translation-invariant' || f.featureKind === 'temporal',
    );
    const verdict = await runBatteryAsync(
      await dataset('levelAnchoredVolatility', 1, LEVEL_TICKS),
      {
        families: conventional,
      },
    );
    summarise('levelAnchored / conventional battery', verdict);
    expect(verdict.coverage.hypothesesTested).toBeGreaterThan(200);
    expect(verdict.clean).toBe(true);
  });

  it('the full battery catches it, through a level-anchored family', async () => {
    const verdict = await runBatteryAsync(await dataset('levelAnchoredVolatility', 1, LEVEL_TICKS));
    summarise('levelAnchored / full battery', verdict);
    expect(verdict.clean).toBe(false);
    const levelFindings = verdict.exploitable.filter((f) => f.featureKind === 'level-anchored');
    expect(levelFindings.length).toBeGreaterThan(0);
    // The sweep must find the cell width the fixture actually uses.
    expect(verdict.exploitable.map((f) => f.family)).toContain('price-modulo-4000');
  });

  it('the swept cell family recovers the correct opposite signs', async () => {
    const verdict = await runBatteryAsync(await dataset('levelAnchoredVolatility', 1, LEVEL_TICKS));
    const cell = verdict.findings.filter(
      (f) => f.family === 'price-modulo-4000' && f.horizon === '30s',
    );
    expect(cell).toHaveLength(2);
    // Volatility troughs sit at the cell boundaries, so below the centre the
    // median drifts down and above it drifts up.
    expect(cell[0]!.edgePoints).toBeLessThan(0);
    expect(cell[1]!.edgePoints).toBeGreaterThan(0);
  });

  it('the learned family also sees it, because its features include price-cell phase', async () => {
    // Recorded deliberately: the learned family straddles the taxonomy, which is
    // why the conventional-battery comparison above excludes it.
    const learned = new LogisticAttackFamily();
    const verdict = await runBatteryAsync(
      await dataset('levelAnchoredVolatility', 1, LEVEL_TICKS),
      {
        families: [learned],
      },
    );
    expect(verdict.exploitable.length).toBeGreaterThan(0);
  });
});
