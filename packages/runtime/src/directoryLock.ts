import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { createFileExclusively, replaceFileAtomically } from './atomicFile.js';
import { assertHolder, DEFAULT_LEASE_RENEWAL_MS, DEFAULT_LEASE_TERM_MS } from './lease.js';

/**
 * One writer per state directory (Cycle Audit 10: a3-07, a6-05).
 *
 * Nothing stopped two venue processes from being pointed at one state
 * directory. Both booted, both hosted the catalogue, both appended to one
 * `record.db` — and because each primed its own feed from the record at boot
 * and then only ever offered it the ticks *its own* append returned as fresh,
 * each one's feed refused the very next pass with a gap it could never close.
 * Measured: two processes, both answering `{"status":"ok","stalled":[],
 * "ready":true}`, both with a climbing `otc_ticks_published_total`, and every
 * subscriber of both receiving nothing for the life of the process.
 *
 * ## Why this is a lock file and not a lease
 *
 * The repository already has a fenced-lease vocabulary — {@link LeaseStore},
 * {@link AssetLease}, {@link FenceToken} — and it is the right mechanism for
 * the multi-node topology ADR-0012 describes. It is not the right mechanism
 * *here*, and the reason is stated in `lease.ts` itself: a lease is worth
 * nothing without the fence, and fencing means every write presents a token to
 * a store that checks it in the same critical section. Nothing in `apps/api`
 * writes through a `CoordinatedStore`: the checkpoints go through
 * `FileStateStore.save`, the record through `SqliteTickRecord.append`, the
 * bars through `SqliteCandleHistory`, the chain through the publication
 * writer. Acquiring a lease and then writing through four unfenced paths would
 * be, in that file's own words, "a race with a comment" — and it would be
 * worse than a lock file, because it would *look* like fencing.
 *
 * So this is what it says it is: **mutual exclusion at boot, between processes
 * on one filesystem** — exactly the deployment `deploy/` ships (one systemd
 * unit, one host, one directory, `Restart=always`). It borrows the lease's
 * vocabulary where the vocabulary is honest — the holder-id grammar, and a
 * term tied to {@link DEFAULT_LEASE_TERM_MS} so a heartbeat older than one
 * catch-up bound is a holder that could not have published anyway — and it
 * claims none of the lease's safety properties. See
 * `docs/decisions/DECISION-LOG.md`.
 *
 * ## What it guarantees, and what it does not
 *
 * A second process started while the first is live is refused, atomically:
 * the file is created with `link`, which fails `EEXIST` at the filesystem
 * rather than after a read. A holder that has stopped renewing for a full term,
 * or whose pid is demonstrably gone on this host, is taken over — otherwise a
 * `SIGKILL` under `Restart=always` would leave a directory no process could
 * ever open again.
 *
 * The takeover path is *not* atomic: it reads, writes and re-reads to confirm,
 * so two processes racing to adopt the same abandoned lock have a window in
 * which both may believe they won. Closing that needs a compare-and-set the
 * filesystem does not offer, which is the same thing as saying it needs the
 * coordinated store. The window requires the previous holder to be already
 * gone and two starters to race inside one read-modify-write; the common case
 * — a live holder and a second `npm start` — is refused by `link` with no race
 * at all.
 */

/**
 * The lock file's name inside the state directory.
 *
 * **Not `*.json`, and that is load-bearing.** `FileStateStore.list` maps every
 * `*.json` in a state directory to an asset id, which is how `backup.json`
 * became "asset undefined" and made every backup the shipped deployment takes
 * refuse to boot (a3-01, a6-11). A lock named `venue.lock` is invisible to the
 * boot check and to `backupStateDirectory`'s copy loop, so it neither breaks a
 * verify nor travels into a backup that would then be born locked.
 * `directoryLock.test.ts` asserts both, so a rename to `lock.json` fails a test
 * rather than a deployment.
 */
export const LOCK_FILE = 'venue.lock';

/**
 * How long a lock survives without a heartbeat.
 *
 * The lease term, and for the lease's reason: a holder that has not renewed for
 * a full term has been out of contact for longer than it is permitted to catch
 * up (ADR-0010), so its next advance would be refused anyway. Taking the
 * directory from it takes nothing the catch-up bound had not already taken.
 */
export const DEFAULT_LOCK_TERM_MS = DEFAULT_LEASE_TERM_MS;

/** How often a holder should renew: three attempts per term. */
export const DEFAULT_LOCK_RENEWAL_MS = DEFAULT_LEASE_RENEWAL_MS;

/** Who holds a directory: a process, not a node (the lease's rule, PH-14.1 §6). */
export interface LockIdentity {
  /** The lease's holder grammar: 1-128 printable characters naming one process. */
  readonly holder: string;
  readonly pid: number;
  readonly host: string;
}

