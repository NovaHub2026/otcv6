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
});
