import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  MasterKeyring,
  SteppableClock,
  type Tick,
  logPrice,
  toDisplayPrice,
} from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { PublicationService } from '../publication.service.js';
import { VenueService } from '../venue.service.js';
import { LabController } from './lab.controller.js';
import { SignSelector } from './selectableSigns.js';
import { ArrivalSelector } from './selectableArrival.js';
import { LabPositions } from './positions.js';
import { LabSession } from './session.js';

/**
 * PH-24.23: a route of up to five points, sought in order, on a real venue
 * composed as a Lab. Reached is read from the record — the price at the
 * sequence the route named is at or beyond the point in the leg's direction.
 */
const asset = ASSET_CATALOGUE[0]!;
const id = asset.definition.id;
const GENESIS = epochMillis(1_776_000_000_000);
const keyring = (): MasterKeyring =>
  MasterKeyring.fromSecret('push-routes-spec', new Uint8Array(32).fill(17));

async function labVenue(withSelector = true) {
  const clock = new SteppableClock(GENESIS);
  const selector = new SignSelector();
  const arrivals = new ArrivalSelector();
  const session = new LabSession();
  const venue = new VenueService(
    new MemoryStateStore(),
    keyring(),
    clock,
    [asset],
    5_000,
    new PublicationService([asset]),
    null,
    null,
    0,
    withSelector ? (keystream, assetId) => selector.wrap(keystream, assetId) : null,
    withSelector ? (keystream, assetId) => arrivals.wrap(keystream, assetId) : null,
  );
  await venue.start();
  const controller = new LabController(venue, selector, session, new LabPositions(), arrivals);
  return { venue, clock, controller, selector, arrivals, session };
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

const record = (venue: VenueService): Tick[] => [...venue.feed.since(id, 1)];

interface Routed {
  armed: boolean;
  pace: string;
  ticks: number;
  points: { price: string; level: number; landing: number; sequence: number; ticks: number }[];
  released: { discarded: number } | null;
  route: {
    points: { price: string; level: number; sequence: number; reached: boolean }[];
    direction: 1 | -1 | null;
    remaining: number;
  } | null;
  pushing: unknown;
}

const display = (level: number): string =>
  toDisplayPrice(asset.instrument, logPrice(level)).toFixed(asset.instrument.displayPrecision);

describe('PH-24.23 — a route is points the price goes to seek, in order', () => {
  it('reaches two points in order — up, then down — and the market is free after the last', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 120_000);
    const state = lab.controller.state(id) as {
      latticeLevel: number;
      distance: { unitSteps: number };
    };
    const up = state.latticeLevel + 2 * state.distance.unitSteps;
    const down = state.latticeLevel - 2 * state.distance.unitSteps;
    const routed = (await lab.controller.route(
      id,
      `${display(up)},${display(down)}`,
      'rapido',
    )) as Routed;
    expect(routed.armed).toBe(true);
    expect(routed.points).toHaveLength(2);
    expect(routed.points[0]!.sequence).toBeLessThan(routed.points[1]!.sequence);
    expect(routed.points[0]!.landing).toBeGreaterThanOrEqual(up);
    expect(routed.points[1]!.landing).toBeLessThanOrEqual(down);
    expect(routed.ticks).toBe(routed.points[0]!.ticks + routed.points[1]!.ticks);
    expect(routed.route).not.toBeNull();
    expect(routed.route!.direction).toBe(1);
    expect(routed.route!.points.map((p) => p.reached)).toEqual([false, false]);
    expect(routed.pushing).toBeNull();

    await advance(lab.venue, lab.clock, 120_000);
    const ticks = record(lab.venue);
    const at = (sequence: number): Tick => ticks.find((t) => t.sequence === sequence)!;
    // The record agrees with the fork: each point reached where the route said, in its direction.
    expect(at(routed.points[0]!.sequence).price).toBe(routed.points[0]!.landing);
    expect(at(routed.points[0]!.sequence).price).toBeGreaterThanOrEqual(up);
    expect(at(routed.points[1]!.sequence).price).toBe(routed.points[1]!.landing);
    expect(at(routed.points[1]!.sequence).price).toBeLessThanOrEqual(down);
    // And the leg towards the second point came down from the first: a run against, at most.
    const control = lab.controller.control(id) as { route: unknown; armed: boolean };
    expect(control.route).toBeNull();
    expect(control.armed).toBe(false);
    expect(lab.selector.for(id)!.armed).toBe(false);
    const actions = lab.session.labActions.filter((action) => action.action === 'route');
    expect(actions).toHaveLength(1);
    expect(actions[0]!.succeeded).toBe(true);
    expect(actions[0]!.parameters).toMatchObject({ pace: 'rapido' });
  }, 60_000);

  it('says reached as the record reaches each point, and the direction of the leg in force', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 120_000);
    const state = lab.controller.state(id) as {
      latticeLevel: number;
      distance: { unitSteps: number };
    };
    const routed = (await lab.controller.route(
      id,
      `${display(state.latticeLevel - state.distance.unitSteps)},${display(state.latticeLevel + state.distance.unitSteps)}`,
      'normal',
    )) as Routed;
    expect(routed.armed).toBe(true);
    expect(routed.route!.direction).toBe(-1);
    // Publish exactly up to the first point — read from the record, not from the
    // engine snapshot, which counts the drawn, unpublished tick as well.
    const publishedThrough = (): number => {
      const ticks = record(lab.venue);
      return ticks[ticks.length - 1]?.sequence ?? 0;
    };
    while (publishedThrough() < routed.points[0]!.sequence) {
      await advance(lab.venue, lab.clock, 250);
      expect(publishedThrough()).toBeLessThan(routed.points[1]!.sequence);
    }
    const midway = lab.controller.control(id) as Routed;
    expect(midway.route!.points[0]!.reached).toBe(true);
    expect(midway.route!.points[1]!.reached).toBe(false);
    expect(midway.route!.direction).toBe(1);
  }, 60_000);

  it('refuses a point no leg reaches, by number, and arms nothing', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 120_000);
    const state = lab.controller.state(id) as { price: string; latticeLevel: number };
    const far = (Number(state.price) * 1.05).toFixed(asset.instrument.displayPrecision);
    await expect(lab.controller.route(id, `${state.price},${far}`, 'rapido')).rejects.toMatchObject(
      {
        response: { point: 2 },
      },
    );
    expect(lab.selector.for(id)!.armed).toBe(false);
    expect((lab.controller.control(id) as Routed).route).toBeNull();
    await expect(lab.controller.route(id, '', 'rapido')).rejects.toThrow(/points must list/);
    await expect(lab.controller.route(id, '1,2,3,4,5,6', 'rapido')).rejects.toThrow(
      /points must list/,
    );
  }, 60_000);

  it('a close is refused while a route runs; a push or a sube / baja interrupts it; release frees it', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 120_000);
    const state = lab.controller.state(id) as {
      price: string;
      latticeLevel: number;
      distance: { unitSteps: number };
    };
    const points = `${display(state.latticeLevel + 3 * state.distance.unitSteps)},${display(state.latticeLevel - 3 * state.distance.unitSteps)}`;
    await lab.controller.route(id, points, 'normal');
    await expect(lab.controller.applyClose(id, state.price, 'next', '1m')).rejects.toThrow(
      /ROUTE_RUNNING/,
    );
    // A push over the route releases it and says so.
    const pushed = (await lab.controller.push(id, '+2')) as {
      released: { discarded: number } | null;
      route: unknown;
    };
    expect(pushed.released).not.toBeNull();
    expect(pushed.route).toBeNull();
    lab.controller.release(id);
    // A sube / baja interrupts it too, recorded as a release by bias.
    await lab.controller.route(id, points, 'normal');
    const biased = (await lab.controller.bias(id, 'up')) as Routed & { bias: 1 | -1 | null };
    expect(biased.route).toBeNull();
    expect(biased.bias).toBe(1);
    const releases = lab.session.labActions.filter((action) => action.action === 'release');
    expect(releases.some((action) => (action.parameters as { by?: string }).by === 'bias')).toBe(
      true,
    );
    expect(releases.some((action) => (action.parameters as { by?: string }).by === 'push')).toBe(
      true,
    );
    await lab.controller.bias(id, 'off');
    // Release mid-route frees the market and forgets the route.
    await lab.controller.route(id, points, 'normal');
    const released = lab.controller.release(id) as Routed & { discarded: number };
    expect(released.discarded).toBeGreaterThan(0);
    expect(released.route).toBeNull();
    expect(lab.selector.for(id)!.armed).toBe(false);
  }, 60_000);
});
