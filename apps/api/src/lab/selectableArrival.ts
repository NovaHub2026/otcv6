import { exp, type RandomSource, type StreamCursor } from '@otc/core';

/**
 * An arrival source that plays chosen draws, in lockstep with the keystream
 * (PH-24.13) — `SelectableSigns` for the arrival stream.
 *
 * The engine's arrivals are a Hawkes process whose interval is
 * `-ln(1 - draw) · base / intensity` for a uniform `draw`. Armed, this returns
 * the scripted draws instead of the keystream's; the keystream still advances
 * with every call, so cursors are what they would have been, a snapshot records
 * nothing of the script, and a seek releases. Only `nextFloat64` is scripted:
 * it is the one call the arrival model makes.
 */
export class SelectableArrival implements RandomSource {
  #script: readonly (number | null)[] | null = null;
  #at = 0;

  constructor(
    private readonly inner: RandomSource,
    readonly assetId: string,
  ) {}

  get label(): string {
    return `${this.inner.label}#selectable-arrival`;
  }

  get armed(): boolean {
    return this.#script !== null;
  }

  get remaining(): number {
    return this.#script === null ? 0 : this.#script.length - this.#at;
  }

  remainingScript(): readonly (number | null)[] {
    return this.#script === null ? [] : this.#script.slice(this.#at);
  }

  /**
   * Play these draws for the next `draws.length` intervals. Replaces.
   *
   * A `null` entry passes the keystream's own draw through (PH-24.15's `normal`
   * pace): the script still has to be one entry per pushed tick, so that the
   * arrival script and the sign script stay aligned when paces mix.
   */
  arm(draws: readonly (number | null)[]): void {
    if (draws.length === 0) throw new RangeError('A script must contain at least one draw.');
    for (const draw of draws) {
      if (draw !== null && !(draw >= 0 && draw < 1))
        throw new RangeError(`A draw must lie in [0, 1), received ${String(draw)}.`);
    }
    this.#script = [...draws];
    this.#at = 0;
  }

  /** Play these draws after the ones still to be drawn; transparent, an arm. */
  extend(draws: readonly (number | null)[]): void {
    if (draws.length === 0) throw new RangeError('An extension must contain at least one draw.');
    if (this.#script === null) {
      this.arm(draws);
      return;
    }
    this.#script = [...this.#script.slice(this.#at), ...draws];
    this.#at = 0;
  }

  release(): number {
    const remaining = this.remaining;
    this.#script = null;
    this.#at = 0;
    return remaining;
  }

  nextFloat64(): number {
    const draw = this.inner.nextFloat64();
    if (this.#script === null) return draw;
    const scripted = this.#script[this.#at]!;
    this.#at += 1;
    if (this.#at >= this.#script.length) {
      this.#script = null;
      this.#at = 0;
    }
    return scripted === null ? draw : scripted;
  }

  nextBoolean(): boolean {
    return this.inner.nextBoolean();
  }

  nextUint32(): number {
    return this.inner.nextUint32();
  }

  nextUint64(): bigint {
    return this.inner.nextUint64();
  }

  nextBoundedUint32(bound: number): number {
    return this.inner.nextBoundedUint32(bound);
  }

  nextBytes(count: number): Uint8Array {
    return this.inner.nextBytes(count);
  }

  position(): StreamCursor {
    return this.inner.position();
  }

  /** A seek releases: the script was armed against one particular future. */
  seek(target: StreamCursor): void {
    this.release();
    this.inner.seek(target);
  }
}

/** The Lab's handle on every hosted engine's arrival source; the last wrapper for an id wins. */
export class ArrivalSelector {
  readonly #wrappers = new Map<string, SelectableArrival>();

  wrap(keystream: RandomSource, assetId: string): SelectableArrival {
    const wrapper = new SelectableArrival(keystream, assetId);
    this.#wrappers.set(assetId, wrapper);
    return wrapper;
  }

  for(assetId: string): SelectableArrival | null {
    return this.#wrappers.get(assetId) ?? null;
  }
}

/**
 * The burst (PH-24.13 §1): pushed ticks arrive one `BURST_DIVISOR`th of the
 * base tempo apart — `-ln(1 - draw) = 1 / BURST_DIVISOR` — and closer as the
 * burst excites the process. Twelve: ~200–350 ms on EUR/USD, magnitudes about
 * half a normal tick's under duration coupling.
 */
export const BURST_DIVISOR = 12;
// The portable exp (CA7-14): this constant decides what a replay must reproduce.
export const BURST_DRAW = 1 - exp(-1 / BURST_DIVISOR);

/**
 * The push's pace (PH-24.15): which arrival draws the pushed ticks play.
 * `normal` plays none — the keystream's own; `medio` one sixth of the base
 * tempo; `rapido` PH-24.13's one twelfth. The same fences for all three.
 */
export type Pace = 'normal' | 'medio' | 'rapido';
export const PACES: readonly Pace[] = ['normal', 'medio', 'rapido'];
export const PACE_DIVISORS: Readonly<Record<Pace, number | null>> = {
  normal: null,
  medio: 6,
  rapido: BURST_DIVISOR,
};
export function paceDraw(pace: Pace): number | null {
  const divisor = PACE_DIVISORS[pace];
  return divisor === null ? null : 1 - exp(-1 / divisor);
}
