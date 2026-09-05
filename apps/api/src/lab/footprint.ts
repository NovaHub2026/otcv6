import type { RandomSource, Tick } from '@otc/core';
import type { VenueService } from '../venue.service.js';
import { SelectableSigns } from './selectableSigns.js';

/**
 * PH-27.4 — the footprint of a Lab intervention, measured on the record it
 * wrote.
 *
 * _"¿Has realizado tests para definir el impacto que tiene el Lab en un activo
 * cuando lo ejecuta, mueve algo en concreto, se desconfigura?"_
 *
 * What was proven before this: what the Lab **cannot** touch — magnitudes and
 * intervals are bit-identical under every sign assignment
 * (`stepIndependence.test.ts`), and the keystream cursor advances as if nothing
 * were armed (`selectableSigns.test.ts`), so a release is a restart and the
 * personality, lattice and calibration are unreachable. What was never
 * measured is what an intervention did to the segment it controlled. This is
 * that measurement, and it can be taken because the cursor did not move: the
 * continuation the keystream **would** have produced is reconstructible from
 * the same snapshot, and the two paths are compared tick for tick.
 *
 * Three figures:
 *
 * - **Displacement** — the controlled price at release against the natural
 *   price at the same tick, in lattice steps, and in units of the median
 *   one-minute range when one is known.
 * - **Detectability** — how many increments over the whole horizon differ
 *   between the two paths, and what share of the record that is. An observer's
 *   instrument can see at most that much.
 * - **Decay** — the first tick after release from which the two paths'
 *   increments are identical for the rest of the horizon, counted from the
 *   release. For a sign-only substitution on a magnitude engine that cannot
 *   see signs this must be **zero**; a non-zero decay is the signature of a
 *   magnitude path that saw the sign (the leverage effect, ADR-0003), and
 *   `footprint.test.ts` plants exactly that to show the figure is not zero by
 *   construction.
 */
export interface Footprint {
  /** Ticks the intervention controlled. */
  readonly controlledTicks: number;
  /** Ticks compared after release. */
  readonly horizonTicks: number;
  readonly displacement: {
    /** Controlled level minus natural level at the last controlled tick. */
    readonly steps: number;
    /** The same, over the median 1m range in steps; null when no range is known. */
    readonly candles: number | null;
  };
  readonly detectability: {
    /** Increments that differ between the paths, over the whole comparison. */
    readonly divergentIncrements: number;
    readonly share: number;
    /** Whether every instant matched: an intervention that moved no tick in time. */
    readonly instantsIdentical: boolean;
  };
  readonly decay: {
    /**
     * Ticks after release before the increments become identical and stay so.
     * Zero means the first tick after release already continues the natural
     * path's increments. Null when they never do within the horizon.
     */
    readonly ticksUntilIdentical: number | null;
    /** Controlled level minus natural level at the end of the horizon. */
    readonly levelOffsetAfter: number;
  };
}

/** Compare a controlled path with the natural continuation from the same state. */
export function footprintOf(
  controlled: readonly Tick[],
  natural: readonly Tick[],
  controlledTicks: number,
  startPrice: number,
  medianRangeSteps: number | null,
): Footprint {
  if (!Number.isInteger(controlledTicks) || controlledTicks < 1) {
    throw new RangeError(
      `controlledTicks must be a positive integer, received ${String(controlledTicks)}.`,
    );
  }
  const length = Math.min(controlled.length, natural.length);
  if (length < controlledTicks) {
    throw new RangeError(
      `Both paths must reach the release: ${String(length)} ticks against ${String(controlledTicks)} controlled.`,
    );
  }
  const increment = (path: readonly Tick[], i: number): number =>
    path[i]!.price - (i === 0 ? startPrice : path[i - 1]!.price);

  let divergent = 0;
  let instantsIdentical = true;
  for (let i = 0; i < length; i += 1) {
    if (increment(controlled, i) !== increment(natural, i)) divergent += 1;
    if (controlled[i]!.instant !== natural[i]!.instant) instantsIdentical = false;
  }
  // From the end backwards: the last index whose increments differ, after release.
  let lastDivergent = -1;
  for (let i = length - 1; i >= controlledTicks; i -= 1) {
    if (increment(controlled, i) !== increment(natural, i)) {
      lastDivergent = i;
      break;
    }
  }
  const ticksUntilIdentical =
    lastDivergent === -1
      ? 0
      : lastDivergent + 1 - controlledTicks >= length - controlledTicks
        ? null
        : lastDivergent + 1 - controlledTicks;
  const atRelease = controlled[controlledTicks - 1]!.price - natural[controlledTicks - 1]!.price;
  return {
    controlledTicks,
    horizonTicks: length - controlledTicks,
    displacement: {
      steps: atRelease,
      candles:
        medianRangeSteps === null || medianRangeSteps <= 0 ? null : atRelease / medianRangeSteps,
    },
    detectability: {
      divergentIncrements: divergent,
      share: length === 0 ? 0 : divergent / length,
      instantsIdentical,
    },
    decay: {
      ticksUntilIdentical,
      levelOffsetAfter: controlled[length - 1]!.price - natural[length - 1]!.price,
    },
  };
}

