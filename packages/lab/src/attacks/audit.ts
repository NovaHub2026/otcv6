import { epochMillis } from '@otc/core';
import { datasetFromTicks, type ObserverDataset } from '../observer.js';
import { buildFeatureFrame } from './frame.js';
import { SKIP_BUCKET, type AttackFamily } from './types.js';
import { logPrice, type Tick } from '@otc/core';

/**
 * A general look-ahead audit for attack families.
 *
 * The rule an attack must obey is that its bucket depends only on data up to the
 * entry index. That is testable directly and without knowing anything about the
 * family: **truncate the dataset immediately after the entry, and the bucket
 * must not change.** A family that reads even one tick forward changes its
 * answer when the future is removed.
 *
 * This matters more than it sounds. A PH-1 design probe whose forward window
 * included the entry tick reported z-scores above 1000 on a provably
 * unexploitable process. It happened to be broken in the direction that produces
 * alarming results; the opposite sign of error would have certified a leaking
 * engine as clean, and nothing downstream would have caught it.
 */

export interface LookAheadOffender {
  readonly family: string;
  readonly entryIndex: number;
  readonly bucketWithFuture: number;
  readonly bucketWithoutFuture: number;
}

export interface LookAheadAuditOptions {
  /** Entry indices to probe. Defaults to a spread across the dataset. */
  readonly probes?: readonly number[];
  /** Ticks retained after the entry index when truncating. Default 0. */
  readonly tailTicks?: number;
}

function truncate(dataset: ObserverDataset, upToIndex: number): ObserverDataset {
  const ticks: Tick[] = [];
  for (let i = 0; i <= upToIndex; i += 1) {
    ticks.push({
      instant: epochMillis(dataset.instants[i]!),
      sequence: i + 1,
      price: logPrice(dataset.prices[i]!),
    });
  }
  return datasetFromTicks(dataset.instrument, ticks);
}

/**
 * Returns every family whose bucket changes when the future is removed.
 * An empty result is the evidence that PH2-I1 holds.
 */
export function auditLookAhead(
  families: readonly AttackFamily[],
  dataset: ObserverDataset,
  options: LookAheadAuditOptions = {},
): LookAheadOffender[] {
  const tailTicks = options.tailTicks ?? 0;
  const probes =
    options.probes ??
    (() => {
      const out: number[] = [];
      const start = Math.floor(dataset.tickCount * 0.5);
      const step = Math.max(1, Math.floor((dataset.tickCount * 0.4) / 12));
      for (let i = start; i < dataset.tickCount - 1 && out.length < 12; i += step) out.push(i);
      return out;
    })();

  const fullFrame = buildFeatureFrame(dataset);
  const offenders: LookAheadOffender[] = [];

  for (const entryIndex of probes) {
    const cut = Math.min(dataset.tickCount - 1, entryIndex + tailTicks);
    const truncatedFrame = buildFeatureFrame(truncate(dataset, cut));
    const entryInstant = epochMillis(dataset.instants[entryIndex]!);
    for (const family of families) {
      const withFuture = family.bucket(fullFrame, entryIndex, entryInstant);
      const withoutFuture = family.bucket(truncatedFrame, entryIndex, entryInstant);
      if (withFuture !== withoutFuture) {
        offenders.push({
          family: family.name,
          entryIndex,
          bucketWithFuture: withFuture,
          bucketWithoutFuture: withoutFuture,
        });
      }
    }
  }
  return offenders;
}

export { SKIP_BUCKET };
