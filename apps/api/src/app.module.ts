import { Module } from '@nestjs/common';
import { MasterKeyring, SystemClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  FileAssetRegistry,
  FileStateStore,
  SqliteCandleHistory,
  type AssetRegistry,
  type CandleHistory,
  type StateStore,
} from '@otc/runtime';
import type { RegisteredAsset } from '@otc/engine';
import { RegistrationService } from './registration.service.js';
import { HistoryService } from './history.service.js';
import { MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * Wiring, and nothing else.
 *
 * The master secret is read from the environment and never originates in code.
 * `MasterKeyring` redacts itself in JSON, string and inspect forms — a defect
 * PH-1 found the hard way, when a `private` field that was compile-time only
 * serialised the entire 32-byte secret.
 */
@Module({
  controllers: [MarketController],
  providers: [
    {
      provide: 'STATE_STORE',
      useFactory: (): StateStore => new FileStateStore(process.env.OTC_STATE_DIR ?? './.otc-state'),
    },
    {
      provide: 'CANDLE_HISTORY',
      // Defaults *inside* the state directory rather than beside it. A
      // deployment that moves its state somewhere else means to move all of it,
      // and a history that stayed behind would be a chart of a different market
      // than the one the checkpoints describe.
      useFactory: (): CandleHistory =>
        new SqliteCandleHistory(
          process.env.OTC_HISTORY_DB ?? `${process.env.OTC_STATE_DIR ?? './.otc-state'}/history.db`,
        ),
    },
    {
      provide: 'ASSET_REGISTRY',
      // Inside the state directory, beside the checkpoints, for the reason the
      // history database is: a deployment that moves its state means to move all
      // of it, and a registry left behind would describe assets whose records
      // went elsewhere.
      useFactory: (): AssetRegistry =>
        new FileAssetRegistry(
          process.env.OTC_ASSET_REGISTRY_DIR ??
            `${process.env.OTC_STATE_DIR ?? './.otc-state'}/assets`,
          new SystemClock(),
        ),
    },
    {
      // The catalogue this process hosts: the five compiled assets plus every
      // asset an operator has registered here. Resolved once, at boot, and
      // handed to everything that needs it — `VenueService` owns the list from
      // then on, because an asset created at runtime has to reach the venue, the
      // history and the publisher together or not at all.
      provide: 'ASSETS',
      inject: ['ASSET_REGISTRY'],
      useFactory: async (registry: AssetRegistry): Promise<RegisteredAsset[]> => {
        const stored = await registry.list();
        const compiled = new Set(ASSET_CATALOGUE.map((asset) => asset.definition.id));
        for (const asset of stored) {
          if (compiled.has(asset.definition.id)) {
            // Two assets with one id derive the same keystream: one market under
            // two names, INV-003 broken before a tick is published.
            throw new Error(
              `Registered asset ${asset.definition.id} collides with a compiled ` +
                `catalogue entry. Remove one before starting.`,
            );
          }
        }
        return [...ASSET_CATALOGUE, ...stored];
      },
    },
    {
      provide: HistoryService,
      inject: ['CANDLE_HISTORY', 'ASSETS'],
      useFactory: (history: CandleHistory, assets: RegisteredAsset[]): HistoryService =>
        new HistoryService(history, assets),
    },
    {
      provide: VenueService,
      inject: ['STATE_STORE', HistoryService, 'ASSETS'],
      useFactory: (
        store: StateStore,
        history: HistoryService,
        assets: RegisteredAsset[],
      ): VenueService =>
        new VenueService(
          store,
          keyringFromEnvironment(),
          new SystemClock(),
          assets,
          5_000,
          new PublicationService(assets),
          history,
          null,
          backfillDaysFromEnvironment(),
        ),
    },
    {
      provide: RegistrationService,
      inject: ['ASSET_REGISTRY', VenueService],
      useFactory: (registry: AssetRegistry, venue: VenueService): RegistrationService =>
        new RegistrationService(registry, venue, keyringFromEnvironment()),
    },
  ],
})
export class AppModule {}

/**
 * Days of history a brand-new asset is given, from `OTC_BACKFILL_DAYS`.
 *
 * Zero by default, and that is a decision rather than an oversight: a backfill
 * is genesis and refuses to run twice, so it is irreversible. Making an
 * irreversible act the default behaviour of a process start would let booting
 * the service in the wrong directory permanently decide what a market's past is.
 *
 * `main.ts` reads this and asks {@link HistoryService.provision} before the
 * venue starts, because the checkpoint a backfill leaves is what the venue then
 * resumes from.
 */
export function backfillDaysFromEnvironment(): number {
  const raw = process.env.OTC_BACKFILL_DAYS;
  if (raw === undefined || raw.trim().length === 0) return 0;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`OTC_BACKFILL_DAYS must be a non-negative number of days, got ${raw}.`);
  }
  return days;
}

function keyringFromEnvironment(): MasterKeyring {
  const secret = process.env.OTC_MASTER_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new Error(
      'OTC_MASTER_SECRET is not set. The runtime will not invent a secret: doing so ' +
        'would produce a different market on every boot and make settlement ' +
        'irreproducible (INV-009).',
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error('OTC_MASTER_SECRET must be 64 hex characters (32 bytes).');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(secret.slice(i * 2, i * 2 + 2), 16);
  }
  return MasterKeyring.fromSecret(process.env.OTC_KEY_ID ?? 'primary', bytes);
}
