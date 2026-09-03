import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SessionSink } from './session.js';

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
    appendFileSync(this.file, `${line}\n`);
  }
}
