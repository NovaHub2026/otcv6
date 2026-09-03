import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { PublicationService } from '../publication.service.js';
import { VenueService } from '../venue.service.js';
import { LabController } from './lab.controller.js';
import { SignSelector } from './selectableSigns.js';
import { LabSession } from './session.js';

/**
 * PH-24.4 criteria 3 and 4: the catalogue served with its refusals, and a
 * scenario applied to a hosted Lab market playing out in the published ticks.
 */
const asset = ASSET_CATALOGUE[0]!;
const id = asset.definition.id;
const GENESIS = epochMillis(1_776_000_000_000);

async function labVenue() {
  const clock = new SteppableClock(GENESIS);
  const selector = new SignSelector();
  const venue = new VenueService(
    new MemoryStateStore(),
    MasterKeyring.fromSecret('scenario-routes-spec', new Uint8Array(32).fill(17)),
    clock,
    [asset],
    5_000,
    new PublicationService([asset]),
    null,
    null,
    0,
    (keystream, assetId) => selector.wrap(keystream, assetId),
  );
  await venue.start();
  return {
    venue,
    clock,
    controller: new LabController(venue, selector, new LabSession()),
    selector,
  };
}

async function advance(venue: VenueService, clock: SteppableClock, ms: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, 10_000);
    clock.advance(durationMillis(step));
    await venue.tick();
    left -= step;
  }
}

interface Applied {
  armed: boolean;
  instant: number;
  ticksInWindow: number;
  attempts: number;
  acceptanceRate: number;
  impossible: string | null;
  shape: { net: number } | null;
}

describe('scenarios on a real Lab-composed venue', () => {
  it('serves the sixteen, with the two that are not selectable saying why', async () => {
    const { venue, controller } = await labVenue();
    const body = controller.scenarios() as {
      scenarios: { name: string; selectable: boolean; why: string | null }[];
      shock: { why: string };
    };
    expect(body.scenarios).toHaveLength(16);
    expect(body.scenarios.filter((s) => !s.selectable).map((s) => s.name)).toEqual([
      'extreme-volatility',
      'low-activity',
    ]);
    expect(body.scenarios.find((s) => s.name === 'low-activity')!.why).toMatch(/arrival/);
    expect(body.shock.why).toMatch(/LA-01/);
    await venue.stop();
  });

  it('refuses to arm what the signs cannot select, and previews without arming', async () => {
    const { venue, clock, controller, selector } = await labVenue();
    await advance(venue, clock, 20_000);
    await expect(
      controller.applyScenario(id, { name: 'extreme-volatility', window: '60000' }),
    ).rejects.toMatchObject({ status: 409 });
    const preview = controller.scenarioPreview(id, {
      name: 'bullish-trend',
      window: '60000',
      net: '1',
    }) as Applied;
    expect(preview.armed).toBe(false);
    expect(preview.ticksInWindow).toBeGreaterThan(3);
    expect(selector.for(id)!.armed).toBe(false);
    await venue.stop();
  });

  it('reports zero, not a best effort, for a shape the window cannot hold', async () => {
    const { venue, clock, controller, selector } = await labVenue();
    await advance(venue, clock, 20_000);
    const result = (await controller.applyScenario(id, {
      name: 'bullish-trend',
      window: '30000',
      net: '1000000',
    })) as Applied;
    expect(result.armed).toBe(false);
    expect(result.acceptanceRate).toBe(0);
    expect(result.impossible).toMatch(/does not do that in this window/);
    expect(selector.for(id)!.armed).toBe(false);
    await venue.stop();
  });

  it('4. a bullish trend applied over the window is what the market then publishes', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const from = venue.hostedMarket(id)!.snapshotEngine();
    const result = (await controller.applyScenario(id, {
      name: 'bullish-trend',
      window: '60000',
      net: '5',
    })) as Applied;
    expect(result.armed).toBe(true);
    expect(result.shape!.net).toBeGreaterThanOrEqual(5);
    await advance(venue, clock, 70_000);
    // The published ticks inside the window, from the engine's price when armed.
    const ticks = venue.feed
      .since(id, from.sequence + 1)
      .filter((t) => t.instant <= result.instant);
    expect(ticks.length).toBe(result.ticksInWindow);
    const net = ticks[ticks.length - 1]!.price - from.price;
    expect(net, 'the market did not publish the selected shape').toBe(result.shape!.net);
    expect(net).toBeGreaterThanOrEqual(5);
    await venue.stop();
  }, 60_000);

  it('locates a coming shock and chooses its direction, or says none is coming', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const none = (await controller.applyScenario(id, {
      name: 'shock',
      window: '30000',
      size: '100000',
      direction: '1',
    })) as Applied;
    expect(none.armed).toBe(false);
    expect(none.impossible).toMatch(/not something the Lab can order/);
    const some = (await controller.applyScenario(id, {
      name: 'shock',
      window: '60000',
      size: '1',
      direction: '-1',
    })) as Applied & { shockAt: number | null };
    expect(some.armed).toBe(true);
    expect(some.shockAt).not.toBeNull();
    expect(some.acceptanceRate).toBeGreaterThan(0.05); // a coin toss, roughly one in two
    await venue.stop();
  }, 60_000);
});
