import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LabSession, type LabAction, type SessionSink } from './session.js';
import { SessionFile } from './sessionFile.js';

/**
 * PH-24.8 §2 on the disk, where the audit record either is or is not.
 *
 * `labSession.test.ts` drives the session against an in-memory sink, so nothing
 * there executes the mkdir/append/read path this class exists for: a no-op
 * append, a wrong directory or a dropped newline leaves the whole suite green
 * and every Lab session unrecorded (Cycle Audit 8, a8). These run the real file.
 */
const made: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'otc-session-'));
  made.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A reader's sink: `persistTo` needs one and this session writes nothing. */
const nowhere: SessionSink = { append: () => undefined };

const action = (name: string): LabAction => ({
  at: 2,
  asset: 'eurusd',
  engineVersion: 'state-record/3',
  action: name,
  parameters: {},
  initialState: {},
  resultingState: {},
  succeeded: true,
  diagnostics: {},
});

const lines = (file: SessionFile): string[] =>
  readFileSync(file.file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);

describe('the session file', () => {
  it('what one Lab wrote is what the next one restores (PH-24.8 §2)', () => {
    const dir = scratch();
    const file = new SessionFile(dir);
    expect(file.file).toBe(path.join(dir, 'lab', 'session.jsonl'));
    expect(file.existing()).toEqual([]); // a fresh state directory has no session

    const first = new LabSession();
    first.persistTo(file.existing(), file);
    first.recordEvent({ at: 1, asset: 'eurusd', kind: 'regime', detail: 'observed' });
    first.recordAction(action('close.apply'));

    // On disk, in the Lab's own subdirectory, one record per line.
    const written = lines(file);
    expect(written).toHaveLength(2);
    expect(JSON.parse(written[0]!)).toMatchObject({ stream: 'engine', kind: 'regime' });
    expect(JSON.parse(written[1]!)).toMatchObject({ stream: 'lab', action: 'close.apply' });
    expect(readFileSync(file.file, 'utf8').endsWith('\n')).toBe(true);

    // A second process, reading the directory the first one left.
    const second = new LabSession();
    expect(second.persistTo(new SessionFile(dir).existing(), nowhere)).toEqual({
      loaded: 2,
      skipped: 0,
    });
    expect(second.engineEvents).toHaveLength(1);
    expect(second.labActions.map((a) => a.action)).toEqual(['close.apply']);
  });

  it('appends to what is there rather than replacing it, across processes', () => {
    const dir = scratch();
    const first = new LabSession();
    first.persistTo(new SessionFile(dir).existing(), new SessionFile(dir));
    first.recordAction(action('push'));

    const file = new SessionFile(dir);
    const second = new LabSession();
    second.persistTo(file.existing(), file);
    second.recordAction(action('release'));

    expect(lines(file).map((line) => (JSON.parse(line) as LabAction).action)).toEqual([
      'push',
      'release',
    ]);
  });

  it('a crash that tore the last line costs that line and nothing after it', () => {
    const dir = scratch();
    const file = new SessionFile(dir);
    file.append(JSON.stringify({ stream: 'engine', at: 1, asset: 'eurusd', kind: 'regime' }));
    // What a kill mid-write leaves: a complete record, then half of one.
    writeFileSync(file.file, `${readFileSync(file.file, 'utf8')}{"stream":"lab","at":2,"asse`);

    const session = new LabSession();
    const restored = session.persistTo(new SessionFile(dir).existing(), new SessionFile(dir));
    expect(restored).toEqual({ loaded: 1, skipped: 1 }); // the fragment, counted once
    session.recordAction(action('close.apply'));

    // Three lines, not two: the fragment did not swallow the record after it.
    const after = lines(new SessionFile(dir));
    expect(after).toHaveLength(3);
    expect(JSON.parse(after[2]!)).toMatchObject({ stream: 'lab', action: 'close.apply' });

    // And the boot after that still loses the fragment alone.
    const next = new LabSession();
    expect(next.persistTo(new SessionFile(dir).existing(), nowhere)).toEqual({
      loaded: 2,
      skipped: 1,
    });
    expect(next.labActions.map((a) => a.action)).toEqual(['close.apply']);
  });
});
