// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  benjaminiHochberg,
  minimumDetectableEffectUnderDependence,
  twoSidedPValue,
} from '@otc/lab';
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
  /** Which `## Run N` section this row came from. */
  readonly run: number;
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

interface RecordedRun {
  readonly run: number;
  readonly asset: string;
  readonly ticks: number;
  readonly simulatedDays: number;
}

/** The per-asset run headers: which run, how many ticks, how long. */
function readRecordedRuns(): RecordedRun[] {
  const text = readFileSync(path.join(repoRoot, EVIDENCE), 'utf8');
  const runs: RecordedRun[] = [];
  let run = 0;
  const header = /^([\w-]+): ([\d,]+) ticks, ([\d.]+) simulated days \(/;
  for (const line of text.split('\n')) {
    const r = /^## Run (\d+)/.exec(line);
    if (r !== null) {
      run = Number.parseInt(r[1]!, 10);
      continue;
    }
    const h = header.exec(line);
    if (h === null) continue;
    runs.push({
      run,
      asset: h[1]!,
      ticks: Number.parseInt(h[2]!.replace(/,/g, ''), 10),
      simulatedDays: Number.parseFloat(h[3]!),
    });
  }
  return runs;
}

interface RecordedSummary {
  readonly totalBillionTicks: number;
  readonly totalAssetYears: number;
  readonly policedBillionTicks: number;
  readonly policedAssetYears: number;
  readonly worstZ: number;
  readonly worstAsset: string;
  readonly worstHorizon: string;
  readonly effectiveTests: number;
  readonly familyWiseErrorRate: number;
}

/**
 * The summary and interpretation lines, which no test read until the
 * out-of-band audit (a4-10) — Cycle Audit 5 had found the summary wrong (2.5
 * billion / 62 asset-years, neither total) while this file advertised itself as
 * re-deriving the record.
 */
function readRecordedSummary(): RecordedSummary {
  const text = readFileSync(path.join(repoRoot, EVIDENCE), 'utf8');
  // Whitespace-tolerant between words, for the reason the row parser is:
  // Prettier wraps prose, and the family-wise line already breaks mid-sentence.
  const phrase = (words: string): RegExp => new RegExp(words.split(' ').join('\\s+'));
  // PH-26.3: the cell count is the catalogue's, not the word "forty". The
  // record says how many cells it polices and which run they came from, and
  // both are read back rather than assumed.
  const cells = String(ASSET_CATALOGUE.length * 8);
  const totals = phrase(
    'Total across all runs: \\*\\*([\\d.]+) billion ticks\\*\\*, ([\\d.]+) asset-years\\. ' +
      `The ${cells} cells are run 1 alone: \\*\\*([\\d.]+) billion ticks\\*\\*, ([\\d.]+) asset-years`,
  ).exec(text);
  const worst = phrase(
    `Worst \\|z\\| across the ${cells} is ([\\d.]+) \\(([\\w-]+), (\\w+)\\)`,
  ).exec(text);
  const effective = phrase(`Effective independent tests: \\*\\*≈ (\\d+) of ${cells}\\*\\*`).exec(
    text,
  );
  const fwer = phrase('Family-wise error rate for the observed worst cell: ([\\d.]+)\\.').exec(
    text,
  );
  if (totals === null || worst === null || effective === null || fwer === null) {
    throw new Error('The summary or interpretation lines of the horizon record did not parse.');
  }
  return {
    totalBillionTicks: Number.parseFloat(totals[1]!),
    totalAssetYears: Number.parseFloat(totals[2]!),
    policedBillionTicks: Number.parseFloat(totals[3]!),
    policedAssetYears: Number.parseFloat(totals[4]!),
    worstZ: Number.parseFloat(worst[1]!),
    worstAsset: worst[2]!,
    worstHorizon: worst[3]!,
    effectiveTests: Number.parseInt(effective[1]!, 10),
    familyWiseErrorRate: Number.parseFloat(fwer[1]!),
  };
}

function readRecordedRows(): RecordedRow[] {
  const text = readFileSync(path.join(repoRoot, EVIDENCE), 'utf8');
  const rows: RecordedRow[] = [];
  let asset: string | null = null;
  let threshold = Number.NaN;
  let simulatedDays = Number.NaN;
  // The document records its runs by heading, and one asset appears twice: the
  // btcusd replication is the whole basis for reading its eight positive
  // horizons as path displacement. Cycle Audit 4 (Minor 7) found that run
  // present only as prose, so it is a table now — and the table gets checked.
  let run = 0;
  const runHeading = /^## Run (\d+)/;

  const header =
    // `[\w-]+`, not `\w+`: the catalogue of thirty's ids carry hyphens
    // (`eurusd-otc`), and a header regex that could not see them parsed zero
    // rows from a 240-row record on the first run of PH-26.3.
    /^([\w-]+): [\d,]+ ticks, ([\d.]+) simulated days \([\d.]+ years\), \d+ segments, payout threshold ([\d.]+)pp, net displacement -?[\d,]+ steps$/;
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
    const r = runHeading.exec(line);
    if (r !== null) {
      run = Number.parseInt(r[1]!, 10);
      continue;
    }
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
      run,
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
  const all = readRecordedRows();
  /** Runs 1 and 2 are the coverage claim; run 3 is the replication. */
  const rows = all.filter((row) => row.run <= 2);
  /** The asset run 3 replicates, read from the record rather than named. */
  const replicated = new Set(all.filter((row) => row.run === 3).map((row) => row.asset));
  const replication = all.filter((row) => row.run === 3);

  it('covers every asset at every horizon', () => {
    expect(rows.length).toBe(ASSET_CATALOGUE.length * 8);
    for (const asset of ASSET_CATALOGUE) {
      const forAsset = rows.filter((r) => r.asset === asset.definition.id);
      expect(forAsset, `no rows for ${asset.definition.id}`).toHaveLength(8);
    }
  });

  it('records a replication: the same market again, and a different realisation', () => {
    // The five's record replicated btcusd because its primary run came out
    // positive at all eight horizons, and the replication flipped every one —
    // which settled it as path displacement rather than a leak. That sign flip
    // was a fact about one draw; asserting it of every catalogue would assert a
    // coin toss. What is asserted of any catalogue is what the replication is
    // for: one asset, run again under another label, eight cells that are a
    // *different* realisation of the *same* market (PH-26.3).
    expect(replication, 'the replication run is missing').toHaveLength(8);
    expect(replicated.size, 'run 3 replicates exactly one asset').toBe(1);
    const [asset] = [...replicated];
    const primary = rows.filter((r) => r.asset === asset);
    expect(primary, `${asset!} has no primary run to replicate`).toHaveLength(8);
    // A different realisation: the eight edges cannot all coincide.
    const same = replication.filter((r, i) => r.edgePoints === primary[i]!.edgePoints).length;
    expect(same, 'the replication repeats the primary run').toBeLessThan(8);
    // The same market: the same horizons at comparable sample counts.
    expect(replication.map((r) => r.horizon)).toEqual(primary.map((r) => r.horizon));
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
    // Grouped by run, not by asset: btcusd appears in two runs with opposite
    // path displacement, and mixing them would compare a bias to its own
    // negation.
    for (const key of new Set(all.map((r) => `${r.asset}#${r.run}`))) {
      const [asset] = key.split('#');
      const forAsset = all.filter((r) => `${r.asset}#${r.run}` === key);
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
      // The threshold is one residual standard deviation, not a number picked
      // until this passed. Cycle Audit 4 measured the scatter of observed z
      // about `pathBiasZ` at **0.82** per draw, so below that magnitude the
      // sampling noise dominates the bias and sign agreement is not expected —
      // gbpjpy sits at −0.38 with an observed z of +0.01, which is exactly what
      // a small bias under noise looks like.
      //
      // Above it the two must agree, and that is where the assertion earns its
      // place: both btcusd runs (+0.85 and −1.00) are in that regime, and they
      // are the reason this check exists.
      const RESIDUAL_SD = 0.8;
      if (Math.abs(meanBias) > RESIDUAL_SD && Math.sign(meanObserved) !== Math.sign(meanBias)) {
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

  it('re-derives the summary line from the run headers (a4-10)', () => {
    // Ticks and asset-years are sums over the headers this file already parses;
    // the summary is quoted to two and one decimals respectively.
    const runs = readRecordedRuns();
    const summary = readRecordedSummary();
    expect(runs.length).toBeGreaterThanOrEqual(ASSET_CATALOGUE.length + 1);
    const billion = (xs: RecordedRun[]) => xs.reduce((a, r) => a + r.ticks, 0) / 1e9;
    const assetYears = (xs: RecordedRun[]) => xs.reduce((a, r) => a + r.simulatedDays, 0) / 365;
    const policed = runs.filter((r) => r.run <= 2);
    expect(billion(runs)).toBeCloseTo(summary.totalBillionTicks, 2);
    expect(Math.abs(assetYears(runs) - summary.totalAssetYears)).toBeLessThan(0.1);
    expect(billion(policed)).toBeCloseTo(summary.policedBillionTicks, 1);
    expect(Math.abs(assetYears(policed) - summary.policedAssetYears)).toBeLessThan(0.1);
  });

  it('re-derives the worst cell and the family-wise error rate from the rows (a4-10)', () => {
    // The interpretation says how many effective tests the cells are worth
    // and quotes the family-wise error rate of the worst cell at that count. The
    // count itself comes from a 400-realisation measurement this file cannot
    // repeat; what it can check is that the two statements agree with each
    // other and with the table.
    const summary = readRecordedSummary();
    const worst = rows.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
    expect(Math.abs(worst.z)).toBeCloseTo(summary.worstZ, 2);
    expect(worst.asset).toBe(summary.worstAsset);
    expect(worst.horizon).toBe(summary.worstHorizon);
    const p = twoSidedPValue(summary.worstZ);
    const derived = 1 - (1 - p) ** summary.effectiveTests;
    expect(derived).toBeCloseTo(summary.familyWiseErrorRate, 2);
  });

  it('finds no significant edge across every recorded cell', () => {
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
