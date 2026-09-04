import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MasterKeyring, SystemClock } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  FileAssetRegistry,
  FileStateStore,
  SqliteCandleHistory,
  type AssetRegistry,
  type CandleHistory,
  type SignSourceFactory,
  type StateStore,
} from '@otc/runtime';
import type { RegisteredAsset } from '@otc/engine';
import { ADMIN_TOKEN, AdminWriteGuard, MIN_ADMIN_TOKEN_LENGTH } from './adminAuth.guard.js';
import { RegistrationService } from './registration.service.js';
import { HistoryService } from './history.service.js';
import { BOOT_NONCE, MarketController } from './market.controller.js';
import { PublicationService } from './publication.service.js';
import { VenueService } from './venue.service.js';

/**
 * Wiring, and nothing else.
 *
 * The master secret is read from the environment and never originates in code.
 * `MasterKeyring` redacts itself in JSON, string and inspect forms — a defect
 * PH-1 found the hard way, when a `private` field that was compile-time only
 * serialised the entire 32-byte secret.
 *
 * This file and `main.ts` are the only modules under `apps/api/src` allowed to
 * read `process.env` (the guardrail scan's ambient-state allowlist). Everything
 * the environment decides — the state directory, the secret, the backfill, the
 * admin token, the boot nonce — is read here once and handed down as a value.
 */
/**
 * What a composition may hand the application, and the one thing it may hand.
 *
 * PH-24.1. `signSource` reaches `resumeMarket` and wraps the keystream's sign
 * stream for every hosted engine. Production registers **nothing** here —
 * `main.ts` calls `register()` bare, and `composition.test.ts` asserts it — and
 * the Lab registers `SelectableSigns` (ADR-0015 §3: the boundary is what is
 * composed, not a flag).
 */
export interface AppModuleOptions {
  readonly signSource?: SignSourceFactory;
  /** The same for the arrival stream (PH-24.13); passed through, never built here. */
  readonly arrivalSource?: SignSourceFactory;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [MarketController],
      providers: [
        {
          provide: 'STATE_STORE',
          useFactory: (): StateStore =>
            new FileStateStore(process.env.OTC_STATE_DIR ?? './.otc-state'),
        },
        {
          provide: 'CANDLE_HISTORY',
          // Defaults *inside* the state directory rather than beside it. A
          // deployment that moves its state somewhere else means to move all of it,
          // and a history that stayed behind would be a chart of a different market
          // than the one the checkpoints describe.
          useFactory: (): CandleHistory =>
            new SqliteCandleHistory(
              process.env.OTC_HISTORY_DB ??
                `${process.env.OTC_STATE_DIR ?? './.otc-state'}/history.db`,
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
          /**
           * The operator's write credential, or null when none was given (a6-01).
           *
           * Null does not stop the boot: the guard refuses every write with a
           * message naming the variable, and reads carry on. A token that is set
           * but too short to be one *does* stop the boot, the way a malformed
           * master secret does.
           */
          provide: ADMIN_TOKEN,
          useFactory: (): string | null => adminTokenFromEnvironment(),
        },
        {
          /**
           * A value a test that spawns this service passes in and reads back from
           * `/health`, so it knows the service answering is the one it started
           * (a6-14). Null in every other deployment.
           */
          provide: BOOT_NONCE,
          useFactory: (): string | null => bootNonceFromEnvironment(),
        },
        {
          // Global, so no write route can be added without the credential check.
          provide: APP_GUARD,
          useClass: AdminWriteGuard,
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
              options.signSource ?? null,
              options.arrivalSource ?? null,
            ),
        },
        {
          provide: RegistrationService,
          inject: ['ASSET_REGISTRY', VenueService],
          useFactory: (registry: AssetRegistry, venue: VenueService): RegistrationService =>
            new RegistrationService(registry, venue, keyringFromEnvironment()),
        },
      ],
      /**
       * Exported so the Lab can compose on top of this module (ADR-0015 §3).
       *
       * An export, never an import: the Lab knows about the application and the
       * application does not know the Lab exists. `labSurface.test.ts` asserts the
       * direction, because reversing it is what a `LAB_ENABLED` flag looks like.
       */
      exports: [VenueService],
    };
  }
}

/**
 * The most days a backfill may be asked for in one boot.
 *
 * Ninety is what the product promises and what the evidence was measured at
 * (`CYCLE-6-BACKFILL-SCALE.md`); a year is four times that and already tens of
 * minutes of generation for a hundred assets. Above it the request is far more
 * likely a typo than an intent — and a backfill is genesis, which cannot be
 * taken back.
 */
export const MAX_BACKFILL_DAYS = 365;

/**
 * Days of history a brand-new asset is given, from `OTC_BACKFILL_DAYS`.
 *
 * Zero by default, and that is a decision rather than an oversight: a backfill
 * is genesis and refuses to run twice, so it is irreversible. Making an
 * irreversible act the default behaviour of a process start would let booting
 * the service in the wrong directory permanently decide what a market's past is.
 *
 * `VenueService.start` reads this and asks {@link HistoryService.provision}
 * before any market is resumed, because the checkpoint a backfill leaves is what
 * the venue then resumes from.
 *
 * **a6-15.** `Number(raw)` accepted `1e3`: a thousand-day, irreversible genesis
 * from a typo. The value is whole days written as digits, with a ceiling, and
 * anything else is refused by name before a market exists.
 */
export function backfillDaysFromEnvironment(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OTC_BACKFILL_DAYS;
  if (raw === undefined || raw.trim().length === 0) return 0;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(
      `OTC_BACKFILL_DAYS must be a whole number of days written as digits, got ${raw}. ` +
        'A backfill is genesis and cannot be undone, so it is not inferred from an ' +
        'exponent, a sign or a fraction.',
    );
  }
  const days = Number(raw.trim());
  if (days > MAX_BACKFILL_DAYS) {
    throw new Error(
      `OTC_BACKFILL_DAYS is ${days}; the most one boot may provision is ${MAX_BACKFILL_DAYS}.`,
    );
  }
  return days;
}

/**
 * The write credential, or null when the operator did not set one (a6-01).
 *
 * Unset is allowed and closes the write surface. Set-but-short is refused at
 * boot: a token that can be guessed is not one, and a service that booted with
 * it would be advertising an authorisation it does not have.
 */
export function adminTokenFromEnvironment(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.OTC_ADMIN_TOKEN;
  if (raw === undefined || raw.length === 0) return null;
  if (raw.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new Error(
      `OTC_ADMIN_TOKEN is ${raw.length} characters; it must be at least ` +
        `${MIN_ADMIN_TOKEN_LENGTH}. Leave it unset to run with writes refused.`,
    );
  }
  return raw;
}

/** The boot nonce a spawning test hands in, or null (a6-14). */
export function bootNonceFromEnvironment(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.OTC_BOOT_NONCE;
  return raw === undefined || raw.length === 0 ? null : raw;
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
