// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOGUE } from '@otc/engine';
import { benjaminiHochberg, minimumDetectableEffectUnderDependence } from '@otc/lab';
import { measureHorizonCoverage } from './horizonCoverage.js';

/**
 * The long-horizon coverage evidence, kept honest in two ways.
 *
 * The full run takes tens of minutes and produces
 * `docs/evidence/PH-11-HORIZON-COVERAGE.md`. It is a deliberate act, not
 * something a gate can afford to repeat. That is exactly the shape of the defect
 * PH-10 found in `MEASURED_LATTICE_TIE_RATES`: a recorded measurement that
 * nothing reads, which went stale without anything failing.
 *
 * So two things run on every gate:
 *
 *  1. **The method** — the same machinery at a fraction of the length, so a
 *     regression in the estimator fails here rather than at the next long run.
 *  2. **The record** — the document is parsed and every row is re-derived from
 *     its own recorded sample count and design effect. A stale row, a
 *     transcription slip, or a hand-edited "yes" in the Policed column fails the
 *     build.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const EVIDENCE = 'docs/evidence/PH-11-HORIZON-COVERAGE.md';

describe('the coverage method still works', () => {
  it('measures every horizon from one streaming pass, with no significant edge', async () => {
    const coverage = await measureHorizonCoverage({
      asset: ASSET_CATALOGUE[0]!,
      targetSlowestWindows: 4_000,
      segments: 20,
      keyLabel: 'coverage-method-check',
    });

    expect(coverage.rows).toHaveLength(8);
    expect(coverage.rows[0]!.horizon).toBe('30s');
    expect(coverage.rows[7]!.horizon).toBe('15m');

    // Shorter horizons tile more finely, so they must accumulate more windows
    // from the same path. If this inverts, the tiling is wrong.
    for (let i = 1; i < coverage.rows.length; i += 1) {
      expect(
        coverage.rows[i - 1]!.windows,
        `${coverage.rows[i - 1]!.horizon} vs ${coverage.rows[i]!.horizon}`,
      ).toBeGreaterThan(coverage.rows[i]!.windows);
    }

    const rejected = benjaminiHochberg(
      coverage.rows.map((row) => row.pValue),
      0.05,
    );
    console.info(
      `method check: ${coverage.simulatedDays.toFixed(1)} days, worst |z| ` +
        `${Math.max(...coverage.rows.map((r) => Math.abs(r.z))).toFixed(2)}, ` +
        `${rejected.rejected.length} rejections`,
    );
    expect(rejected.rejected).toEqual([]);
  });

  it('refuses a segmentation it cannot measure a design effect from', async () => {
    await expect(
      measureHorizonCoverage({
        asset: ASSET_CATALOGUE[0]!,
        targetSlowestWindows: 100,
        segments: 2,
        keyLabel: 'coverage-too-few-segments',
      }),
    ).rejects.toThrow(/at least 3 segments/);
  });
});

interface RecordedRow {
  readonly asset: string;
  readonly horizon: string;
  readonly simulatedDays: number;
  readonly decided: number;
  readonly upRate: number;
  readonly edgePoints: number;
  readonly z: number;
  readonly pathBiasZ: number;
  readonly designEffect: number;
  readonly floorPoints: number;
  readonly policed: boolean;
  readonly thresholdPoints: number;
}

function readRecordedRows(): RecordedRow[] {
  const text = readFileSync(path.join(repoRoot, EVIDENCE), 'utf8');
  const rows: RecordedRow[] = [];
  let asset: string | null = null;
  let threshold = Number.NaN;
  let simulatedDays = Number.NaN;

  const header =
    /^(\w+): [\d,]+ ticks, ([\d.]+) simulated days \([\d.]+ years\), \d+ segments, payout threshold ([\d.]+)pp, net displacement -?[\d,]+ steps$/;
  // Whitespace-tolerant on purpose: every markdown file here is Prettier
  // formatted, and Prettier pads table cells to the widest entry in the column.
  // A parser written against one run's column widths silently matches nothing
  // after the next reformat — the exact hazard that produced a stale
  // CURRENT_STATE.md three times before `stateConsistency.test.ts` existed.
  const row = new RegExp(
    '^\\|\\s*(\\S+)\\s*\\|\\s*([\\d,]+)\\s*\\|\\s*([\\d.]+)\\s*\\|\\s*([+-][\\d.]+)\\s*\\|' +
      '\\s*(-?[\\d.]+)\\s*\\|\\s*(-?[\\d.]+)\\s*\\|\\s*([\\d.]+) ±\\d+%\\s*\\|\\s*([\\d.]+)\\s*\\|\\s*(yes|no)\\s*\\|$',
  );

  for (const line of text.split('\n')) {
    const h = header.exec(line);
    if (h !== null) {
      asset = h[1]!;
      simulatedDays = Number.parseFloat(h[2]!);
      threshold = Number.parseFloat(h[3]!);
      continue;
    }
    const m = row.exec(line);
    if (m === null || asset === null) continue;
    rows.push({
      asset,
      horizon: m[1]!,
      simulatedDays,
      decided: Number.parseInt(m[2]!.replace(/,/g, ''), 10),
      upRate: Number.parseFloat(m[3]!),
      edgePoints: Number.parseFloat(m[4]!),
      z: Number.parseFloat(m[5]!),
      pathBiasZ: Number.parseFloat(m[6]!),
      designEffect: Number.parseFloat(m[7]!),
      floorPoints: Number.parseFloat(m[8]!),
      policed: m[9] === 'yes',
      thresholdPoints: threshold,
    });
  }
  return rows;
}

describe('the recorded evidence re-derives from itself', () => {
  const rows = readRecordedRows();

  it('covers every asset at every horizon', () => {
    expect(rows.length).toBe(ASSET_CATALOGUE.length * 8);
    for (const asset of ASSET_CATALOGUE) {
      const forAsset = rows.filter((r) => r.asset === asset.definition.id);
      expect(forAsset, `no rows for ${asset.definition.id}`).toHaveLength(8);
    }
  });

  it('re-derives every floor from its own sample count and design effect', () => {
    // The design effect is recorded to two decimals, so the re-derivation is
    // accurate to about a percent. That is far tighter than any real drift.
    const wrong: string[] = [];
    for (const row of rows) {
      const derived = minimumDetectableEffectUnderDependence(row.decided, row.designEffect) * 100;
      const relative = Math.abs(derived - row.floorPoints) / row.floorPoints;
      if (relative > 0.01) {
        wrong.push(
          `${row.asset} ${row.horizon}: recorded ${row.floorPoints}, derived ${derived.toFixed(4)}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it('re-derives every payout verdict from its own floor', () => {
    // Catches the one edit that would matter most: a "no" turned into a "yes".
    const wrong = rows
      .filter((row) => row.policed !== row.floorPoints < row.thresholdPoints)
      .map((row) => `${row.asset} ${row.horizon}: says ${row.policed ? 'yes' : 'no'}`);
    expect(wrong).toEqual([]);
  });

  it('re-derives every edge from its own up rate', () => {
    const wrong = rows
      .filter((row) => Math.abs((row.upRate - 0.5) * 100 - row.edgePoints) > 0.006)
      .map((row) => `${row.asset} ${row.horizon}`);
    expect(wrong).toEqual([]);
  });

  it('has a path-bias diagnostic that stays flat across horizons', () => {
    // The whole point of the column: the horizon dependence cancels, so within
    // one asset it should barely move. If it starts varying with horizon, the
    // derivation behind it is wrong and the "eight horizons are one test"
    // reading has to be withdrawn.
    const drifting: string[] = [];
    for (const asset of new Set(rows.map((r) => r.asset))) {
      const forAsset = rows.filter((r) => r.asset === asset);
      const values = forAsset.map((r) => r.pathBiasZ);
      const spread = Math.max(...values) - Math.min(...values);
      const magnitude = Math.max(...values.map(Math.abs));
      if (spread > 0.6 * Math.max(magnitude, 0.2)) {
        drifting.push(
          `${asset}: path bias z ranges ${Math.min(...values)}..${Math.max(...values)}`,
        );
      }
      // The sign check that used to sit here was vacuous, and Cycle Audit 4
      // (Minor 8) proved it: `pathBiasZ = netDisplacement · sumAbs /
      // (√windows · sumSquared)`, where `netDisplacement` is ONE scalar per
      // asset and every other term is non-negative. The sign is therefore
      // identical across all eight rows **by construction**, and the assertion
      // could only fire on an exact zero. It could never have been watched
      // failing — the standing hazard this project records.
      //
      // What has teeth instead: the diagnostic must actually track the observed
      // z. If the derivation behind "these horizons are one test" were wrong,
      // the two would decouple.
      const observed = forAsset.map((r) => r.z);
      const bias = forAsset.map((r) => r.pathBiasZ);
      const meanObserved = observed.reduce((a, b) => a + b, 0) / observed.length;
      const meanBias = bias.reduce((a, b) => a + b, 0) / bias.length;
      if (Math.abs(meanBias) > 0.3 && Math.sign(meanObserved) !== Math.sign(meanBias)) {
        drifting.push(
          `${asset}: path bias z averages ${meanBias.toFixed(2)} but observed z averages ` +
            `${meanObserved.toFixed(2)} — the diagnostic and the measurement disagree in sign`,
        );
      }
    }
    expect(drifting).toEqual([]);
  });

  it('re-derives every z from its own columns, so it cannot be edited downward', () => {
    // **Cycle Audit 4, CA4-03.** The record was forgeable in the one direction
    // that matters. An auditor lowered four btcusd z values from 2.64 to 0.10,
    // leaving `decided`, `Up rate`, `Edge`, `Design effect` and `Floor`
    // untouched, and this file reported "worst |z| 1.74, 0 rejections" and
    // passed 8 of 8.
    //
    // The guard was asymmetric: an *inflated* z would have tripped the
    // Benjamini-Hochberg assertion below, but a *suppressed* one sailed through
    // — and suppression is the failure mode a self-approving autonomous loop
    // actually produces.
    //
    // z is fully determined by the other recorded columns, so it gets derived.
    const wrong: string[] = [];
    for (const row of rows) {
      const effective = row.decided / Math.max(row.designEffect, 1);
      const derived = (row.upRate - 0.5) / Math.sqrt(0.25 / effective);
      // The up rate is recorded to five decimals, which is worth about 0.03 of z.
      if (Math.abs(derived - row.z) > 0.05) {
        wrong.push(
          `${row.asset} ${row.horizon}: recorded z ${row.z}, derived ${derived.toFixed(3)}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it('ties every sample count to the run length it claims', () => {
    // The same audit replaced a whole asset's table with an invented run and
    // falsified its header from 4375 simulated days to 87.5 — a fiftyfold
    // arithmetic impossibility, since 87.5 days cannot contain 12.5 million
    // 30-second windows. Nothing checked, and the file passed.
    const seconds: Record<string, number> = {
      '30s': 30,
      '1m': 60,
      '2m': 120,
      '3m': 180,
      '4m': 240,
      '5m': 300,
      '10m': 600,
      '15m': 900,
    };
    const wrong: string[] = [];
    for (const row of rows) {
      const windows = (row.simulatedDays * 86_400) / seconds[row.horizon]!;
      // Decided windows are the total less ties, so the count must sit just
      // under the number the run length allows, and nowhere near above it.
      const ratio = row.decided / windows;
      if (!(ratio > 0.9 && ratio <= 1.0)) {
        wrong.push(
          `${row.asset} ${row.horizon}: ${row.decided} decided against ${Math.round(windows)} ` +
            `windows in ${row.simulatedDays} days (ratio ${ratio.toFixed(3)})`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it('finds no significant edge across all 40 recorded tests', () => {
    // The z is already stated at the effective sample size, so this is the
    // verdict the record actually supports.
    const pValues = rows.map((row) => 2 * (1 - normalCdf(Math.abs(row.z))));
    const rejected = benjaminiHochberg(pValues, 0.05);
    const worst = rows.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
    console.info(
      `recorded evidence: ${rows.length} tests, worst |z| ${Math.abs(worst.z).toFixed(2)} ` +
        `(${worst.asset} ${worst.horizon}), ${rejected.rejected.length} rejections`,
    );
    expect(rejected.rejected).toEqual([]);
  });
});

/** Standard normal CDF, Abramowitz–Stegun 26.2.17. */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