/** What the lock file contains. */
export interface LockRecord extends LockIdentity {
  readonly kind: 'otc-venue-lock';
  readonly version: 1;
  /** When this holder took the directory. */
  readonly acquiredAt: number;
  /** The heartbeat: when this holder last said it was still here. */
  readonly renewedAt: number;
  /** How long the heartbeat is good for. */
  readonly termMs: number;
}

/** Whether the recorded holder is still running. */
export type HolderLiveness = 'alive' | 'gone' | 'unknown';

/** Thrown when a directory already has a writer. */
export class DirectoryLockedError extends Error {
  constructor(
    readonly directory: string,
    readonly held: LockRecord | null,
    readonly detail: string,
  ) {
    super(
      `Refusing to start: ${path.join(directory, LOCK_FILE)} says this state directory already ` +
        `has a writer — ${detail}. Two processes on one state directory each prime a feed from ` +
        `the record and then refuse every pass the other one appended, so both serve nothing ` +
        `while reporting healthy (a3-06, a6-05). Stop the other process, or point this one at ` +
        `its own directory with OTC_STATE_DIR.`,
    );
    this.name = 'DirectoryLockedError';
  }
}

/** The default identity of the calling process. */
export function currentProcessIdentity(): LockIdentity {
  const host = hostname();
  return { holder: `${host}/${String(process.pid)}`, pid: process.pid, host };
}

/**
 * Whether the process named in a lock record is still running.
 *
 * Only answerable on the same host: a pid from another host, or from another
 * pid namespace presenting a different hostname, means nothing here, and
 * guessing would be the one wrong answer that lets two writers proceed. So
 * `unknown` is treated as alive by {@link StateDirectoryLock.acquire}, and the
 * heartbeat is what eventually releases such a lock.
 *
 * `EPERM` is `alive`: the pid exists and belongs to another user.
 */
export function processLiveness(record: LockRecord, self: LockIdentity): HolderLiveness {
  if (record.host !== self.host) return 'unknown';
  try {
    process.kill(record.pid, 0);
    return 'alive';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'alive';
  }
}

export interface LockOptions {
  /**
   * The instant, injected. Nothing under `packages/` reads ambient time; the
   * caller passes a `Clock`'s reading, the way `backupStateDirectory` takes one.
   */
  readonly now: () => number;
  /** Who is claiming it. Defaults to {@link currentProcessIdentity}. */
  readonly identity?: LockIdentity;
  /** The heartbeat's validity. Defaults to {@link DEFAULT_LOCK_TERM_MS}. */
  readonly termMs?: number;
  /** How liveness is judged. Defaults to {@link processLiveness}; a test substitutes. */
  readonly liveness?: (record: LockRecord, self: LockIdentity) => HolderLiveness;
}

function render(record: LockRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Parse a lock file, or null when it is not one. A torn file parses as null. */
function parse(text: string): LockRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<LockRecord>;
  if (candidate.kind !== 'otc-venue-lock' || candidate.version !== 1) return null;
  if (typeof candidate.holder !== 'string' || typeof candidate.host !== 'string') return null;
  if (!Number.isInteger(candidate.pid)) return null;
  if (!Number.isFinite(candidate.acquiredAt) || !Number.isFinite(candidate.renewedAt)) return null;
  if (!Number.isFinite(candidate.termMs) || (candidate.termMs ?? 0) <= 0) return null;
  return candidate as LockRecord;
}

/** The same grant, not merely the same holder: a restart reuses neither. */
function sameGrant(a: LockRecord, b: LockRecord): boolean {
  return (
    a.holder === b.holder && a.pid === b.pid && a.host === b.host && a.acquiredAt === b.acquiredAt
  );
}

/** How a holder is named in a refusal. */
function describe(record: LockRecord): string {
  return `${record.holder} (pid ${String(record.pid)} on ${record.host})`;
}

/**
 * The state directory's writer lock: held for the life of a process, renewed on
 * the checkpoint cadence, released on a clean shutdown.
 */
export class StateDirectoryLock {
  #record: LockRecord;
  #lost = false;
  #released = false;
  #supersededBy: LockRecord | null = null;

  private constructor(
    readonly directory: string,
    readonly file: string,
    record: LockRecord,
    private readonly now: () => number,
    /** The abandoned lock this one replaced, or null when the directory was free. */
    readonly tookOverFrom: LockRecord | null,
  ) {
    this.#record = record;
  }

