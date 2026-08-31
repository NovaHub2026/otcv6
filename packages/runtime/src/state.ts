import type { EpochMillis, LogPrice, Tick } from '@otc/core';
import type { EngineSnapshot } from '@otc/engine';

/** Format version of a persisted record. Bump when the shape changes. */
export const STATE_RECORD_VERSION = 1;

/** The last tick actually published to observers. */
export interface PublishedCheckpoint {
  readonly sequence: number;
  readonly instant: EpochMillis;
  readonly price: LogPrice;
}

/**
 * Everything needed to resume one market, and nothing else.
 *
 * Three fields, and the relationship between them is the whole design:
 *
 * - `snapshot` is the engine's latent state *after* every draw it has made,
 *   including the tick that has been generated but not yet published;
 * - `pending` is that generated-but-not-due tick, held separately because
 *   restoring the snapshot alone would silently skip it;
 * - `lastPublished` is what observers have actually seen.
 *
 * Because the snapshot is taken at the same instant as the other two, restoring
 * it and drawing one tick must reproduce `pending` exactly. That is not an
 * assumption — `resumeMarket` checks it, and a record that fails is treated as
 * unusable rather than trusted.
 *
 * **No key material.** The snapshot carries stream *cursors*, never keys. A
 * secret on disk would be a far worse leak than one in memory, and PH-1 found
 * exactly that defect in memory: a keyring whose `private` field was
 * compile-time only serialised its entire master secret through
 * `JSON.stringify`.
 */
export interface MarketStateRecord {
  readonly version: number;
  readonly assetId: string;
  readonly savedAt: EpochMillis;
  readonly snapshot: EngineSnapshot;
  readonly pending: Tick | null;
  readonly lastPublished: PublishedCheckpoint | null;
  /**
   * Durably reserved keystream high-water marks, by stream purpose.
   *
   * Written *ahead* of use, so a crash can never cause a position to be spent
   * twice. This is the only thing that makes the seam-recovery path safe when
   * the snapshot cannot be trusted.
   */
  readonly leasedBlocks: Readonly<Record<string, string>>;
}

/**
 * Durable storage for market state.
 *
 * An interface rather than a database, deliberately. PH-5 has no load profile to
 * design against, and picking a hosted engine now would be guessing; PH-7 makes
 * that choice when distribution semantics exist to inform it.
 */
export interface StateStore {
  load(assetId: string): Promise<MarketStateRecord | null>;
  save(record: MarketStateRecord): Promise<void>;
  list(): Promise<readonly string[]>;
}

/**
 * Thrown when stored bytes exist but cannot be read as a record.
 *
 * Deliberately **not** treated as "no state". A missing record means nothing
 * ever ran, so starting at genesis is safe. A corrupt record means something did
 * run and its lease marks are gone — restarting from genesis would re-consume
 * keystream positions already spent, which is the exact failure cursor leasing
 * exists to prevent, and it would publish a second, different market under the
 * same asset id.
 *
 * There is no safe automatic recovery from this, so the market refuses to start
 * and an operator has to decide.
 */
export class CorruptRecordError extends Error {
  constructor(
    readonly assetId: string,
    readonly detail: string,
  ) {
    super(
      `Stored state for ${assetId} exists but cannot be read (${detail}). Refusing to ` +
        `start: the lease marks are unknown, so resuming would risk spending keystream ` +
        `positions twice and publishing a different market under the same id.`,
    );
    this.name = 'CorruptRecordError';
  }
}

/** Thrown when a persisted record cannot be trusted to resume from. */
export class UnusableRecordError extends Error {
  constructor(
    readonly assetId: string,
    readonly detail: string,
  ) {
    super(`Persisted state for ${assetId} is unusable: ${detail}`);
    this.name = 'UnusableRecordError';
  }
}

/** Shape and range validation for a record read back from a store. */
export function assertUsableRecord(record: MarketStateRecord, expectedAssetId: string): void {
  const reject = (detail: string): never => {
    throw new UnusableRecordError(expectedAssetId, detail);
  };
  if (record.version !== STATE_RECORD_VERSION) {
    reject(`version ${record.version}, expected ${STATE_RECORD_VERSION}`);
  }
  if (record.assetId !== expectedAssetId) {
    reject(`records asset ${record.assetId}`);
  }
  if (typeof record.snapshot !== 'object' || record.snapshot === null) {
    reject('no snapshot');
  }
  if (Object.keys(record.leasedBlocks).length === 0) {
    reject('no leased cursors');
  }
  if (record.pending !== null && record.lastPublished !== null) {
    // The pending tick is by construction the one after the last published.
    if (record.pending.sequence !== record.lastPublished.sequence + 1) {
      reject(
        `pending tick ${record.pending.sequence} does not follow last published ` +
          `${record.lastPublished.sequence}`,
      );
    }
  }
}

/** Anything in a persisted record that looks like key material. */
export function findSecretShapedValues(record: MarketStateRecord): readonly string[] {
  // Cursors are short "block:offset" pairs; a long hex run is not something any
  // legitimate field in this record produces.
  const suspicious: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (/[0-9a-f]{32,}/i.test(value)) suspicious.push(`${path}: ${value.slice(0, 24)}...`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    }
  };
  walk(record, 'record');
  return suspicious;
}
