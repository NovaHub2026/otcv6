import { MasterKeyring } from '../entropy/keyring.js';
import { epochMillis } from '../time/instant.js';
import { logPrice } from './instrument.js';
import type { Tick } from './tick.js';

/**
 * Deterministic synthetic tick streams for exercising the fold.
 *
 * The price path here is a plain bounded walk: these fixtures test aggregation,
 * not the market model, which does not exist until PH-3.
 */
export interface StreamShape {
  readonly name: string;
  /** Mean gap between ticks, in milliseconds. */
  readonly meanGapMs: number;
  readonly ticks: number;
  /** Probability of a long idle gap after a tick, producing empty buckets. */
  readonly gapProbability: number;
  readonly gapMs: number;
}

const keyring = MasterKeyring.forTesting('market-domain-fixtures');

export function makeTicks(shape: StreamShape, priceOffset = 0): Tick[] {
  const stream = keyring.derive({
    env: 'test',
    asset: 'fold',
    purpose: shape.name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default',
    keyEpoch: 0,
  });
  const ticks: Tick[] = [];
  let instant = 1_776_000_000_000;
  let price = priceOffset;
  for (let i = 0; i < shape.ticks; i += 1) {
    // Always at least 1ms, so instants never move backwards.
    instant += 1 + Math.floor(stream.nextFloat64() * 2 * shape.meanGapMs);
    if (shape.gapProbability > 0 && stream.nextFloat64() < shape.gapProbability) {
      instant += shape.gapMs;
    }
    price += stream.nextBoundedUint32(21) - 10;
    ticks.push({ instant: epochMillis(instant), sequence: i + 1, price: logPrice(price) });
  }
  return ticks;
}
