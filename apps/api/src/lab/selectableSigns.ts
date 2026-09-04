import type { RandomSource, StreamCursor } from '@otc/core';

/**
 * A sign source that plays a chosen vector, in lockstep with the keystream.
 *
 * PH-24.1. Every Lab control that "applies" something — an exact close, a
 * scenario, a preset — comes down to one act: the engine's next N coin tosses
 * are a vector the Lab chose among the engine's own futures (PH-23.1). This
 * class is that act, and it is the **only** new thing in PH-24 that touches a
 * price stream.
 *
 * ## Lockstep
 *
 * Armed or not, every `nextBoolean()` draws the inner keystream. Armed, the
 * scripted sign is returned instead of the draw. So the keystream cursor
 * advances exactly as it would have, a snapshot taken mid-script records the
 * keystream's position and nothing about the script, and a market restored from
 * it continues on the keystream. **A restart is a release, by construction.**
 * This is `ScriptedSigns` from `stepIndependence.test.ts`, which is also the
 * proof that the steps do not care.
 *
 * ## Where it may exist
 *
 * Under `apps/api/src/lab/`, which `labSurface.test.ts` forbids the production
 * composition from reaching, and handed to `resumeMarket` only by
 * `LabModule` through `AppModule.register({signSource})` — `main.ts` registers
 * nothing, and `composition.test.ts` asserts it (ADR-0015 §3).
 */
/** The sustained direction (PH-24.16): runs for it, shorter runs against it. */
export const BIAS_RUN_MIN = 2;
export const BIAS_RUN_MAX = 6;

export class SelectableSigns implements RandomSource {
  #script: readonly (1 | -1)[] | null = null;
  #at = 0;
  #bias: 1 | -1 | null = null;
  #biasRandom: RandomSource | null = null;
  /** The run being played under the bias: its sign and how many ticks remain. */
  #runSign: 1 | -1 = 1;
  #runLeft = 0;
  #lastForLength = 0;
  #runMin = BIAS_RUN_MIN;
  #runMax = BIAS_RUN_MAX;

  constructor(
    private readonly inner: RandomSource,
    readonly assetId: string,
  ) {}

  get label(): string {
    return `${this.inner.label}#selectable`;
  }

  /** Whether a script is being played. */
  get armed(): boolean {
    return this.#script !== null;
  }

  /** Scripted signs not yet drawn. Zero when transparent. */
  get remaining(): number {
    return this.#script === null ? 0 : this.#script.length - this.#at;
  }

  /** The scripted signs not yet drawn, so a replay can play what this market will (PH-24.10). */
  remainingScript(): readonly (1 | -1)[] {
    return this.#script === null ? [] : this.#script.slice(this.#at);
  }

  /**
   * Play these signs for the next `signs.length` draws.
   *
   * Replaces any script in progress: the Lab asked for something new, and two
   * scripts cannot both describe the next tick.
   */
  arm(signs: readonly (1 | -1)[]): void {
    if (signs.length === 0) {
      throw new RangeError('A script must contain at least one sign; use release() to clear.');
    }
    this.#script = [...signs];
    this.#at = 0;
  }

  /**
   * Play these signs after the ones still to be drawn (PH-24.10).
   *
   * A second push in the same direction while one runs: the operator kept
   * pressing, and the market keeps going. Nothing already drawn is touched;
   * transparent, this is `arm`.
   */
  extend(signs: readonly (1 | -1)[]): void {
    if (signs.length === 0) throw new RangeError('An extension must contain at least one sign.');
    if (this.#script === null) {
      this.arm(signs);
      return;
    }
    this.#script = [...this.#script.slice(this.#at), ...signs];
    this.#at = 0;
  }

  /** The sustained direction, or null when the keystream decides. */
  get bias(): 1 | -1 | null {
    return this.#bias;
  }

