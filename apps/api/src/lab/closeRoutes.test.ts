import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  logPrice,
  MasterKeyring,
  SteppableClock,
  toDisplayPrice,
  type EpochMillis,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { PublicationService } from '../publication.service.js';
import { VenueService } from '../venue.service.js';
import { closeInstant, readWindow } from './closeControl.js';
import { LabController } from './lab.controller.js';
import { SignSelector } from './selectableSigns.js';
import { LabSession } from './session.js';

/**
 * PH-24.2 acceptance criteria 1–6, on a real venue composed as a Lab.
 *
 * The venue is the production `VenueService` given a `SelectableSigns`
 * factory, exactly as `LabModule` composes it; the clock is stepped; the
 * record is read back from the venue's own feed. "The candle closed there" is
 * asserted as ADR-0017 defines it — the price in force at the candle's end.
 */
const asset = ASSET_CATALOGUE[0]!;
const id = asset.definition.id;
const spec = asset.instrument;
const GENESIS = epochMillis(1_776_000_000_000); // a 1m boundary
const keyring = (): MasterKeyring =>
  MasterKeyring.fromSecret('close-routes-spec', new Uint8Array(32).fill(13));

interface Applied {
  armed: boolean;
  target: number;
  instant: number;
  ticksInWindow: number;
  reachability: string;
}

async function labVenue(withSelector = true) {
  const clock = new SteppableClock(GENESIS);
  const selector = new SignSelector();
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
  const controller = new LabController(venue, selector, new LabSession());
  return { venue, clock, controller, selector };
}

/** Advance in steps inside the catch-up bound. */
async function advance(venue: VenueService, clock: SteppableClock, ms: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, 10_000);
    clock.advance(durationMillis(step));
    await venue.tick();
    left -= step;
  }
}

/** The price in force at `instant`: the last published tick at or before it (ADR-0017). */
function inForceAt(venue: VenueService, instant: EpochMillis): Tick | null {
  let last: Tick | null = null;
  for (const tick of venue.feed.since(id, 1)) {
    if (tick.instant <= instant) last = tick;
    else break;
  }
  return last;
}

/** A target any sign vector reaches: the alternating assignment over the window's steps. */
function reachableTarget(
  venue: VenueService,
  instant: EpochMillis,
): { level: number; price: string; ticks: number } {
  const window = readWindow(venue.labFork(id)!, instant);
  const sum = window.steps.reduce((acc, step, i) => acc + (i % 2 === 0 ? step : -step), 0);
  const level = window.fromPrice + sum;
  return {
    level,
    price: toDisplayPrice(spec, logPrice(level)).toFixed(spec.displayPrecision),
    ticks: window.steps.length,
  };
}

