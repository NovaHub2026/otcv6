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
  // eslint-disable-next-line no-console -- the process is about to die; this is the only channel left
  console.error(error);
  process.exit(1);
});
