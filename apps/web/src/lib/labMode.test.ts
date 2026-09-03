import { describe, expect, it } from 'vitest';
import { isLabMode } from './labMode.js';

describe('isLabMode', () => {
  it('is true only when both bases name one origin', () => {
    expect(isLabMode('http://127.0.0.1:7300', 'http://127.0.0.1:7300')).toBe(true);
    expect(isLabMode('http://127.0.0.1:7300/', 'http://127.0.0.1:7300')).toBe(true);
    expect(isLabMode('http://127.0.0.1:7302', 'http://127.0.0.1:7300')).toBe(false);
    expect(isLabMode(undefined, 'http://127.0.0.1:7300')).toBe(false);
    expect(isLabMode('http://127.0.0.1:7300', undefined)).toBe(false);
    expect(isLabMode('not a url', 'not a url')).toBe(false);
  });
});
