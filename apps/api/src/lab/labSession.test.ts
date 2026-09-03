import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LabSession } from './session.js';

/**
 * The two timelines stay two.
 *
 * §72–§73: natural engine behaviour and Lab actions are shown separately and
 * never mixed. A blended timeline would make a session unreadable as evidence
 * about the engine — nobody could tell which regime change the market produced
 * and which one an operator asked for.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe('engine behaviour and Lab actions never share a stream', () => {
  it('keeps what the engine did apart from what was asked for', () => {
    const session = new LabSession();
    session.recordEvent({
      at: 1,
      asset: 'eurusd',
      kind: 'regime',
      detail: 'bullish regime started',
    });
    session.recordAction({
      at: 2,
      asset: 'eurusd',
      engineVersion: 'test',
      action: 'bullishPressure',
      parameters: { steps: 20 },
      initialState: { price: 100 },
      resultingState: { price: 130 },
      succeeded: true,
      diagnostics: { acceptanceRate: 0.02, attempts: 50 },
    });

    const { engine, lab } = session.timelines();
    expect(engine).toHaveLength(1);
    expect(lab).toHaveLength(1);
    // The load-bearing assertion: nothing in the engine stream came from an
    // operator. Checked on the shape rather than on a flag, because a flag is
    // a thing that can be set wrong.
    for (const event of engine) expect(event).not.toHaveProperty('action');
    for (const action of lab) expect(action).toHaveProperty('action');
  });

  it('offers no merged timeline, so nobody gets one by default', () => {
    // A caller that wants them interleaved can zip them, and will have written
    // that decision down. One that gets them interleaved by default never
    // decided anything.
    // Checked on what the class *offers*, not on whether its prose says the
    // word. A guard that fires on the comment explaining its own rule is one
    // that gets deleted the first time it is inconvenient — which is exactly
    // what happened to this test's first version, and to `labSurface.test.ts`
    // before it.
    const source = readFileSync(path.join(here, 'session.ts'), 'utf8');
    // The class body only: the `SessionSink` interface above it has an `append`
    // that is not a method of the session.
    const body = source.slice(source.indexOf('class LabSession'));
    const methods = [...body.matchAll(/^ {2}([a-zA-Z]+)\(/gm)].map((match) => match[1]!);
    // The regex has to have found something. A pattern that matches no method
    // filters to `[]` and passes on a class that offers `mergedTimeline()` in
    // its first line — the vacuity this project has now written three times.
    // `persistTo` and `toLines` are the file (PH-24.8 §2): one line per record,
    // a `stream` field telling the two apart in the file only. Not an accessor
    // that hands a caller the two streams interleaved — a reader that merges
    // the file's lines has chosen to.
    expect(methods.sort(), 'the pattern parsed no methods, or new ones appeared').toEqual([
      'persistTo',
      'recordAction',
      'recordEvent',
      'timelines',
      'toLines',
    ]);
    expect(methods.filter((name) => /merge|combine|interleav|all/i.test(name))).toEqual([]);
    expect(source, 'the two streams are concatenated somewhere').not.toMatch(
      /#events[\s\S]{0,40}\.concat\(|\.\.\.this\.#events,\s*\.\.\.this\.#actions/,
    );
    const session = new LabSession();
    expect(Object.keys(session.timelines()).sort()).toEqual(['engine', 'environment', 'lab']);
  });

  it('requires every field §78 lists, so a record is auditable', () => {
    // Required rather than optional: a record missing its initial state is not
    // auditable, which is the whole reason §78 enumerates them.
    const source = readFileSync(path.join(here, 'session.ts'), 'utf8');
    const block = /export interface LabAction \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
    for (const field of [
      'at',
      'asset',
      'engineVersion',
      'action',
      'parameters',
      'initialState',
      'resultingState',
      'succeeded',
      'diagnostics',
    ]) {
      expect(block, `§78 requires ${field}`).toMatch(new RegExp(`readonly ${field}\\??:`));
      expect(block, `${field} is optional; an incomplete record is not auditable`).not.toMatch(
        new RegExp(`readonly ${field}\\?:`),
      );
    }
  });

  it('survives the process: lines written by one session are what the next one starts with (PH-24.8)', () => {
    const lines: string[] = [];
    const first = new LabSession();
    first.persistTo([], { append: (l) => lines.push(l) });
    first.recordEvent({ at: 1, asset: 'eurusd', kind: 'regime', detail: 'observed' });
    first.recordAction({
      at: 2,
      asset: 'eurusd',
      engineVersion: 'x',
      action: 'close.apply',
      parameters: {},
      initialState: {},
      resultingState: {},
      succeeded: true,
      diagnostics: {},
    });
    expect(lines).toHaveLength(2);
    const second = new LabSession();
    const restored = second.persistTo(
      [JSON.stringify({ stream: 'meta', environment: 'x' }), ...lines, 'not json', ''],
      { append: () => undefined },
    );
    expect(restored).toEqual({ loaded: 2, skipped: 1 });
    expect(second.engineEvents).toHaveLength(1);
    expect(second.labActions.map((a) => a.action)).toEqual(['close.apply']);
    // The two streams stay two: `stream` lives in the file only.
    expect(Object.keys(second.labActions[0]!)).not.toContain('stream');
    expect(second.toLines()).toEqual(lines);
  });
});
