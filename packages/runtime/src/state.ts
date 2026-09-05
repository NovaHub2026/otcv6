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
  /**
   * Fingerprint of the personality that wrote this record (PH-26.3). A resume
   * under the same id by a different personality is a seam, not a
   * continuation; a record with no fingerprint predates the field and is
   * seamed too, because nothing can say what wrote it. See `personality.ts`.
   */
  readonly personality?: string;
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
  /**
   * Whether a composition outside the engine chose signs for this market since
   * the previous clean checkpoint (Cycle Audit 8, a6). Absent means no.
   *
   * A restore continues by regenerating the ticks that were published but never
   * persisted, and that is safe **because deterministic replay reproduces
   * them** — the same keystream positions give the same ticks. A Lab-composed
   * process breaks that premise: its script is deliberately absent from the
   * snapshot ("a restart is a release"), so the regenerated ticks carry the
   * keystream's own signs. Same asset, same sequence numbers, same instants,
   * **different prices**, and two observers either side of the restart hold
   * irreconcilable histories (INV-002) while a settled position points at a
   * price the record no longer shows (INV-009).
   *
   * A record carrying this may not be continued; `resumeMarket` seams instead.
   * Production never writes it — the field exists so the runtime can refuse
   * without knowing what a Lab is.
   */
  readonly controlled?: boolean;
  /**
   * Sequence number reserved ahead of use, for the same reason as the keystream.
   *
   * After an unclean crash the record lags what was actually published: it knows
   * the sequence at the last checkpoint, while observers saw everything up to
   * the crash. A seam that resumed from the recorded number would therefore
   * reissue numbers already used — the same failure cursor leasing was built to
   * prevent, one field over, and nobody had applied the idea here.
   *
   * So a checkpoint reserves a block of sequence numbers, and a seam starts
   * beyond it. The gap is visible and free; a duplicate is neither.
   */
  readonly leasedSequence: number;
}

/**
 * Sequence numbers reserved per checkpoint.
 *
 * Must exceed the ticks publishable between checkpoints. At the 5s cadence the
 * fastest asset produces about fifteen; a hundred thousand covers roughly nine
 * hours of it, which is far past the point where the catch-up bound refuses.
 */
export const DEFAULT_SEQUENCE_LEASE = 100_000;

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
export function assertUsableRecord(
  record: MarketStateRecord,
  expectedAssetId: string,
  expectedPersonality?: string,
): void {
  const reject = (detail: string): never => {
    throw new UnusableRecordError(expectedAssetId, detail);
  };
  if (record.version > STATE_RECORD_VERSION) {
    // Not a seam (a5-11). A record written by code that knows more than this
    // does — a downgrade, a mixed-version rollout — may keep its leases and
    // cursors in a shape this code cannot read, which is the definition of
    // "refuse to start". Seaming on it discontinued every market's latent
    // state on every rollback, logged and otherwise silent.
    throw new CorruptRecordError(
      expectedAssetId,
      `record version ${record.version} is newer than the ${STATE_RECORD_VERSION} this code ` +
        `writes, so its lease marks may be in a shape this code cannot read`,
    );
  }
  if (record.version !== STATE_RECORD_VERSION) {
    reject(`version ${record.version}, expected ${STATE_RECORD_VERSION}`);
  }
  if (record.assetId !== expectedAssetId) {
    // Not a seam. A record belonging to another asset tells us nothing about
    // THIS asset's leases, which is the definition of "refuse to start": seaming
    // on it re-issued 5,377 already-consumed blocks in an audit probe and
    // adopted the foreign asset's last price as the starting price.
    throw new CorruptRecordError(
      expectedAssetId,
      `record belongs to asset ${record.assetId}, so this asset's lease marks are unknown`,
    );
  }
  if (typeof record.snapshot !== 'object' || record.snapshot === null) {
    reject('no snapshot');
  }
  if (expectedPersonality !== undefined) {
    if (record.personality === undefined) {
      reject(
        'no personality fingerprint — the record predates the field, and nothing can say what wrote it',
      );
    } else if (record.personality !== expectedPersonality) {
      reject(
        `written by another personality under this id (${record.personality.slice(0, 19)}…, ` +
          `expected ${expectedPersonality.slice(0, 19)}…) — the same name is not the same market`,
      );
    }
  }
  if (Object.keys(record.leasedBlocks).length === 0) {
    reject('no leased cursors');
  }
  if (record.pending !== null && record.lastPublished === null && record.pending.sequence > 1) {
    // Self-contradictory: an outstanding tick numbered above the first, with no
    // published history at all. Produced by the HOSTED-002 write-path defect,
    // and trusted by this function until an audit measured what it caused.
    reject(
      `pending tick ${record.pending.sequence} with no published history — the record is degraded`,
    );
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
