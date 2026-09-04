import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring } from '@otc/core';
import { ASSET_CATALOGUE, registrationKeyLabel } from './catalogue.js';
import { configFor } from './catalogue.js';
import { createMarketEngine } from './factory.js';
import { authorPersonality } from './personality.js';

/**
 * PH-24.17 §2, continuity: a hosted market whose state record was written
 * under one tempo restores into the same asset re-authored at another tempo,
 * and continues — same price, same sequence, cursors accepted — because the
 * cascade's structure (depth, span, spacing) is untouched and only the tempo,
 * the tick RMS and the solved clustering change. A recalibration therefore
 * reaches a running market on its next restart without a seam.
 *
 * **Cycle Audit 8, a5.** The claim that the continuation is the *new*
 * personality's was asserted as "the mean interval over 400 ticks is under
 * twice the new tempo", and it is not a discriminator: those 400 ticks sit in
 * the excited Hawkes phase that follows a 500-tick warm-up, where the previous
 * personality's mean interval clears the same bound on every asset in the
 * catalogue (measured). A restore into the *old* configuration passed. What
 * separates the two is running both from the identical snapshot: same cursors,
 * same latent state, same draws, so the only thing left that can move the
 * interval is the configuration — and it moves it by the factor the tempo did.
 */
const START = { instant: epochMillis(1_776_000_000_000), price: logPrice(0) };

/**
 * The transition each asset actually made, from PH-24.17 §2.
 *
 * The tempo went down by the factor and the tick RMS by its square root, so the
 * variance per millisecond is unchanged — a finer grain of the same market.
 * ÷3 rather than ÷4 for GBP/JPY (aggregational gaussianity out of band at ÷4)
 * and BTC/USD (÷4 crosses the 250 ms trait floor). The previous tempo is the
 * PH-4 value `catalogue.test.ts` pins from the other side, so reconstructing it
 * here from the factor and getting that number back is itself a check that this
 * record and the catalogue's are the same record.
 */
const GRAIN: Record<string, { readonly factor: number; readonly previousTempoMs: number }> = {
  eurusd: { factor: 4, previousTempoMs: 3_000 },
  gbpjpy: { factor: 3, previousTempoMs: 1_850 },
  btcusd: { factor: 3, previousTempoMs: 1_100 },
  spx: { factor: 4, previousTempoMs: 5_450 },
  xauusd: { factor: 4, previousTempoMs: 4_300 },
};

describe("a recalibrated personality restores the previous one's snapshot", () => {
  it.each(ASSET_CATALOGUE.map((a) => [a.definition.id, a] as const))('%s', (id, asset) => {
    // PH-26.1: an asset with no row here used to throw `Cannot destructure` two
    // lines after the id was last visible. It refuses by name now.
    const grain = GRAIN[id];
    if (grain === undefined) {
      throw new Error(
        `GRAIN has no record for ${id}: the recalibration record covers only the assets it names.`,
      );
    }
    const { factor, previousTempoMs } = grain;
    const registration = MasterKeyring.forTesting(registrationKeyLabel(id));
    const derive = (purpose: string) =>
      registration.derive({ env: 'simulation', asset: id, purpose, keyEpoch: 0 });
    // The previous personality: the same asset at `factor` times the tempo and
    // the square root of that times the tick RMS — what the catalogue held
    // before PH-24.17, reconstructed by the same solve rather than copied as
    // numbers.
    const previous = authorPersonality(
      { ...asset.definition.traits, tempoMs: asset.definition.traits.tempoMs * factor },
      {
        excessKurtosis: asset.authored.excessKurtosis,
        tickRms: asset.authored.tickRms * Math.sqrt(factor),
      },
      derive,
    );
    expect(previous.traits.tempoMs, `${id} previous tempo`).toBeCloseTo(previousTempoMs, 6);
    const keyring = MasterKeyring.forTesting(`recalibration-${id}`);
    const before = createMarketEngine({
      config: configFor({ ...asset, definition: { ...asset.definition, traits: previous.traits } }),
      keyring,
      environment: 'simulation',
      start: START,
    });
    let last = null;
    for (let i = 0; i < 500; i += 1) last = before.next();
    expect(last).not.toBeNull();
    const snapshot = before.snapshot();

    const after = createMarketEngine({
      config: configFor(asset),
      keyring,
      environment: 'simulation',
      start: START,
    });
    expect(() => after.restore(snapshot)).not.toThrow();
    const continued = after.next();
    expect(continued).not.toBeNull();
    expect(continued!.sequence).toBe(snapshot.sequence + 1);
    expect(continued!.instant).toBeGreaterThan(snapshot.instant);

    // The same snapshot continued twice: once by the personality that wrote it,
    // once by the recalibrated one. `before` stands exactly where the snapshot
    // was taken, so this is the A and the B of the same market.
    const asPrevious = before.next()!;
    const previousInterval = asPrevious.instant - snapshot.instant;
    const interval = continued!.instant - snapshot.instant;
    // Both draw the same uniform against the same excitation, and the Hawkes
    // mean is `tempo / multiplier`, so the ratio is the tempo ratio up to the
    // millisecond floor. A snapshot restored into the old configuration puts it
    // at 1.
    expect(previousInterval / interval, `${id} first interval ratio`).toBeGreaterThan(
      factor * 0.85,
    );
    expect(previousInterval / interval, `${id} first interval ratio`).toBeLessThan(factor * 1.15);

    const ticks = [continued!];
    const previousTicks = [asPrevious];
    for (let i = 0; i < 400; i += 1) {
      ticks.push(after.next()!);
      previousTicks.push(before.next()!);
    }
    const meanInterval = (of: typeof ticks) =>
      (of[of.length - 1]!.instant - of[0]!.instant) / (of.length - 1);
    // Over 400 ticks the two have diverged and the ratio is no longer the tempo
    // ratio (2.2 to 4.4 across the catalogue), but the new personality is still
    // decisively the faster of the two. This is the assertion the old one
    // meant to make.
    expect(
      meanInterval(previousTicks) / meanInterval(ticks),
      `${id} mean interval ratio`,
    ).toBeGreaterThan(1.5);
    // And it is a different market, not the old one relabelled.
    expect(ticks.map((t) => t.price)).not.toEqual(previousTicks.map((t) => t.price));
  });
});
