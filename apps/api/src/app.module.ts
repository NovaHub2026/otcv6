import { Module } from '@nestjs/common';
import { MasterKeyring, SystemClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  FileStateStore,
  SqliteCandleHistory,
  type CandleHistory,
  type StateStore,
} from '@otc/runtime';
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
      provide: HistoryService,
      inject: ['CANDLE_HISTORY'],
      useFactory: (history: CandleHistory): HistoryService =>
        new HistoryService(history, ASSET_CATALOGUE),
    },
    {
      provide: VenueService,
      inject: ['STATE_STORE', HistoryService],
      useFactory: (store: StateStore, history: HistoryService): VenueService =>
        new VenueService(
          store,
          keyringFromEnvironment(),
          new SystemClock(),
          ASSET_CATALOGUE,
          5_000,
          new PublicationService(ASSET_CATALOGUE),
          history,
          null,
          backfillDaysFromEnvironment(),
        ),
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
