import type { LabAction } from './session.js';

/**
 * §70, over the operator rather than over the paths (PH-24.5 §2).
 *
 * A selected path carries no signature — that is PH-23.1's construction, and a
 * plant that replaced the sampler with a constructive solver was caught. The
 * other place a pattern can live is in what the operator asks for: a session
 * that always closes one step past entry has a distribution of closes no
 * natural market has. This reads that distribution off the session's own
 * actions and says what it rests on.
 */
export interface ClosesDiagnostic {
  /** Applied closes and presets that were armed. */
  readonly controlled: number;
  /** Signed lattice distance from where the market stood to the target, tallied. */
  readonly distances: Readonly<Record<string, number>>;
  /** Fraction of controlled closes exactly one step away, either side. */
  readonly oneStepFraction: number | null;
  /** How many closes a verdict here needs before it is one. */
  readonly minimumForVerdict: number;
  readonly verdict: 'too-few-to-say' | 'no-pattern' | 'one-sided';
  readonly note: string;
}

/** Below this many controlled closes, the distribution is anecdote. */
export const MINIMUM_CONTROLLED_CLOSES = 10;

/**
 * Deltas are taken from the action's diagnostics: `delta` is the lattice
 * distance from the engine's price when armed to the target (PH-24.2). Only
 * armed acts count — a refused close chose nothing.
 */
export function closesDiagnostic(actions: readonly LabAction[]): ClosesDiagnostic {
  const armed = actions.filter(
    (a) => (a.action === 'close.apply' || a.action === 'preset.apply') && a.succeeded,
  );
  const deltas = armed
    .map((a) => a.diagnostics['delta'])
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d));
  const distances: Record<string, number> = {};
  for (const d of deltas) {
    const key = Math.abs(d) > 3 ? (d > 0 ? '>+3' : '<-3') : String(d);
    distances[key] = (distances[key] ?? 0) + 1;
  }
  const oneStep = deltas.filter((d) => Math.abs(d) === 1).length;
  const oneStepFraction = deltas.length === 0 ? null : oneStep / deltas.length;
  if (deltas.length < MINIMUM_CONTROLLED_CLOSES) {
    return {
      controlled: deltas.length,
      distances,
      oneStepFraction,
      minimumForVerdict: MINIMUM_CONTROLLED_CLOSES,
      verdict: 'too-few-to-say',
      note:
        `${String(deltas.length)} controlled close(s) in this session; a distribution needs at least ` +
        `${String(MINIMUM_CONTROLLED_CLOSES)} before it says anything about the operator's habits.`,
    };
  }
  // A natural market's close is one step from the previous price only as often
  // as its step distribution puts it there — for these assets a few per cent.
  // Half or more of a session's closes sitting exactly one step away is a
  // hand, not a market.
  const oneSided = oneStepFraction !== null && oneStepFraction >= 0.5;
  return {
    controlled: deltas.length,
    distances,
    oneStepFraction,
    minimumForVerdict: MINIMUM_CONTROLLED_CLOSES,
    verdict: oneSided ? 'one-sided' : 'no-pattern',
    note: oneSided
      ? `${String(Math.round(oneStepFraction * 100))}% of ${String(deltas.length)} controlled closes ` +
        `sit exactly one lattice step from where the market stood. The paths carry no signature; ` +
        `the choices do. A viewer who saw only closes would notice.`
      : `${String(deltas.length)} controlled closes, ${String(Math.round((oneStepFraction ?? 0) * 100))}% ` +
        `one step away: no concentration a viewer of closes alone would pick out.`,
  };
}
