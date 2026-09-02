import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AssetRegistry } from '@otc/runtime';
import { AppModule } from './app.module.js';
import { VenueService } from './venue.service.js';

/**
 * Boot the venue, then serve.
 *
 * The markets start before the HTTP listener does, so nothing can observe a
 * half-recovered venue. Shutdown is the mirror: stop publishing, write a final
 * checkpoint, then close. A process that exits without checkpointing is still
 * *correct* — the next boot replays from the last one — but it makes the replay
 * longer than it needs to be.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();

  // The panel may be served from a different origin than the engine — `next dev`
  // on one port, this on another — and without these headers the browser blocks
  // every request and the operator surface simply does not work. Found by
  // opening it.
  //
  // **Reads are open to any origin; writes are not.** That distinction arrived
  // with PH-20.2. Until then this service was entirely read-only and `*` cost
  // nothing: it publishes the public market, and INV-002 says every observer
  // sees the same market at the same moment, so there is nothing origin-specific
  // to protect. `POST /assets` changed that — it has no authentication, because
  // it is an operator surface on an operator's own network, and an open
  // cross-origin write is then a page in another tab creating markets.
  //
  // So the wildcard default allows GET and HEAD only. A deployment that really
  // does drive this from another origin names that origin in `OTC_CORS_ORIGIN`
  // and gets the write methods with it. The panel needs neither: it proxies the
  // engine under its own origin.
  const origins = process.env.OTC_CORS_ORIGIN;
  const wildcard = origins === undefined || origins.trim() === '' || origins.trim() === '*';
  app.enableCors({
    origin: wildcard ? true : origins.split(',').map((origin) => origin.trim()),
    methods: wildcard ? ['GET', 'HEAD'] : ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
  });

  const venue = app.get(VenueService);
  // Overlays before start: a retirement decides whether a market is resumed at
  // all, so it has to be known before the resume loop runs.
  venue.applyOverlays(await app.get<AssetRegistry>('ASSET_REGISTRY').overlays());
  await venue.start();

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  logger.log(`hosting ${venue.assetIds.length} markets on :${port}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void (async (): Promise<void> => {
        logger.log(`${signal} — checkpointing before exit`);
        await venue.stop();
        await app.close();
        process.exit(0);
      })();
    });
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
