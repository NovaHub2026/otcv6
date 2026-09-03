import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { PublicationService } from '../publication.service.js';
import { VenueService } from '../venue.service.js';
import { LabController } from './lab.controller.js';
import { LabPositions } from './positions.js';
import { ArrivalSelector } from './selectableArrival.js';
import { BIAS_RUN_MAX, SignSelector } from './selectableSigns.js';
import { LabSession } from './session.js';

/**
 * PH-24.16 acceptance criterion 2: sube / baja on a real venue composed as a Lab.
 */
const asset = ASSET_CATALOGUE[0]!;
const id = asset.definition.id;
const GENESIS = epochMillis(1_776_000_000_000);
const keyring = (): MasterKeyring =>
  MasterKeyring.fromSecret('bias-routes-spec', new Uint8Array(32).fill(29));

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

/** Signs of the non-zero steps after `sequence`. */
function signsAfter(ticks: Tick[], sequence: number): (1 | -1)[] {
  const out: (1 | -1)[] = [];
  let previous: Tick | null = null;
  for (const tick of ticks) {
    if (previous !== null && tick.sequence > sequence) {
      const d = tick.price - previous.price;
      if (d !== 0) out.push(d > 0 ? 1 : -1);
    }
    previous = tick;
  }
  return out;
}

/** Runs of equal signs, in order. */
function runs(signs: (1 | -1)[]): { sign: 1 | -1; length: number }[] {
  const out: { sign: 1 | -1; length: number }[] = [];
  for (const sign of signs) {
    const last = out[out.length - 1];
    if (last !== undefined && last.sign === sign) last.length += 1;
    else out.push({ sign, length: 1 });
  }
  return out;
}

describe('PH-24.16 — sube / baja', () => {
  it('down: the price goes down on balance, not in a line, in runs for the direction and shorter runs against', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 60_000);
    const start = record(lab.venue)[record(lab.venue).length - 1]!;
    const on = (await lab.controller.bias(id, 'down')) as { bias: number | null };
    expect(on.bias).toBe(-1);
    await advance(lab.venue, lab.clock, 180_000);
    const ticks = record(lab.venue);
    const end = ticks[ticks.length - 1]!;
    expect(end.price).toBeLessThan(start.price);
    const signs = signsAfter(ticks, start.sequence);
    expect(signs.length).toBeGreaterThan(20);
    expect(
      signs.some((s) => s === 1),
      'never a tick against the direction: a line',
    ).toBe(true);
    // Runs against the direction are bounded by the run before them (zero-step
    // ticks can only shorten an observed run, never lengthen it).
    const pattern = runs(signs);
    for (let i = 1; i < pattern.length - 1; i += 1) {
      const run = pattern[i]!;
      if (run.sign === 1) expect(run.length).toBeLessThanOrEqual(BIAS_RUN_MAX - 1);
    }
    expect(
      lab.session.toLines().some((l) => /"action":"bias"/.test(l) && /"direction":"down"/.test(l)),
    ).toBe(true);
  });

  it("off: transparent again — the signs are the keystream's, identical to an unbiased venue from the same keyring", async () => {
    const lab = await labVenue();
    const plain = await labVenue(false);
    await advance(lab.venue, lab.clock, 60_000);
    await advance(plain.venue, plain.clock, 60_000);
    await lab.controller.bias(id, 'up');
    await advance(lab.venue, lab.clock, 60_000);
    await advance(plain.venue, plain.clock, 60_000);
    const off = (await lab.controller.bias(id, 'off')) as { bias: number | null; armed: boolean };
    expect(off.bias).toBeNull();
    expect(off.armed).toBe(false);
    const from = record(lab.venue)[record(lab.venue).length - 1]!.sequence;
    await advance(lab.venue, lab.clock, 60_000);
    await advance(plain.venue, plain.clock, 60_000);
    // Lockstep: after the bias the same keystream positions give the same signs,
    // so the steps' signs agree tick for tick from here on.
    const labTicks = record(lab.venue).filter((t) => t.sequence > from);
    const plainTicks = record(plain.venue).filter((t) => t.sequence > from);
    const n = Math.min(labTicks.length, plainTicks.length);
    expect(n).toBeGreaterThan(10);
    const signOf = (ticks: Tick[]): number[] =>
      ticks.slice(1, n).map((t, i) => Math.sign(t.price - ticks[i]!.price));
    expect(signOf(labTicks)).toEqual(signOf(plainTicks));
    // release ends a bias too; a direction that is not one is refused.
    await lab.controller.bias(id, 'down');
    const released = lab.controller.release(id) as { bias: number | null };
    expect(released.bias).toBeNull();
    await expect(lab.controller.bias(id, 'sideways')).rejects.toThrow(/direction must be/);
  });
});
