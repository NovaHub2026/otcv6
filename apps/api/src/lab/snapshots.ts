import type { EngineSnapshot } from '@otc/engine';

/**
 * The snapshots the Lab keeps of each hosted market (PH-24.10 §2).
 *
 * One on every arm and release — the moments a replay would want to start
 * from — and one a minute otherwise, bounded per market. The engine snapshot is
 * kept as the Lab already reads it, cursors included: this is the Lab, INV-010's
 * one permitted place. Beside it, **the script armed at that moment**: a replay
 * that drew the keystream where the market drew a script would diverge on the
 * first scripted tick and prove nothing; with the script it reproduces what was
 * published, which is what §74–§75 ask to see.
 */
export type KeepReason = 'arm' | 'release' | 'time';

export interface KeptSnapshot {
  readonly sequence: number;
  readonly instant: number;
  readonly keptAt: number;
  readonly why: KeepReason;
  readonly snapshot: EngineSnapshot;
  /** Signs still to be drawn from the script armed at that moment; empty when none. */
  readonly script: readonly (1 | -1)[];
}

export const KEPT_PER_MARKET = 30;
export const KEEP_EVERY_MS = 60_000;

export class KeptSnapshots {
  readonly #byAsset = new Map<string, KeptSnapshot[]>();
  readonly #lastByTime = new Map<string, number>();

  keep(
    assetId: string,
    snapshot: EngineSnapshot,
    script: readonly (1 | -1)[],
    why: KeepReason,
    now: number,
  ): KeptSnapshot {
    const kept: KeptSnapshot = {
      sequence: snapshot.sequence,
      instant: snapshot.instant,
      keptAt: now,
      why,
      snapshot,
      script: [...script],
    };
    const list = this.#byAsset.get(assetId) ?? [];
    // One per sequence: an arm and a release at the same sequence replace.
    const filtered = list.filter((k) => k.sequence !== kept.sequence);
    filtered.push(kept);
    while (filtered.length > KEPT_PER_MARKET) filtered.shift();
    this.#byAsset.set(assetId, filtered);
    if (why === 'time') this.#lastByTime.set(assetId, now);
    return kept;
  }

  /** Keep by time, once a minute per market; returns what was kept, if anything. */
  maybeKeepByTime(
    assetId: string,
    snapshot: EngineSnapshot,
    script: readonly (1 | -1)[],
    now: number,
  ): KeptSnapshot | null {
    const last = this.#lastByTime.get(assetId);
    if (last !== undefined && now - last < KEEP_EVERY_MS) return null;
    return this.keep(assetId, snapshot, script, 'time', now);
  }

  list(assetId: string): readonly KeptSnapshot[] {
    return [...(this.#byAsset.get(assetId) ?? [])];
  }

  at(assetId: string, sequence: number): KeptSnapshot | null {
    return this.#byAsset.get(assetId)?.find((k) => k.sequence === sequence) ?? null;
  }
}