  /**
   * Take the directory, or refuse with {@link DirectoryLockedError}.
   *
   * A directory with no lock file is taken atomically. A lock whose holder is
   * live, or whose liveness cannot be judged and whose heartbeat is inside its
   * term, refuses. A lock whose heartbeat has expired, or whose process is gone
   * on this host, is taken over — and the previous record is kept in
   * {@link tookOverFrom} so the caller can say so out loud.
   *
   * A lock file that does not parse refuses. That is deliberate and it is the
   * conservative half of a trade: a file this cannot read might be a live
   * holder's, and the cost of guessing wrong is the two-writer failure this
   * exists to prevent. The refusal names the file, and removing it is one
   * command for an operator who knows nothing else is running.
   */
  static async acquire(directory: string, options: LockOptions): Promise<StateDirectoryLock> {
    const self = options.identity ?? currentProcessIdentity();
    assertHolder(self.holder);
    const termMs = options.termMs ?? DEFAULT_LOCK_TERM_MS;
    const judge = options.liveness ?? processLiveness;
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, LOCK_FILE);
    const at = options.now();
    const mine: LockRecord = {
      kind: 'otc-venue-lock',
      version: 1,
      holder: self.holder,
      pid: self.pid,
      host: self.host,
      acquiredAt: at,
      renewedAt: at,
      termMs,
    };

    if (await createFileExclusively(file, render(mine))) {
      return new StateDirectoryLock(directory, file, mine, options.now, null);
    }

    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) {
      // It existed a moment ago and does not now: another starter is mid-takeover.
      throw new DirectoryLockedError(directory, null, 'another process is claiming it right now');
    }
    const held = parse(text);
    if (held === null) {
      throw new DirectoryLockedError(
        directory,
        null,
        `the lock file is present but is not a lock record; it was not removed by this process ` +
          `because a file that cannot be read might be a live writer's`,
      );
    }
    const age = at - held.renewedAt;
    const liveness = judge(held, self);
    if (liveness === 'alive') {
      throw new DirectoryLockedError(
        directory,
        held,
        `${describe(held)} is running, and its heartbeat is ${String(age)} ms old`,
      );
    }
    if (liveness === 'unknown' && age < held.termMs) {
      throw new DirectoryLockedError(
        directory,
        held,
        `it is held by ${describe(held)}, whose heartbeat is ${String(age)} ms old and whose ` +
          `liveness cannot be judged from this host; it expires in ${String(held.termMs - age)} ms`,
      );
    }

    // Abandoned. Take it, then read back what is actually on disk: two starters
    // adopting one abandoned lock is the case this cannot make atomic, and a
    // confirming read is what turns "both proceed" into "at most one usually
    // does". See the class docstring for the residual window.
    await replaceFileAtomically(file, render(mine));
    const confirmed = parse(await readFile(file, 'utf8'));
    if (confirmed === null || !sameGrant(confirmed, mine)) {
      throw new DirectoryLockedError(
        directory,
        confirmed,
        confirmed === null
          ? 'another process claimed it while this one was adopting it'
          : `${describe(confirmed)} claimed it while this one was adopting it`,
      );
    }
    return new StateDirectoryLock(directory, file, mine, options.now, held);
  }

  /** The grant this process holds. */
  get record(): LockRecord {
    return this.#record;
  }

  get holder(): string {
    return this.#record.holder;
  }

  /**
   * True once a renewal has been refused.
   *
   * The lease's contract, and its warning with it: false means "no refusal has
   * been seen yet", not "we lead".
   */
  get lost(): boolean {
    return this.#lost;
  }

  /** Who took the directory, when this one lost it. */
  get supersededBy(): LockRecord | null {
    return this.#supersededBy;
  }

  /**
   * Beat the heart. Returns false once, and stays lost thereafter.
   *
   * A holder that finds the file gone, unreadable or someone else's has been
   * superseded and must stop writing. It does **not** re-take the directory:
   * the other process is the writer now, and two writers is the failure.
   */
  async renew(): Promise<boolean> {
    if (this.#lost || this.#released) return false;
    const text = await readFile(this.file, 'utf8').catch(() => null);
    const current = text === null ? null : parse(text);
    if (current === null || !sameGrant(current, this.#record)) {
      this.#lost = true;
      this.#supersededBy = current;
      return false;
    }
    const next: LockRecord = { ...this.#record, renewedAt: this.now() };
    await replaceFileAtomically(this.file, render(next));
    this.#record = next;
    return true;
  }

  /** Give the directory up. A no-op unless this process still holds it. */
  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    if (this.#lost) return;
    const text = await readFile(this.file, 'utf8').catch(() => null);
    const current = text === null ? null : parse(text);
    if (current !== null && sameGrant(current, this.#record)) {
      await unlink(this.file).catch(() => undefined);
    }
  }

  /**
   * The same, synchronously, for an exit handler.
   *
   * `process.exit` runs `'exit'` listeners and then stops; a promise scheduled
   * there never resolves. Not releasing is safe — the next boot takes an
   * abandoned lock over — but it costs a warning line on every restart, and a
   * clean shutdown should not look like a crash.
   */
  releaseSync(): void {
    if (this.#released) return;
    this.#released = true;
    if (this.#lost) return;
    try {
      const current = parse(readFileSync(this.file, 'utf8'));
      if (current !== null && sameGrant(current, this.#record)) unlinkSync(this.file);
    } catch {
      // The directory is gone, or the file is not ours to remove. Either way
      // there is nothing to release and nothing an exit handler can do about it.
    }
  }
}
