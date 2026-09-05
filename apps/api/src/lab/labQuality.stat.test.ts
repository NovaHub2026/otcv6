import { describe, expect, it } from 'vitest';
import { MasterKeyring, SteppableClock, epochMillis } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { yieldToLoop } from '@otc/lab';
import { MemoryStateStore } from '@otc/runtime';
import { VenueService } from '../venue.service.js';
import { LabController } from './lab.controller.js';
import { SignSelector } from './selectableSigns.js';
import { LabSession } from './session.js';

/**
 * What the Lab's default sample actually buys.
 *
 * Statistical rather than unit because it runs the real battery over a million
 * ticks — six seconds of it, measured — and the unit suite is thirty seconds
 * for eighty-six files. The fast half of this rule lives in
 * `labMarkets.test.ts`: that a sample too thin to test reads `inconclusive`.
 *
 * `await yieldToLoop()` before the long stretch, per CLAUDE.md §5: a
 * synchronous run longer than sixty seconds with a main-thread request in
 * flight produces this project's most confusing failure — every test passing
 * and the gate exiting 1.
 */
const GENESIS = epochMillis(1_776_000_000_000);

interface QualityBody {
  readonly sampledTicks: number;
  readonly predictability: {
    readonly verdict: string;
    readonly hypothesesTested: number;
    readonly resolutionPoints: number;
    readonly notes: readonly string[];
  };
}

describe('the default sample supports a verdict', () => {
  it('tests enough hypotheses, and states the resolution it holds at', async () => {
    const venue = new VenueService(
      new MemoryStateStore(),
      MasterKeyring.fromSecret('lab-quality-spec', new Uint8Array(32).fill(9)),
      new SteppableClock(GENESIS),
      [ASSET_CATALOGUE[0]!],
    );
    await venue.start();
    await yieldToLoop();
    const body = (await new LabController(venue, new SignSelector(), new LabSession()).quality(
      ASSET_CATALOGUE[0]!.definition.id,
    )) as QualityBody;
    // PH-24.17: the default is a span — sixteen days, what a million ticks were on
    // EUR/USD before the grain changed — in the asset's own ticks.
    const expected = Math.round((1_000_000 * 1_380) / ASSET_CATALOGUE[0]!.evidence.meanIntervalMs);
    expect(body.sampledTicks).toBe(Math.min(8_000_000, expected));
    expect(body.sampledTicks).toBeGreaterThan(1_000_000);
    // 378 measured on 2026-09-03, against 2 at the 40,000 this route used to
    // sample. The floor is 100; the assertion is that the default clears it by
    // a margin, not that it hits a number.
    expect(body.predictability.hypothesesTested).toBeGreaterThanOrEqual(300);
    expect(body.predictability.verdict).toBe('clean-above-resolution');
    // Not "no edge" — no edge *above this*. Even a million ticks resolves to
    // about a point, against a 0.25pp materiality threshold, and the battery
    // says so itself in its notes.
    expect(body.predictability.resolutionPoints).toBeGreaterThan(0);
    expect(body.predictability.notes.join(' ')).toMatch(/were not tested/);
    await venue.stop();
  }, 300_000);
});