  /** The run lengths a bias plays, in ticks. */
  get biasRuns(): { readonly min: number; readonly max: number } {
    return { min: this.#runMin, max: this.#runMax };
  }

  /**
   * Prioritise a direction until told otherwise (PH-24.16).
   *
   * Runs, not a coin with a thumb on it: a run for the direction of 2–6 ticks,
   * then a run against it strictly shorter than the run before, and so on —
   * down 3, up 2, down 5, up 3. The lengths come from a Lab-only random stream;
   * the keystream keeps advancing in lockstep as always. A script armed on top
   * plays first; the bias resumes after it.
   */
  setBias(
    direction: 1 | -1,
    random: RandomSource,
    runs: { readonly min: number; readonly max: number } = { min: BIAS_RUN_MIN, max: BIAS_RUN_MAX },
  ): void {
    if (!(runs.min >= 2) || !(runs.max >= runs.min)) {
      throw new RangeError(
        `Bias runs must satisfy 2 <= min <= max, received ${String(runs.min)}..${String(runs.max)}.`,
      );
    }
    this.#bias = direction;
    this.#biasRandom = random;
    this.#runMin = runs.min;
    this.#runMax = runs.max;
    this.#runLeft = 0;
    this.#lastForLength = 0;
  }

  clearBias(): void {
    this.#bias = null;
    this.#biasRandom = null;
    this.#runLeft = 0;
    this.#lastForLength = 0;
  }

  /** Back to the keystream, script and bias alike. Returns how many scripted signs were never drawn. */
  release(): number {
    const remaining = this.remaining;
    this.#script = null;
    this.#at = 0;
    this.clearBias();
    return remaining;
  }

  #biasedSign(): 1 | -1 {
    const random = this.#biasRandom!;
    const bias = this.#bias!;
    if (this.#runLeft === 0) {
      if (this.#lastForLength === 0 || this.#runSign !== bias) {
        // A run for the direction.
        this.#runSign = bias;
        this.#runLeft = this.#runMin + random.nextBoundedUint32(this.#runMax - this.#runMin + 1);
        this.#lastForLength = this.#runLeft;
      } else {
        // A run against it, strictly shorter than the run before.
        this.#runSign = bias === 1 ? -1 : 1;
        this.#runLeft = 1 + random.nextBoundedUint32(Math.max(1, this.#lastForLength - 1));
      }
    }
    this.#runLeft -= 1;
    return this.#runSign;
  }

  nextBoolean(): boolean {
    // Always: the keystream advances whether or not its draw is used.
    const draw = this.inner.nextBoolean();
    if (this.#script === null) return this.#bias === null ? draw : this.#biasedSign() === 1;
    const sign = this.#script[this.#at]!;
    this.#at += 1;
    if (this.#at >= this.#script.length) {
      this.#script = null;
      this.#at = 0;
    }
    return sign === 1;
  }

  nextUint32(): number {
    return this.inner.nextUint32();
  }

  nextUint64(): bigint {
    return this.inner.nextUint64();
  }

  nextFloat64(): number {
    return this.inner.nextFloat64();
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

  /**
   * A seek releases. A script was armed against one particular future — the
   * next N draws from where the cursor stood — and a cursor that moves is no
   * longer there. Restores go through here, which is the "restart is a
   * release" rule made mechanical.
   */
  seek(target: StreamCursor): void {
    this.release();
    this.inner.seek(target);
  }
}

/**
 * The Lab's handle on every hosted engine's sign source.
 *
 * `resumeMarket` calls the factory once per hosted engine; the selector keeps
 * the wrapper by asset id so a route can later arm it. The **last** wrapper for
 * an id wins, and that is the right rule: a seam after a failed restore, or a
 * retire followed by a host, constructs a new hosted engine, and the old
 * wrapper belongs to an engine nothing advances any more.
 */
export class SignSelector {
  readonly #wrappers = new Map<string, SelectableSigns>();

  /** The factory `LabModule` hands to `AppModule.register`. */
  wrap(keystream: RandomSource, assetId: string): SelectableSigns {
    const wrapper = new SelectableSigns(keystream, assetId);
    this.#wrappers.set(assetId, wrapper);
    return wrapper;
  }

  for(assetId: string): SelectableSigns | null {
    return this.#wrappers.get(assetId) ?? null;
  }

  get assetIds(): readonly string[] {
    return [...this.#wrappers.keys()].sort();
  }
}

/**
 * A sign source that remembers what it drew (PH-24.23).
 *
 * On a fork playing sube / baja towards a point, the signs the fork draws are
 * the script the live market will play: recorded here, armed there, and the
 * live path is the fork's path — the engine's magnitudes and intervals, the
 * Lab's signs, exactly as a push.
 */
export class RecordingSigns extends SelectableSigns {
  readonly drawn: (1 | -1)[] = [];

  override nextBoolean(): boolean {
    const up = super.nextBoolean();
    this.drawn.push(up ? 1 : -1);
    return up;
  }
}
