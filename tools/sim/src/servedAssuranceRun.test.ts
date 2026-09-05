import { describe, expect, it } from 'vitest';
import type { StandingVerdict } from '@otc/lab';
import { parse, report, retainedWindowStart, startFor, verdictRow } from './servedAssuranceRun.js';

/** PH-25.3: the job's pure half, tested without a venue. */

const verdict = (outcome: StandingVerdict['outcome']): StandingVerdict => ({
  assetId: 'eurusd-otc',
  at: 1_776_000_000_000,
  ticks: 12_345,
  coveredMs: 2.5 * 3_600_000,
  outcome,
  families: ['a', 'b', 'c'],
  withheldUnavailable: outcome === 'undecided' ? ['wh-cross-asset'] : [],
  hypothesesTested: 321,
  horizons: [
    {
      horizon: '30s',
      samples: 400,
      detectionFloorPp: 4.321,
      sufficientForPayout: false,
      sufficientForProductMargin: false,
    },
  ],
  exploitable: [],
  worstZ: -1.234,
  elapsedSeconds: 3,
  notes: ['a note'],
});

describe('the options a run is given', () => {
  it('requires a bare base URL and reads every flag it documents', () => {
    expect(parse(['--base', 'http://127.0.0.1:7300'])).toEqual({
      base: 'http://127.0.0.1:7300',
      assets: null,
      out: null,
      maxTicks: 50_000,
      label: 'served-assurance',
    });
    expect(
      parse([
        '--base',
        'http://h:1',
        '--assets',
        'a,b',
        '--out',
        'x.md',
        '--max-ticks',
        '9',
        '--label',
        'l',
      ]),
    ).toEqual({ base: 'http://h:1', assets: ['a', 'b'], out: 'x.md', maxTicks: 9, label: 'l' });
  });

  it('refuses what it cannot run', () => {
    expect(() => parse([])).toThrow(/--base/);
    expect(() => parse(['--base', 'http://h:1/'])).toThrow(/--base/);
    expect(() => parse(['--base', 'http://h:1', '--max-ticks', '1'])).toThrow(/max-ticks/);
    expect(() => parse(['--base', 'http://h:1', '--nonsense'])).toThrow(/Unknown option/);
  });
});

describe('the window is learned from the venue, not guessed', () => {
  it('reads the window start off the refusal, and nothing off anything else', () => {
    expect(
      retainedWindowStart(
        '{"message":"Sequence 1804 for x is older than the retained window, which starts at 1899. …"}',
      ),
    ).toBe(1_899);
    expect(retainedWindowStart('Sequence 5 has never been published; the newest is 4.')).toBeNull();
  });

  it('starts so that at most maxTicks are asked for, never below one', () => {
    expect(startFor(100_000, 50_000)).toBe(50_001);
    expect(startFor(10, 50_000)).toBe(1);
  });
});

describe('the report says what the run did', () => {
  it('writes one row per asset with the outcome, the floors and the counts', () => {
    const row = verdictRow({
      assetId: 'eurusd-otc',
      record: { ticks: [], gaps: [], discontinuities: [], bytes: 0 },
      range: { first: 100, last: 12_444, sha256: 'abcdef0123456789ff' },
      verdict: verdict('undecided'),
      failure: null,
      seconds: 12.4,
    });
    expect(row).toContain(
      '| eurusd-otc | 12345 | 2.50 h | undecided | 321 / 3 / 1 | 30s 4.321pp (400) | -1.23 | 12s | 100–12444 abcdef012345 |',
    );
    expect(
      verdictRow({
        assetId: 'x',
        record: null,
        range: null,
        verdict: null,
        failure: 'no route',
        seconds: 1,
      }),
    ).toContain('**failed** | no route');
    expect(
      verdictRow({
        assetId: 'x',
        record: { ticks: [], gaps: [], discontinuities: [], bytes: 0 },
        range: null,
        verdict: verdict('exploitable'),
        failure: null,
        seconds: 1,
      }),
    ).toContain('**exploitable**');
  });

  it('names the venue, the stamp, the counts and the holes', () => {
    const text = report(
      {
        label: 'first',
        base: 'http://127.0.0.1:7300',
        at: '2026-09-05T06:00:00.000Z',
        maxTicks: 50_000,
        venue: { bootNonce: 'n-1', assets: 31, labComposition: true },
        jobCommit: 'abc1234',
      },
      [
        {
          assetId: 'a',
          record: {
            ticks: [],
            gaps: [{ requested: 1, reason: 'r', resumesAt: 9, afterSequence: null }],
            discontinuities: [],
            bytes: 1,
          },
          range: { first: 1, last: 2, sha256: 'ff' },
          verdict: verdict('clean'),
          failure: null,
          seconds: 1,
        },
        { assetId: 'b', record: null, range: null, verdict: null, failure: 'down', seconds: 1 },
      ],
    );
    expect(text).toContain('# Served-record assurance — first');
    expect(text).toContain('Venue: `http://127.0.0.1:7300`');
    expect(text).toContain('Assets: 2 — 0 exploitable, 1 failed');
    // The venue as it described itself, and the build (CA9 a4-02).
    expect(text).toContain('boot nonce n-1, 31 assets, **Lab composition**');
    expect(text).toContain('Job built from commit `abc1234`');
    // The venue as it described itself, and the build (CA9 a4-02).
    expect(text).toContain('boot nonce n-1, 31 assets, **Lab composition**');
    expect(text).toContain('Job built from commit `abc1234`');
    expect(text).toContain('- a: a note');
    expect(text).toContain('- a: 1 told gap(s), 0 discontinuit(ies)');
  });
});
