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
    let last = 1;
    for (let i = 0; i < 60; i += 1) {
      clock.advance(durationMillis(10_000));
      await venue.tick();
      observer.observe();
      expect(session.engineEvents.length).toBeGreaterThanOrEqual(last);
      last = session.engineEvents.length;
    }
    for (const event of session.engineEvents) {
      expect(['regime', 'volatility', 'stall', 'recovery', 'seam']).toContain(event.kind);
    }
    // And the Lab's stream is untouched: the observer writes engine events only.
    expect(session.labActions).toEqual([]);
    await venue.stop();
  }, 60_000);

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
