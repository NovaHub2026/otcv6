import { describe, expect, it } from 'vitest';
import { conforms, shapeProblems } from './shape.js';

describe('a value conforms to a contracted type', () => {
  it('judges every type the contract can name', () => {
    expect(conforms(1, 'integer')).toBe(true);
    expect(conforms(1.5, 'integer')).toBe(false);
    expect(conforms(1.5, 'number')).toBe(true);
    expect(conforms(Number.NaN, 'number')).toBe(false);
    expect(conforms('x', 'string')).toBe(true);
    expect(conforms(true, 'boolean')).toBe(true);
    expect(conforms([], 'array')).toBe(true);
    expect(conforms({}, 'object')).toBe(true);
    expect(conforms([], 'object')).toBe(false);
    expect(conforms(null, 'integer|null')).toBe(true);
    expect(conforms(null, 'integer')).toBe(false);
    expect(conforms(1, 'string|null')).toBe(false);
  });

  it('names every departure from a shape', () => {
    expect(shapeProblems('x', { a: 1, b: 'y' }, { a: 'integer', b: 'string' })).toEqual([]);
    expect(shapeProblems('x', { a: 1.5, b: 'y' }, { a: 'integer', b: 'string' })).toHaveLength(1);
    expect(shapeProblems('x', { a: 1 }, { a: 'integer', b: 'string' })).toHaveLength(1);
    expect(shapeProblems('x', { a: 1, b: 'y', c: 0 }, { a: 'integer', b: 'string' })).toHaveLength(
      1,
    );
    expect(shapeProblems('x', 'not an object', { a: 'integer' })).toEqual(['x: not an object']);
    expect(shapeProblems('x', null, { a: 'integer' })).toEqual(['x: not an object']);
  });

  /**
   * **Cycle Audit 13, a3-03.** The history route's candles were `'array'`, and a
   * refuter fed it exactly this and the check passed it. An items shape holds
   * every element to it (PH-40.4).
   */
  it('holds every item of a typed array to its shape', () => {
    const shape = { candles: { items: { close: 'integer', logQuantum: 'number|null' } } } as const;
    expect(shapeProblems('h', { candles: [{ close: 3, logQuantum: null }] }, shape)).toEqual([]);
    const problems = shapeProblems(
      'h',
      { candles: [{ nonsense: true, logQuantum: 'banana' }, 7, null] },
      shape,
    );
    expect(problems.join('; ')).toMatch(/h\.candles\[0\]: keys logQuantum,nonsense/);
    expect(problems.join('; ')).toMatch(/h\.candles\[0\]\.logQuantum: "banana"/);
    expect(problems).toContain('h.candles[1]: not an object');
    expect(problems).toContain('h.candles[2]: not an object');
    expect(shapeProblems('h', { candles: 'no' }, shape)).toEqual([
      'h.candles: "no" is not an array',
    ]);
  });
});
