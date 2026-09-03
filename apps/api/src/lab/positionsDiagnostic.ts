import type { Outcome } from '@otc/trading';

/**
 * §70 over the positions (PH-24.8 §1.2): the closes diagnostic reads the
 * operator's distances; this reads how the positions ended. A session in which
 * every position won is a hand, not a market, and the Lab says so — with the
 * count it rests on, and never below the floor.
 */
export interface PositionsDiagnostic {
  readonly settled: number;
  readonly byOutcome: Readonly<Record<Outcome, number>>;
  readonly byPreset: Readonly<Record<string, Readonly<Record<Outcome, number>>>>;
  readonly winFraction: number | null;
  readonly minimumForVerdict: number;
  readonly verdict: 'too-few-to-say' | 'no-pattern' | 'one-sided';
  readonly note: string;
}

export const MINIMUM_SETTLED_POSITIONS = 10;

export interface SettledPosition {
  readonly id: string;
  readonly outcome: Outcome;
  /** The preset that decided it, if a preset was applied to it; null otherwise. */
  readonly preset: string | null;
}

export function positionsDiagnostic(settled: readonly SettledPosition[]): PositionsDiagnostic {
  const byOutcome: Record<Outcome, number> = { win: 0, loss: 0, refund: 0 };
  const byPreset: Record<string, Record<Outcome, number>> = {};
  for (const p of settled) {
    byOutcome[p.outcome] += 1;
    const key = p.preset ?? 'sin preset';
    byPreset[key] ??= { win: 0, loss: 0, refund: 0 };
    byPreset[key][p.outcome] += 1;
  }
  const winFraction = settled.length === 0 ? null : byOutcome.win / settled.length;
  if (settled.length < MINIMUM_SETTLED_POSITIONS) {
    return {
      settled: settled.length,
      byOutcome,
      byPreset,
      winFraction,
      minimumForVerdict: MINIMUM_SETTLED_POSITIONS,
      verdict: 'too-few-to-say',
      note:
        `${String(settled.length)} settled position(s); a verdict needs at least ` +
        `${String(MINIMUM_SETTLED_POSITIONS)} before it says anything about the operator's habits.`,
    };
  }
  // A fair market pays roughly half of at-random positions. Nine in ten either
  // way, over ten or more, is a hand.
  const oneSided = winFraction !== null && (winFraction >= 0.9 || winFraction <= 0.1);
  return {
    settled: settled.length,
    byOutcome,
    byPreset,
    winFraction,
    minimumForVerdict: MINIMUM_SETTLED_POSITIONS,
    verdict: oneSided ? 'one-sided' : 'no-pattern',
    note: oneSided
      ? `${String(Math.round((winFraction ?? 0) * 100))}% of ${String(settled.length)} settled positions won. ` +
        'The paths carry no signature; the presets do — a viewer who saw only outcomes would notice.'
      : `${String(settled.length)} settled positions, ${String(Math.round((winFraction ?? 0) * 100))}% won: ` +
        'nothing a viewer of outcomes alone would pick out.',
  };
}
