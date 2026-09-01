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

  const header =
    /^(\w+): [\d,]+ ticks, [\d.]+ simulated days \([\d.]+ years\), \d+ segments, payout threshold ([\d.]+)pp, net displacement -?[\d,]+ steps$/;
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
      threshold = Number.parseFloat(h[2]!);
      continue;
    }
    const m = row.exec(line);
    if (m === null || asset === null) continue;
    rows.push({
      asset,
      horizon: m[1]!,
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
      // And every horizon of one asset must agree on the direction of the bias.
      if (new Set(values.map((v) => Math.sign(v))).size > 1) {
        drifting.push(`${asset}: path bias z changes sign across horizons`);
      }
    }
    expect(drifting).toEqual([]);
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
