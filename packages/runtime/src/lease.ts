import type { Clock, EpochMillis, Tick } from '@otc/core';
import { epochMillis } from '@otc/core';
import { StaleFenceError, type FenceToken } from './fence.js';
import {
  entrySequence,
  lowerBound,
  malformedBatch,
  RecordForkError,
  sameTick,
  SeamError,
  type RecordEntry,
  type ReplicationLog,
  type SeamMarker,
} from './replication.js';
import { CorruptRecordError, type MarketStateRecord, type StateStore } from './state.js';

/**
 * The lease term, in milliseconds.
 *
 * Tied to `DEFAULT_MAX_CATCH_UP_MS` (ADR-0010), and the tie is the argument: a
 * leader that has failed to renew for a full term has been out of contact for
 * longer than it is permitted to catch up, so its next advance would be refused
 * anyway. Losing the lease takes away nothing the catch-up bound had not already
 * taken, and the maximum leaderless window equals the maximum catch-up burst.
 */
export const DEFAULT_LEASE_TERM_MS = 15_000;

/**
 * How often a live leader should renew.
 *
 * Three attempts per term, so two lost round-trips are survivable.
 */
export const DEFAULT_LEASE_RENEWAL_MS = 5_000;

/** One grant of leadership over one asset. */
export interface LeaseGrant {
  readonly assetId: string;
  /** Identifies the *process*, not the node. See `PH-14.1` §6. */
  readonly holder: string;
  readonly token: FenceToken;
  readonly grantedAt: EpochMillis;
  /**
   * Advisory only.
   *
   * A holder may use this to schedule renewals. Nothing may branch on it to
   * decide whether it still leads: expiry is a fact at the store, judged by the
   * store's clock, and asking is the only way to learn it. Comparing this
   * against a local clock is what reintroduces skew into the safety argument.
   */
  readonly expiresAt: EpochMillis;
}

/** The outcome of an acquisition attempt. */
export type AcquireOutcome =
  | { readonly kind: 'granted'; readonly grant: LeaseGrant }
  | { readonly kind: 'held'; readonly by: LeaseGrant };

/** The outcome of a renewal attempt. */
export type RenewOutcome =
  | { readonly kind: 'renewed'; readonly grant: LeaseGrant }
  | { readonly kind: 'lost'; readonly current: LeaseGrant | null };

/** Thrown when a holder id cannot identify one process unambiguously. */
export class LeaseHolderError extends Error {
  constructor(readonly holder: string) {
    super(
      `Unusable lease holder id ${JSON.stringify(holder)}: it must be 1-128 printable ` +
        `characters and must identify one process, not one node.`,
    );
    this.name = 'LeaseHolderError';
  }
}

/** Whether a holder id can be trusted to name a single process. */
export function isUsableHolder(holder: string): boolean {
  return /^[\x21-\x7e]{1,128}$/.test(holder);
}

/** Reject a holder id that cannot be trusted to name a single process. */
export function assertHolder(holder: string): void {
  if (!isUsableHolder(holder)) throw new LeaseHolderError(holder);
}

/**
 * Grants leadership over assets, one holder at a time.
 *
 * The store judges expiry with its own clock. That is the point: with one clock
 * deciding, skew between nodes cannot cause a handover at all, and a node is
 * never in the position of concluding from its own clock that it still leads.
 */
export interface LeaseStore {
  /** The term granted, so a holder can schedule renewals. */
  readonly termMs: number;
  /**
   * Claim an asset. Succeeds only if no unexpired grant exists, and then always
   * with a token strictly greater than every token this store has ever issued
   * for the asset — including when the acquirer is the previous holder.
   */
  acquire(assetId: string, holder: string): Promise<AcquireOutcome>;
  /** Extend a grant, preserving its token. Fails if the grant is not current. */
  renew(grant: LeaseGrant): Promise<RenewOutcome>;
  /**
   * Give the lease up early. A no-op unless `grant` is the current one, so a
   * superseded holder cannot release its successor's lease.
   */
  release(grant: LeaseGrant): Promise<void>;
  /** The current unexpired grant, or null. Never extends anything. */
  inspect(assetId: string): Promise<LeaseGrant | null>;
}

