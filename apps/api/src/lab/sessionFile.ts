import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import type { SessionSink } from './session.js';

/** The byte a record ends on. A file that does not end on it was torn mid-write. */
const NEWLINE = 0x0a;

/**
 * The session's file: `<state dir>/lab/session.jsonl`, appended synchronously.
 *
 * Synchronous on purpose: a record is written before the route answers, so a
 * crash right after cannot lose the act it just reported. The volume is an
 * operator's clicks and a few engine transitions a minute — nothing a sync
 * append costs anything on. Lives beside the Lab's own state, never a market's
 * (PH-24.8 §2).
 */
export class SessionFile implements SessionSink {
  readonly file: string;
  /** Whether this process has already appended, and so already closed whatever it found. */
  #sealed = false;

  constructor(stateDir: string) {
    this.file = path.join(stateDir, 'lab', 'session.jsonl');
  }

  /** What a previous process left, one line per record; nothing when there is no file. */
  existing(): string[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n');
  }

  append(line: string): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    // A crash leaves half a line, and `session.ts` counts on that fragment being
    // skipped **alone**. Appending straight onto it glues this record to the
    // fragment: one unparseable line made of two records, of which one is an
    // operator's act, reported as a single skip on this boot and every boot
    // after it (Cycle Audit 8, a6). Closing the fragment first costs it the one
    // skip it had coming and keeps the record that follows. Only the first
    // append of a process can meet a torn file — every later one follows a
    // newline this method wrote.
    const seal = this.#sealed || !this.#endsTorn() ? '' : '\n';
    appendFileSync(this.file, `${seal}${line}\n`);
    this.#sealed = true;
  }

  /** Whether the file exists, holds something, and its last byte is not a newline. */
  #endsTorn(): boolean {
    if (!existsSync(this.file)) return false;
    const { size } = statSync(this.file);
    if (size === 0) return false;
    const handle = openSync(this.file, 'r');
    try {
      const last = Buffer.alloc(1);
      readSync(handle, last, 0, 1, size - 1);
      return last[0] !== NEWLINE;
    } finally {
      closeSync(handle);
    }
  }
}
