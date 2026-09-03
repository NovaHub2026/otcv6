import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { PublicationService } from '../publication.service.js';
import { VenueService } from '../venue.service.js';
import { LabController } from './lab.controller.js';
import { SignSelector } from './selectableSigns.js';
import { LabSession } from './session.js';

/**
 * PH-24.10 acceptance criteria 1–3, on a real venue composed as a Lab.
 *
 * "Natural" is asserted the only way it can be: a second venue from the same
 * keyring, never pushed, produces the same magnitudes and the same intervals
 * over the pushed stretch — only the signs differ (ADR-0003, the mirror
 * argument). The landing the route announced is the price the record shows
 * after the Nth pushed tick.
 */
const asset = ASSET_CATALOGUE[0]!;
const id = asset.definition.id;
const GENESIS = epochMillis(1_776_000_000_000);
const keyring = (): MasterKeyring =>
  MasterKeyring.fromSecret('push-routes-spec', new Uint8Array(32).fill(17));

interface Pushed {
  direction: 'up' | 'down';
  ticks: number;
  extended: boolean;
  landing: { latticeLevel: number; price: string; afterTicks: number };
  armed: boolean;
  remaining: number;
  pushing: { direction: 1 | -1; requested: number; remaining: number } | null;
}

async function labVenue(withSelector = true) {
  const clock = new SteppableClock(GENESIS);
  const selector = new SignSelector();
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
  );
  await venue.start();
  const controller = new LabController(venue, selector, session);
  return { venue, clock, controller, selector, session };
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
const after = (ticks: Tick[], sequence: number): Tick[] =>
  ticks.filter((t) => t.sequence > sequence);
const deltas = (ticks: Tick[], from: Tick): number[] =>
  ticks.map((t, i) => t.price - (i === 0 ? from.price : ticks[i - 1]!.price));
const intervals = (ticks: Tick[], from: Tick): number[] =>
  ticks.map((t, i) => t.instant - (i === 0 ? from.instant : ticks[i - 1]!.instant));

