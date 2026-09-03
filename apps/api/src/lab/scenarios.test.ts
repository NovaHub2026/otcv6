import { describe, expect, it } from 'vitest';
import { INTERVENTIONS } from '@otc/engine';
import { SCENARIOS, scenarioNamed, scenarioParameters, shapeOf } from './scenarios.js';

/**
 * PH-24.4 §3: sixteen scenarios, fourteen selectable, two declared not — with
 * the reason — and every selectable one a criterion the LA-01 guard covers.
 */
describe('the scenario catalogue', () => {
  it('names the sixteen the specification lists, P1 to P16, once each', () => {
    expect(SCENARIOS).toHaveLength(16);
    expect(new Set(SCENARIOS.map((s) => s.name)).size).toBe(16);
    for (let n = 1; n <= 16; n += 1) {
      expect(
        SCENARIOS.some((s) => s.label.startsWith(`P${String(n)} `)),
        `P${String(n)} missing`,
      ).toBe(true);
    }
  });

  it('declares exactly extreme volatility and low activity not selectable, each with its reason', () => {
    const not = SCENARIOS.filter((s) => !s.selectable);
    expect(not.map((s) => s.name).sort()).toEqual(['extreme-volatility', 'low-activity']);
    for (const s of not) {
      expect(s.why, `${s.name} has no reason`).toMatch(/do(es)? not depend on the signs/);
      expect(s.criterion).toBeUndefined();
      expect(s.parameters).toEqual([]);
    }
  });

  it('gives every selectable scenario a criterion built from INTERVENTIONS, with defaults that parse', () => {
    for (const s of SCENARIOS.filter((x) => x.selectable)) {
      expect(s.criterion, `${s.name} has no criterion`).toBeDefined();
      const params = scenarioParameters(s, {});
      const predicate = s.criterion!(params);
      expect(typeof predicate).toBe('function');
      for (const p of s.parameters) expect(params[p.name]).toBe(p.default);
    }
    // And the criteria they build on are all in the object the LA-01 guard exercises.
    expect(Object.keys(INTERVENTIONS).sort()).toEqual(
      [
        'bearTrendThenPullback',
        'bearishPressure',
        'breakout',
        'bullishPressure',
        'compressedVolatility',
        'directionAt',
        'expandedVolatility',
        'falseBreakout',
        'noise',
        'reversal',
        'sideways',
        'touches',
        'trendThenPullback',
      ].sort(),
    );
  });

  it('parses parameters from a query and refuses nonsense by name', () => {
    const s = scenarioNamed('bull-pullback')!;
    expect(scenarioParameters(s, { rise: '30', depth: '0.5' })).toEqual({ rise: 30, depth: 0.5 });
    expect(() => scenarioParameters(s, { rise: 'many' })).toThrow(RangeError);
    expect(() => scenarioParameters(s, { rise: '-1' })).toThrow(RangeError);
    expect(scenarioNamed('nope')).toBeNull();
  });

  it('summarises a continuation by the numbers the criteria are about', () => {
    const shape = shapeOf({ signs: [1, -1, -1, 1], path: [3, 1, -2, 2], net: 2, high: 3, low: -2 });
    expect(shape).toEqual({ net: 2, high: 3, low: -2, range: 5, directionChanges: 2, ticks: 4 });
  });
});