describe('Candle Close Control on a real candle (PH-24.2)', () => {
  it('1. closes the current candle exactly where it was told to', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const now = venue.now();
    const instant = closeInstant(now, '1m', 'current');
    const target = reachableTarget(venue, instant);
    expect(target.ticks).toBeGreaterThan(3);

    const applied = (await controller.applyClose(id, target.price, 'current', '1m')) as Applied;
    expect(applied.armed).toBe(true);
    expect(applied.target).toBe(target.level);
    expect(applied.instant).toBe(instant);
    // 4. The window the route saw is the window the test read: same pending alignment.
    expect(applied.ticksInWindow).toBe(target.ticks);

    await advance(venue, clock, instant - now + 5_000);
    const close = inForceAt(venue, instant);
    expect(close, 'no tick published inside the candle').not.toBeNull();
    expect(close!.price, 'the candle did not close on the target').toBe(target.level);
    // And the control route says what became of it, read the way settlement reads.
    const control = controller.control(id) as {
      lastApplied: { target: number; closed: number | null; exact: boolean | null };
    };
    expect(control.lastApplied.closed).toBe(target.level);
    expect(control.lastApplied.exact).toBe(true);
    await venue.stop();
  }, 60_000);

  it('2. closes the next candle exactly where it was told to', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const now = venue.now();
    const instant = closeInstant(now, '1m', 'next');
    const target = reachableTarget(venue, instant);
    const applied = (await controller.applyClose(id, target.price, 'next', '1m')) as Applied;
    expect(applied.armed).toBe(true);
    await advance(venue, clock, instant - now + 5_000);
    expect(inForceAt(venue, instant)!.price).toBe(target.level);
    await venue.stop();
  }, 60_000);

  it('3. refuses a price between levels with both neighbours, and arms nothing', async () => {
    const { venue, clock, controller, selector } = await labVenue();
    await advance(venue, clock, 5_000);
    const below = toDisplayPrice(spec, logPrice(venue.labFork(id)!.price));
    const above = toDisplayPrice(spec, logPrice(venue.labFork(id)!.price + 1));
    const between = ((below + above) / 2).toFixed(spec.displayPrecision);
    await expect(controller.applyClose(id, between, 'current', '1m')).rejects.toMatchObject({
      status: 409,
    });
    expect(selector.for(id)!.armed).toBe(false);
    await venue.stop();
  });

  it("5. released mid-window, the market is the keystream's again with no jump", async () => {
    const lab = await labVenue();
    const plain = await labVenue(false);
    await advance(lab.venue, lab.clock, 20_000);
    await advance(plain.venue, plain.clock, 20_000);
    const instant = closeInstant(lab.venue.now(), '1m', 'next');
    const target = reachableTarget(lab.venue, instant);
    const applied = (await lab.controller.applyClose(id, target.price, 'next', '1m')) as Applied;
    expect(applied.armed).toBe(true);
    await advance(lab.venue, lab.clock, 20_000);
    await advance(plain.venue, plain.clock, 20_000);
    const released = lab.controller.release(id) as {
      discarded: number;
      armed: boolean;
      pendingTick: number | null;
    };
    expect(released.discarded).toBeGreaterThan(0);
    expect(released.armed).toBe(false);
    // Lockstep: the cursors agree, so what follows is the keystream's — same
    // instants and same signed steps as a venue that was never armed.
    expect(lab.venue.hostedMarket(id)!.snapshotEngine().cursors).toEqual(
      plain.venue.hostedMarket(id)!.snapshotEngine().cursors,
    );
    // A tick already drawn when the release happened is published as drawn —
    // its coin was tossed under the script, and nothing un-tosses a coin. The
    // keystream resumes with the *next draw*, which is where the comparison
    // starts. The route says so (`pendingTick`), because an operator watching
    // the chart would otherwise see one more scripted tick and call it a bug.
    const fromLab = (lab.venue.hostedMarket(id)!.pending ??
      lab.venue.hostedMarket(id)!.lastPublished)!;
    const fromPlain = (plain.venue.hostedMarket(id)!.pending ??
      plain.venue.hostedMarket(id)!.lastPublished)!;
    expect(released.pendingTick).toBe(lab.venue.hostedMarket(id)!.pending?.sequence ?? null);
    await advance(lab.venue, lab.clock, 60_000);
    await advance(plain.venue, plain.clock, 60_000);
    const a = lab.venue.feed.since(id, fromLab.sequence + 1);
    const b = plain.venue.feed.since(id, fromPlain.sequence + 1);
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(5);
    let pa = fromLab.price;
    let pb = fromPlain.price;
    for (const [i, tick] of a.entries()) {
      expect(tick.instant, `instant ${i}`).toBe(b[i]!.instant);
      expect(tick.price - pa, `signed step ${i}`).toBe(b[i]!.price - pb);
      pa = tick.price;
      pb = b[i]!.price;
    }
    await lab.venue.stop();
    await plain.venue.stop();
  }, 60_000);

  it('6. records every apply and release in the Lab timeline, with §78 fields, and nothing in the engine one', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const instant = closeInstant(venue.now(), '1m', 'next');
    const target = reachableTarget(venue, instant);
    await controller.applyClose(id, target.price, 'next', '1m');
    controller.release(id);
    const timelines = controller.sessionTimelines() as {
      engine: unknown[];
      lab: Record<string, unknown>[];
    };
    expect(timelines.engine).toEqual([]);
    expect(timelines.lab.map((a) => a['action'])).toEqual(['close.apply', 'release']);
    for (const action of timelines.lab) {
      for (const field of [
        'at',
        'asset',
        'engineVersion',
        'action',
        'parameters',
        'initialState',
        'resultingState',
        'succeeded',
        'diagnostics',
      ]) {
        expect(action, `${String(action['action'])} lacks ${field}`).toHaveProperty(field);
      }
    }
    expect(
      (timelines.lab[0]!['diagnostics'] as { acceptanceRate: number }).acceptanceRate,
    ).toBeGreaterThan(0);
    await venue.stop();
  }, 60_000);

  it('says what it is in every response (§3)', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const instant = closeInstant(venue.now(), '1m', 'next');
    const target = reachableTarget(venue, instant);
    const responses: unknown[] = [
      controller.closePreview(id, target.price, 'next', '1m'),
      await controller.applyClose(id, target.price, 'next', '1m'),
      controller.control(id),
      controller.release(id),
      controller.sessionTimelines(),
    ];
    for (const response of responses) {
      expect(response).toHaveProperty('environment', 'OTC LAB — SIMULATION ENVIRONMENT');
    }
    await venue.stop();
  }, 60_000);

  it('PH-24.3: a preset closes a position the way it says, and the production settlement agrees', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const opened = controller.openPosition(id, 'up', '100', '60000') as {
      position: { id: string; expiryInstant: number; entryPrice: number };
    };
    const position = opened.position;
    expect(position.expiryInstant).toBe(venue.now() + 60_000);

    let applied = (await controller.applyPreset(id, position.id, 'win-minimum')) as Applied & {
      impossible: string | null;
      reachableNeighbours: readonly string[] | null;
    };
    if (!applied.armed) {
      // Parity refused entry + 1; the preset names entry and entry + 2. "Minimum"
      // is not redefined — the test takes the reachable neighbour above entry,
      // through the close control addressed to the position's expiry.
      expect(applied.impossible).toMatch(/parity/);
      expect(applied.reachableNeighbours).toHaveLength(2);
      applied = (await controller.applyClose(
        id,
        applied.reachableNeighbours![1],
        undefined,
        undefined,
        String(position.expiryInstant),
      )) as typeof applied;
    }
    expect(applied.armed).toBe(true);
    expect(applied.instant).toBe(position.expiryInstant);

    // Expected rests on the armed target and says so.
    const listed = controller.listPositions(id) as {
      positions: { id: string; expected: { outcome: string; basis: string }; actual: unknown }[];
    };
    const row = listed.positions.find((p) => p.id === position.id)!;
    expect(row.expected).toMatchObject({ outcome: 'win', basis: 'armed-target' });
    expect(row.actual).toBeNull();

    await advance(venue, clock, 70_000);
    const after = controller.listPositions(id) as {
      positions: {
        id: string;
        actual: { outcome: string; agrees: boolean; expiryPrice: number } | null;
      }[];
    };
    const settled = after.positions.find((p) => p.id === position.id)!.actual!;
    expect(settled.outcome).toBe('win');
    expect(settled.agrees).toBe(true);
    expect(settled.expiryPrice).toBe(applied.target);
    await venue.stop();
  }, 60_000);

  it('PH-24.3: settles a position on a feed whose window does not start at sequence 1', async () => {
    // The long-running Lab's case: restarted, its feed retains only what it
    // published since. The first `recordTicks` guessed at the window and built a
    // record that began after every entry, so `settle` refused for ever.
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 30_000);
    venue.feed.forget(id, 'test: the window restarts late');
    await advance(venue, clock, 10_000);
    expect(venue.feed.retained(id)!.oldest).toBeGreaterThan(1);
    const opened = controller.openPosition(id, 'up', '50', '30000') as { position: { id: string } };
    await advance(venue, clock, 40_000);
    const after = controller.listPositions(id) as {
      positions: { id: string; actual: { outcome: string } | null }[];
    };
    const row = after.positions.find((p) => p.id === opened.position.id)!;
    expect(row.actual, 'settlement never happened on a late-starting feed').not.toBeNull();
    expect(['win', 'loss', 'refund']).toContain(row.actual!.outcome);
    await venue.stop();
  }, 60_000);

  it('PH-24.3: refuses a preset on an unknown or expired position, and a bad name', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    await expect(controller.applyPreset(id, 'lab-99', 'tie')).rejects.toMatchObject({
      status: 404,
    });
    const opened = controller.openPosition(id, 'down', '10', '5000') as {
      position: { id: string };
    };
    await expect(controller.applyPreset(id, opened.position.id, 'nonsense')).rejects.toMatchObject({
      status: 400,
    });
    await advance(venue, clock, 10_000);
    await expect(controller.applyPreset(id, opened.position.id, 'tie')).rejects.toMatchObject({
      status: 409,
    });
    await venue.stop();
  }, 60_000);

  it('answers 409 when the process was not composed as a Lab', async () => {
    const { venue, clock, controller } = await labVenue(false);
    await advance(venue, clock, 5_000);
    await expect(controller.applyClose(id, '1.0800000', 'current', '1m')).rejects.toMatchObject({
      status: 409,
    });
    await venue.stop();
  });
});
