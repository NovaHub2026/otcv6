import type { Continuation } from '@otc/engine';
import { INTERVENTIONS } from '@otc/engine';

/**
 * The specification's sixteen scenarios (P1–P16), as what each one is here.
 *
 * A **selectable** scenario is a criterion over the engine's own continuations
 * of the next window (PH-23.4, PH-24.4 §2): every candidate is the engine's,
 * the Lab keeps one. Two are **not selectable** and say why: extreme
 * volatility and low activity are magnitude and arrival events, which the
 * signs cannot change (the LA-01 argument). A button that offered them would
 * report an acceptance rate of one for something nobody chose.
 *
 * Parameters are in lattice steps, the operator's unit here, except `depth`
 * (a fraction) and `changes` (a count).
 */
export interface ScenarioParameter {
  readonly name: string;
  readonly label: string;
  readonly default: number;
}

export interface Scenario {
  readonly name: string;
  readonly label: string;
  readonly selectable: boolean;
  /** When not selectable: the reason, in a sentence an operator can act on. */
  readonly why?: string;
  readonly parameters: readonly ScenarioParameter[];
  readonly criterion?: (params: Readonly<Record<string, number>>) => (c: Continuation) => boolean;
}

const steps = (name: string, label: string, fallback: number): ScenarioParameter => ({
  name,
  label,
  default: fallback,
});

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'bullish-trend',
    label: 'P1 Bullish trend',
    selectable: true,
    parameters: [steps('net', 'net displacement ≥ (steps)', 20)],
    criterion: (p) => INTERVENTIONS.bullishPressure(p['net']!),
  },
  {
    name: 'bearish-trend',
    label: 'P2 Bearish trend',
    selectable: true,
    parameters: [steps('net', 'net displacement ≥ (steps)', 20)],
    criterion: (p) => INTERVENTIONS.bearishPressure(p['net']!),
  },
  {
    name: 'sideways',
    label: 'P3 Sideways',
    selectable: true,
    parameters: [steps('range', 'realised range ≤ (steps)', 30)],
    criterion: (p) => INTERVENTIONS.sideways(p['range']!),
  },
  {
    name: 'bull-pullback',
    label: 'P4 Bull trend → pullback',
    selectable: true,
    parameters: [
      steps('rise', 'rise ≥ (steps)', 20),
      steps('depth', 'pullback depth (fraction of the rise)', 0.3),
    ],
    criterion: (p) => INTERVENTIONS.trendThenPullback(p['rise']!, p['depth']!),
  },
  {
    name: 'bear-pullback',
    label: 'P5 Bear trend → pullback',
    selectable: true,
    parameters: [
      steps('fall', 'fall ≥ (steps)', 20),
      steps('depth', 'pullback depth (fraction of the fall)', 0.3),
    ],
    criterion: (p) => INTERVENTIONS.bearTrendThenPullback(p['fall']!, p['depth']!),
  },
  {
    name: 'bullish-breakout',
    label: 'P6 Bullish breakout',
    selectable: true,
    parameters: [
      steps('level', 'level above here (steps)', 20),
      steps('hold', 'may give back at most (steps)', 10),
    ],
    criterion: (p) => INTERVENTIONS.breakout(Math.abs(p['level']!), p['hold']!),
  },
  {
    name: 'bearish-breakout',
    label: 'P7 Bearish breakout',
    selectable: true,
    parameters: [
      steps('level', 'level below here (steps)', 20),
      steps('hold', 'may give back at most (steps)', 10),
    ],
    criterion: (p) => INTERVENTIONS.breakout(-Math.abs(p['level']!), p['hold']!),
  },
  {
    name: 'bullish-false-breakout',
    label: 'P8 Bullish false breakout',
    selectable: true,
    parameters: [steps('level', 'level above here (steps)', 20)],
    criterion: (p) => INTERVENTIONS.falseBreakout(Math.abs(p['level']!)),
  },
  {
    name: 'bearish-false-breakout',
    label: 'P9 Bearish false breakout',
    selectable: true,
    parameters: [steps('level', 'level below here (steps)', 20)],
    criterion: (p) => INTERVENTIONS.falseBreakout(-Math.abs(p['level']!)),
  },
  {
    name: 'bull-bear-reversal',
    label: 'P10 Bull → bear reversal',
    selectable: true,
    parameters: [steps('rise', 'rise ≥ (steps)', 15), steps('fall', 'then net fall ≥ (steps)', 15)],
    criterion: (p) => INTERVENTIONS.reversal(Math.abs(p['rise']!), p['fall']!),
  },
  {
    name: 'bear-bull-reversal',
    label: 'P11 Bear → bull reversal',
    selectable: true,
    parameters: [steps('fall', 'fall ≥ (steps)', 15), steps('rise', 'then net rise ≥ (steps)', 15)],
    criterion: (p) => INTERVENTIONS.reversal(-Math.abs(p['fall']!), p['rise']!),
  },
  {
    // §G. Target Price: reach a level, above (positive) or below (negative),
    // with no terminal condition — the distinction G8 insists on and the audit
    // found correctly kept. Its strength is the acceptance rate, never a mode.
    name: 'target-price',
    label: 'G Target Price',
    selectable: true,
    parameters: [steps('level', 'level to touch (steps from here, ± for above/below)', 15)],
    criterion: (p) => INTERVENTIONS.touches(p['level']!),
  },
  {
    name: 'volatility-expansion',
    label: 'P12 Volatility expansion',
    selectable: true,
    parameters: [steps('range', 'realised range ≥ (steps)', 60)],
    criterion: (p) => INTERVENTIONS.expandedVolatility(p['range']!),
  },
  {
    name: 'volatility-compression',
    label: 'P13 Volatility compression',
    selectable: true,
    parameters: [steps('range', 'realised range ≤ (steps)', 20)],
    criterion: (p) => INTERVENTIONS.compressedVolatility(p['range']!),
  },
  {
    name: 'high-noise',
    label: 'P14 High noise',
    selectable: true,
    parameters: [steps('changes', 'direction changes ≥ (count)', 15)],
    criterion: (p) => INTERVENTIONS.noise(p['changes']!),
  },
  {
    name: 'extreme-volatility',
    label: 'P15 Extreme volatility',
    selectable: false,
    why:
      'Extreme volatility is large steps, and the size of a step does not depend on the signs ' +
      '(ADR-0003). No criterion over sign vectors can select for it; the Lab reports the regime ' +
      'and the cascade on the state panel and can tell you whether a large step is coming (shock).',
    parameters: [],
  },
  {
    name: 'low-activity',
    label: 'P16 Low activity',
    selectable: false,
    why:
      'Activity is the arrival process — how long between ticks — and intervals do not depend on ' +
      'the signs. No criterion over sign vectors can select for it; the Lab reports arrival ' +
      'excitation on the state panel.',
    parameters: [],
  },
];

export function scenarioNamed(name: string): Scenario | null {
  return SCENARIOS.find((s) => s.name === name) ?? null;
}

/** Parameters from a query, defaults filled, numbers only. */
export function scenarioParameters(
  scenario: Scenario,
  query: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const parameter of scenario.parameters) {
    const raw = query[parameter.name];
    const value = raw === undefined || raw.trim().length === 0 ? parameter.default : Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `${parameter.name} must be a non-negative number, received ${String(raw)}.`,
      );
    }
    out[parameter.name] = value;
  }
  return out;
}

/** What a continuation looks like, for a preview: the numbers a criterion is about. */
export function shapeOf(c: Continuation): {
  net: number;
  high: number;
  low: number;
  range: number;
  directionChanges: number;
  ticks: number;
} {
  let changes = 0;
  for (let i = 1; i < c.signs.length; i += 1) if (c.signs[i] !== c.signs[i - 1]) changes += 1;
  return {
    net: c.net,
    high: c.high,
    low: c.low,
    range: c.high - c.low,
    directionChanges: changes,
    ticks: c.signs.length,
  };
}
