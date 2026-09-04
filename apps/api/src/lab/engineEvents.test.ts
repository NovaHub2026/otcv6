import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { PublicationService } from '../publication.service.js';
import { VenueService } from '../venue.service.js';
import { EngineEventObserver } from './engineEvents.js';
import { LabSession } from './session.js';

/**
 * PH-24.5 §4: the engine's timeline is fed by watching the engine, and only the
 * engine's behaviour reaches it.
 */
const asset = ASSET_CATALOGUE[0]!;
const GENESIS = epochMillis(1_776_000_000_000);

async function venueAndSession() {
  const clock = new SteppableClock(GENESIS);
  const venue = new VenueService(
    new MemoryStateStore(),
    MasterKeyring.fromSecret('engine-events-spec', new Uint8Array(32).fill(19)),
    clock,
    [asset],
    5_000,
    new PublicationService([asset]),
  );
  await venue.start();
  const session = new LabSession();
  return { venue, clock, session, observer: new EngineEventObserver(venue, session) };
}

/**
 * A venue whose engine snapshot a test sets by hand.
 *
 * The real venue is what the tests around this one drive, and it is the honest
 * subject — but ten simulated minutes of a seeded market contain the
 * transitions it happens to contain, so a branch that never fires there can be
 * deleted with the suite green. This one fires each of them on demand.
 */
function drivenVenue(): {
  venue: VenueService;
  set: (next: Partial<{ regime: string; phase: string; stalled: boolean }>) => void;
} {
  let state = { regime: 'normal', phase: 'neutral', stalled: false };
  const venue = {
    get assetIds(): readonly string[] {
      return ['eurusd'];
    },
    get stalledMarkets(): readonly { assetId: string; reason: string }[] {
      return state.stalled ? [{ assetId: 'eurusd', reason: 'catch-up bound' }] : [];
    },
    hostedMarket: () => ({
      snapshotEngine: () => ({
        magnitudeState: { modulators: [{ regime: state.regime }, { phase: state.phase }] },
      }),
    }),
  } as unknown as VenueService;
  return {
    venue,
    set: (next) => {
      state = { ...state, ...next };
    },
  };
}

describe('the engine-event observer', () => {
  it('records where things stand on first sight, then only changes', async () => {
    const { venue, clock, session, observer } = await venueAndSession();
    observer.observe();
    expect(session.engineEvents).toHaveLength(1);
    expect(session.engineEvents[0]).toMatchObject({ asset: asset.definition.id, kind: 'regime' });
    expect(session.engineEvents[0]!.detail).toMatch(/observed: regime/);
    // Nothing moved, nothing recorded.
    observer.observe();
    expect(session.engineEvents).toHaveLength(1);
    // Run the market a while; whatever changed is recorded and nothing else is.
    for (let i = 0; i < 60; i += 1) {
      clock.advance(durationMillis(10_000));
      await venue.tick();
      observer.observe();
    }
    // A transition, not merely a length that never shrank: ten minutes of this
    // market changes something, and every record after the first names what it
    // changed from and to. `>= last` was true of an observer that recorded
    // nothing at all (Cycle Audit 8, a8).
    const transitions = session.engineEvents.slice(1);
    expect(
      transitions.length,
      'ten simulated minutes recorded no engine transition',
    ).toBeGreaterThan(0);
    for (const event of transitions) {
      expect(['regime', 'volatility', 'stall', 'recovery', 'seam']).toContain(event.kind);
      expect(event.detail, 'a transition that names no change').toMatch(/→/);
    }
    // And not one record per pass: what did not change was not recorded.
    expect(session.engineEvents.length).toBeLessThan(60);
    // And the Lab's stream is untouched: the observer writes engine events only.
    expect(session.labActions).toEqual([]);
    await venue.stop();
  }, 60_000);

  it('records each kind of change once, and only on the pass that changed it', () => {
    const { venue, set } = drivenVenue();
    const session = new LabSession();
    const observer = new EngineEventObserver(venue, session);
    const details = (): string[] => session.engineEvents.map((e) => `${e.kind}: ${e.detail}`);

    observer.observe(GENESIS);
    set({ regime: 'stressed' });
    observer.observe(epochMillis(GENESIS + 1_000));
    set({ phase: 'coil' });
    observer.observe(epochMillis(GENESIS + 2_000));
    set({ stalled: true });
    observer.observe(epochMillis(GENESIS + 3_000));
    set({ stalled: false });
    observer.observe(epochMillis(GENESIS + 4_000));
    // Nothing moved on this pass, and nothing is added.
    observer.observe(epochMillis(GENESIS + 5_000));

    expect(details()).toEqual([
      'regime: observed: regime normal, cascade neutral',
      'regime: volatility regime normal → stressed',
      'volatility: cascade phase neutral → coil',
      'stall: market stalled (catch-up bound)',
      'recovery: market publishing again',
    ]);
    expect(session.labActions).toEqual([]);
  });

  it('records a stall when the market falls past its catch-up bound', async () => {
    const { venue, clock, session, observer } = await venueAndSession();
    clock.advance(durationMillis(2_000));
    await venue.tick();
    observer.observe();
    clock.advance(durationMillis(30_000)); // past the 15 s bound: refused, stalled
    await venue.tick();
    observer.observe();
    expect(session.engineEvents.some((e) => e.kind === 'stall')).toBe(true);
    await venue.stop();
  });
});
