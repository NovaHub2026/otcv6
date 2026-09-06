import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentProcessIdentity,
  DEFAULT_LOCK_RENEWAL_MS,
  DEFAULT_LOCK_TERM_MS,
  DirectoryLockedError,
  LOCK_FILE,
  processLiveness,
  StateDirectoryLock,
  type HolderLiveness,
  type LockIdentity,
  type LockRecord,
} from './directoryLock.js';
import { backupStateDirectory, verifyStateDirectory } from './stateDirectory.js';

/**
 * One writer per state directory (Cycle Audit 10: a3-07, a6-05).
 *
 * Two venue processes pointed at one state directory both booted, both hosted
 * the catalogue and both appended to one `record.db`. Each had primed its own
 * feed from the record at boot and afterwards offered it only the ticks *its
 * own* append returned as fresh, so each one's feed was handed a sequence it
 * could not follow and refused it — for the life of the process. Measured on
 * the release build: both answering `{"status":"ok","stalled":[],"ready":true}`
 * with a climbing `otc_ticks_published_total`, and every subscriber of both
 * receiving nothing.
 *
 * Nothing in the repository prevented it: `grep` for `flock`, `venue.lock` or
 * an exclusive open over `packages/`, `apps/`, `tools/` and `deploy/` found
 * nothing, and `MULTI_NODE_AND_OPERATIONS.md` said so outright — "a second
 * writer with no fence".
 */

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'otc-lock-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const A: LockIdentity = { holder: 'host-a/101', pid: 101, host: 'host-a' };
const B: LockIdentity = { holder: 'host-a/202', pid: 202, host: 'host-a' };
const ELSEWHERE: LockIdentity = { holder: 'host-b/303', pid: 303, host: 'host-b' };

/** A clock a test advances, since nothing under `packages/` reads ambient time. */
function ticking(from = 1_776_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let instant = from;
  return {
    now: () => instant,
    advance: (ms: number) => {
      instant += ms;
    },
  };
}

const always = (verdict: HolderLiveness) => (): HolderLiveness => verdict;

async function held(dir: string): Promise<LockRecord> {
  return JSON.parse(await readFile(path.join(dir, LOCK_FILE), 'utf8')) as LockRecord;
}

