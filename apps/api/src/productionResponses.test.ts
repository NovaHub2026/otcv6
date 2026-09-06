// Invariant evidence: INV-010 (private generator state).
import 'reflect-metadata';
import { HttpException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  InMemoryCandleHistory,
  MemoryAssetRegistry,
  MemoryStateStore,
  MemoryTickRecord,
} from '@otc/runtime';
import { HistoryService } from './history.service.js';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { RegistrationService } from './registration.service.js';
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
 *
 * **Cycle Audit 10 (a1-03, a1-04) widened it in four directions**, because the
 * walk had four blind spots and every one of them was planted through:
 *
 * 1. **`/metrics` was one opaque string.** `leaksIn` tests a whole string
 *    against the cursor form, so a multi-line Prometheus body matched nothing:
 *    every keystream cursor of every asset, served as well-formed numeric
 *    samples, passed 44 files and 961 tests. Text routes are parsed now, and
 *    the sample names must be exactly {@link METRIC_NAMES} — so a leak does not
 *    have to be *recognised*, it only has to be **new**.
 * 2. **A route that threw was skipped as "not a response".** A 4xx/5xx body is
 *    a wire response; the whole snapshot as the `reason` of a 503 was invisible.
 *    Refusals are walked now, and a second pass asks every route for an asset
 *    that does not exist so the refusal path always has subjects.
 * 3. **Two JSON routes answered for nobody.** The guard's venue composed no
 *    history and no registrations, so `markets/:id/history` and
 *    `registrations/:id` logged "(threw)" and a cursor served on either was
 *    never seen. Both are composed here.
 * 4. **The leak did not have to be a cursor at all.** `HostedMarket.pending` is
 *    the *next* tick — drawn, not yet due — and serving it inside
 *    `/markets/:id`'s own `price`/`sequence`/`instant` keys carries no cursor,
 *    no snapshot-only key and no extra key for the contract guard to see. So
 *    the walk also holds every answer against the tick the venue published
 *    *after* the walk: a response that carries two of its three coordinates was
 *    serving a price nobody had generated yet, whatever the keys were called.
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

/**
 * Every sample `/metrics` may carry, and nothing else (Cycle Audit 10, a1-04).
 *
 * A closed list rather than a scan for suspicious content, because the plant
 * that survived was not suspicious: `otc_debug_block{asset,purpose} 0` and
 * `otc_debug_offset{asset,purpose} 32` are well-formed gauges that parse, that
 * agree with `/health`, and that hand a reader the engine's keystream position.
 * Anything an operator surface may publish is known in advance and written
 * here; a counter added without a line in this list is a red suite, and adding
 * the line is the moment somebody decides the number is publishable.
 *
 * Keep it in step with `MarketController.metrics` and `operations.test.ts`.
 */
const METRIC_NAMES = new Set([
  'otc_markets_hosted',
  'otc_markets_stalled',
  'otc_ready',
  'otc_ticks_published_total',
  'otc_stream_subscribers',
  'otc_replay_bytes_in_use',
  'otc_replay_budget_bytes',
  'otc_uptime_seconds',
  'otc_process_resident_bytes',
  'otc_stream_connections',
  'otc_record_head_sequence',
  // Cycle Audit 10 (a3-06): passes that threw, so a venue that has stopped
  // serving cannot look identical to one that is idle. A count of failures is
  // the operator's business and carries no engine state.
  'otc_tick_pass_failures_total',
]);
/** The only label a sample may carry, and its value is an asset id. */
const METRIC_LABELS = new Set(['asset']);

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

/**
 * A string that is itself a JSON object or array, or `undefined`.
 *
 * **Cycle Audit 10 (a1-04).** The walk below used to test a whole string
 * against the cursor form and stop there, so any leak with a `JSON.stringify`
 * around it was invisible: the engine snapshot served as the `reason` of a 503
 * is one string, and one `JSON.parse` from being the object this guard was
 * written to catch.
 */
function nestedJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Walk a JSON value; return the paths that look like a snapshot's. */
function leaksIn(value: unknown, path = '$', found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (CURSOR.test(value)) found.push(`${path} = "${value}" (a keystream cursor)`);
    const nested = nestedJson(value);
    if (nested !== undefined) {
      leaksIn(nested, `${path} (JSON inside a string)`, found);
    } else {
      // Not parseable — truncated, or quoted inside a sentence. The names are
      // still there, and a snapshot key in a message is a snapshot in a message.
      for (const key of SNAPSHOT_ONLY_KEYS) {
        if (value.includes(`"${key}"`)) {
          found.push(`${path} names "${key}" in its text (a snapshot-only key)`);
        }
      }
    }
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

/**
 * Every number a value carries, under any key and at any depth.
 *
 * Numeric strings count: a leak served as `"1776000060000"` is the same leak,
 * and the difference is a `String()` call.
 */
function numbersIn(value: unknown, found: Set<number> = new Set<number>()): Set<number> {
  if (typeof value === 'number') {
    found.add(value);
    return found;
  }
  if (typeof value === 'string') {
    if (/^-?\d+$/.test(value)) found.add(Number(value));
    return found;
  }
  if (Array.isArray(value)) {
    for (const v of value) numbersIn(v, found);
    return found;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) numbersIn(v, found);
  }
  return found;
}

/**
 * Whether a response is carrying a tick that has not been published yet.
 *
 * Keys are not consulted, because the plant that survived used the contract's
 * own (Cycle Audit 10, a1-03: `/markets/:id` answering with `pending`, the tick
 * drawn but not yet due). Two of the three coordinates is the threshold: a
 * sequence, an instant or a price may each collide with an unrelated number,
 * and two of them together in one response cannot.
 */
function futureTickIn(
  value: unknown,
  next: { sequence: number; instant: number; price: number },
): string[] {
  const numbers = numbersIn(value);
  const matched = (['sequence', 'instant', 'price'] as const).filter((k) => numbers.has(next[k]));
  if (matched.length < 2) return [];
  return [
    `carries ${String(matched.length)} coordinates of the tick published after the walk ` +
      `(${matched.map((k) => `${k}=${String(next[k])}`).join(', ')}): a price nobody had generated`,
  ];
}

interface Sample {
  readonly name: string;
  readonly labels: readonly (readonly [string, string])[];
  readonly value: number;
}

/** Parse a Prometheus text body into declarations and samples, keeping what it cannot read. */
function prometheus(text: string): {
  samples: Sample[];
  declared: string[];
  malformed: string[];
} {
  const samples: Sample[] = [];
  const declared: string[] = [];
  const malformed: string[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith('#')) {
      const comment = /^# (?:HELP|TYPE) ([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
      if (comment === null) malformed.push(line);
      else declared.push(comment[1]!);
      continue;
    }
    const sample = /^([A-Za-z_][A-Za-z0-9_]*)(?:\{([^}]*)\})? (-?\d+(?:\.\d+)?)$/.exec(line);
    if (sample === null) {
      malformed.push(line);
      continue;
    }
    const labels: [string, string][] = [];
    let broken = false;
    for (const pair of (sample[2] ?? '').split(',')) {
      if (pair.length === 0) continue;
      const label = /^([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"$/.exec(pair);
      if (label === null) broken = true;
      else labels.push([label[1]!, label[2]!]);
    }
    if (broken) malformed.push(line);
    samples.push({ name: sample[1]!, labels, value: Number(sample[3]) });
  }
  return { samples, declared, malformed };
}

