import { describe, expect, it } from 'vitest';
import { closesDiagnostic, MINIMUM_CONTROLLED_CLOSES } from './closesDiagnostic.js';
import type { LabAction } from './session.js';

/**
 * PH-24.5 §2: the §70 diagnostic runs over the operator's choices, says what
 * it rests on, and refuses to call three closes a pattern.
 */
const act = (delta: number, succeeded = true, action = 'close.apply'): LabAction => ({
  at: 0,
  asset: 'eurusd',
  engineVersion: 'test',
  action,
  parameters: {},
  initialState: {},
  resultingState: {},
  succeeded,
  diagnostics: { delta },
});

describe('the closes diagnostic', () => {
  it('says too few to say below the floor, and names the floor', () => {
    const d = closesDiagnostic([act(1), act(1), act(1)]);
    expect(d.verdict).toBe('too-few-to-say');
    expect(d.controlled).toBe(3);
    expect(d.minimumForVerdict).toBe(MINIMUM_CONTROLLED_CLOSES);
    expect(d.note).toMatch(/at least 10/);
  });

  it('calls a session of one-step closes one-sided, with the fraction it rests on', () => {
    const actions = [...Array.from({ length: 8 }, () => act(1)), act(4), act(-2), act(0), act(-1)];
    const d = closesDiagnostic(actions);
    expect(d.controlled).toBe(12);
    expect(d.verdict).toBe('one-sided');
    expect(d.oneStepFraction).toBeCloseTo(9 / 12, 6);
    expect(d.distances).toEqual({ '1': 8, '>+3': 1, '-2': 1, '0': 1, '-1': 1 });
    expect(d.note).toMatch(/75% of 12/);
  });

  it('finds no pattern in a spread of distances', () => {
    const d = closesDiagnostic([2, -3, 5, -7, 0, 4, -4, 6, -6, 3, -5, 8].map((x) => act(x)));
    expect(d.verdict).toBe('no-pattern');
    expect(d.oneStepFraction).toBe(0);
  });

  it('counts only what was armed: refused closes chose nothing, and other acts are not closes', () => {
    const d = closesDiagnostic([
      ...Array.from({ length: 10 }, () => act(1)),
      ...Array.from({ length: 10 }, () => act(1, false)),
      ...Array.from({ length: 10 }, () => act(1, true, 'scenario.apply')),
      ...Array.from({ length: 2 }, () => act(1, true, 'preset.apply')),
    ]);
    expect(d.controlled).toBe(12);
    expect(d.verdict).toBe('one-sided');
  });
});
