import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  MasterKeyring,
  SteppableClock,
  type Tick,
  logPrice,
  toDisplayPrice,
  type InstrumentSpec,
} from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { PublicationService } from '../publication.service.js';
import { VenueService } from '../venue.service.js';
import { LabController } from './lab.controller.js';
import { SignSelector } from './selectableSigns.js';
import { ArrivalSelector, paceIntervalMs } from './selectableArrival.js';
import { LabPositions } from './positions.js';
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
  landing: { latticeLevel: number; price: string; afterTicks: number; instant: number };
  retracted: boolean;
  pace: string;
  armed: boolean;
  remaining: number;
  pushing: { direction: 1 | -1; requested: number; remaining: number } | null;
}

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
const after = (ticks: Tick[], sequence: number): Tick[] =>
  ticks.filter((t) => t.sequence > sequence);
const deltas = (ticks: Tick[], from: Tick): number[] =>
  ticks.map((t, i) => t.price - (i === 0 ? from.price : ticks[i - 1]!.price));
const intervals = (ticks: Tick[], from: Tick): number[] =>
  ticks.map((t, i) => t.instant - (i === 0 ? from.instant : ticks[i - 1]!.instant));

describe('PH-24.10 — a push is N natural ticks', () => {
  it('+3 retracts the pending tick and bursts three upward ticks at the fastest natural pace; the landing is where the record goes', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 120_000);
    const before = record(lab.venue);
    const lastPublished = before[before.length - 1]!;
    // The hosted market holds one drawn tick; PH-24.13 retracts it, so the push
    // begins with that very sequence.
    const pending = lab.venue.hostedMarket(id)!.pending!;
    expect(pending.sequence).toBe(lastPublished.sequence + 1);

    const gap = lab.clock.now() - lastPublished.instant;
    const pushed = (await lab.controller.push(id, '+3')) as Pushed;
    expect(pushed).toMatchObject({
      direction: 'up',
      ticks: 3,
      extended: false,
      retracted: true,
      armed: true,
      remaining: 3,
    });
    expect(pushed.pushing).toEqual({ direction: 1, requested: 3, remaining: 3, pace: 'rapido' });
    expect(pushed.pace).toBe('rapido');
    expect(pushed.landing.afterTicks).toBe(3);
    expect(lab.venue.hostedMarket(id)!.pending).toBeNull();

    // One second on, one pass: the burst's instants are already due.
    await advance(lab.venue, lab.clock, 1_000);
    const labTicks = after(record(lab.venue), lastPublished.sequence);
    expect(labTicks.length).toBeGreaterThanOrEqual(3);
    expect(labTicks[0]!.sequence).toBe(pending.sequence);
    const labDeltas = deltas(labTicks, lastPublished);
    const labIntervals = intervals(labTicks, lastPublished);
    // Criterion 2: the burst — at most base / BURST_DIVISOR apart, every sign up.
    const step = paceIntervalMs('rapido', asset.evidence.meanIntervalMs)!;
    // PH-24.16: the first pushed tick is anchored at now — its interval is the gap
    // since the last published tick plus one burst step; the rest are burst steps.
    expect(labIntervals[0]!).toBeGreaterThanOrEqual(gap);
    expect(labIntervals[0]!).toBeLessThanOrEqual(gap + step + 1);
    for (let i = 1; i < 3; i += 1) expect(labIntervals[i]!).toBeLessThanOrEqual(step);
    for (let i = 0; i < 3; i += 1) expect(labDeltas[i]!).toBeGreaterThanOrEqual(0);
    // The landing announced is the third pushed tick's price.
    expect(labTicks[2]!.price).toBe(pushed.landing.latticeLevel);

    // The mirror on the burst (ADR-0003): the same push, every sign flipped, on a
    // second venue from the same keyring — identical intervals, magnitudes negated.
    const mirror = await labVenue();
    await advance(mirror.venue, mirror.clock, 120_000);
    const mirrored = (await mirror.controller.push(id, '-3')) as Pushed;
    expect(mirrored.retracted).toBe(true);
    await advance(mirror.venue, mirror.clock, 1_000);
    const mirrorTicks = after(record(mirror.venue), lastPublished.sequence);
    const mirrorDeltas = deltas(mirrorTicks, lastPublished);
    const mirrorIntervals = intervals(mirrorTicks, lastPublished);
    expect(mirrorIntervals.slice(0, 3)).toEqual(labIntervals.slice(0, 3));
    // `0 - d`, not `-d`: a zero step mirrors to +0, and toEqual tells -0 apart.
    expect(mirrorDeltas.slice(0, 3)).toEqual(labDeltas.slice(0, 3).map((d) => 0 - d));

    // Criterion 3: after the push both wrappers are transparent, and the outcome
    // is read from the record at the landing's sequence.
    const control = lab.controller.control(id) as {
      armed: boolean;
      pushing: unknown;
      lastPush: { exact: boolean | null; landedPrice: string | null; landingPrice: string };
    };
    expect(control.armed).toBe(false);
    expect(control.pushing).toBeNull();
    expect(lab.arrivals.for(id)!.armed).toBe(false);
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
    expect(second.pushing).toEqual({ direction: 1, requested: 8, remaining: 8, pace: 'rapido' });
    expect(second.landing.afterTicks).toBe(8);
    const reversed = (await lab.controller.push(id, '-2')) as Pushed;
    expect(reversed).toMatchObject({ direction: 'down', extended: false, remaining: 2 });
    expect(reversed.pushing).toEqual({ direction: -1, requested: 2, remaining: 2, pace: 'rapido' });
    const released = lab.controller.release(id) as { discarded: number; pushing: unknown };
    expect(released.discarded).toBe(2);
    expect(released.pushing).toBeNull();
    expect(lab.selector.for(id)!.armed).toBe(false);
  });

  it('refuses a close while a push runs; a push over an armed close releases it, recorded (PH-24.11)', async () => {
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
    // Arm a close (delta 0 is off-parity half the time; any armed vector will do).
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
        )) as { armed: boolean };
        if (r.armed) {
          armed = true;
          break;
        }
      } catch {
        // between levels or refused: try the next
      }
    }
    expect(armed).toBe(true);
    const beforePush = lab.controller.control(id) as { remaining: number; lastApplied: unknown };
    expect(beforePush.remaining).toBeGreaterThan(0);
    expect(beforePush.lastApplied).not.toBeNull();
    // The push wins: the close is released, counted, and no longer judged.
    const pushed = (await lab.controller.push(id, '2')) as Pushed & {
      released: { discarded: number } | null;
      lastApplied: unknown;
    };
    expect(pushed.released).toEqual({ discarded: beforePush.remaining });
    expect(pushed.pushing).toEqual({ direction: 1, requested: 2, remaining: 2, pace: 'rapido' });
    expect(pushed.lastApplied).toBeNull();
    const lines = lab.session.toLines();
    expect(
      lines.filter((l) => /"succeeded":false/.test(l) && /"refused":"PUSH_RUNNING"/.test(l)).length,
    ).toBe(2);
    expect(lines.some((l) => /"action":"release"/.test(l) && /"by":"push"/.test(l))).toBe(true);
  });

  it('rejects zero, non-integers and more than fifty ticks', async () => {
    const lab = await labVenue();
    for (const bad of ['0', '1.5', 'x', '51', '-51', undefined]) {
      await expect(lab.controller.push(id, bad)).rejects.toThrow(/ticks must be/);
    }
  });

  it("PH-24.15: normal plays the keystream's own intervals, medio one sixth of the tempo; the pace is recorded", async () => {
    // normal: the pushed stretch has the unpushed venue's intervals, tick for tick —
    // the retract redraws from the same keystream positions and no arrival draw is scripted.
    const lab = await labVenue();
    const plain = await labVenue(false);
    await advance(lab.venue, lab.clock, 120_000);
    await advance(plain.venue, plain.clock, 120_000);
    const lastPublished = record(lab.venue)[record(lab.venue).length - 1]!;
    const gapNormal = lab.clock.now() - lastPublished.instant;
    const pushed = (await lab.controller.push(id, '+3', 'normal')) as Pushed;
    expect(pushed.pace).toBe('normal');
    expect(pushed.retracted).toBe(true);
    await advance(lab.venue, lab.clock, 60_000);
    await advance(plain.venue, plain.clock, 60_000);
    const labTicks = after(record(lab.venue), lastPublished.sequence);
    const plainTicks = after(record(plain.venue), lastPublished.sequence);
    // PH-24.16: the first interval is the keystream's own plus the gap to now (within
    // the model's millisecond); from the second tick the intervals are the unpushed venue's.
    const labIntervals = intervals(labTicks, lastPublished);
    const plainIntervals = intervals(plainTicks, lastPublished);
    expect(Math.abs(labIntervals[0]! - (plainIntervals[0]! + gapNormal))).toBeLessThanOrEqual(1);
    // The draws are the keystream's; the intervals differ only by the Hawkes decay
    // over a longer first interval — the engine's own law, within a percent.
    for (let i = 1; i < 3; i += 1) {
      expect(Math.abs(labIntervals[i]! - plainIntervals[i]!)).toBeLessThanOrEqual(
        Math.max(2, plainIntervals[i]! * 0.02),
      );
    }
    // Signs up throughout. The first magnitude answers a longer interval (duration
    // coupling), so magnitudes are compared from the second tick, within a few percent.
    const labDeltasN = deltas(labTicks, lastPublished).slice(0, 3);
    const plainDeltasN = deltas(plainTicks, lastPublished).slice(0, 3).map(Math.abs);
    for (const d of labDeltasN) expect(d).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < 3; i += 1) {
      expect(Math.abs(labDeltasN[i]! - plainDeltasN[i]!)).toBeLessThanOrEqual(
        Math.max(1, plainDeltasN[i]! * 0.05),
      );
    }
    expect(
      lab.session.toLines().some((l) => /"action":"push"/.test(l) && /"pace":"normal"/.test(l)),
    ).toBe(true);

    // medio: at most base / 6 apart.
    const medio = await labVenue();
    await advance(medio.venue, medio.clock, 120_000);
    const last2 = record(medio.venue)[record(medio.venue).length - 1]!;
    const gapMedio = medio.clock.now() - last2.instant;
    const m = (await medio.controller.push(id, '-4', 'medio')) as Pushed;
    expect(m.pushing).toEqual({ direction: -1, requested: 4, remaining: 4, pace: 'medio' });
    await advance(medio.venue, medio.clock, 5_000);
    const mTicks = after(record(medio.venue), last2.sequence);
    const bound = paceIntervalMs('medio', asset.evidence.meanIntervalMs)!;
    // PH-24.16: the first pushed tick is anchored at now (gap + step); the rest at the pace.
    const mIntervals = intervals(mTicks, last2).slice(0, 4);
    expect(mIntervals[0]!).toBeLessThanOrEqual(gapMedio + bound + 1);
    for (const ms of mIntervals.slice(1)) expect(ms).toBeLessThanOrEqual(bound);
    for (const d of deltas(mTicks, last2).slice(0, 4)) expect(d).toBeLessThanOrEqual(0);

    // An unknown pace is refused.
    await expect(medio.controller.push(id, '1', 'turbo')).rejects.toThrow(/pace must be one of/);
  });

  it('PH-24.16: pushed ticks are due one after another from now, at the pace, never before the push', async () => {
    for (const pace of ['rapido', 'medio'] as const) {
      const lab = await labVenue();
      await advance(lab.venue, lab.clock, 120_000);
      const lastPublished = record(lab.venue)[record(lab.venue).length - 1]!;
      const now = lab.clock.now();
      const pushed = (await lab.controller.push(id, '+5', pace)) as Pushed;
      const step = paceIntervalMs(pace, asset.evidence.meanIntervalMs)!;
      // The landing is five ticks ahead of now, not of the last published instant.
      expect(pushed.landing.instant).toBeGreaterThanOrEqual(now + step);
      expect(pushed.landing.instant).toBeLessThanOrEqual(now + 6 * step + 1);
      await advance(lab.venue, lab.clock, 10_000);
      const ticks = after(record(lab.venue), lastPublished.sequence).slice(0, 5);
      expect(ticks[0]!.instant).toBeGreaterThanOrEqual(now);
      expect(ticks[0]!.instant).toBeLessThanOrEqual(now + step + 1);
      for (let i = 1; i < 5; i += 1) {
        expect(ticks[i]!.instant - ticks[i - 1]!.instant).toBeLessThanOrEqual(step);
      }
    }
    // normal: the first tick is at or after now as well, at the keystream's own interval.
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 120_000);
    const now = lab.clock.now();
    const pushed = (await lab.controller.push(id, '+2', 'normal')) as Pushed;
    expect(pushed.landing.instant).toBeGreaterThan(now);
  });

  it('PH-24.18: a push by distance arms the ticks the fork needed to reach the units asked, and says so', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 120_000);
    const state = lab.controller.state(id) as {
      latticeLevel: number;
      price: string;
      distance: { unitSteps: number; candleRangeSteps: number; minutes: number };
      instrument: { logQuantum: number; referencePrice: number; displayPrecision: number };
    };
    expect(state.distance.minutes).toBeGreaterThan(10);
    // PH-24.20: the state carries the lattice — the asset's own, exactly (a plant
    // that scaled logQuantum by 1.0001 survived the render check below: near the
    // reference price the distortion is invisible at display precision) — and
    // the level it names renders to its price.
    const own = lab.venue.assetFor(id)!.instrument;
    expect(state.instrument).toEqual({
      logQuantum: own.logQuantum,
      referencePrice: own.referencePrice,
      displayPrecision: own.displayPrecision,
    });
    expect(
      toDisplayPrice(state.instrument as InstrumentSpec, logPrice(state.latticeLevel)).toFixed(
        state.instrument.displayPrecision,
      ),
    ).toBe(state.price);
    expect(state.distance.unitSteps).toBeGreaterThanOrEqual(1);
    const pushed = (await lab.controller.push(id, undefined, 'rapido', '+2')) as Pushed & {
      distance: { units: number; unitSteps: number; ticks: number; fromLevel: number } | null;
      landing: { latticeLevel: number };
    };
    expect(pushed.armed).toBe(true);
    expect(pushed.distance).not.toBeNull();
    expect(pushed.distance!.units).toBe(2);
    expect(pushed.distance!.ticks).toBe(pushed.ticks);
    // It stops when the distance is reached: fewer ticks than the fork may look
    // at, and a landing not further past the target than a candle's range (a plant
    // that ignored the stop walked all 400 and passed a looser version of this).
    expect(pushed.ticks).toBeLessThan(400);
    expect(Math.abs(pushed.landing.latticeLevel - pushed.distance!.fromLevel)).toBeLessThan(
      2 * state.distance.unitSteps + state.distance.candleRangeSteps,
    );
    // The landing is at least two units from where the walk began — the last
    // published level, the retracted pending tick undone (`state` still carried it).
    expect(
      Math.abs(pushed.landing.latticeLevel - pushed.distance!.fromLevel),
    ).toBeGreaterThanOrEqual(2 * state.distance.unitSteps);
    expect(Math.abs(pushed.distance!.fromLevel - state.latticeLevel)).toBeLessThan(
      state.distance.unitSteps,
    );
    expect(pushed.pushing).toMatchObject({
      direction: 1,
      requested: pushed.ticks,
      remaining: pushed.ticks,
    });
    await expect(lab.controller.push(id, undefined, 'rapido', '0')).rejects.toThrow(
      /distance must be/,
    );
    await expect(lab.controller.push(id, undefined, 'rapido', '21')).rejects.toThrow(
      /distance must be/,
    );
  });
});