/**
 * A store that grants leases and writes records, atomically with respect to
 * each other.
 *
 * These are one interface rather than two because the fence check and the write
 * must not interleave. A check against one store followed by a write to another
 * is not fencing; it is a race with a comment. Co-locating them is exactly what
 * ADR-0012 means by "a shared store".
 */
export interface CoordinatedStore extends LeaseStore, StateStore, ReplicationLog {
  /**
   * Write a record, but only under the current grant.
   *
   * Refuses with `StaleFenceError` — leaving the stored record untouched — if
   * the token is not the current grant's, or if that grant has expired. An
   * expired grant is not authority to write even when nobody has taken over:
   * the holder must reacquire, which issues a new token.
   */
  saveFenced(record: MarketStateRecord, token: FenceToken): Promise<void>;
}

/**
 * One asset's record.
 *
 * `expectNext` is carried rather than derived from `head`, because after a seam
 * they differ: the head is the last sequence before the discontinuity and the
 * next append must start at the seam's resuming sequence, which is far beyond
 * it. Deriving one from the other is precisely the assumption a seam breaks.
 */
interface RecordState {
  entries: RecordEntry[];
  /** Tick sequence to its index in `entries`. Seams are not addressable. */
  readonly indexBySequence: Map<number, number>;
  head: number | null;
  expectNext: number | null;
}

interface StoredGrant {
  readonly holder: string;
  readonly token: FenceToken;
  readonly grantedAt: EpochMillis;
  readonly expiresAt: EpochMillis;
}

/**
 * The reference `CoordinatedStore`, in memory.
 *
 * "Atomic" here means that every critical section below contains no `await`, so
 * under Node's execution model nothing can interleave with it. That is a real
 * guarantee for a single process and the basis of the conformance battery; a
 * deployment across processes needs a backend with native compare-and-set,
 * which implements this same interface and passes the same battery.
 */
export class MemoryCoordinatedStore implements CoordinatedStore {
  readonly #grants = new Map<string, StoredGrant>();
  /** The published record, per asset: ticks, and the seams between them. */
  readonly #record = new Map<string, RecordState>();
  /** Highest token ever issued per asset, retained after release and expiry. */
  readonly #highWater = new Map<string, FenceToken>();
  readonly #records = new Map<string, string>();
  readonly #clock: Clock;
  readonly termMs: number;

  constructor(clock: Clock, termMs: number = DEFAULT_LEASE_TERM_MS) {
    if (!Number.isFinite(termMs) || termMs <= 0) {
      throw new RangeError(`Lease term must be a positive number of milliseconds: ${termMs}.`);
    }
    this.#clock = clock;
    this.termMs = termMs;
  }