/** An intervention as the Lab plays it: a script, or a sustained direction. */
export type Intervention =
  | { readonly kind: 'script'; readonly signs: readonly (1 | -1)[] }
  | {
      readonly kind: 'bias';
      readonly direction: 1 | -1;
      readonly ticks: number;
      readonly runs: { readonly min: number; readonly max: number };
      readonly random: RandomSource;
    };

/**
 * Two forks from the market's current snapshot — one with the intervention
 * armed on its sign stream, one bare — walked `controlled + horizon` ticks and
 * compared. The live market is untouched: forks are what the Lab already uses
 * to announce a landing.
 */
export function measureFootprint(
  venue: VenueService,
  assetId: string,
  intervention: Intervention,
  horizonTicks: number,
  medianRangeSteps: number | null,
): { footprint: Footprint; controlled: Tick[]; natural: Tick[]; startPrice: number } | null {
  const controlledTicks =
    intervention.kind === 'script' ? intervention.signs.length : intervention.ticks;
  let armed: SelectableSigns | null = null;
  const controlledFork = venue.labFork(assetId, (keystream) => {
    armed = new SelectableSigns(keystream, assetId);
    return armed;
  });
  const naturalFork = venue.labFork(assetId);
  if (controlledFork === null || naturalFork === null || armed === null) return null;
  const wrapper = armed as SelectableSigns;
  const total = controlledTicks + horizonTicks;
  const controlled: Tick[] = [];
  const natural: Tick[] = [];
  if (intervention.kind === 'script') {
    wrapper.arm(intervention.signs);
  } else {
    // A bias ends by its own clock: the fork's instants are that clock, and the
    // deadline is the instant of the last controlled tick — read from the
    // natural fork, whose instants the controlled one shares.
    for (let i = 0; i < total; i += 1) {
      const tick = naturalFork.next();
      if (tick === null) break;
      natural.push(tick);
    }
    if (natural.length < controlledTicks) return null;
    const deadline = natural[controlledTicks - 1]!.instant;
    let now = controlledFork.instant as number;
    wrapper.setBias(intervention.direction, intervention.random, intervention.runs, {
      at: deadline + 0.5,
      now: () => now,
    });
    for (let i = 0; i < total; i += 1) {
      const tick = controlledFork.next();
      if (tick === null) break;
      controlled.push(tick);
      now = tick.instant;
    }
    return {
      footprint: footprintOf(
        controlled,
        natural,
        controlledTicks,
        controlledFork.price,
        medianRangeSteps,
      ),
      controlled,
      natural,
      startPrice: controlledFork.price,
    };
  }
  for (let i = 0; i < total; i += 1) {
    const c = controlledFork.next();
    const n = naturalFork.next();
    if (c === null || n === null) break;
    controlled.push(c);
    natural.push(n);
  }
  if (controlled.length < controlledTicks) return null;
  return {
    footprint: footprintOf(
      controlled,
      natural,
      controlledTicks,
      controlledFork.price,
      medianRangeSteps,
    ),
    controlled,
    natural,
    startPrice: controlledFork.price,
  };
}
