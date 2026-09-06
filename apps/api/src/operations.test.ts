// Invariant evidence: INV-010 (private generator state) — the operator surface carries counters, never state.
import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord } from '@otc/runtime';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

const GENESIS = epochMillis(1_776_000_000_000);
const asset = ASSET_CATALOGUE[0]!;

function venue(): { venue: VenueService; clock: SteppableClock; controller: MarketController } {
  const clock = new SteppableClock(GENESIS);
  const service = new VenueService(
    new MemoryStateStore(),
    MasterKeyring.fromSecret('operations-spec', new Uint8Array(32).fill(30)),
    clock,
    [asset],
    5_000,
    new PublicationService([asset], 500, {}),
    null,
    GENESIS,
    0,
    null,
    null,
    null,
    new MemoryTickRecord(),
  );
  return { venue: service, clock, controller: new MarketController(service) };
}

describe('liveness and readiness (PH-30.1)', () => {
  it('is live before it is ready, ready once the markets resumed, and not ready while one is stalled', async () => {
    const { venue: service, clock, controller } = venue();
    expect(controller.live()).toEqual({ live: true });
    expect(() => controller.ready()).toThrow(ServiceUnavailableException);
    expect(service.notReadyReason).toMatch(/not finished resuming/);
    await service.start();
    expect(controller.ready()).toEqual({ ready: true });
    expect((controller.health() as { ready: boolean }).ready).toBe(true);
    // Past the catch-up bound: the market stalls, and readiness says which.
    clock.advance(durationMillis(60_000));
    await service.tick();
    expect(service.stalledMarkets).toHaveLength(1);
    expect(() => controller.ready()).toThrow(ServiceUnavailableException);
    expect(service.notReadyReason).toContain(asset.definition.id);
    expect(controller.health() as { ready: boolean; status: string }).toMatchObject({
      ready: false,
      status: 'degraded',
    });
    await service.stop();
    expect(service.notReadyReason).toMatch(/shutting down/);
  });
});

describe('metrics (PH-30.1)', () => {
  it('is Prometheus text whose numbers are the ones /health reports', async () => {
    const { venue: service, clock, controller } = venue();
    await service.start();
    for (let i = 0; i < 10; i += 1) {
      clock.advance(durationMillis(1_000));
      await service.tick();
    }
    service.feed.subscribe(asset.definition.id, { deliver: () => true, close: () => undefined });
    const text = await controller.metrics();
    const samples = new Map<string, number>();
    for (const line of text.split('\n')) {
      if (line.length === 0 || line.startsWith('#')) continue;
      const m = /^([a-z_]+)(\{[^}]*\})? (-?\d+(?:\.\d+)?)$/.exec(line);
      expect(m, `malformed sample: ${line}`).not.toBeNull();
      samples.set(m![1]! + (m![2] ?? ''), Number(m![3]));
    }
    const health = controller.health() as { assets: number; stalled: unknown[] };
    expect(samples.get('otc_markets_hosted')).toBe(health.assets);
    expect(samples.get('otc_markets_stalled')).toBe(health.stalled.length);
    expect(samples.get('otc_ready')).toBe(1);
    expect(samples.get('otc_ticks_published_total')).toBe(
      service.feed.since(asset.definition.id, 1).length,
    );
    expect(samples.get('otc_stream_subscribers')).toBe(1);
    expect(samples.get('otc_uptime_seconds')).toBe(10);
    expect(samples.get(`otc_record_head_sequence{asset="${asset.definition.id}"}`)).toBe(
      service.feed.since(asset.definition.id, 1).length,
    );
    expect(samples.get('otc_process_resident_bytes')).toBeGreaterThan(1_000_000);
    expect(text).toMatch(/# TYPE otc_ticks_published_total counter/);
    await service.stop();
  });
});
