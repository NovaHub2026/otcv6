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
export class SelectableSigns implements RandomSource {
  #script: readonly (1 | -1)[] | null = null;
  #at = 0;

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

  /** Back to the keystream. Returns how many scripted signs were never drawn. */
  release(): number {
    const remaining = this.remaining;
    this.#script = null;
    this.#at = 0;
    return remaining;
  }

  nextBoolean(): boolean {
    // Always: the keystream advances whether or not its draw is used.
    const draw = this.inner.nextBoolean();
    if (this.#script === null) return draw;
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
