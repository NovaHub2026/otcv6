import { Module } from '@nestjs/common';
import { MasterKeyring, SystemClock } from '@otc/core';
import { FileStateStore, type StateStore } from '@otc/runtime';
import { MarketController } from './market.controller.js';
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
      provide: VenueService,
      inject: ['STATE_STORE'],
      useFactory: (store: StateStore): VenueService =>
        new VenueService(store, keyringFromEnvironment(), new SystemClock()),
    },
  ],
})
export class AppModule {}

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
