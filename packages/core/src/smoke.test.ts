import { describe, expect, it } from 'vitest';
import { PLACEHOLDER } from './index.js';

describe('toolchain smoke', () => {
  it('resolves workspace sources', () => {
    expect(PLACEHOLDER).toBe(true);
  });
});
