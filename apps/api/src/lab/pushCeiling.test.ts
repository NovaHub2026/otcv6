// Invariant evidence: none — the Lab's own controls, which INV-001 keeps out of the price path.
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { candleStretch, pushCeiling, PUSH_CEILING_MAX, type PushCeiling } from './pushCeiling.js';

const BASE = 1_776_000_000_000;

/** One minute of ticks whose range is `range` lattice steps. */
function minute(index: number, range: number, from: number): Tick[] {
  const at = BASE + index * 60_000;
  return [
    { sequence: from, instant: epochMillis(at + 1_000), price: logPrice(0) },
    { sequence: from + 1, instant: epochMillis(at + 2_000), price: logPrice(range) },
  ];
}

/** `calm` minutes of range 20, then `loud` of `loudRange`, newest last. */
function record(calm: number, loud: number, loudRange: number): Tick[] {
  const ticks: Tick[] = [];
  let seq = 1;
  for (let i = 0; i < calm + loud; i += 1) {
    ticks.push(...minute(i, i < calm ? 20 : loudRange, seq));
    seq += 2;
  }
  return ticks;
}

describe('how large a push the market itself will take (PH-31)', () => {
  it('lets everything through when the label is calm and the candle is its usual size', () => {
    for (const regime of ['compressed', 'normal']) {
      const ceiling = pushCeiling(regime, 1);
      expect(ceiling.max, regime).toBe(PUSH_CEILING_MAX);
      expect(ceiling.because, regime).toBeNull();
    }
    // An unknown label — a snapshot that carries no regime — does not bind.
    expect(pushCeiling(null, null).max).toBe(PUSH_CEILING_MAX);
  });

  it('takes the lower of the label and the measurement, and says which bound it', () => {
    // The label alone.
    expect(pushCeiling('elevated', 1)).toMatchObject({ max: 3, because: 'regime' });
    expect(pushCeiling('stressed', 1)).toMatchObject({ max: 1, because: 'regime' });
    // The measurement alone: the label still reads normal, which is exactly the
    // lag this combination exists for.
    expect(pushCeiling('normal', 1.8)).toMatchObject({ max: 3, because: 'stretch' });
    expect(pushCeiling('normal', 3)).toMatchObject({ max: 1, because: 'stretch' });
    // Both, and the lower wins: an elevated label cannot widen a stretched
    // measurement, and a calm measurement cannot widen a stressed label.
    expect(pushCeiling('stressed', 1.8)).toMatchObject({ max: 1, because: 'regime' });
    expect(pushCeiling('elevated', 3)).toMatchObject({ max: 1, because: 'stretch' });
    expect(pushCeiling('elevated', 1.8)).toMatchObject({ max: 3, because: 'both' });
  });

  it('carries what it was decided from, so the panel can say why', () => {
    const ceiling: PushCeiling = pushCeiling('elevated', 2.2);
    expect(ceiling.regime).toBe('elevated');
    expect(ceiling.stretch).toBe(2.2);
  });

  it('measures the recent candle against the market’s own longer record', () => {
    // Two hours calm, then half an hour four times as large.
    const stretched = record(90, 30, 80);
    const at = BASE + 121 * 60_000;
    const stretch = candleStretch(stretched, at);
    expect(stretch).not.toBeNull();
    expect(stretch!).toBeGreaterThan(2.5);
    expect(pushCeiling('normal', stretch).max).toBe(1);

    // The same market, all of it calm: nothing is stretched.
    const calm = record(120, 0, 0);
    expect(candleStretch(calm, at)).toBe(1);
    expect(pushCeiling('normal', candleStretch(calm, at)).max).toBe(PUSH_CEILING_MAX);
  });

  it('refuses to compare a market with too little record, rather than answering 1', () => {
    // A market whose whole record is the half hour being measured would compare
    // that half hour with itself and always read «calm», which is the one
    // answer it has no evidence for.
    const short = record(20, 10, 200);
    expect(candleStretch(short, BASE + 31 * 60_000)).toBeNull();
    expect(candleStretch([], BASE)).toBeNull();
    // And with no measurement, only the label binds.
    expect(pushCeiling('stressed', null).max).toBe(1);
    expect(pushCeiling('normal', null).max).toBe(PUSH_CEILING_MAX);
  });
});
