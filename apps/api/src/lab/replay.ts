import type { RandomSource, StreamCursor, Tick } from '@otc/core';
import { epochMillis, logPrice } from '@otc/core';
import {
  configFor,
  createMarketEngine,
  type EngineSnapshot,
  type MarketEngine,
  type RegisteredAsset,
} from '@otc/engine';
import type { MasterKeyring } from '@otc/core';
import { SelectableSigns } from './selectableSigns.js';

/**
 * Replay and the mirror (PH-24.10 §2), on forks — the market is never rewound.
 */

/** A fork of a hosted market from a snapshot, the sign stream optionally wrapped. */
export function forkFrom(
  asset: RegisteredAsset,
  keyring: MasterKeyring,
  snapshot: EngineSnapshot,
  wrap?: (keystream: RandomSource) => RandomSource,
): MarketEngine {
  const config = configFor(asset);
  const keystream = keyring.derive({
    env: 'production',
    asset: config.instrument.id,
    purpose: 'sign',
    keyEpoch: 0,
  });
  const fork = createMarketEngine({
    config,
    keyring,
    environment: 'production',
    start: { instant: epochMillis(snapshot.instant), price: logPrice(snapshot.price) },
    ...(wrap === undefined ? {} : { streams: { sign: wrap(keystream) } }),
  });
  fork.restore(snapshot);
  return fork;
}

export interface ReplayVerdict {
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly replayed: number;
  readonly identical: boolean;
  readonly firstDivergence: { sequence: number; replayed: Tick; published: Tick } | null;
  readonly scriptPlayed: number;
}

/**
 * Replay from a kept snapshot to the record's end and compare tick by tick.
 *
 * The snapshot was taken after its last tick was drawn, so the fork's first
 * tick is `sequence + 1`; the record is compared from there. The script armed
 * at the snapshot is played first, then the keystream — exactly what the market
 * did. A divergence is reported, with both ticks, never smoothed over: it would
 * be a finding about the engine (INV-009).
 */
export function replayAgainst(
  asset: RegisteredAsset,
  keyring: MasterKeyring,
  snapshot: EngineSnapshot,
  script: readonly (1 | -1)[],
  published: readonly Tick[],
): ReplayVerdict {
  const fork = forkFrom(asset, keyring, snapshot, (keystream) => {
    const signs = new SelectableSigns(keystream, asset.definition.id);
    if (script.length > 0) signs.arm(script);
    return signs;
  });
  const record = published.filter((t) => t.sequence > snapshot.sequence);
  let replayed = 0;
  for (const expected of record) {
    const tick = fork.next();
    if (tick === null) break;
    replayed += 1;
    if (
      tick.sequence !== expected.sequence ||
      tick.instant !== expected.instant ||
      tick.price !== expected.price
    ) {
      return {
        fromSequence: snapshot.sequence,
        toSequence: record[record.length - 1]?.sequence ?? snapshot.sequence,
        replayed,
        identical: false,
        firstDivergence: { sequence: expected.sequence, replayed: tick, published: expected },
        scriptPlayed: script.length,
      };
    }
  }
  return {
    fromSequence: snapshot.sequence,
    toSequence: record[record.length - 1]?.sequence ?? snapshot.sequence,
    replayed,
    identical: true,
    firstDivergence: null,
    scriptPlayed: script.length,
  };
}

/** Every keystream draw, negated — the mirror of ADR-0003's theorem. */
class MirrorSigns implements RandomSource {
  constructor(private readonly inner: RandomSource) {}
  get label(): string {
    return `${this.inner.label}#mirror`;
  }
  nextBoolean(): boolean {
    return !this.inner.nextBoolean();
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
  seek(target: StreamCursor): void {
    this.inner.seek(target);
  }
}

export interface PathSummary {
  readonly ticks: number;
  readonly net: number;
  readonly high: number;
  readonly low: number;
  readonly steps: readonly number[];
  readonly intervalsMs: readonly number[];
}

export interface MirrorVerdict {
  readonly plain: PathSummary;
  readonly mirror: PathSummary;
  /** Equal magnitudes, equal intervals, displacements exactly opposite. */
  readonly onlySignsDiffer: boolean;
}

/**
 * Two forks from one state: the keystream's signs and every sign flipped.
 *
 * ADR-0003 says the magnitude engine cannot see a sign, so the two paths must
 * have identical steps and identical intervals and opposite displacements —
 * the mirror test the gate runs, shown on the shipped engine, on this market,
 * now.
 */
export function mirrorFrom(
  asset: RegisteredAsset,
  keyring: MasterKeyring,
  snapshot: EngineSnapshot,
  ticks: number,
): MirrorVerdict {
  const walk = (fork: MarketEngine): PathSummary => {
    const steps: number[] = [];
    const intervals: number[] = [];
    let price = snapshot.price;
    let instant = snapshot.instant;
    let net = 0;
    let high = 0;
    let low = 0;
    for (let i = 0; i < ticks; i += 1) {
      const tick = fork.next();
      if (tick === null) break;
      steps.push(tick.price - price);
      intervals.push(tick.instant - instant);
      net += tick.price - price;
      if (net > high) high = net;
      if (net < low) low = net;
      price = tick.price;
      instant = tick.instant;
    }
    return { ticks: steps.length, net, high, low, steps, intervalsMs: intervals };
  };
  const plain = walk(forkFrom(asset, keyring, snapshot));
  const mirror = walk(forkFrom(asset, keyring, snapshot, (k) => new MirrorSigns(k)));
  const onlySignsDiffer =
    plain.ticks === mirror.ticks &&
    plain.steps.every((step, i) => step === -mirror.steps[i]!) &&
    plain.intervalsMs.every((ms, i) => ms === mirror.intervalsMs[i]);
  return { plain, mirror, onlySignsDiffer };
}
