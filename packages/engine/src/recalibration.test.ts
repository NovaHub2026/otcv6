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
 */
const START = { instant: epochMillis(1_776_000_000_000), price: logPrice(0) };

describe("a recalibrated personality restores the previous one's snapshot", () => {
  it.each(ASSET_CATALOGUE.map((a) => [a.definition.id, a] as const))('%s', (id, asset) => {
    const registration = MasterKeyring.forTesting(registrationKeyLabel(id));
    const derive = (purpose: string) =>
      registration.derive({ env: 'simulation', asset: id, purpose, keyEpoch: 0 });
    // The previous personality: the same asset at four times the tempo and twice
    // the tick RMS — what the catalogue held before PH-24.17, reconstructed by the
    // same solve rather than copied as numbers.
    const previous = authorPersonality(
      { ...asset.definition.traits, tempoMs: asset.definition.traits.tempoMs * 4 },
      { excessKurtosis: asset.authored.excessKurtosis, tickRms: asset.authored.tickRms * 2 },
      derive,
    );
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
    // The continuation is the new personality's: its mean interval is shorter.
    const ticks = [continued!];
    for (let i = 0; i < 400; i += 1) ticks.push(after.next()!);
    const span = ticks[ticks.length - 1]!.instant - ticks[0]!.instant;
    expect(span / (ticks.length - 1)).toBeLessThan(asset.definition.traits.tempoMs * 2);
  });
});
