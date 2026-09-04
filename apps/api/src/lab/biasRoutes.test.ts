import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock, type Tick } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { PublicationService } from '../publication.service.js';
import { VenueService } from '../venue.service.js';
import { LabController } from './lab.controller.js';
import { LabPositions } from './positions.js';
import { ArrivalSelector } from './selectableArrival.js';
import { BIAS_MAX_MS, SignSelector } from './selectableSigns.js';
import { LabSession } from './session.js';

/**
 * PH-24.16 acceptance criterion 2: sube / baja on a real venue composed as a Lab.
 * PH-24.24: and the cap that makes a sustained direction end by itself.
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
    const on = (await lab.controller.bias(id, 'down')) as {
      bias: number | null;
      runs: { min: number; max: number } | null;
    };
    expect(on.bias).toBe(-1);
    // PH-24.18: runs are one to three seconds of the market's pace, never under two ticks.
    const mean = asset.evidence.meanIntervalMs;
    const runMin = Math.max(2, Math.round(1_000 / mean));
    expect(on.runs).toEqual({ min: runMin, max: Math.max(runMin + 1, Math.round(3_000 / mean)) });
    // Inside the two-minute cap (PH-24.24), so this is the biased stretch alone.
    await advance(lab.venue, lab.clock, 100_000);
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
      if (run.sign === 1) expect(run.length).toBeLessThanOrEqual(on.runs!.max - 1);
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

  it('PH-24.24: a bias turns itself off after two minutes of market time, leaves no residue, and the session says so', async () => {
    const lab = await labVenue();
    const plain = await labVenue(false);
    await advance(lab.venue, lab.clock, 60_000);
    await advance(plain.venue, plain.clock, 60_000);
    const on = (await lab.controller.bias(id, 'up')) as {
      bias: number | null;
      expiresInMs: number | null;
      biasMsLeft: number;
    };
    // The cap is stated where the act is, in the unit the operator asked for.
    expect(on.expiresInMs).toBe(BIAS_MAX_MS);
    expect(on.biasMsLeft).toBe(BIAS_MAX_MS);

    // Halfway: still biased, and visibly running out.
    await advance(lab.venue, lab.clock, 60_000);
    await advance(plain.venue, plain.clock, 60_000);
    const midway = lab.controller.control(id) as { bias: number | null; biasMsLeft: number };
    expect(midway.bias).toBe(1);
    expect(midway.biasMsLeft).toBeGreaterThan(0);
    expect(midway.biasMsLeft).toBeLessThan(BIAS_MAX_MS);
    expect(
      lab.session.toLines().some((l) => /"action":"bias.expired"/.test(l)),
      'expired while it was still running',
    ).toBe(false);

    // Past the cap: off, by itself, with nobody having asked.
    await advance(lab.venue, lab.clock, 90_000);
    await advance(plain.venue, plain.clock, 90_000);
    const from = record(lab.venue)[record(lab.venue).length - 1]!.sequence;
    const after = lab.controller.control(id) as { bias: number | null; biasMsLeft: number };
    expect(after.bias).toBeNull();
    expect(after.biasMsLeft).toBe(0);
    expect(lab.selector.for(id)!.armed).toBe(false);
    expect(
      lab.session.toLines().some((l) => /"action":"bias.expired"/.test(l) && /"up"/.test(l)),
    ).toBe(true);
    // Recorded once, however often the control is read.
    lab.controller.control(id);
    lab.controller.controlAll();
    expect(lab.session.toLines().filter((l) => /"action":"bias.expired"/.test(l))).toHaveLength(1);

    // No residue: from here the signs are the keystream's, tick for tick.
    await advance(lab.venue, lab.clock, 60_000);
    await advance(plain.venue, plain.clock, 60_000);
    const labTicks = record(lab.venue).filter((t) => t.sequence > from);
    const plainTicks = record(plain.venue).filter((t) => t.sequence > from);
    const n = Math.min(labTicks.length, plainTicks.length);
    expect(n).toBeGreaterThan(10);
    const signOf = (ticks: Tick[]): number[] =>
      ticks.slice(1, n).map((t, i) => Math.sign(t.price - ticks[i]!.price));
    expect(signOf(labTicks)).toEqual(signOf(plainTicks));
  });

  it('PH-24.24: the deadline is the moment, not the next tick — the control says so with nothing drawn since', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 60_000);
    await lab.controller.bias(id, 'down');
    const before = record(lab.venue).length;
    // The clock passes the deadline; the market draws nothing in between.
    lab.clock.advance(durationMillis(BIAS_MAX_MS + 1_000));
    expect(record(lab.venue)).toHaveLength(before);
    const atDeadline = lab.controller.control(id) as { bias: number | null; biasMsLeft: number };
    // A screen that says a market is being pushed when it is not is the failure
    // this cap exists to end, so the getter answers on the clock, not on a draw.
    expect(atDeadline.bias, 'expired but still reported as biased').toBeNull();
    expect(atDeadline.biasMsLeft).toBe(0);
    expect(lab.selector.for(id)!.bias).toBeNull();
    expect(lab.session.toLines().filter((l) => /"action":"bias.expired"/.test(l))).toHaveLength(1);
  });

  it('PH-24.24: a push does not end the sustained direction — it plays first and the bias continues, on the same deadline', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 60_000);
    const set = lab.venue.now();
    await lab.controller.bias(id, 'down');
    // A push retracts the pending tick, a retract restores, and a restore seeks:
    // until PH-24.24 that seek released the bias with the script, so the ⓘ's
    // promise that "el sesgo continúa después" was false and the notice then
    // wrote a two-minute expiry that had never happened.
    await advance(lab.venue, lab.clock, 20_000);
    await lab.controller.push(id, '+3');
    expect(lab.selector.for(id)!.bias, 'the push ended the sustained direction').toBe(-1);
    const during = lab.controller.control(id) as { bias: number | null; biasMsLeft: number };
    expect(during.bias).toBe(-1);
    // On the same deadline: a push does not extend a bias, and does not shorten it.
    expect(during.biasMsLeft).toBe(BIAS_MAX_MS - (lab.venue.now() - set));
    expect(lab.session.toLines().some((l) => /"action":"bias.expired"/.test(l))).toBe(false);
    // And it still ends by itself, two minutes after it was set.
    lab.clock.advance(durationMillis(BIAS_MAX_MS));
    expect((lab.controller.control(id) as { bias: number | null }).bias).toBeNull();
    const expired = lab.session
      .toLines()
      .filter((l) => /"action":"bias.expired"/.test(l))
      .map((l) => JSON.parse(l) as { at: number; initialState: { bias: number | null } });
    expect(expired).toHaveLength(1);
    // The record is a transition, at the instant it really ended.
    expect(expired[0]!.at).toBe(set + BIAS_MAX_MS);
    expect(expired[0]!.initialState.bias).toBe(-1);
  });

  it('PH-24.24: an expiry is recorded even when the act that follows would erase it', async () => {
    for (const ending of ['off', 'release', 'release-all'] as const) {
      const lab = await labVenue();
      await advance(lab.venue, lab.clock, 60_000);
      await lab.controller.bias(id, 'up');
      // Nobody reads the control; the bias runs out; the operator then acts.
      lab.clock.advance(durationMillis(BIAS_MAX_MS + 1_000));
      if (ending === 'off') await lab.controller.bias(id, 'off');
      else if (ending === 'release') lab.controller.release(id);
      else lab.controller.releaseAll();
      expect(
        lab.session.toLines().filter((l) => /"action":"bias.expired"/.test(l)),
        `${ending} swallowed the expiry`,
      ).toHaveLength(1);
    }
  });

  it('PH-24.24: a bias ended by a request is not recorded as an expiry, and no bias can be set without a cap', async () => {
    const lab = await labVenue();
    await advance(lab.venue, lab.clock, 60_000);
    // Read the control while each bias is on, as the panel does every second:
    // otherwise nothing has noticed the bias and the notice has nothing to claim
    // — which is how a plant that recorded a release as an expiry survived.
    await lab.controller.bias(id, 'up');
    expect((lab.controller.control(id) as { bias: number | null }).bias).toBe(1);
    await lab.controller.bias(id, 'off');
    lab.controller.control(id);
    expect(lab.session.toLines().some((l) => /"action":"bias.expired"/.test(l))).toBe(false);
    await lab.controller.bias(id, 'down');
    expect((lab.controller.control(id) as { bias: number | null }).bias).toBe(-1);
    lab.controller.release(id);
    lab.controller.control(id);
    expect(lab.session.toLines().some((l) => /"action":"bias.expired"/.test(l))).toBe(false);
    // And the board notices an expiry on a market nobody has selected.
    await lab.controller.bias(id, 'up');
    lab.controller.controlAll();
    lab.clock.advance(durationMillis(BIAS_MAX_MS + 1_000));
    lab.controller.controlAll();
    expect(lab.session.toLines().filter((l) => /"action":"bias.expired"/.test(l))).toHaveLength(1);
    // Releasing every market releases a bias too: a market carrying only a
    // sustained direction used to be skipped here, which left running exactly
    // the act the operator most wanted off.
    await lab.controller.bias(id, 'down');
    expect(lab.selector.for(id)!.bias).toBe(-1);
    const releasedAll = lab.controller.releaseAll() as { released: { id: string }[] };
    expect(releasedAll.released.map((r) => r.id)).toContain(id);
    expect(lab.selector.for(id)!.bias).toBeNull();
    expect((lab.controller.control(id) as { bias: number | null }).bias).toBeNull();
    // And it was a request, so nothing claims it as an expiry.
    expect(lab.session.toLines().filter((l) => /"action":"bias.expired"/.test(l))).toHaveLength(1);

    // The cap is not optional, and not zero.
    const wrapper = lab.selector.for(id)!;
    const random = lab.venue.labRandom(id);
    const now = (): number => lab.venue.now();
    expect(() => wrapper.setBias(1, random, { min: 2, max: 6 }, { at: now(), now })).toThrow(
      /must expire/,
    );
    expect(() =>
      wrapper.setBias(1, random, { min: 2, max: 6 }, { at: now() - 1_000, now }),
    ).toThrow(/must expire/);
  });
});
