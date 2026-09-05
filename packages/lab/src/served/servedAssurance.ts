import { assertTickOrder, type Tick } from '@otc/core';
import type { BatteryOptions } from '../attacks/battery.js';
import type { HorizonSpec } from '../horizons.js';
import { runStandingAssurance, type StandingVerdict } from '../standing.js';
import { datasetFromTicks } from '../observer.js';
import type { ServedRecord } from './servedRecord.js';

/**
 * PH-25.2 — the standing verdict on a served record.
 *
 * `runStandingAssurance` already takes the published record as ticks and the
 * seam positions as indices; what it never had was a record that came over a
 * socket. This is the join: the ticks are the record's ticks, the seams are
 * the record's own discontinuities and told gaps, and the reference series for
 * the cross-asset family is another served record. Nothing is read that the
 * wire did not carry.
 */

export interface ServedAssuranceOptions {
  /** The instant of the run, from the caller's clock; stamped on the verdict. */
  readonly at: number;
  /** Another asset's served record, for the cross-asset family. */
  readonly reference?: ServedRecord;
  readonly battery?: BatteryOptions;
  readonly horizons?: readonly HorizonSpec[];
}

/**
 * Tick indices at which the record does not continue: the first tick after
 * each discontinuity and after each told gap. Sorted, deduplicated.
 */
export function seamIndicesOf(record: ServedRecord): number[] {
  const indices = new Set<number>();
  const indexOfSequence = new Map<number, number>();
  record.ticks.forEach((tick, index) => indexOfSequence.set(tick.sequence, index));
  for (const jump of record.discontinuities) {
    const index = indexOfSequence.get(jump.nextSequence);
    if (index !== undefined) indices.add(index);
  }
  for (const gap of record.gaps) {
    // The first tick held after the gap was told.
    const index =
      gap.afterSequence === null
        ? record.ticks.length > 0
          ? 0
          : undefined
        : record.ticks.findIndex((tick) => tick.sequence > gap.afterSequence!);
    if (index !== undefined && index >= 0) indices.add(index);
  }
  // A seam at index 0 is not a seam inside the record: nothing precedes it.
  indices.delete(0);
  return [...indices].sort((a, b) => a - b);
}

/**
 * Two reads of one market as one record: what an observer held before a
 * restart and what it read after. `later` must have been asked for the
 * sequence after `earlier`'s last — anything else is two records, not one.
 */
export function joinServedRecords(earlier: ServedRecord, later: ServedRecord): ServedRecord {
  if (earlier.assetId !== later.assetId) {
    throw new RangeError(`cannot join ${earlier.assetId} with ${later.assetId}.`);
  }
  const last = earlier.ticks[earlier.ticks.length - 1];
  if (last === undefined) return later;
  if (later.requestedFrom !== last.sequence + 1) {
    throw new RangeError(
      `the later read asked for ${String(later.requestedFrom)}, not ${String(last.sequence + 1)}: ` +
        'it does not continue the earlier one.',
    );
  }
  const first = later.ticks[0];
  if (first !== undefined) assertTickOrder(last, first);
  const ticks: readonly Tick[] = [...earlier.ticks, ...later.ticks];
  const joined: ServedRecord = {
    assetId: earlier.assetId,
    instrument: earlier.instrument,
    requestedFrom: earlier.requestedFrom,
    ticks,
    // A gap the later read was told before its first tick sat after nothing
    // *in that read*; in the joined record it sits after the earlier read's
    // last tick, and `seamIndicesOf` must see it there rather than at index 0.
    gaps: [
      ...earlier.gaps,
      ...later.gaps.map((gap) =>
        gap.afterSequence === null ? { ...gap, afterSequence: last.sequence } : gap,
      ),
    ],
    closes: [...earlier.closes, ...later.closes],
    // The later read recorded its own first-tick jump against `from`, which is
    // exactly the join's discontinuity, so nothing is added here.
    discontinuities: [...earlier.discontinuities, ...later.discontinuities],
    endedBy: later.endedBy,
    bytes: earlier.bytes + later.bytes,
    source: () => {
      let index = 0;
      return { instrument: earlier.instrument, next: () => ticks[index++] ?? null };
    },
    dataset: () => datasetFromTicks(earlier.instrument, ticks),
  };
  return joined;
}

/** The standing verdict on what the wire carried. */
export function servedAssurance(
  record: ServedRecord,
  options: ServedAssuranceOptions,
): Promise<StandingVerdict> {
  const { reference } = options;
  return runStandingAssurance({
    assetId: record.assetId,
    instrument: record.instrument,
    ticks: record.ticks,
    at: options.at,
    withheld: {
      seamIndices: seamIndicesOf(record),
      ...(reference === undefined
        ? {}
        : {
            reference: {
              instants: Float64Array.from(reference.ticks, (tick) => tick.instant),
              prices: Int32Array.from(reference.ticks, (tick) => tick.price),
            },
          }),
    },
    ...(options.battery === undefined ? {} : { battery: options.battery }),
    ...(options.horizons === undefined ? {} : { horizons: options.horizons }),
  });
}
