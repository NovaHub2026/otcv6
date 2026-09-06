// Invariant evidence: INV-010 (private generator state) — the contract names every key a production response may carry.
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { RequestMethod } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { durationMillis, epochMillis, MasterKeyring, SteppableClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import { MemoryStateStore, MemoryTickRecord } from '@otc/runtime';
import {
  API_ROUTES,
  API_VERSION,
  CONTRACT_HISTORY,
  contractDigest,
  renderContract,
  type FieldType,
  type RouteContract,
} from './contract.js';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const GENESIS = epochMillis(1_776_000_000_000);
const asset = ASSET_CATALOGUE[0]!;
const id = asset.definition.id;
const scratch: string[] = [];
const started: VenueService[] = [];
afterAll(async () => {
  for (const venue of started) await venue.stop();
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const METHODS: Record<number, RouteContract['method'] | undefined> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PATCH]: 'PATCH',
};

function declaredRoutes(): { name: string; method: RouteContract['method']; path: string }[] {
  const proto = MarketController.prototype as unknown as Record<string, unknown>;
  const routes: { name: string; method: RouteContract['method']; path: string }[] = [];
  for (const name of Object.getOwnPropertyNames(MarketController.prototype)) {
    const handler = proto[name];
    if (typeof handler !== 'function' || name === 'constructor') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    const route = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    if (method === undefined || route === undefined) continue;
    const verb = METHODS[method];
    if (verb === undefined)
      throw new Error(`${name}: an HTTP method the contract does not describe`);
    routes.push({ name, method: verb, path: `/${route}` });
  }
  return routes;
}

function routeArgs(name: string): Map<number, { type: RouteParamtypes; data?: string }> {
  const meta = (Reflect.getMetadata(ROUTE_ARGS_METADATA, MarketController, name) ?? {}) as Record<
    string,
    { index: number; data?: string }
  >;
  const out = new Map<number, { type: RouteParamtypes; data?: string }>();
  for (const [key, value] of Object.entries(meta)) {
    const type: RouteParamtypes = Number(key.split(':')[0]);
    out.set(value.index, value.data === undefined ? { type } : { type, data: value.data });
  }
  return out;
}

function conforms(value: unknown, type: FieldType): boolean {
  const [base, nullable] = type.split('|');
  if (value === null) return nullable === 'null';
  switch (base) {
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    default:
      return false;
  }
}

function checkShape(
  where: string,
  value: unknown,
  shape: Readonly<Record<string, FieldType>>,
): string[] {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`${where}: not an object`];
  }
  const keys = Object.keys(value).sort();
  const wanted = Object.keys(shape).sort();
  if (JSON.stringify(keys) !== JSON.stringify(wanted)) {
    problems.push(`${where}: keys ${keys.join(',')} — the contract names ${wanted.join(',')}`);
  }
  for (const [key, type] of Object.entries(shape)) {
    const field = (value as Record<string, unknown>)[key];
    if (key in value && !conforms(field, type)) {
      problems.push(`${where}.${key}: ${JSON.stringify(field)} is not ${type}`);
    }
  }
  return problems;
}

