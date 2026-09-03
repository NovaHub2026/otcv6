import { describe, expect, it } from 'vitest';
import { MINIMUM_SETTLED_POSITIONS, positionsDiagnostic } from './positionsDiagnostic.js';

describe('the positions diagnostic (§70 over outcomes)', () => {
  const won = (n: number, preset: string | null = 'win-minimum') =>
    Array.from({ length: n }, (_, i) => ({ id: `p${String(i)}`, outcome: 'win' as const, preset }));
  const lost = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `l${String(i)}`,
      outcome: 'loss' as const,
      preset: null,
    }));

  it('says too few to say below the floor, and names it', () => {
    const d = positionsDiagnostic(won(3));
    expect(d.verdict).toBe('too-few-to-say');
    expect(d.minimumForVerdict).toBe(MINIMUM_SETTLED_POSITIONS);
    expect(d.byPreset['win-minimum']!.win).toBe(3);
  });

  it('calls ten wins in ten one-sided, and a mixed session no pattern', () => {
    expect(positionsDiagnostic(won(10)).verdict).toBe('one-sided');
    const mixed = positionsDiagnostic([...won(6), ...lost(6)]);
    expect(mixed.verdict).toBe('no-pattern');
    expect(mixed.winFraction).toBeCloseTo(0.5, 6);
    expect(mixed.byOutcome).toEqual({ win: 6, loss: 6, refund: 0 });
    expect(mixed.byPreset['sin preset']!.loss).toBe(6);
  });
});
