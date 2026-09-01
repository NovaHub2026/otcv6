import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

  // The panel is served from a different origin than the engine — `next dev` on
  // one port, this on another — so without this the browser blocks every
  // request and the operator surface simply does not work. Found by opening it.
  //
  // `*` by default, and that is a decision rather than laziness: this service is
  // entirely read-only, it publishes the public market, and INV-002 says every
  // observer sees the same market at the same moment — so there is nothing
  // origin-specific to protect. It carries nothing economic, which
  // `adminSurface.test.ts` asserts rather than assumes. An operator who wants it
  // narrower sets `OTC_CORS_ORIGIN` to a comma-separated list.
  const origins = process.env.OTC_CORS_ORIGIN;
  app.enableCors({
    origin:
      origins === undefined || origins.trim() === '' || origins.trim() === '*'
        ? true
        : origins.split(',').map((origin) => origin.trim()),
  });

  const venue = app.get(VenueService);
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
