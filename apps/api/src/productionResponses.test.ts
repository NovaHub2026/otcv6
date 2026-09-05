// Invariant evidence: INV-010 (private generator state).
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { RequestMethod } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore } from '@otc/runtime';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * INV-010, about the value rather than the word (Cycle Audit 9, a1-01).
 *
 * `labSurface.test.ts` scans production sources for the identifiers a leak
 * would use — `snapshot`, `snapshotEngine()` spread, `cursors` near a return.
 * Cycle Audit 8 recorded that guard as "about the value"; Cycle Audit 9 planted
 * `const state = hosted.snapshotEngine(); return { id, state };` on a new
 * production route and every unit test stayed green while the route served all
 * seven keystream cursors and the whole latent state. An alias defeats a
 * regex; nothing defeats reading the response.
 *
 * So this boots a real production venue in-process — the composition with no
 * sign source, as `main.ts` builds it — enumerates every GET route the
 * production controller declares from Nest's own route metadata (a route added
 * tomorrow is enumerated tomorrow), calls each with a live asset id, and walks
 * the JSON it answers for the shape of an engine snapshot: a cursor-formatted
 * string, or a key only a snapshot has. The source scan stays as the second
 * layer.
 */
const asset = ASSET_CATALOGUE[0]!;
const id = asset.definition.id;
const GENESIS = epochMillis(1_776_000_000_000);

/** Keys that exist on an `EngineSnapshot` and on nothing a production response may carry. */
const SNAPSHOT_ONLY_KEYS = new Set([
  'cursors',
  'magnitudeState',
  'arrivalState',
  'previousMagnitude',
  'previousIntervalMs',
]);
/** `formatCursor`: `<blockIndex>:<byteOffset>`. */
const CURSOR = /^\d+:\d{1,2}$/;

interface RouteArg {
  readonly index: number;
  readonly data?: string;
}

function routeArgs(name: string): Map<number, { type: RouteParamtypes; data?: string }> {
  const raw = (Reflect.getMetadata(ROUTE_ARGS_METADATA, MarketController, name) ?? {}) as Record<
    string,
    RouteArg
  >;
  const out = new Map<number, { type: RouteParamtypes; data?: string }>();
  for (const [key, arg] of Object.entries(raw)) {
    const type: RouteParamtypes = Number(key.split(':')[0]);
    out.set(arg.index, { type, ...(arg.data === undefined ? {} : { data: arg.data }) });
  }
  return out;
}

/** Walk a JSON value; return the paths that look like a snapshot's. */
function leaksIn(value: unknown, path = '$', found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (CURSOR.test(value)) found.push(`${path} = "${value}" (a keystream cursor)`);
    return found;
  }
  if (typeof value === 'bigint') found.push(`${path} is a bigint (a cursor's block index)`);
  if (Array.isArray(value)) {
    value.forEach((v, i) => leaksIn(v, `${path}[${String(i)}]`, found));
    return found;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SNAPSHOT_ONLY_KEYS.has(k)) found.push(`${path}.${k} (a snapshot-only key)`);
      leaksIn(v, `${path}.${k}`, found);
    }
  }
  return found;
}

const started: VenueService[] = [];
afterAll(async () => {
  for (const venue of started) await venue.stop();
});

describe('no production response carries an engine snapshot, by value (INV-010)', () => {
  it('every GET route of the production controller answers without a cursor or a snapshot-only key', async () => {
    const clock = new SteppableClock(GENESIS);
    // The production composition: no sign source, no arrival source (main.ts).
    const venue = new VenueService(
      new MemoryStateStore(),
      MasterKeyring.fromSecret('production-responses-spec', new Uint8Array(32).fill(41)),
      clock,
      [asset],
      5_000,
      new PublicationService([asset]),
    );
    started.push(venue);
    await venue.start();
    for (let i = 0; i < 6; i += 1) {
      clock.advance(durationMillis(10_000));
      await venue.tick();
    }
    const controller = new MarketController(venue);
    const last = venue.lastTick(id)!;

    const proto = MarketController.prototype as unknown as Record<string, unknown>;
    const routes: { name: string; path: string }[] = [];
    for (const name of Object.getOwnPropertyNames(MarketController.prototype)) {
      const handler = proto[name];
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (method === RequestMethod.GET && path !== undefined) routes.push({ name, path });
    }
    // A subject to guard: the production controller declares many GET routes.
    expect(routes.length).toBeGreaterThanOrEqual(8);

    const leaks: string[] = [];
    const exercised: string[] = [];
    const skipped: string[] = [];
    for (const { name, path } of routes) {
      const args = routeArgs(name);
      // A route that writes to the response itself (the streams) is not a JSON
      // answer; the stream's frames are ticks, guarded elsewhere by shape.
      const streams = [...args.values()].some(
        (a) => a.type === RouteParamtypes.RESPONSE || a.type === RouteParamtypes.REQUEST,
      );
      if (streams) {
        skipped.push(path);
        continue;
      }
      const positional: unknown[] = [];
      const width = args.size === 0 ? 0 : Math.max(...args.keys()) + 1;
      for (let i = 0; i < width; i += 1) {
        const arg = args.get(i);
        if (arg === undefined) {
          positional.push(undefined);
          continue;
        }
        if (arg.type === RouteParamtypes.PARAM) {
          positional.push(arg.data === 'id' ? id : arg.data === 'delta' ? '1' : '1');
        } else if (arg.type === RouteParamtypes.QUERY) {
          const q = arg.data ?? '';
          positional.push(
            q === 'timeframe'
              ? '1m'
              : q === 'from'
                ? String(GENESIS)
                : q === 'to'
                  ? String(last.instant + 60_000)
                  : undefined,
          );
        } else {
          positional.push(undefined);
        }
      }
      let answer: unknown;
      try {
        answer = await (controller as unknown as Record<string, (...a: unknown[]) => unknown>)[
          name
        ]!(...positional);
      } catch {
        // A refusal (404 for a history this venue does not keep, a registry it
        // does not have) is not a response; nothing leaked.
        skipped.push(`${path} (threw)`);
        continue;
      }
      exercised.push(path);
      // Through JSON, as the wire would carry it.
      const serialised: unknown = JSON.parse(JSON.stringify(answer ?? null));
      for (const leak of leaksIn(serialised)) leaks.push(`GET ${path}: ${leak}`);
    }
    expect(exercised.length, `exercised: ${exercised.join(', ')}`).toBeGreaterThanOrEqual(5);
    expect(leaks, 'a production response carries engine state (INV-010)').toEqual([]);
    console.info(
      `INV-010 by value: ${String(exercised.length)} GET routes answered clean` +
        (skipped.length > 0 ? `; not JSON or refused: ${skipped.join(', ')}` : ''),
    );
  }, 60_000);

  it('the walk sees what it is for', () => {
    expect(leaksIn({ ok: 1, nested: { cursors: { sign: '0:12' } } })).toEqual([
      '$.nested.cursors (a snapshot-only key)',
      '$.nested.cursors.sign = "0:12" (a keystream cursor)',
    ]);
    expect(leaksIn({ state: { magnitudeState: { modulators: [] } } })).toHaveLength(1);
    expect(
      leaksIn({ id: 'eurusd-otc', price: 1, displayPrice: '1.0850', recovery: { kind: 'fresh' } }),
    ).toEqual([]);
  });
});
