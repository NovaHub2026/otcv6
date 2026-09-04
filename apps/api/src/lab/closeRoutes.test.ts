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
import { closeInstant, readWindow, resolveTarget } from './closeControl.js';
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

    const applied = (await controller.applyPreset(id, position.id, 'win-minimum')) as Applied & {
      impossible: string | null;
      reachableNeighbours: readonly string[] | null;
      adjusted: { requested: string; applied: string; why: string } | null;
    };
    // Parity refuses entry + 1 half the time. PH-24.17: the apply then arms the
    // reachable neighbour on the requested side — entry + 2 — and says so;
    // "minimum" is not redefined, the request is answered with the nearest
    // reachable level and the adjustment named.
    if (applied.adjusted !== null) {
      expect(applied.adjusted.why).toBe('parity');
      expect(applied.adjusted.requested).not.toBe(applied.adjusted.applied);
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

  it('PH-24.5: refuses a non-natural close by name, and never appends a tick to a feed', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    await expect(
      controller.applyClose(id, '1.0800000', 'current', '1m', undefined, '1'),
    ).rejects.toMatchObject({ status: 400 });
    // The preview route is synchronous: it throws rather than rejecting.
    expect(() => controller.closePreview(id, '1.0800000', 'current', '1m', undefined, '1')).toThrow(
      /nonNatural is not available/,
    );
    // And the session's closes diagnostic says what it rests on.
    const closes = controller.sessionCloses() as { verdict: string; controlled: number };
    expect(closes.verdict).toBe('too-few-to-say');
    expect(closes.controlled).toBe(0);
    await venue.stop();
  });

  it('PH-24.6: a relative close — N lattice steps from where the market stands — is a close like any other', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const from = venue.hostedMarket(id)!.snapshotEngine().price;
    // Preview at +2 and -2: the target is the engine's price plus the delta, and
    // one of the two parities is reachable in any window with ticks in it.
    const up = controller.closePreview(
      id,
      undefined,
      'next',
      '1m',
      undefined,
      undefined,
      '2',
    ) as Applied & { target: number; fromPrice: number };
    const down = controller.closePreview(
      id,
      undefined,
      'next',
      '1m',
      undefined,
      undefined,
      '-2',
    ) as Applied & { target: number };
    expect(up.target).toBe(from + 2);
    expect(down.target).toBe(from - 2);
    expect(up.fromPrice).toBe(from);
    expect(up.armed).toBe(false);
    const plus1 = controller.closePreview(
      id,
      undefined,
      'next',
      '1m',
      undefined,
      undefined,
      '1',
    ) as Applied & {
      target: number;
      impossible: string | null;
    };
    const reachable = plus1.impossible === null ? '1' : '2';
    const applied = (await controller.applyClose(
      id,
      undefined,
      'next',
      '1m',
      undefined,
      undefined,
      reachable,
    )) as Applied & { target: number };
    expect(applied.armed).toBe(true);
    expect(applied.target).toBe(from + Number(reachable));
    // Neither a price nor a delta is refused by name; a fractional delta too.
    expect(() => controller.closePreview(id, undefined, 'next', '1m')).toThrow(/price .* or delta/);
    expect(() =>
      controller.closePreview(id, undefined, 'next', '1m', undefined, undefined, '1.5'),
    ).toThrow(/whole number/);
    await venue.stop();
  }, 60_000);

  it('PH-24.8: names a close whose settlement tick lands exactly on the boundary (ADR-0017)', async () => {
    // Constructed, not hoped for: the fork says when the next ticks come, so the
    // expiry is set to the instant of the third one — the window's last tick lands
    // exactly on it, and the chart's candle would show that tick as the next
    // candle's open. The target is the fork's own price there, so the close is
    // reachable in one draw. A second close expiring between ticks is not marked.
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const fork = venue.labFork(id)!;
    const upcoming = [fork.next()!, fork.next()!, fork.next()!];
    const third = upcoming[2]!;
    const applied = (await controller.applyClose(
      id,
      undefined,
      undefined,
      undefined,
      String(third.instant),
      undefined,
      String(third.price - fork.price),
    )) as Applied & { target: number };
    expect(applied.armed).toBe(true);
    expect(applied.target).toBe(third.price);
    await advance(venue, clock, third.instant - venue.now() + 5_000);
    const marked = controller.control(id) as {
      lastApplied: { exact: boolean | null; onBoundary?: boolean };
    };
    expect(marked.lastApplied.exact).toBe(true);
    expect(marked.lastApplied.onBoundary, 'a settlement tick on the boundary was not named').toBe(
      true,
    );

    // Between two ticks: settled on the tick before, not on the boundary.
    const fork2 = venue.labFork(id)!;
    const a = fork2.next()!;
    const b = fork2.next()!;
    const between = Math.floor((a.instant + b.instant) / 2);
    expect(between).toBeGreaterThan(a.instant);
    const applied2 = (await controller.applyClose(
      id,
      undefined,
      undefined,
      undefined,
      String(between),
      undefined,
      String(a.price - fork2.price),
    )) as Applied;
    expect(applied2.armed).toBe(true);
    await advance(venue, clock, between - venue.now() + 5_000);
    const unmarked = controller.control(id) as {
      lastApplied: { exact: boolean | null; onBoundary?: boolean };
    };
    expect(unmarked.lastApplied.exact).toBe(true);
    expect(unmarked.lastApplied.onBoundary).toBe(false);
    await venue.stop();
  }, 60_000);

  it('PH-24.9: reports every market at once and releases them all, one action per market', async () => {
    const two = ASSET_CATALOGUE.slice(0, 2);
    const clock = new SteppableClock(GENESIS);
    const selector = new SignSelector();
    const venue = new VenueService(
      new MemoryStateStore(),
      keyring(),
      clock,
      [...two],
      5_000,
      new PublicationService([...two]),
      null,
      null,
      0,
      (keystream, assetId) => selector.wrap(keystream, assetId),
    );
    await venue.start();
    const controller = new LabController(venue, selector, new LabSession());
    await advance(venue, clock, 20_000);
    const ids = two.map((a) => a.definition.id);
    for (const assetId of ids) {
      const plus1 = controller.closePreview(
        assetId,
        undefined,
        'next',
        '1m',
        undefined,
        undefined,
        '1',
      ) as Applied & { impossible: string | null };
      const reachable = plus1.impossible === null ? '1' : '2';
      const applied = (await controller.applyClose(
        assetId,
        undefined,
        'next',
        '1m',
        undefined,
        undefined,
        reachable,
      )) as Applied;
      expect(applied.armed).toBe(true);
    }
    const all = controller.controlAll() as {
      markets: {
        id: string;
        armed: boolean;
        price: string | null;
        regime: string | null;
        openPositions: number;
      }[];
    };
    expect(all.markets.map((m) => m.id).sort()).toEqual([...ids].sort());
    for (const market of all.markets) {
      expect(market.armed).toBe(true);
      expect(market.price).toMatch(/^[0-9]+\.[0-9]+$/);
      expect(market.regime).not.toBeNull();
      expect(market.openPositions).toBe(0);
    }
    const released = controller.releaseAll() as { released: { id: string; discarded: number }[] };
    expect(released.released.map((r) => r.id).sort()).toEqual([...ids].sort());
    for (const r of released.released) expect(r.discarded).toBeGreaterThan(0);
    const after = controller.controlAll() as { markets: { armed: boolean }[] };
    expect(after.markets.every((m) => !m.armed)).toBe(true);
    const timelines = controller.sessionTimelines() as {
      lab: { action: string; asset: string; parameters: Record<string, unknown> }[];
    };
    const releases = timelines.lab.filter((a) => a.action === 'release');
    expect(releases.map((a) => a.asset).sort()).toEqual([...ids].sort());
    expect(releases.every((a) => a.parameters['all'] === true)).toBe(true);
    // A second release-all releases nothing and records nothing.
    expect((controller.releaseAll() as { released: unknown[] }).released).toEqual([]);
    await venue.stop();
  }, 60_000);

  it("PH-24.21: a close on a side of a mark — above by a selected path, below by the market's own when it already ends there; a side no close is on is refused by name", async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const now = venue.now();
    const instant = closeInstant(now, '1m', 'current');
    const state = controller.state(id) as { latticeLevel: number; price: string };
    type Sided = Applied & { condition: string; mark: string; natural: boolean; attempts: number };
    // Above the price now: the candle must end higher than where it stands, crossing allowed.
    const above = (await controller.applyClose(
      id,
      state.price,
      'current',
      '1m',
      undefined,
      undefined,
      undefined,
      'above',
    )) as Sided;
    expect(above.armed).toBe(true);
    expect(above.condition).toBe('above');
    expect(above.mark).toBe(state.price);
    expect(above.target).toBeGreaterThan(state.latticeLevel);
    await advance(venue, clock, instant - now + 5_000);
    const close = inForceAt(venue, instant);
    expect(close, 'no tick published inside the candle').not.toBeNull();
    expect(close!.price, 'the candle did not close above the mark').toBeGreaterThan(
      state.latticeLevel,
    );
    expect(close!.price).toBe(above.target);
    const control = controller.control(id) as { lastApplied: { exact: boolean | null } };
    expect(control.lastApplied.exact).toBe(true);

    // Below a mark far above the price: every natural path already ends there, so the
    // market's own path is armed as is — zero attempts, nothing chosen.
    const later = venue.now();
    const nextInstant = closeInstant(later, '1m', 'next');
    const price = Number((controller.state(id) as { price: string }).price);
    const farAbove = (price * 1.01).toFixed(asset.instrument.displayPrecision);
    const below = (await controller.applyClose(
      id,
      farAbove,
      'next',
      '1m',
      undefined,
      undefined,
      undefined,
      'below',
    )) as Sided;
    expect(below.armed).toBe(true);
    expect(below.natural).toBe(true);
    expect(below.attempts).toBe(0);
    const markLevel = resolveTarget(asset.instrument, below.mark);
    expect(markLevel.kind).toBe('level');
    expect(below.target).toBeLessThan((markLevel as { level: number }).level);
    await advance(venue, clock, nextInstant - later + 5_000);
    const closedBelow = inForceAt(venue, nextInstant);
    expect(closedBelow!.price).toBe(below.target);

    // A side no attainable close is on: refused by name, nothing armed.
    const last = venue.now();
    const soon = closeInstant(last, '1m', 'current');
    const unreachable = (price * 0.9).toFixed(asset.instrument.displayPrecision);
    const refused = (await controller.applyClose(
      id,
      unreachable,
      'current',
      '1m',
      undefined,
      undefined,
      undefined,
      'below',
    )) as Sided & { impossible: string | null };
    expect(refused.armed).toBe(false);
    expect(refused.impossible).toMatch(/no close within that range satisfies/);
    expect(soon).toBeGreaterThan(last);
    // And a condition that is not a side.
    await expect(
      controller.applyClose(
        id,
        state.price,
        'current',
        '1m',
        undefined,
        undefined,
        undefined,
        'sideways',
      ),
    ).rejects.toThrow(/condition must be/);
    await venue.stop();
  }, 60_000);

  it('Cycle Audit 8 (a8): refuses a close whose window would hold the engine, rather than walking it', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const state = controller.state(id) as { price: string };
    // A day's window: 355,392 ticks at this market's grain. One unauthenticated
    // GET of this shape measured 121 seconds of blocked event loop, and the Lab
    // process *is* the engine — tick generation, publication and /health with it.
    const started = Date.now();
    await expect(controller.applyClose(id, state.price, 'next', '1d')).rejects.toThrow(
      /WINDOW_TOO_LONG|timeframe must be/,
    );
    // Bounded: whatever it answered, it answered quickly.
    expect(Date.now() - started, 'the refusal itself took seconds').toBeLessThan(30_000);

    // The preview form, addressed by a far instant, is bounded the same way.
    const far = String(venue.now() + 30 * 86_400_000);
    const preview = (): unknown =>
      controller.closePreview(id, state.price, undefined, undefined, far);
    expect(preview).toThrow(/WINDOW_TOO_LONG/);
    // And a close an operator actually addresses still works.
    const near = (await controller.applyClose(id, state.price, 'next', '1m')) as { armed: boolean };
    expect(near.armed).toBe(true);
    await venue.stop();
  }, 120_000);

  it('Cycle Audit 8 (a8): tells a settled position from one still waiting and one the window dropped', async () => {
    /**
     * `actual` was a settlement or null, and null meant either of two opposite
     * things: "not expired yet, ask again" and "the entry is no longer in the
     * retained window, so this will never settle". The panel showed both as a
     * position pending for ever. The view now carries the record's own answer.
     */
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 20_000);
    const opened = controller.openPosition(id, 'up', '100', '60000') as {
      position: { id: string };
    };
    type Row = {
      id: string;
      actual: unknown;
      settlement: { kind: string; reason?: string } | null;
    };
    const rowNow = (): Row =>
      (controller.listPositions(id) as { positions: Row[] }).positions.find(
        (p) => p.id === opened.position.id,
      )!;

    // Before the expiry: nothing to say yet, and the view says so rather than
    // showing the same null an unsettleable entry would show.
    expect(rowNow().settlement).toBeNull();

    await advance(venue, clock, 70_000);
    const settled = rowNow();
    expect(settled.settlement).toEqual({ kind: 'settled' });
    expect(settled.actual).not.toBeNull();

    // Now drop the window the entry lived in and let the feed refill past it.
    venue.feed.forget(id, 'test: the entry falls out of the retained window');
    await advance(venue, clock, 10_000);
    const dropped = rowNow();
    expect(dropped.actual, 'an evicted entry cannot be settled').toBeNull();
    expect(dropped.settlement!.kind).toBe('evicted');
    // With `settle`'s own wording, so the panel is not paraphrasing the kernel.
    expect(dropped.settlement!.reason!.length).toBeGreaterThan(0);
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

  it('PH-24.17: an apply on an off-parity price arms the reachable neighbour on the requested side, and says so', async () => {
    const { venue, clock, controller } = await labVenue();
    await advance(venue, clock, 120_000);
    // Find a delta that a preview refuses by parity, then apply it.
    let refused: number | null = null;
    for (const delta of [1, 2, 3, 4]) {
      const preview = (await controller.closePreview(
        id,
        undefined,
        'next',
        '1m',
        undefined,
        undefined,
        String(delta),
      )) as { impossible: string | null };
      if (preview.impossible !== null && /parity/.test(preview.impossible)) {
        refused = delta;
        break;
      }
    }
    expect(refused, 'no delta in 1..4 was off-parity').not.toBeNull();
    const applied = (await controller.applyClose(
      id,
      undefined,
      'next',
      '1m',
      undefined,
      undefined,
      String(refused!),
    )) as Applied & {
      adjusted: { requested: string; applied: string; why: string } | null;
      delta: number;
    };
    expect(applied.armed).toBe(true);
    expect(applied.adjusted).not.toBeNull();
    expect(applied.adjusted!.why).toBe('parity');
    // Upward request → the neighbour above: one lattice step beyond the request.
    expect(applied.delta).toBe(refused! + 1);
    await venue.stop();
  }, 60_000);
});
