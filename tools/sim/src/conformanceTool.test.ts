import { describe, expect, it } from 'vitest';
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
    expect(parseConformanceArgs(['--base', 'http://h:1', '--key', 'AB'.repeat(32)])).toEqual({
      base: 'http://h:1',
      out: null,
      ticks: 200,
      key: 'ab'.repeat(32),
    });
    expect(() => parseConformanceArgs(['--base', 'http://h:1', '--key', 'ab'])).toThrow(
      /64 hex characters/,
    );
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
