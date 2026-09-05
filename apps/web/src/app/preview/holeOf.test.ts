import { describe, expect, it } from 'vitest';
import { holeOf } from './PreviewChart.js';

/** PH-27.3: the hole a gap frame names, read off its own fields. */
describe('holeOf', () => {
  const frame = (data: unknown): Event =>
    ({
      data: typeof data === 'string' ? data : JSON.stringify(data),
    }) as unknown as MessageEvent<string>;

  it('bounds the hole from requested to resumesAt − 1', () => {
    expect(holeOf(frame({ requested: 1804, reason: 'r', resumesAt: 1899 }))).toEqual({
      from: 1804,
      to: 1898,
    });
  });

  it('names no hole when the frame does not bound one', () => {
    expect(holeOf(frame({ requested: 5, reason: 'never published', resumesAt: null }))).toBeNull();
    expect(holeOf(frame({ requested: 9, resumesAt: 9 }))).toBeNull();
    expect(holeOf(frame('not json'))).toBeNull();
    expect(holeOf({} as Event)).toBeNull();
  });
});
