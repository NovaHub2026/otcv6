import { describe, expect, it } from 'vitest';
import { MasterKeyring, SteppableClock, epochMillis } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { VenueService } from '../venue.service.js';
import { LabController } from './lab.controller.js';
import { SignSelector } from './selectableSigns.js';
import { LabSession } from './session.js';
import { BadRequestException } from '@nestjs/common';

/**
 * The Lab names its own markets and no others.
 *
 * §3 of the specification: Lab controls must never be available for
 * manipulating a live market carrying positions. The screen therefore asks the
 * Lab which markets *it* hosts, and a production asset id never reaches it —
 * which is a stronger property than a check on the way out, because a check is
 * a flag and ADR-0015 §3 is the record of what this project thinks flags are
 * worth.
 *
 * Behavioural rather than textual: what matters is what the route returns when
 * an asset is not hosted, and that is a thing you can run.
 */
const GENESIS = epochMillis(1_776_000_000_000);
const keyring = (): MasterKeyring =>
  MasterKeyring.fromSecret('lab-markets-spec', new Uint8Array(32).fill(9));

async function labVenue(): Promise<VenueService> {
  const venue = new VenueService(
    new MemoryStateStore(),
    keyring(),
    new SteppableClock(GENESIS),
    ASSET_CATALOGUE.slice(0, 3),
  );
  await venue.start();
  return venue;
}

interface MarketsBody {
  readonly environment: string;
  readonly markets: readonly { readonly id: string; readonly displayName: string }[];
}

describe('the Lab lists the markets it hosts', () => {
  it('returns every hosted asset, named, and says where it is', async () => {
    const venue = await labVenue();
    const body = new LabController(
      venue,
      new SignSelector(),
      new LabSession(),
    ).markets() as MarketsBody;
    expect(body.environment).toBe('OTC LAB — SIMULATION ENVIRONMENT');
    expect(body.markets.map((m) => m.id)).toEqual(
      ASSET_CATALOGUE.slice(0, 3).map((a) => a.definition.id),
    );
    for (const market of body.markets) expect(market.displayName.length).toBeGreaterThan(0);
    await venue.stop();
  });

  it('drops an asset the venue stopped hosting', async () => {
    // Retirement is the case that separates "the catalogue" from "what is
    // hosted". A retired asset is still registered and is no longer a market,
    // and offering it in the Lab would offer a control over nothing.
    const venue = await labVenue();
    const retired = ASSET_CATALOGUE[1]!.definition.id;
    await venue.retire(retired);
    const body = new LabController(
      venue,
      new SignSelector(),
      new LabSession(),
    ).markets() as MarketsBody;
    expect(body.markets.map((m) => m.id)).not.toContain(retired);
    expect(body.markets, 'retiring one asset emptied the list').toHaveLength(2);
    await venue.stop();
  });
});

interface QualityBody {
  readonly sampledTicks: number;
  readonly predictability: {
    readonly verdict: string;
    readonly clean: boolean;
    readonly hypothesesTested: number;
    readonly resolutionPoints: number;
    readonly notes: readonly string[];
  };
}

describe('a bounded battery run says what it could not see', () => {
  /**
   * The defect this exists for, measured on this engine on 2026-09-03.
   *
   * The route sampled 40,000 ticks and the panel printed `clean`. The battery
   * drops any bucket holding fewer than 500 decided outcomes, so at that size
   * **two** hypotheses survived out of the eight hundred it defines — and two
   * reads exactly like 378 when the word on the screen is the same.
   *
   * | ticks | hypotheses |
   * | ----: | ---------: |
   * | 40,000 |         2 |
   * | 1,000,000 |    378 |
   */
  it('calls a sample too thin to test inconclusive, not clean', async () => {
    const venue = await labVenue();
    const body = (await new LabController(venue, new SignSelector(), new LabSession()).quality(
      ASSET_CATALOGUE[0]!.definition.id,
      '40000',
    )) as QualityBody;
    expect(body.predictability.hypothesesTested).toBeLessThan(100);
    expect(body.predictability.verdict, 'two hypotheses read as a clean verdict').toBe(
      'inconclusive',
    );
    await venue.stop();
  }, 120_000);

  /**
   * **Cycle Audit 8 (a8): the floor above was pinned by nothing.**
   *
   * After PH-24.17 a 40,000-tick sample tests **zero** hypotheses, so
   * `tested < floor` holds for every floor at or above one and the assertion
   * stopped saying anything about the value. Dropping `LAB_MIN_HYPOTHESES` to 1
   * restored the exact CA7-05 defect — a screen printing a verdict off a
   * handful of hypotheses — with a green gate.
   *
   * This case sits inside the band instead: a sample that survives *some*
   * hypotheses and not enough. It fails at a floor of 1, where the same sample
   * would be called clean.
   */
  it('holds the floor at a sample that tests some hypotheses but not enough (a8)', async () => {
    const venue = await labVenue();
    const body = (await new LabController(venue, new SignSelector(), new LabSession()).quality(
      ASSET_CATALOGUE[0]!.definition.id,
      '400000',
    )) as QualityBody;
    const tested = body.predictability.hypothesesTested;
    expect(tested, 'the sample tests nothing, so it pins no floor').toBeGreaterThan(0);
    expect(tested, 'the sample clears the floor, so it pins nothing either').toBeLessThan(100);
    expect(
      body.predictability.verdict,
      `${String(tested)} hypotheses read as a verdict rather than as too little evidence`,
    ).toBe('inconclusive');
    await venue.stop();
  }, 300_000);

  it('records what each sample size actually tests, so the docstring cannot rot (a8)', async () => {
    // **Cycle Audit 8 (a8).** The table in `lab.controller.ts` was measured
    // before PH-24.17 divided the tempo by four, and every row of it moved: a
    // 40,000-tick sample tested two hypotheses then and none now. A table
    // nothing re-measures is a table that describes an engine the project no
    // longer runs, and this one is the argument for the floor beneath it.
    const venue = await labVenue();
    const controller = new LabController(venue, new SignSelector(), new LabSession());
    const measured: [number, number][] = [];
    for (const ticks of [40_000, 400_000, 1_000_000]) {
      const body = (await controller.quality(
        ASSET_CATALOGUE[0]!.definition.id,
        String(ticks),
      )) as QualityBody;
      measured.push([ticks, body.predictability.hypothesesTested]);
    }
    console.log(`hypotheses by sample: ${JSON.stringify(measured)}`);
    // Monotone in the sample, and the default clears the floor with room.
    expect(measured[0]![1]).toBeLessThanOrEqual(measured[1]![1]);
    expect(measured[1]![1]).toBeLessThanOrEqual(measured[2]![1]);
    expect(measured[2]![1], 'the default sample no longer supports a verdict').toBeGreaterThan(100);
    await venue.stop();
  }, 600_000);

  it('refuses a sample size outside the stated bounds', async () => {
    const venue = await labVenue();
    const controller = new LabController(venue, new SignSelector(), new LabSession());
    await expect(
      controller.quality(ASSET_CATALOGUE[0]!.definition.id, '10'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.quality(ASSET_CATALOGUE[0]!.definition.id, '9000000'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.quality(ASSET_CATALOGUE[0]!.definition.id, 'lots'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await venue.stop();
  });
});