  /**
   * The grant in force at `now`, or null.
   *
   * Expired grants are dropped from the table but their tokens stay in the
   * high-water map, so expiry can never recycle a token.
   */
  #live(assetId: string, now: EpochMillis): StoredGrant | null {
    const grant = this.#grants.get(assetId);
    if (grant === undefined) return null;
    if (now >= grant.expiresAt) {
      this.#grants.delete(assetId);
      return null;
    }
    return grant;
  }

  #toGrant(assetId: string, stored: StoredGrant): LeaseGrant {
    return {
      assetId,
      holder: stored.holder,
      token: stored.token,
      grantedAt: stored.grantedAt,
      expiresAt: stored.expiresAt,
    };
  }

  acquire(assetId: string, holder: string): Promise<AcquireOutcome> {
    // Rejected, not thrown. A method whose type says `Promise` and which
    // sometimes throws synchronously has two error contracts, and a caller that
    // uses `.catch()` rather than `try`/`await` sees only one of them.
    if (!isUsableHolder(holder)) return Promise.reject(new LeaseHolderError(holder));
    const now = this.#clock.now();
    const held = this.#live(assetId, now);
    if (held !== null) {
      return Promise.resolve({ kind: 'held', by: this.#toGrant(assetId, held) });
    }
    // Strictly above the high-water mark, not above whatever is in the table:
    // an expired grant has already been deleted, and reissuing its token would
    // let a stranded holder's write match the new grant exactly.
    const token = (this.#highWater.get(assetId) ?? 0) + 1;
    this.#highWater.set(assetId, token);
    const stored: StoredGrant = {
      holder,
      token,
      grantedAt: now,
      expiresAt: epochMillis(now + this.termMs),
    };
    this.#grants.set(assetId, stored);
    return Promise.resolve({ kind: 'granted', grant: this.#toGrant(assetId, stored) });
  }

  renew(grant: LeaseGrant): Promise<RenewOutcome> {
    const now = this.#clock.now();
    const held = this.#live(grant.assetId, now);
    if (held === null || held.token !== grant.token || held.holder !== grant.holder) {
      return Promise.resolve({
        kind: 'lost',
        current: held === null ? null : this.#toGrant(grant.assetId, held),
      });
    }
    // The token is preserved. Bumping it here would fence the live leader's own
    // in-flight writes, which is the failure renewal exists to prevent.
    const stored: StoredGrant = { ...held, expiresAt: epochMillis(now + this.termMs) };
    this.#grants.set(grant.assetId, stored);
    return Promise.resolve({ kind: 'renewed', grant: this.#toGrant(grant.assetId, stored) });
  }

  release(grant: LeaseGrant): Promise<void> {
    const held = this.#live(grant.assetId, this.#clock.now());
    if (held !== null && held.token === grant.token && held.holder === grant.holder) {
      this.#grants.delete(grant.assetId);
    }
    return Promise.resolve();
  }

  inspect(assetId: string): Promise<LeaseGrant | null> {
    const held = this.#live(assetId, this.#clock.now());
    return Promise.resolve(held === null ? null : this.#toGrant(assetId, held));
  }

  saveFenced(record: MarketStateRecord, token: FenceToken): Promise<void> {
    const refusal = this.#fenceRefusal(record.assetId, token);
    if (refusal !== null) return Promise.reject(refusal);
    this.#records.set(record.assetId, JSON.stringify(record));
    return Promise.resolve();
  }

  /**
   * The fence check every write shares.
   *
   * Returns nothing and throws nothing; the caller turns a refusal into a
   * rejection so that a method typed `Promise` never throws synchronously.
   */
  #fenceRefusal(assetId: string, token: FenceToken): StaleFenceError | null {
    const now = this.#clock.now();
    const grant = this.#grants.get(assetId);
    if (grant === undefined) {
      return new StaleFenceError(assetId, token, null, 'the asset has never been led');
    }
    if (now >= grant.expiresAt) {
      this.#grants.delete(assetId);
      return new StaleFenceError(assetId, token, grant.token, 'that grant has expired');
    }
    if (grant.token !== token) {
      return new StaleFenceError(assetId, token, grant.token, `held by ${grant.holder}`);
    }
    return null;
  }

  appendTicks(assetId: string, token: FenceToken, ticks: readonly Tick[]): Promise<void> {
    const refusal = this.#fenceRefusal(assetId, token);
    if (refusal !== null) return Promise.reject(refusal);
    if (ticks.length === 0) return Promise.resolve();
    const malformed = malformedBatch(assetId, ticks);
    if (malformed !== null) return Promise.reject(malformed);

    const state = this.#recordFor(assetId);
    // Validate the whole batch before mutating anything. A partial append would
    // leave the record in a state no single writer could have produced.
    const pending: Tick[] = [];
    let head = state.head;
    let expectNext = state.expectNext;
    for (const tick of ticks) {
      if (head !== null && tick.sequence <= head) {
        const index = state.indexBySequence.get(tick.sequence);
        if (index === undefined) {
          // Inside a seam gap, or older than anything held. Nothing can be
          // checked against it, so it is refused rather than assumed to match.
          return Promise.reject(
            new RangeError(
              `Cannot append sequence ${tick.sequence} to ${assetId}: the record holds no tick ` +
                `there to compare against, so a match cannot be established.`,
            ),
          );
        }
        const recorded = state.entries[index]!;
        if (recorded.kind !== 'tick' || !sameTick(recorded.tick, tick)) {
          return Promise.reject(
            new RecordForkError(
              assetId,
              tick.sequence,
              recorded.kind === 'tick' ? recorded.tick : tick,
              tick,
            ),
          );
        }
        continue; // Identical replay of a tick already recorded.
      }
      const expected = expectNext ?? tick.sequence;
      if (tick.sequence !== expected) {
        return Promise.reject(
          new RangeError(
            `Cannot append sequence ${tick.sequence} to ${assetId} after ${String(head)}: a gap ` +
              `in the record would be served to every observer as though it were the market. ` +
              `Past a genuine discontinuity, record a seam.`,
          ),
        );
      }
      pending.push(tick);
      head = tick.sequence;
      expectNext = tick.sequence + 1;
    }
    for (const tick of pending) {
      state.indexBySequence.set(tick.sequence, state.entries.length);
      state.entries.push({ kind: 'tick', tick });
    }
    state.head = head;
    state.expectNext = expectNext;
    return Promise.resolve();
  }

  recordSeam(assetId: string, token: FenceToken, seam: SeamMarker): Promise<void> {
    const refusal = this.#fenceRefusal(assetId, token);
    if (refusal !== null) return Promise.reject(refusal);

    const state = this.#recordFor(assetId);
    if (seam.assetId !== assetId) {
      return Promise.reject(new SeamError(assetId, `it names asset ${seam.assetId}`));
    }
    // A seam that claimed a different last sequence would be rewriting history
    // rather than extending it, and the rewrite would be invisible afterwards.
    if (seam.lastSequence !== state.head) {
      return Promise.reject(
        new SeamError(
          assetId,
          `it continues from ${String(seam.lastSequence)} but the record's head is ` +
            `${String(state.head)}`,
        ),
      );
    }
    if (!Number.isInteger(seam.resumesAtSequence) || seam.resumesAtSequence < 1) {
      return Promise.reject(
        new SeamError(assetId, `it resumes at sequence ${seam.resumesAtSequence}`),
      );
    }
    if (state.head !== null && seam.resumesAtSequence <= state.head) {
      return Promise.reject(
        new SeamError(
          assetId,
          `it resumes at ${seam.resumesAtSequence}, at or before the head ${state.head} — a seam ` +
            `moves forward or it is not a seam`,
        ),
      );
    }
    state.entries.push({ kind: 'seam', seam });
    state.expectNext = seam.resumesAtSequence;
    return Promise.resolve();
  }

  readRecord(
    assetId: string,
    fromSequence: number,
    limit: number,
  ): Promise<readonly RecordEntry[]> {
    if (!Number.isInteger(fromSequence) || fromSequence < 1) {
      return Promise.reject(
        new RangeError(`A sequence must be a positive integer, received ${fromSequence}.`),
      );
    }
    if (!Number.isInteger(limit) || limit < 1) {
      return Promise.reject(new RangeError(`A read limit must be a positive integer.`));
    }
    const state = this.#record.get(assetId);
    if (state === undefined || state.entries.length === 0) return Promise.resolve([]);
    const first = entrySequence(state.entries[0]!);
    if (fromSequence < first) {
      return Promise.reject(
        new RangeError(
          `Sequence ${fromSequence} for ${assetId} precedes the retained record, which starts ` +
            `at ${first}.`,
        ),
      );
    }
    const from = lowerBound(state.entries, fromSequence);
    return Promise.resolve(state.entries.slice(from, from + limit));
  }

  recordHead(assetId: string): Promise<number | null> {
    return Promise.resolve(this.#record.get(assetId)?.head ?? null);
  }

  seams(assetId: string): Promise<readonly SeamMarker[]> {
    const state = this.#record.get(assetId);
    if (state === undefined) return Promise.resolve([]);
    return Promise.resolve(
      state.entries.filter((e) => e.kind === 'seam').map((e) => (e as { seam: SeamMarker }).seam),
    );
  }

  #recordFor(assetId: string): RecordState {
    let state = this.#record.get(assetId);
    if (state === undefined) {
      state = { entries: [], indexBySequence: new Map(), head: null, expectNext: null };
      this.#record.set(assetId, state);
    }
    return state;
  }

  /**
   * Unfenced write.
   *
   * Present because `CoordinatedStore` is a `StateStore`, and needed by the
   * paths that legitimately write without leading — tests, and the fresh-start
   * path before any lease exists. Leader code calls `saveFenced`; PH-14.3 makes
   * that structural rather than a convention.
   */
  save(record: MarketStateRecord): Promise<void> {
    this.#records.set(record.assetId, JSON.stringify(record));
    return Promise.resolve();
  }

  load(assetId: string): Promise<MarketStateRecord | null> {
    const text = this.#records.get(assetId);
    if (text === undefined) return Promise.resolve(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return Promise.reject(new CorruptRecordError(assetId, (error as Error).message));
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Promise.reject(new CorruptRecordError(assetId, 'record did not parse to an object'));
    }
    return Promise.resolve(parsed as MarketStateRecord);
  }

  list(): Promise<readonly string[]> {
    return Promise.resolve([...this.#records.keys()].sort());
  }
}

/**
 * A holder-side handle on one asset's leadership.
 *
 * Deliberately thin. It remembers the grant so the token can be presented on a
 * write, and it knows when it has been lost — it does not schedule anything and
 * does not decide from a clock that it still leads. Renewal scheduling belongs
 * to whatever is already running a loop (PH-14.3).
 */
export class AssetLease {
  #grant: LeaseGrant;
  #lost = false;

  private constructor(
    private readonly store: LeaseStore,
    grant: LeaseGrant,
  ) {
    this.#grant = grant;
  }

  /** Take leadership, or return the grant that stopped us. */
  static async acquire(
    store: LeaseStore,
    assetId: string,
    holder: string,
  ): Promise<AssetLease | { readonly heldBy: LeaseGrant }> {
    const outcome = await store.acquire(assetId, holder);
    if (outcome.kind === 'held') return { heldBy: outcome.by };
    return new AssetLease(store, outcome.grant);
  }

  get assetId(): string {
    return this.#grant.assetId;
  }

  get holder(): string {
    return this.#grant.holder;
  }

  /** The token to present on a fenced write. */
  get token(): FenceToken {
    return this.#grant.token;
  }

  get grant(): LeaseGrant {
    return this.#grant;
  }

  /**
   * True once a renewal has been refused.
   *
   * The only honest way to know. A false value means "no refusal has been seen
   * yet", not "we lead" — the lease may have been taken a millisecond ago and
   * the fence is what will say so.
   */
  get lost(): boolean {
    return this.#lost;
  }

  /** Extend the grant. Returns false once, and stays lost thereafter. */
  async renew(): Promise<boolean> {
    if (this.#lost) return false;
    const outcome = await this.store.renew(this.#grant);
    if (outcome.kind === 'lost') {
      this.#lost = true;
      return false;
    }
    this.#grant = outcome.grant;
    return true;
  }

  /** Give it up. Idempotent, and a no-op if it was already lost. */
  async release(): Promise<void> {
    if (this.#lost) return;
    this.#lost = true;
    await this.store.release(this.#grant);
  }
}
