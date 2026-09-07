import type { Tick } from '@otc/core';
import { medianCandleRange, recordWindow } from './distance.js';

/**
 * How large a push the market's own state will accept (PH-31).
 *
 * The operator asked for this in the plainest terms: "si está normal o bajo,
 * liberar todos los niveles; si está alto, liberar solo +1" — and then, asked
 * what counts as high, "creo que tenemos que tener una combinación". This is
 * that combination, and the reason it is one is worth stating.
 *
 * **The regime is a label, and a label can lag.** `VolatilityRegime` is the
 * modulator's current state: it changes on the engine's own schedule, so a
 * market can already be printing candles twice their usual size while the
 * label still reads `normal`, and it can read `elevated` for a stretch in
 * which nothing much happens. Gating on the label alone would let a `+10`
 * through in exactly the minute it should not, and refuse one in a calm
 * elevated stretch for no reason an operator can see on the screen.
 *
 * **The measurement is honest but blind to what comes next.** The median
 * 1-minute range of the last half hour is what the operator is looking at, and
 * it is what the distance unit is already cut from. It says what the market
 * *has been* doing. It cannot say that the modulator has just entered a
 * stressed stretch.
 *
 * So the ceiling is the **lower** of the two, and the answer says which one
 * bound it. Neither can quietly widen the other.
 */
export type PushCeilingCause = 'regime' | 'stretch' | 'both' | null;

export interface PushCeiling {
  /** The largest push, in units, this market will accept right now. */
  readonly max: number;
  /** What bound it, or null when nothing did. */
  readonly because: PushCeilingCause;
  /** The regime the ceiling was read from, when one was known. */
  readonly regime: string | null;
  /**
   * The recent median 1m candle against the market's own longer record,
   * rounded to two decimals. Null when there is not enough record to compare —
   * a market minutes old cannot be said to be stretched or calm.
   */
  readonly stretch: number | null;
}

/** The largest push the strip offers; nothing here can raise it. */
export const PUSH_CEILING_MAX = 10;

/**
 * The regime's own ceiling.
 *
 * `elevated` gets 3 rather than 1 because it is a regime a market spends real
 * time in — capping it at one unit would leave the strip almost always down to
 * its finest control, which is the same as not having the other buttons. What
 * `elevated` should stop is the *large* push, and 3 does that.
 */
const BY_REGIME: Readonly<Record<string, number>> = {
  compressed: PUSH_CEILING_MAX,
  normal: PUSH_CEILING_MAX,
  elevated: 3,
  stressed: 1,
};

/**
 * Where the measurement takes over from the label.
 *
 * The unit's own docstring records that the last half hour and the next half
 * hour disagree by more than 2x about one measurement in ten, across a regime
 * change. So a recent candle **half again** as large as this market's longer
 * record is already outside its own ordinary spread, and one **two and a half
 * times** as large is the shape of a stressed stretch whatever the label says.
 */
const STRETCH_TIGHT = 1.5;
const STRETCH_TIGHTEST = 2.5;

/** The measurement's own ceiling. */
function byStretch(stretch: number | null): number {
  if (stretch === null) return PUSH_CEILING_MAX;
  if (stretch > STRETCH_TIGHTEST) return 1;
  if (stretch > STRETCH_TIGHT) return 3;
  return PUSH_CEILING_MAX;
}

/**
 * The recent median 1m candle over the market's own longer one.
 *
 * Both medians come from the same tick array — the retained record — so this
 * compares a market with itself and never with a family average or a
 * calibration. Returns null unless both windows hold enough complete minutes
 * to have a median at all, and unless the long window is genuinely longer than
 * the recent one: a market with exactly half an hour of record would otherwise
 * compare that half hour against itself and always answer 1.
 */
export function candleStretch(all: readonly Tick[], at: number): number | null {
  const recent = medianCandleRange(recordWindow(all, at));
  const long = medianCandleRange(all);
  if (recent.minutes < 5 || long.minutes < recent.minutes * 2) return null;
  if (long.range <= 0) return null;
  return Math.round((recent.range / long.range) * 100) / 100;
}

/** The lower of what the label allows and what the market has been doing. */
export function pushCeiling(regime: string | null, stretch: number | null): PushCeiling {
  const fromRegime = regime === null ? PUSH_CEILING_MAX : (BY_REGIME[regime] ?? PUSH_CEILING_MAX);
  const fromStretch = byStretch(stretch);
  const max = Math.min(fromRegime, fromStretch);
  const because: PushCeilingCause =
    max === PUSH_CEILING_MAX
      ? null
      : fromRegime === fromStretch
        ? 'both'
        : fromRegime < fromStretch
          ? 'regime'
          : 'stretch';
  return { max, because, regime, stretch };
}
