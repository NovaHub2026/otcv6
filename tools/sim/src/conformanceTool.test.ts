import { describe, expect, it } from 'vitest';
import { publicKeyHex, publishingKeyFromSeed } from '@otc/distribution';
import { parseConformanceArgs, runConformanceTool } from './conformanceTool.js';

describe('the conformance command', () => {
  it('parses its options and refuses a malformed base', () => {
    expect(parseConformanceArgs(['--base', 'http://h:1'])).toEqual({
      base: 'http://h:1',
      out: null,
      ticks: 200,
      key: null,
    });
    expect(parseConformanceArgs(['--base', 'http://h:1', '--out', 'r.md', '--ticks', '5'])).toEqual(
      { base: 'http://h:1', out: 'r.md', ticks: 5, key: null },
    );
    // The publisher key, told out of band, is what makes a served proof
    // evidence rather than a claim (Cycle Audit 10, a4-03).
    // **The key an engine really publishes** (2026-09-28). This asserted that 64
    // hex characters were accepted, which is the seed's length: the tool and this
    // guard agreed on a shape no engine publishes, so the documented command
    // refused the only value that works and a truncated key made the report
    // accuse the engine. The key is built here the way the engine builds it.
    const published = publicKeyHex(publishingKeyFromSeed('5a'.repeat(32)));
    expect(published).toHaveLength(88);
    expect(
      parseConformanceArgs(['--base', 'http://h:1', '--key', published.toUpperCase()]),
    ).toEqual({
      base: 'http://h:1',
      out: null,
      ticks: 200,
      key: published,
    });
    // And the seed, or a raw key, is refused by name — with where to find the
    // right value, because a broker meets this message and nothing else.
    for (const wrong of [
      '5a'.repeat(32),
      published.slice(24),
      'ab',
      'zz'.repeat(44),
      published.slice(0, -2),
    ]) {
      expect(() => parseConformanceArgs(['--base', 'http://h:1', '--key', wrong]), wrong).toThrow(
        /publisher\.json/,
      );
    }
    expect(() => parseConformanceArgs(['--base', 'http://h:1', '--key', '5a'.repeat(32)])).toThrow(
      /64 hex characters, which is not a published key/,
    );
    expect(() => parseConformanceArgs(['--base', 'http://h:1', '--key', 'ab'])).toThrow();
    expect(() => parseConformanceArgs([])).toThrow(/--base/);
    expect(() => parseConformanceArgs(['--base', 'http://h:1/'])).toThrow(/trailing slash/);
    expect(() => parseConformanceArgs(['--base', 'http://h:1', '--ticks', '1'])).toThrow(
      /at least 2/,
    );
    expect(() => parseConformanceArgs(['--nope', 'x'])).toThrow(/Unknown option/);
  });

  it('exits 2 on a usage error', async () => {
    expect((await runConformanceTool(['--ticks'])).code).toBe(2);
  });
});