describe('PH-24.10 — a push is N natural ticks', () => {
  it('+3 is exactly three upward ticks from the next draw, then the keystream; the landing is where the record goes', async () => {
    const lab = await labVenue();
    const plain = await labVenue(false);
    await advance(lab.venue, lab.clock, 120_000);
    await advance(plain.venue, plain.clock, 120_000);
    const before = record(lab.venue);
    const last = before[before.length - 1]!;
    // The hosted market holds one drawn tick; the push starts on the draw after it.
    const pending = lab.venue.hostedMarket(id)!.pending!;

    const pushed = (await lab.controller.push(id, '+3')) as Pushed;
    expect(pushed).toMatchObject({
      direction: 'up',
      ticks: 3,
      extended: false,
      armed: true,
      remaining: 3,
    });
    expect(pushed.pushing).toEqual({ direction: 1, requested: 3, remaining: 3 });
    expect(pushed.landing.afterTicks).toBe(3);

    await advance(lab.venue, lab.clock, 120_000);
    await advance(plain.venue, plain.clock, 120_000);
    const labTicks = after(record(lab.venue), pending.sequence);
    const plainTicks = after(record(plain.venue), pending.sequence);
    expect(labTicks.length).toBeGreaterThan(10);
    const labDeltas = deltas(labTicks, pending);
    const plainDeltas = deltas(plainTicks, pending);
    // Criterion 1: the three pushed ticks are the unpushed market's magnitudes
    // with the upward sign — a tick whose magnitude quantised to zero stays zero,
    // because nothing is added to a price.
    expect(labDeltas.slice(0, 3)).toEqual(plainDeltas.slice(0, 3).map(Math.abs));
    expect(labDeltas.slice(0, 3).every((d) => d >= 0)).toBe(true);
    // Natural: magnitudes and intervals are the unpushed market's, tick for tick,
    // across the pushed stretch and beyond — only the signs may differ.
    const n = Math.min(labTicks.length, plainTicks.length);
    expect(labDeltas.slice(0, n).map(Math.abs)).toEqual(plainDeltas.slice(0, n).map(Math.abs));
    expect(intervals(labTicks, pending).slice(0, n)).toEqual(
      intervals(plainTicks, pending).slice(0, n),
    );
    // After the push, the keystream's own signs.
    expect(labDeltas.slice(3, n)).toEqual(plainDeltas.slice(3, n));
    // The landing announced is the third pushed tick's price.
    expect(labTicks[2]!.price).toBe(pushed.landing.latticeLevel);
    expect(last.sequence).toBeLessThan(pending.sequence);

    const control = lab.controller.control(id) as {
      armed: boolean;
      pushing: unknown;
      lastPush: { exact: boolean | null; landedPrice: string | null; landingPrice: string };
    };
    expect(control.armed).toBe(false);
    expect(control.pushing).toBeNull();
    // The outcome is read from the record at the landing's sequence.
    expect(control.lastPush.exact).toBe(true);
    expect(control.lastPush.landedPrice).toBe(pushed.landing.price);
  });

  it('a second push in the same direction extends; the opposite replaces; release ends it', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 60_000);
    const first = (await lab.controller.push(id, '5')) as Pushed;
    expect(first.remaining).toBe(5);
    const second = (await lab.controller.push(id, '+3')) as Pushed;
    expect(second).toMatchObject({ extended: true, remaining: 8 });
    expect(second.pushing).toEqual({ direction: 1, requested: 8, remaining: 8 });
    expect(second.landing.afterTicks).toBe(8);
    const reversed = (await lab.controller.push(id, '-2')) as Pushed;
    expect(reversed).toMatchObject({ direction: 'down', extended: false, remaining: 2 });
    expect(reversed.pushing).toEqual({ direction: -1, requested: 2, remaining: 2 });
    const released = lab.controller.release(id) as { discarded: number; pushing: unknown };
    expect(released.discarded).toBe(2);
    expect(released.pushing).toBeNull();
    expect(lab.selector.for(id)!.armed).toBe(false);
  });

  it('refuses a push while a close is armed and a close while a push runs, and records both refusals', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 60_000);
    await lab.controller.push(id, '4');
    await expect(
      lab.controller.applyClose(id, undefined, 'next', '1m', undefined, undefined, '0'),
    ).rejects.toThrow(/PUSH_RUNNING/);
    await expect(
      lab.controller.applyScenario(id, { name: 'sideways', window: '60000' }),
    ).rejects.toThrow(/PUSH_RUNNING/);
    lab.controller.release(id);
    // Now arm a close (the reachable delta 0 is off-parity half the time; any
    // armed vector will do, so try the two neighbours).
    let armed = false;
    for (const delta of ['0', '1', '-1']) {
      try {
        const r = (await lab.controller.applyClose(
          id,
          undefined,
          'next',
          '1m',
          undefined,
          undefined,
          delta,
        )) as {
          armed: boolean;
        };
        if (r.armed) {
          armed = true;
          break;
        }
      } catch {
        // between levels or refused: try the next
      }
    }
    expect(armed).toBe(true);
    await expect(lab.controller.push(id, '2')).rejects.toThrow(/CLOSE_ARMED/);
    const refused = lab.session
      .toLines()
      .filter(
        (l) => /"succeeded":false/.test(l) && /"refused":"(PUSH_RUNNING|CLOSE_ARMED)"/.test(l),
      );
    expect(refused.length).toBe(3);
  });

  it('rejects zero, non-integers and more than fifty ticks', async () => {
    const lab = await labVenue();
    for (const bad of ['0', '1.5', 'x', '51', '-51', undefined]) {
      await expect(lab.controller.push(id, bad)).rejects.toThrow(/ticks must be/);
    }
  });
});
