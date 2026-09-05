// Invariant evidence: INV-001 (economic independence), INV-006 (no exploitable directional rules),
// INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, yieldToLoop } from '@otc/core';
import { ASSET_CATALOGUE, selectClose } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { PublicationService } from '../publication.service.js';
import { VenueService } from '../venue.service.js';
import { medianCandleRange } from './distance.js';
import { measureFootprint, type Footprint, type Intervention } from './footprint.js';
import { ArrivalSelector } from './selectableArrival.js';
import { SignSelector } from './selectableSigns.js';

/**
 * PH-27.4 — the footprint of each kind of intervention, on the real engine.
 *
 * A Lab-composed venue runs an hour; from its current snapshot two forks are
 * walked, one with the intervention armed and one bare, five thousand ticks
 * past the release. The figures are printed for the evidence record and the
 * invariant ones are asserted: on this engine a sign-only substitution moves
 * the level and nothing else — not one instant, not one increment after the
 * release.
 */
const asset = [...ASSET_CATALOGUE].sort(
  (a, b) => a.evidence.meanIntervalMs - b.evidence.meanIntervalMs,
)[0]!;
const id = asset.definition.id;
const GENESIS = epochMillis(1_776_000_000_000);
const HORIZON = 5_000;

async function labVenue(): Promise<VenueService> {
  const clock = new SteppableClock(GENESIS);
  const selector = new SignSelector();
  const arrivals = new ArrivalSelector();
  const venue = new VenueService(
    new MemoryStateStore(),
    MasterKeyring.fromSecret('footprint-spec', new Uint8Array(32).fill(23)),
    clock,
    [asset],
    5_000,
    new PublicationService([asset]),
    null,
    null,
    0,
    (keystream, assetId) => selector.wrap(keystream, assetId),
    (keystream, assetId) => arrivals.wrap(keystream, assetId),
  );
  await venue.start();
  let left = 3_600_000;
  while (left > 0) {
    clock.advance(durationMillis(10_000));
    await venue.tick();
    left -= 10_000;
    if (left % 600_000 === 0) await yieldToLoop();
  }
  return venue;
}

function row(kind: string, f: Footprint): string {
  return (
    `| ${kind} | ${String(f.controlledTicks)} | ${String(f.displacement.steps)} | ` +
    `${f.displacement.candles === null ? '—' : f.displacement.candles.toFixed(2)} | ` +
    `${String(f.detectability.divergentIncrements)} / ${String(f.controlledTicks + f.horizonTicks)} ` +
    `(${(100 * f.detectability.share).toFixed(2)}%) | ${f.detectability.instantsIdentical ? 'yes' : 'NO'} | ` +
    `${f.decay.ticksUntilIdentical === null ? 'never' : String(f.decay.ticksUntilIdentical)} | ` +
    `${String(f.decay.levelOffsetAfter)} |`
  );
}

describe('the footprint of a Lab intervention (PH-27.4)', () => {
  it('a push, a close and a sustained direction each move the level and nothing else', async () => {
    const venue = await labVenue();
    const ticks = [...venue.feed.since(id, 1)];
    const { range } = medianCandleRange(ticks);
    const random = MasterKeyring.forTesting('footprint-lab').derive({
      env: 'simulation',
      asset: id,
      purpose: 'lab-close-selection',
      keyEpoch: 0,
    });

    // A close: the sign vector the Lab would select to land the natural
    // magnitudes of the next 40 ticks on a target six steps up (or seven, when
    // parity says six cannot be reached) — `selectClose` is what the close
    // route runs, on the same kind of fork.
    const preview = measureFootprint(venue, id, { kind: 'script', signs: [1] }, 39, null)!;
    const steps = preview.natural.map((t, i) =>
      Math.abs(t.price - (i === 0 ? preview.startPrice : preview.natural[i - 1]!.price)),
    );
    const total = steps.reduce((sum, x) => sum + x, 0);
    const delta = ((total - 6) & 1) === 0 ? 6 : 7;
    const closeSelection = selectClose({ steps, delta, random });
    expect(closeSelection.signs, closeSelection.impossible ?? 'no selection').not.toBeNull();
    const closeSigns = closeSelection.signs!;

    const kinds: { name: string; intervention: Intervention }[] = [
      {
        name: 'push +10',
        intervention: { kind: 'script', signs: Array.from({ length: 10 }, () => 1 as const) },
      },
      {
        name: 'close (40-tick selected vector)',
        intervention: { kind: 'script', signs: closeSigns },
      },
      {
        name: 'bias up, 200 ticks',
        intervention: { kind: 'bias', direction: 1, ticks: 200, runs: { min: 2, max: 6 }, random },
      },
    ];
    const lines: string[] = [];
    for (const { name, intervention } of kinds) {
      await yieldToLoop();
      const measured = measureFootprint(venue, id, intervention, HORIZON, range > 0 ? range : null);
      expect(measured, name).not.toBeNull();
      const { footprint } = measured!;
      lines.push(row(name, footprint));
      // Not one instant moved: the arrival process cannot see a sign.
      expect(footprint.detectability.instantsIdentical, name).toBe(true);
      // The increments rejoin at the first tick after release, and stay joined.
      expect(footprint.decay.ticksUntilIdentical, name).toBe(0);
      // The only lasting mark is the level: a random walk carries the displacement forever.
      expect(footprint.decay.levelOffsetAfter, name).toBe(footprint.displacement.steps);
      // Nothing outside the controlled stretch differs.
      expect(footprint.detectability.divergentIncrements, name).toBeLessThanOrEqual(
        footprint.controlledTicks,
      );
    }
    console.log(
      [
        `[PH-27.4] ${id}, median 1m range ${String(range)} steps, horizon ${String(HORIZON)} ticks`,
        '| Intervention | Controlled ticks | Displacement (steps) | Displacement (1m candles) | Divergent increments | Instants identical | Decay (ticks) | Level offset after horizon |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...lines,
      ].join('\n'),
    );
  }, 600_000);
});