const started: VenueService[] = [];
const scratch: string[] = [];
afterAll(async () => {
  // Stopped before the directories go: a stop seals every open commitment
  // window (Cycle Audit 10, a6-03), so the publication directory has to still
  // be there when it runs.
  for (const venue of started) await venue.stop();
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe('no production response carries an engine snapshot, by value (INV-010)', () => {
  it('every GET route answers without a cursor, a snapshot-only key, an unnamed counter or a tick from the future', async () => {
    const publicationDir = mkdtempSync(path.join(tmpdir(), 'otc-prod-responses-'));
    scratch.push(publicationDir);
    const clock = new SteppableClock(GENESIS);
    const keyring = MasterKeyring.fromSecret(
      'production-responses-spec',
      new Uint8Array(32).fill(41),
    );
    // The production composition: no sign source, no arrival source (main.ts).
    const venue = new VenueService(
      new MemoryStateStore(),
      keyring,
      clock,
      [asset],
      5_000,
      // Publishing into a scratch directory with short windows, and keeping a
      // record, so the settlement-query routes (PH-29.1) answer rather than
      // refuse — a refused route is a route this guard has not seen.
      new PublicationService([asset], 20, {
        OTC_PUBLICATION_DIR: publicationDir,
        OTC_PUBLISHING_KEY: '77'.repeat(32),
      }),
      null,
      GENESIS,
      0,
      null,
      null,
      null,
      new MemoryTickRecord(),
    );
    started.push(venue);
    await venue.start();
    for (let i = 0; i < 6; i += 1) {
      clock.advance(durationMillis(10_000));
      await venue.tick();
    }
    // **Cycle Audit 10 (a1-04).** Composed, so the two JSON routes this guard
    // used to log as "(threw)" answer and are walked. A route the guard cannot
    // make answer is a route it does not guard.
    const history = new HistoryService(new InMemoryCandleHistory(), [asset]);
    const registration = new RegistrationService(new MemoryAssetRegistry(), venue, keyring, clock);
    // Refused at identity — the id is already hosted — so the job exists at
    // once and no calibration runs for a guard about response bodies.
    const job = registration.submit({
      id,
      archetypeId: asset.definition.family,
      displayName: 'A job to read back',
      referencePrice: 1,
    });
    const controller = new MarketController(venue, history, registration);
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
    const refused: string[] = [];
    const skipped: string[] = [];
    /** What every route answered, kept so the future-tick check can run after the walk. */
    const answers: { route: string; value: unknown }[] = [];
    let metricsSeen = 0;

    const positionalFor = (
      name: string,
      route: string,
      assetParam: string,
      sequenceParam: string,
    ): unknown[] => {
      const args = routeArgs(name);
      const positional: unknown[] = [];
      const width = args.size === 0 ? 0 : Math.max(...args.keys()) + 1;
      for (let i = 0; i < width; i += 1) {
        const arg = args.get(i);
        if (arg === undefined) {
          positional.push(undefined);
          continue;
        }
        if (arg.type === RouteParamtypes.PARAM) {
          positional.push(
            // `:id` means a job id on the registrations route and an asset id
            // everywhere else; the guard used to hand the asset id to both,
            // which is why `registrations/:id` only ever 404'd.
            route.startsWith('registrations/')
              ? job.id
              : arg.data === 'id'
                ? assetParam
                : arg.data === 'delta'
                  ? '1'
                  : sequenceParam,
          );
        } else if (arg.type === RouteParamtypes.QUERY) {
          const q = arg.data ?? '';
          positional.push(
            q === 'timeframe'
              ? '1m'
              : q === 'from'
                ? String(GENESIS)
                : q === 'to'
                  ? String(last.instant + 60_000)
                  : q === 'at'
                    ? String(last.instant)
                    : undefined,
          );
        } else {
          positional.push(undefined);
        }
      }
      return positional;
    };

    /**
     * Call one route and record what came back — an answer or a refusal.
     *
     * **Both are wire responses.** A body served with a 4xx or a 5xx reaches
     * the same client over the same socket, and Cycle Audit 10 put the whole
     * engine snapshot in the `reason` of a 503 with this guard green.
     */
    const walk = async (name: string, route: string, positional: unknown[]): Promise<void> => {
      let answer: unknown;
      try {
        answer = await (controller as unknown as Record<string, (...a: unknown[]) => unknown>)[
          name
        ]!(...positional);
      } catch (error) {
        if (error instanceof HttpException) {
          const status = error.getStatus();
          refused.push(`${route} (${String(status)})`);
          const body: unknown = JSON.parse(JSON.stringify(error.getResponse()));
          answers.push({ route: `${route} ${String(status)}`, value: body });
          for (const leak of leaksIn(body)) leaks.push(`GET ${route} [${String(status)}]: ${leak}`);
          return;
        }
        // Not an HTTP answer at all: nothing was written to a client, and the
        // route is named so a reader can see what this walk did not cover.
        skipped.push(`${route} (threw ${(error as Error).name})`);
        return;
      }
      if (typeof answer === 'string') {
        // A text route: `/metrics`. Parsed rather than matched, because a
        // multi-line body defeats a whole-string regex (a1-04).
        metricsSeen += 1;
        exercised.push(route);
        const { samples, declared, malformed } = prometheus(answer);
        answers.push({ route, value: samples.map((s) => s.value) });
        for (const line of malformed) leaks.push(`GET ${route}: malformed sample ${line}`);
        for (const metric of [...samples.map((s) => s.name), ...declared]) {
          if (!METRIC_NAMES.has(metric)) {
            leaks.push(
              `GET ${route}: sample ${metric} is not one of the counters this surface publishes`,
            );
          }
        }
        for (const sample of samples) {
          for (const [label, value] of sample.labels) {
            if (!METRIC_LABELS.has(label)) {
              leaks.push(`GET ${route}: sample ${sample.name} carries a label ${label}`);
            }
            for (const leak of leaksIn(value, `${sample.name}{${label}}`)) {
              leaks.push(`GET ${route}: ${leak}`);
            }
          }
        }
        expect(samples.length, `${route} published no samples`).toBeGreaterThan(5);
        return;
      }
      exercised.push(route);
      // Through JSON, as the wire would carry it.
      const serialised: unknown = JSON.parse(JSON.stringify(answer ?? null));
      answers.push({ route, value: serialised });
      for (const leak of leaksIn(serialised)) leaks.push(`GET ${route}: ${leak}`);
    };

    for (const { name, path: route } of routes) {
      const args = routeArgs(name);
      // A route that writes to the response itself (the streams) is not a JSON
      // answer. Its frames are held to the contract, key by key and type by
      // type, by `contract.test.ts` — which drives both stream routes with a
      // recording response and checks every frame against `route.stream`
      // (Cycle Audit 10, a4-07: before that no test read a live frame at all).
      const streams = [...args.values()].some(
        (a) => a.type === RouteParamtypes.RESPONSE || a.type === RouteParamtypes.REQUEST,
      );
      if (streams) {
        skipped.push(route);
        continue;
      }
      await walk(name, route, positionalFor(name, route, id, '1'));
    }
    // The refusal pass: the same routes, asked for what does not exist. Every
    // route that can refuse then refuses, so the body walk above has subjects
    // rather than depending on which routes this composition happens to miss.
    for (const { name, path: route } of routes) {
      const args = routeArgs(name);
      if ([...args.values()].some((a) => a.type === RouteParamtypes.RESPONSE)) continue;
      if (args.size === 0) continue;
      await walk(name, route, positionalFor(name, route, 'no-such-asset', '999999999'));
    }

    // The tick the venue had drawn but not published while every route above
    // was answering. `pending` is exactly this tick (Cycle Audit 10, a1-03),
    // so a response that carried it carried a price that did not exist yet.
    const headBeforeAdvance = venue.lastTick(id)!.sequence;
    clock.advance(durationMillis(10_000));
    await venue.tick();
    const published = venue.feed.since(id, headBeforeAdvance + 1);
    expect(published.length, 'the venue published nothing after the walk').toBeGreaterThan(0);
    const next = published[0]!;
    for (const { route, value } of answers) {
      for (const leak of futureTickIn(value, next)) leaks.push(`GET ${route}: ${leak}`);
    }

    // And the same walk over a venue that is refusing to serve: a market past
    // its catch-up bound stalls, `/health/ready` answers 503 **with a body**,
    // and `/metrics` still answers. Cycle Audit 10 (a1-04, B3) put the whole
    // engine snapshot in the `reason` of that 503 and this guard stayed green,
    // because it never asked a route in the state where it refuses.
    clock.advance(durationMillis(120_000));
    await venue.tick();
    expect(venue.stalledMarkets, 'the stall pass has no stalled market').toHaveLength(1);
    const refusedBefore = refused.length;
    for (const { name, path: route } of routes) {
      const args = routeArgs(name);
      if ([...args.values()].some((a) => a.type === RouteParamtypes.RESPONSE)) continue;
      await walk(name, route, positionalFor(name, route, id, '1'));
    }
    expect(
      refused.length - refusedBefore,
      'a stalled venue refused nothing, so no 5xx body was walked',
    ).toBeGreaterThanOrEqual(1);

    expect(exercised.length, `exercised: ${exercised.join(', ')}`).toBeGreaterThanOrEqual(5);
    // The four widenings each have a subject, so none of them can quietly
    // become a walk over nothing.
    expect(metricsSeen, 'the text route was never read').toBe(2);
    expect(refused.length, 'no refusal body was walked').toBeGreaterThanOrEqual(4);
    expect(
      skipped.filter((s) => s.includes('threw')),
      'a route answered with something that is not an HTTP response',
    ).toEqual([]);
    expect(leaks, 'a production response carries engine state (INV-010)').toEqual([]);
    console.info(
      `INV-010 by value: ${String(exercised.length)} GET routes answered clean, ` +
        `${String(refused.length)} refusals walked` +
        (skipped.length > 0 ? `; not JSON: ${skipped.join(', ')}` : ''),
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
    // A cursor under a key no regex names is still a cursor (a1-04: the
    // refuter's plant was caught by the literal `cursors` and passed once
    // renamed).
    expect(leaksIn({ watermark: { a: '1:0' } })).toEqual([
      '$.watermark.a = "1:0" (a keystream cursor)',
    ]);
    // And a leak with a `JSON.stringify` around it is the same leak (a1-04:
    // the whole snapshot as the `reason` of a 503 is one string).
    expect(leaksIn({ ready: false, reason: JSON.stringify({ cursors: { sign: '3:7' } }) })).toEqual(
      [
        '$.reason (JSON inside a string).cursors (a snapshot-only key)',
        '$.reason (JSON inside a string).cursors.sign = "3:7" (a keystream cursor)',
      ],
    );
    // Even when the wrapper does not parse — cut short, or quoted in a sentence.
    expect(leaksIn({ reason: 'resume failed: {"cursors":{"sign":"3:7"' })).toEqual([
      '$.reason names "cursors" in its text (a snapshot-only key)',
    ]);
    // Prose is not a leak.
    expect(leaksIn({ reason: 'Market is 120s behind the clock, past the 15s bound.' })).toEqual([]);
  });

  it('the future-tick check reads values, not keys (a1-03)', () => {
    const next = { sequence: 4_211, instant: 1_776_000_070_000, price: -1_234 };
    // The plant that survived: the pending tick inside the contract's own keys.
    expect(
      futureTickIn({ id: 'eurusd-otc', sequence: 4_211, instant: 1_776_000_070_000 }, next),
    ).toHaveLength(1);
    // And the same tick under names nobody would grep for, at depth.
    expect(futureTickIn({ a: { b: [4_211] }, c: '-1234' }, next)).toHaveLength(1);
    // One coordinate is a coincidence: a sequence that happens to equal a count
    // must not fail a guard that would then be deleted.
    expect(futureTickIn({ total: 4_211 }, next)).toEqual([]);
    expect(futureTickIn({ sequence: 4_210, instant: 1_776_000_069_000 }, next)).toEqual([]);
  });

  it('the metrics parser reads samples, labels and declarations', () => {
    const parsed = prometheus(
      '# HELP otc_ready Whether the venue is ready.\n# TYPE otc_ready gauge\notc_ready 1\n' +
        'otc_record_head_sequence{asset="eurusd-otc"} 42\notc_debug_block{purpose="sign"} 0\n',
    );
    expect(parsed.declared).toEqual(['otc_ready', 'otc_ready']);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.samples.map((s) => s.name)).toEqual([
      'otc_ready',
      'otc_record_head_sequence',
      'otc_debug_block',
    ]);
    expect(parsed.samples[1]!.labels).toEqual([['asset', 'eurusd-otc']]);
    // The name of the third is not in the published set, and that is the whole
    // check: a leak does not have to look like one, it only has to be new.
    expect(METRIC_NAMES.has(parsed.samples[2]!.name)).toBe(false);
    expect(prometheus('otc_ready one\n').malformed).toEqual(['otc_ready one']);
  });
});
