import { link, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Files that are published whole, and stay published.
 *
 * Two properties, and each of the two callers needed one of them missing:
 *
 * **Atomic against a crash** — a reader sees the previous file or the new one,
 * never a half-written one. Write to a temporary name, `rename` over the
 * target. The temporary name is unique per *call*, not per process: `FileStateStore`
 * used `${target}.${pid}.tmp` and two concurrent saves of one asset raced, the
 * first `rename` moving the file the second was still writing (Cycle Audit 6;
 * reproduced 200 of 200). `FileAssetRegistry` carried the same name and the
 * same race unfixed, twenty concurrent overlay edits storing one (a5-07).
 *
 * **Durable against a power loss** — the bytes and the directory entry are on
 * the platter before the call resolves. `rename` alone is atomic only with
 * respect to the process; after a power loss a filesystem without
 * rename-ordering heuristics may present an empty or stale file under the new
 * name (a5-10). So the temporary file is `fsync`ed before it is renamed, and
 * the directory after, which is what makes the rename itself durable. A
 * checkpoint that reads as empty after a power cut is a `CorruptRecordError`
 * and a market that refuses to start; a registration that reads as empty is a
 * catalogue that will not boot.
 *
 * `createFileExclusively` publishes with `link` rather than `rename`, because
 * a registration must also be *exclusive*: `link` fails with `EEXIST` when the
 * target exists, atomically, where `rename` would silently replace it. Ten
 * concurrent registrations of one id then admit exactly one.
 */

/** Unique within this process; the pid makes it unique across processes. */
let temporarySequence = 0;

function temporaryPathFor(target: string): string {
  temporarySequence += 1;
  return `${target}.${process.pid}.${temporarySequence}.tmp`;
}

/** Write and `fsync` a file, so its bytes are durable before it is published. */
async function writeDurably(file: string, data: string): Promise<void> {
  const handle = await open(file, 'w');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Error codes a filesystem uses to say it cannot sync a directory handle.
 *
 * The file's own sync is never optional. The directory's is what makes the
 * rename durable, and some filesystems refuse the operation outright rather
 * than performing it unsafely; on those the call has done what it can.
 */
const DIRECTORY_SYNC_UNSUPPORTED = new Set(['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM']);

/** `fsync` the directory, so a rename or link into it survives a power loss. */
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === undefined || !DIRECTORY_SYNC_UNSUPPORTED.has(code)) throw error;
  } finally {
    await handle.close();
  }
}

/** Replace `target` with `data`: atomically, durably, and safely under concurrency. */
export async function replaceFileAtomically(target: string, data: string): Promise<void> {
  const temporary = temporaryPathFor(target);
  await writeDurably(temporary, data);
  await rename(temporary, target);
  await syncDirectory(path.dirname(target));
}

/**
 * Replace many files in one directory: each one atomically and durably, and the
 * directory synced **once** at the end rather than once per file.
 *
 * Every file is written and fsynced before any rename, so a power loss leaves
 * each target either whole-old or whole-new — the property `replaceFileAtomically`
 * gives, kept. What is dropped is the repetition: thirty checkpoints cost thirty
 * directory fsyncs where one covers every rename into it, and the venue writes
 * all thirty every five seconds. Measured on this machine's state filesystem,
 * thirty replacements went from 60 fsyncs to 31, and on a contended volume the
 * checkpoint that cost 11.4 s of a 15 s catch-up bound is what made that matter
 * (the readiness audit of 2026-09-28).
 */
export async function replaceFilesAtomically(
  directory: string,
  files: readonly { readonly name: string; readonly data: string }[],
): Promise<void> {
  if (files.length === 0) return;
  const written: { temporary: string; target: string }[] = [];
  for (const file of files) {
    const target = path.join(directory, file.name);
    const temporary = temporaryPathFor(target);
    await writeDurably(temporary, file.data);
    written.push({ temporary, target });
  }
  for (const { temporary, target } of written) await rename(temporary, target);
  await syncDirectory(directory);
}

/**
 * Create `target` with `data` only if it does not exist.
 *
 * Returns false, and leaves nothing behind, when the target already exists.
 */
export async function createFileExclusively(target: string, data: string): Promise<boolean> {
  const temporary = temporaryPathFor(target);
  await writeDurably(temporary, data);
  try {
    await link(temporary, target);
  } catch (error) {
    await unlink(temporary);
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  await unlink(temporary);
  await syncDirectory(path.dirname(target));
  return true;
}