describe('a state directory admits one writer (a3-07)', () => {
  it('takes a free directory and names itself in the file', async () => {
    const clock = ticking();
    const lock = await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    expect(lock.tookOverFrom).toBe(null);
    expect(lock.holder).toBe('host-a/101');
    const record = await held(directory);
    expect(record).toMatchObject({
      kind: 'otc-venue-lock',
      version: 1,
      holder: 'host-a/101',
      pid: 101,
      host: 'host-a',
      termMs: DEFAULT_LOCK_TERM_MS,
    });
    expect(record.acquiredAt).toBe(clock.now());
  });

  it('refuses a second process while the first is running, and says whose it is', async () => {
    const clock = ticking();
    await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    clock.advance(1_000);
    const refused = await StateDirectoryLock.acquire(directory, {
      now: clock.now,
      identity: B,
      liveness: always('alive'),
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(DirectoryLockedError);
    const message = (refused as DirectoryLockedError).message;
    expect(message).toContain(path.join(directory, LOCK_FILE));
    expect(message).toContain('host-a/101 (pid 101 on host-a) is running');
    expect(message).toContain('OTC_STATE_DIR');
    // And it changed nothing: the running holder still holds its own grant.
    expect((await held(directory)).holder).toBe('host-a/101');
  });

  it('refuses a holder on another host whose heartbeat is still inside its term', async () => {
    const clock = ticking();
    await StateDirectoryLock.acquire(directory, { now: clock.now, identity: ELSEWHERE });
    clock.advance(DEFAULT_LOCK_TERM_MS - 1);
    // `processLiveness` cannot judge a pid from another host, and guessing is
    // the one wrong answer that lets two writers proceed.
    await expect(
      StateDirectoryLock.acquire(directory, { now: clock.now, identity: A }),
    ).rejects.toThrow(/liveness cannot be judged from this host/);
  });

  it('refuses a lock file it cannot read rather than assuming it is stale', async () => {
    await writeFile(path.join(directory, LOCK_FILE), 'not json at all\n');
    await expect(
      StateDirectoryLock.acquire(directory, { now: ticking().now, identity: A }),
    ).rejects.toThrow(/is not a lock record/);
  });
});

describe('an abandoned directory is taken over, loudly (a3-07)', () => {
  it('adopts a lock whose process is gone, and reports whose it was', async () => {
    const clock = ticking();
    await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    clock.advance(1_000);
    // `Restart=always` after a SIGKILL: the pid is gone, the file is not.
    const lock = await StateDirectoryLock.acquire(directory, {
      now: clock.now,
      identity: B,
      liveness: always('gone'),
    });
    expect(lock.tookOverFrom?.holder, 'the previous holder was not named').toBe('host-a/101');
    expect((await held(directory)).holder).toBe('host-a/202');
  });

  it('adopts a lock from another host once its heartbeat has expired', async () => {
    const clock = ticking();
    await StateDirectoryLock.acquire(directory, { now: clock.now, identity: ELSEWHERE });
    clock.advance(DEFAULT_LOCK_TERM_MS + 1);
    const lock = await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    expect(lock.tookOverFrom?.holder).toBe('host-b/303');
  });

  it('renews at least three times a term, so a live holder is never adopted', () => {
    expect(DEFAULT_LOCK_RENEWAL_MS * 3).toBeLessThanOrEqual(DEFAULT_LOCK_TERM_MS);
  });
});

describe('a superseded holder stops writing (a6-05)', () => {
  it('renews while it holds, moving the heartbeat forward', async () => {
    const clock = ticking();
    const lock = await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    const first = (await held(directory)).renewedAt;
    clock.advance(DEFAULT_LOCK_RENEWAL_MS);
    expect(await lock.renew()).toBe(true);
    expect((await held(directory)).renewedAt).toBe(first + DEFAULT_LOCK_RENEWAL_MS);
  });

  it('loses the directory when another process has taken it, and stays lost', async () => {
    const clock = ticking();
    const first = await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    clock.advance(DEFAULT_LOCK_TERM_MS + 1);
    const second = await StateDirectoryLock.acquire(directory, {
      now: clock.now,
      identity: B,
      liveness: always('gone'),
    });
    expect(second.tookOverFrom?.holder).toBe('host-a/101');

    expect(await first.renew(), 'a superseded holder renewed as if it still led').toBe(false);
    expect(first.lost, 'a superseded holder does not know it lost').toBe(true);
    expect(first.supersededBy?.holder).toBe('host-a/202');
    // False for ever after: it does not re-take the directory, because the
    // other process is the writer now and two writers is the failure.
    expect(await first.renew(), 'a superseded holder took the directory back').toBe(false);
    expect((await held(directory)).holder).toBe('host-a/202');
  });

  it('releases nothing that is no longer its own', async () => {
    const clock = ticking();
    const first = await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    clock.advance(DEFAULT_LOCK_TERM_MS + 1);
    await StateDirectoryLock.acquire(directory, {
      now: clock.now,
      identity: B,
      liveness: always('gone'),
    });
    await first.release();
    const after = await held(directory).catch(() => null);
    expect(after?.holder, 'a stopping process deleted the new writer’s lock').toBe('host-a/202');
  });

  it('gives a directory it still holds back, synchronously, for an exit handler', async () => {
    const clock = ticking();
    const lock = await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    lock.releaseSync();
    expect(await readdir(directory)).not.toContain(LOCK_FILE);
    // And the next boot takes it with no takeover warning at all.
    const next = await StateDirectoryLock.acquire(directory, { now: clock.now, identity: B });
    expect(next.tookOverFrom).toBe(null);
  });
});

describe('the lock is not part of the state the directory describes (a3-01, a6-11)', () => {
  it('is invisible to the boot check, because it is not a checkpoint', async () => {
    const clock = ticking();
    await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    const report = await verifyStateDirectory(directory);
    // `FileStateStore.list` maps every `*.json` in the directory to an asset id,
    // which is how `backup.json` became "asset undefined" and made every shipped
    // backup unbootable (a3-01, a6-11). A lock file named `venue.lock` cannot
    // repeat it, and this is the assertion that keeps it named that way.
    expect(report.assets).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it('is not copied into a backup, so a restored directory is not born locked', async () => {
    const clock = ticking();
    await StateDirectoryLock.acquire(directory, { now: clock.now, identity: A });
    const target = path.join(directory, '..', path.basename(directory) + '-backup');
    try {
      await backupStateDirectory(directory, target, clock.now());
      expect(await readdir(target)).not.toContain(LOCK_FILE);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
});

describe('who the lock says is holding it', () => {
  it('names this process by host and pid', () => {
    const self = currentProcessIdentity();
    expect(self.pid).toBe(process.pid);
    expect(self.holder).toBe(`${self.host}/${String(process.pid)}`);
  });

  it('calls a pid on another host unknown rather than guessing', () => {
    const self = currentProcessIdentity();
    const record: LockRecord = {
      kind: 'otc-venue-lock',
      version: 1,
      holder: 'elsewhere/1',
      pid: 1,
      host: `${self.host}-not`,
      acquiredAt: 0,
      renewedAt: 0,
      termMs: DEFAULT_LOCK_TERM_MS,
    };
    expect(processLiveness(record, self)).toBe('unknown');
    // This process is demonstrably alive, and a pid that cannot exist is gone.
    expect(processLiveness({ ...record, host: self.host, pid: self.pid }, self)).toBe('alive');
    expect(processLiveness({ ...record, host: self.host, pid: 0x7fff_fffe }, self)).toBe('gone');
  });
});
