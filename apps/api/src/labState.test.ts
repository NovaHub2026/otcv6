import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { labMarkerPath, markLabState, refuseLabState } from './labState.js';

/**
 * Cycle Audit 8 (a4, a6): a state directory says which composition wrote it.
 *
 * The defect this closes is not a crash — it is a market whose prices an
 * operator chose being resumed and served as production's, with
 * `recovery: {"kind":"resumed"}` and nothing else to distinguish it.
 */
const made: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'otc-labstate-'));
  made.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe('a state directory carries the composition that wrote it', () => {
  it('is unmarked until a Lab boots, and marked from that moment', () => {
    const dir = scratch();
    expect(refuseLabState(dir)).toBeNull();

    const file = markLabState(dir, 1_788_000_000_000, 'state-record/3');
    expect(file).toBe(labMarkerPath(dir));
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')) as unknown).toEqual({
      composedBy: 'lab',
      firstBootAt: 1_788_000_000_000,
      engineVersion: 'state-record/3',
    });

    const refusal = refuseLabState(dir);
    expect(refusal).not.toBeNull();
    // The refusal has to be actionable on its own: the directory, the file, and
    // both remedies. An operator reading it at 3am is the point.
    expect(refusal!).toContain(dir);
    expect(refusal!).toContain(labMarkerPath(dir));
    expect(refusal!).toMatch(/OTC_STATE_DIR/);
    expect(refusal!).toMatch(/move that marker aside/);
  });

  it('keeps the first boot, so the mark is not rewritten by every restart', () => {
    const dir = scratch();
    markLabState(dir, 1_000, 'state-record/3');
    markLabState(dir, 2_000, 'state-record/4');
    expect(
      (JSON.parse(readFileSync(labMarkerPath(dir), 'utf8')) as { firstBootAt: number }).firstBootAt,
    ).toBe(1_000);
  });

  it('marks a directory that does not exist yet, because the Lab marks before it publishes', () => {
    const dir = path.join(scratch(), 'not', 'created', 'yet');
    markLabState(dir, 5, 'state-record/3');
    expect(refuseLabState(dir)).not.toBeNull();
  });

  it('is not fooled by a Lab session file alone, nor by an empty lab directory', () => {
    // The marker is the fact; `session.jsonl` only appears once an act is
    // recorded, and a Lab that published for an hour and was never touched has
    // none. Marking at boot is what makes the check reliable in that direction.
    const dir = scratch();
    mkdirSync(path.join(dir, 'lab'), { recursive: true });
    expect(refuseLabState(dir)).toBeNull();
    writeFileSync(path.join(dir, 'lab', 'session.jsonl'), '');
    expect(refuseLabState(dir)).toBeNull();
    markLabState(dir, 7, 'state-record/3');
    expect(refuseLabState(dir)).not.toBeNull();
  });
});

describe('the two compositions agree about the mark', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (file: string): string => readFileSync(path.join(here, file), 'utf8');

  it('the Lab writes it before it publishes, and production refuses on it', () => {
    const lab = read('lab/lab.main.ts');
    const production = read('main.ts');
    // Before `venue.start()`: a mark written after the first tick is a mark that
    // is missing for the run that mattered.
    // The venue's injected clock, never ambient time: the no-ambient-time
    // guardrail covers this file and caught the first version of the line.
    expect(lab).toMatch(/markLabState\(\s*stateDir,\s*venue\.now\(\)/);
    // Over comment-stripped source: the place a forbidden call is likeliest to
    // appear is the comment explaining why it is forbidden.
    const strip = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(strip(lab)).not.toMatch(/Date\.now\(\)/);
    expect(lab.indexOf('markLabState(')).toBeLessThan(lab.indexOf('await venue.start()'));
    expect(production).toMatch(
      /refuseLabState\(process\.env\.OTC_STATE_DIR \?\? '\.\/\.otc-state'\)/,
    );
    // Against the call, not a mention of it: the file's own docstring names
    // `NestFactory.create` several paragraphs above the code.
    expect(production.indexOf('refuseLabState(')).toBeLessThan(
      production.indexOf('NestFactory.create(AppModule.register()'),
    );
    expect(production).toMatch(/process\.exit\(1\)/);
    // And no way to wave it through from the environment.
    expect(production).not.toMatch(/OTC_ALLOW_LAB_STATE|OTC_IGNORE_LAB/);
    expect(read('labState.ts')).not.toMatch(/process\.env/);
  });
});