describe('the API is a contract (PH-29.2)', () => {
  it('names every route the controller declares, and no other', () => {
    const declared = declaredRoutes()
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    const contracted = API_ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(declared).toEqual(contracted);
  });

  it('is in force: the digest of the routes is the last entry of the history, under the current version', () => {
    const last = CONTRACT_HISTORY[CONTRACT_HISTORY.length - 1]!;
    expect(
      contractDigest(),
      'the routes changed and the history has no entry for them: add a version to CONTRACT_HISTORY',
    ).toBe(last.digest);
    expect(API_VERSION).toBe(last.version);
    const versions = CONTRACT_HISTORY.map((entry) => entry.version.split('.').map(Number));
    for (let i = 1; i < versions.length; i += 1) {
      const [a, b] = [versions[i - 1]!, versions[i]!];
      const greater =
        a[0]! < b[0]! || (a[0] === b[0] && (a[1]! < b[1]! || (a[1] === b[1] && a[2]! < b[2]!)));
      expect(
        greater,
        `${CONTRACT_HISTORY[i]!.version} does not follow ${CONTRACT_HISTORY[i - 1]!.version}`,
      ).toBe(true);
    }
    expect(new Set(CONTRACT_HISTORY.map((e) => e.digest)).size).toBe(CONTRACT_HISTORY.length);
  });

  it('is rendered where the docs index says, byte for byte', () => {
    const rendered = renderContract();
    const onDisk = readFileSync(
      path.resolve(here, '../../../docs/architecture/API_CONTRACT.md'),
      'utf8',
    );
    expect(onDisk, 'docs/architecture/API_CONTRACT.md is stale: run npm run contract:render').toBe(
      rendered,
    );
    expect(rendered).toContain(`Version: ${API_VERSION}`);
    expect(rendered).toContain(`Digest: ${contractDigest()}`);
  });

  it('every JSON response has exactly the keys and types the contract names', async () => {
    const publicationDir = mkdtempSync(path.join(tmpdir(), 'otc-contract-'));
    scratch.push(publicationDir);
    const clock = new SteppableClock(GENESIS);
    const venue = new VenueService(
      new MemoryStateStore(),
      MasterKeyring.fromSecret('contract-spec', new Uint8Array(32).fill(43)),
      clock,
      [asset],
      5_000,
      new PublicationService([asset], 20, {
        OTC_PUBLICATION_DIR: publicationDir,
        OTC_PUBLISHING_KEY: '78'.repeat(32),
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
    for (let i = 0; i < 12; i += 1) {
      clock.advance(durationMillis(10_000));
      await venue.tick();
    }
    const controller = new MarketController(venue);
    const last = venue.lastTick(id)!;
    const byPath = new Map(declaredRoutes().map((r) => [`${r.method} ${r.path}`, r.name]));
    const problems: string[] = [];
    const exercised: string[] = [];
    for (const route of API_ROUTES) {
      if (route.response === undefined) continue;
      const name = byPath.get(`${route.method} ${route.path}`)!;
      const args = routeArgs(name);
      const positional: unknown[] = [];
      const width = args.size === 0 ? 0 : Math.max(...args.keys()) + 1;
      for (let i = 0; i < width; i += 1) {
        const arg = args.get(i);
        if (arg === undefined) {
          positional.push(undefined);
        } else if (arg.type === RouteParamtypes.PARAM) {
          positional.push(arg.data === 'id' ? id : '1');
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
      let answer: unknown;
      try {
        answer = await (controller as unknown as Record<string, (...a: unknown[]) => unknown>)[
          name
        ]!(...positional);
      } catch (error) {
        // Routes this composition cannot answer are still contracted; the
        // refusal must be one the contract lists.
        const status = (error as { getStatus?: () => number }).getStatus?.() ?? 0;
        if (route.refusals !== undefined && String(status) in route.refusals) continue;
        problems.push(
          `${route.method} ${route.path}: refused with ${String(status)}, which the contract does not list`,
        );
        continue;
      }
      const value: unknown = JSON.parse(JSON.stringify(answer ?? null));
      exercised.push(route.path);
      if ('array' in route.response) {
        if (!Array.isArray(value)) {
          problems.push(`${route.path}: not an array`);
          continue;
        }
        for (const [index, item] of (value as unknown[]).entries()) {
          problems.push(
            ...checkShape(`${route.path}[${String(index)}]`, item, route.response.array),
          );
        }
      } else {
        problems.push(...checkShape(route.path, value, route.response.object));
      }
    }
    expect(exercised.length, exercised.join(', ')).toBeGreaterThanOrEqual(8);
    expect(problems).toEqual([]);
  }, 60_000);

  it('the shape check sees what it is for', () => {
    expect(checkShape('x', { a: 1, b: 'y' }, { a: 'integer', b: 'string' })).toEqual([]);
    expect(checkShape('x', { a: 1.5, b: 'y' }, { a: 'integer', b: 'string' })).toHaveLength(1);
    expect(checkShape('x', { a: 1 }, { a: 'integer', b: 'string' })).toHaveLength(1);
    expect(checkShape('x', { a: 1, b: 'y', c: 0 }, { a: 'integer', b: 'string' })).toHaveLength(1);
    expect(checkShape('x', { a: null }, { a: 'integer|null' })).toEqual([]);
    expect(checkShape('x', { a: null }, { a: 'integer' })).toHaveLength(1);
  });
});
