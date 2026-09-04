import type { RandomSource } from '@otc/core';

/**
 * Which assets a per-asset statistical suite measures on a gate run.
 *
 * ## Why a suite samples at all (PH-26.1)
 *
 * Nine statistical files do work per asset, and three of them carry 97.5% of
 * it: `multiAsset` runs a full battery over 46 simulated days per asset,
 * `latticeTies` twelve replicates of 8,000 horizons, `catalogue.stat` a
 * three-replicate recalibration. At five assets that is 184 million simulated
 * ticks and 72 minutes of single-core wall clock — the suite runs serially by
 * design (CA6-01), so a larger machine does not shorten it. At thirty assets it
 * is six to seven hours against a hosted ceiling of 180 minutes.
 *
 * A gate that cannot be run is not a gate. So the three heavy suites measure a
 * **fixed, stratified sample** of the catalogue on every run, and the whole
 * catalogue is measured by an evidence run at the phase boundary — the same
 * division PH-11 drew for horizon coverage, where the full run is "a deliberate
 * act, not a test" and the suite re-runs its method at a fraction of the length.
 *
 * ## What a sample must be
 *
 * - **Fixed.** The same assets on every run and on every machine, drawn from a
 *   stream the caller seeds. A sample that rotates would make one gate's verdict
 *   about different assets from the next's, and a statistical assertion that
 *   can fail on a draw is a defect, not a flake.
 * - **Stratified.** One asset from every stratum — the archetype an asset was
 *   drawn from, or its family when it was hand-authored — before a second from
 *   any. Thirty assets on eight archetypes and a sample of five that happened to
 *   land on five currency pairs would verify nothing about crypto.
 * - **Inert when it is not needed.** A catalogue no larger than the sample is
 *   measured whole. At five assets every suite produces exactly the verdict it
 *   produced before this existed, which is how the sampling machinery itself is
 *   shown to change nothing.
 * - **Honest about the rest.** `GOVERNANCE.md` §68: only executed checks may be
 *   reported as passing. A sampled tie rate means the unsampled assets ship with
 *   a refund rate that this run did not verify, and {@link CatalogueSample.describe}
 *   is what a suite prints so the record says so.
 *
 * Different suites pass different `purpose` strings and so draw different
 * subsets; across the three heavy suites more of the catalogue is touched per
 * gate than any one of them touches.
 */
export interface CatalogueSampleOptions<A> {
  /** How many assets to measure. A catalogue no larger than this is measured whole. */
  readonly size: number;
  /**
   * The stratum an asset belongs to. Defaults to the asset's family; a compiled
   * catalogue that records which archetype each asset was drawn from passes
   * that instead, which is the finer and more useful partition.
   */
  readonly stratumOf?: (asset: A) => string;
}

export interface CatalogueSample<A> {
  /** The assets this run measures, in catalogue order. */
  readonly measured: readonly A[];
  /** The assets this run does not measure, in catalogue order. */
  readonly unmeasured: readonly A[];
  /** Every stratum in the catalogue, in first-seen order. */
  readonly strata: readonly string[];
  /** Whether the catalogue was measured whole. */
  readonly whole: boolean;
  /** One line for the test output: what was measured, and what was not. */
  describe(): string;
}

/**
 * The size the three heavy suites use.
 *
 * Five, because that is the catalogue size the 72-minute measurement of
 * 2026-09-04 was taken at: a sample of five keeps each heavy suite at the cost
 * it has today whatever the catalogue grows to. Raising it is a decision about
 * the hosted ceiling and belongs in a phase document, not here.
 */
export const HEAVY_SUITE_SAMPLE = 5;

/**
 * Draw a fixed, stratified sample of a catalogue.
 *
 * Pure: the only randomness is `stream`, which the caller seeds, so the same
 * stream label always yields the same sample. `idOf` is what the description
 * prints and what ties are broken on.
 */
export function sampleCatalogue<A>(
  catalogue: readonly A[],
  idOf: (asset: A) => string,
  stream: RandomSource,
  options: CatalogueSampleOptions<A>,
): CatalogueSample<A> {
  if (!Number.isInteger(options.size) || options.size < 1) {
    throw new RangeError(`A sample size must be a positive integer, received ${options.size}.`);
  }
  const stratumOf = options.stratumOf ?? ((asset: A): string => familyOf(asset, idOf));
  const strata: string[] = [];
  const byStratum = new Map<string, A[]>();
  for (const asset of catalogue) {
    const stratum = stratumOf(asset);
    const members = byStratum.get(stratum);
    if (members === undefined) {
      strata.push(stratum);
      byStratum.set(stratum, [asset]);
    } else {
      members.push(asset);
    }
  }

  if (catalogue.length <= options.size) {
    return finish(catalogue, [], strata, true, idOf);
  }

  // A permutation of the strata, so which strata a sample smaller than their
  // count reaches is the stream's choice rather than declaration order's; then
  // rounds of one draw per stratum until the sample is full. Within a stratum
  // the draw is uniform over what is left of it.
  const order = shuffled(strata, stream);
  const remaining = new Map<string, A[]>();
  for (const [stratum, members] of byStratum) remaining.set(stratum, [...members]);
  const chosen = new Set<A>();
  while (chosen.size < options.size) {
    let drewAny = false;
    for (const stratum of order) {
      if (chosen.size >= options.size) break;
      const pool = remaining.get(stratum)!;
      if (pool.length === 0) continue;
      const index = stream.nextBoundedUint32(pool.length);
      chosen.add(pool.splice(index, 1)[0]!);
      drewAny = true;
    }
    if (!drewAny) break;
  }

  const measured = catalogue.filter((asset) => chosen.has(asset));
  const unmeasured = catalogue.filter((asset) => !chosen.has(asset));
  return finish(measured, unmeasured, strata, false, idOf);
}

function familyOf<A>(asset: A, idOf: (asset: A) => string): string {
  const candidate = asset as { definition?: { family?: unknown } };
  const family = candidate.definition?.family;
  if (typeof family === 'string') return family;
  // Nothing to stratify on: every asset is its own stratum, which makes the
  // sample a plain fixed draw and keeps the call honest rather than throwing.
  return idOf(asset);
}

function shuffled<T>(items: readonly T[], stream: RandomSource): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = stream.nextBoundedUint32(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function finish<A>(
  measured: readonly A[],
  unmeasured: readonly A[],
  strata: readonly string[],
  whole: boolean,
  idOf: (asset: A) => string,
): CatalogueSample<A> {
  const names = (assets: readonly A[]): string => assets.map(idOf).join(', ');
  return {
    measured,
    unmeasured,
    strata,
    whole,
    describe(): string {
      if (whole) {
        return `measured every asset (${String(measured.length)}): ${names(measured)}`;
      }
      return (
        `measured ${String(measured.length)} of ${String(measured.length + unmeasured.length)} ` +
        `assets, stratified over ${String(strata.length)} strata: ${names(measured)}. ` +
        `NOT MEASURED BY THIS RUN (${String(unmeasured.length)}): ${names(unmeasured)}`
      );
    },
  };
}
