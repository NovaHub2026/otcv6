import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AssetRegistry } from '@otc/runtime';
import { ADMIN_TOKEN } from './adminAuth.guard.js';
import { AppModule } from './app.module.js';
import { VenueService } from './venue.service.js';

/**
 * Boot the venue, then serve.
 *
 * The markets start before the HTTP listener does, so nothing can observe a
 * half-recovered venue. Shutdown is the mirror: stop publishing, write a final
 * checkpoint, close the history, then exit. A process that exits without
 * checkpointing is still *correct* — the next boot replays from the last one —
 * but it makes the replay longer than it needs to be.
 *
 * ## One shutdown path (a6-09)
 *
 * There were two. This file registered its own `SIGTERM` handler that called
 * `venue.stop()` and then `app.close()`, and `enableShutdownHooks()` had
 * registered Nest's, which calls every `onModuleDestroy` — `venue.stop()` again
 * — and then re-raises the signal, so `process.exit(0)` never ran and the
 * process died with status 143. Two concurrent final checkpoints from one pid is
 * the CA6-35 shape, and the SQLite history was never closed at all.
 *
 * Now Nest's hooks are the only handler. The order they run in is the order
 * shutdown needs: `onModuleDestroy` (the venue's final checkpoint and flush),
 * `beforeApplicationShutdown` (every open tick stream is told to close), the
 * HTTP listener, `onApplicationShutdown` (the history database is closed), and
 * `process.exit(0)`. `forceCloseConnections` is what makes the listener step
 * finite: `server.close()` waits for active connections, and a live market's
 * clients are all active.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    forceCloseConnections: true,
  });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM'], { useProcessExit: true });

  // The panel may be served from a different origin than the engine — `next dev`
  // on one port, this on another — and without these headers the browser blocks
  // every request and the operator surface simply does not work. Found by
  // opening it.
  //
  // **CORS is not authorisation, and this block is not what protects the write
  // surface.** It decides which origins a browser lets *read* an answer from
  // this service. What protects a write is `AdminWriteGuard` (a6-01): every
  // non-read method needs the bearer token in `OTC_ADMIN_TOKEN` and a JSON
  // content type, and a request carrying either is one a browser preflights —
  // so the preflight below is consulted for every write, from every origin.
  //
  // The wildcard default still answers a preflight with `GET, HEAD` only, so a
  // page on an unnamed origin is refused before the guard sees it; a deployment
  // that drives writes from another origin names it in `OTC_CORS_ORIGIN` and
  // gets the write methods in the preflight — and then still needs the token.
  // The panel needs neither: it proxies the engine under its own origin and adds
  // the token on its server.
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

  // Loopback by default (a6-01). The service used to listen on every interface,
  // which on a LAN meant anyone who could reach the port could create, rename
  // and retire assets. An operator who means to expose it says so:
  // `OTC_BIND=0.0.0.0` — and sets `OTC_ADMIN_TOKEN` first.
  const host = bindAddressFromEnvironment();
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, host);
  const writes =
    app.get<string | null>(ADMIN_TOKEN) === null
      ? 'writes refused (OTC_ADMIN_TOKEN is not set)'
      : 'writes need the bearer token';
  logger.log(`hosting ${venue.assetIds.length} markets on ${host}:${port}; ${writes}`);
}

/** The default bind address: this machine only. */
const DEFAULT_BIND_ADDRESS = '127.0.0.1';

function bindAddressFromEnvironment(): string {
  const raw = process.env.OTC_BIND?.trim();
  return raw === undefined || raw.length === 0 ? DEFAULT_BIND_ADDRESS : raw;
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
