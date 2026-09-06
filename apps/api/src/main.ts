import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express } from 'express';
import { SystemClock } from '@otc/core';
import {
  DirectoryLockedError,
  StateDirectoryLock,
  stateRefusal,
  verifyStateDirectory,
  type AssetRegistry,
} from '@otc/runtime';
import { ADMIN_TOKEN } from './adminAuth.guard.js';
import { AppModule } from './app.module.js';
import { VenueService } from './venue.service.js';
import {
  bindAddressFromEnvironment,
  isExposedBind,
  trustedProxiesFromEnvironment,
} from './bind.js';
import { refuseLabState } from './labState.js';

/**
 * Serve, then boot the venue.
 *
 * **The listener opens first, and readiness is what holds traffic back (Cycle
 * Audit 10, a5-02).** The markets used to resume before the listener opened,
 * which meant the socket refused connections for the whole boot: with a backfill that
 * is seconds to minutes of generation, and `/health/live` and `/health/ready`
 * first answered at the same instant. PH-30.1 §1 promises an orchestrator can
 * point its restart at liveness, and a liveness probe against a port that
 * refuses connections restarts the venue every time the backfill outlasts it —
 * for ever, since each restart begins the backfill again.
 *
 * So the process serves as soon as it can say `{"live":true}`, and
 * `/health/ready` answers `503 the markets have not finished resuming` until
 * `start()` returns. Nothing observes a half-recovered venue that was not told
 * it was looking at one: a market that has not resumed is not hosted, so it is
 * absent from `/markets` and a 404 on its own routes — never a price, and never
 * a different price than another observer's (INV-002). A deployment routes on
 * readiness (the shipped `Dockerfile` and `docker-compose.yml` health-check
 * `/health/ready`, and `deploy/nginx.conf` proxies a venue that is up).
 *
 * What this does **not** change: a first boot whose backfill outlasts the
 * shipped 60 s health-check start period is still unhealthy when it expires —
 * `OTC_BACKFILL_DAYS` decides that and no default can. What changed is that
 * the probe now gets `503 the markets have not finished resuming` instead of a
 * refused connection, which is the difference between an operator seeing a
 * venue that is working and one seeing a venue that is not there.
 *
 * Shutdown is the mirror: stop publishing, write a final
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
  // Cycle Audit 8 (a4, a6): a Lab-composed engine and this one are pointed at
  // the same directory by one environment variable, and until this line nothing
  // noticed. A record an operator steered must not become production's by a
  // redeploy — see `labState.ts` for what the mark is and why there is no
  // variable to wave it through.
  const refusal = refuseLabState(process.env.OTC_STATE_DIR ?? './.otc-state');
  if (refusal !== null) {
    logger.error(refusal);
    process.exit(1);
  }
  // PH-28.3: the directory's files must agree with one another before any
  // market resumes. A record restored beside a newer checkpoint, a history
  // ahead of the record, a database from newer code — each boots a venue that
  // serves something observers did not see, and each is refused here by name.
  // A warning is a seam a resume will take and say so; it is logged, not fatal.
  const stateDir = process.env.OTC_STATE_DIR ?? './.otc-state';
  const report = await verifyStateDirectory(stateDir);
  for (const warning of report.warnings) {
    logger.warn(
      `${warning.file}${warning.assetId === null ? '' : ` (${warning.assetId})`}: ${warning.detail}`,
    );
  }
  const inconsistent = stateRefusal(report);
  if (inconsistent !== null) {
    logger.error(inconsistent);
    process.exit(1);
  }
  // One writer per state directory (Cycle Audit 10: a3-07, a6-05). Two processes pointed at
  // one directory both booted, both hosted the catalogue, and both fell
  // permanently into a3-06 while reporting `ok`, `stalled: []`, `ready: true`
  // and a climbing tick counter. The lock is taken before anything is opened
  // for writing, and after the consistency check, so a refused start has read
  // the directory and changed nothing in it.
  const clock = new SystemClock();
  let lock: StateDirectoryLock;
  try {
    lock = await StateDirectoryLock.acquire(stateDir, { now: () => clock.now() });
  } catch (error) {
    if (error instanceof DirectoryLockedError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  if (lock.tookOverFrom !== null) {
    // Loud, because it is the difference between a clean restart and a
    // process that was killed: an operator who sees this after a deploy that
    // did not stop the old unit is looking at the cause of their next outage.
    logger.warn(
      `took the state directory over from ${lock.tookOverFrom.holder} ` +
        `(pid ${String(lock.tookOverFrom.pid)} on ${lock.tookOverFrom.host}): its lock was ` +
        `abandoned. If that process is still running, stop it now — two writers on one ` +
        `directory serve nothing and report healthy.`,
    );
  }
  // `process.exit` runs `'exit'` listeners and stops; a promise scheduled there
  // never resolves, so the release is the synchronous one. Not releasing would
  // still be safe — the next boot adopts an abandoned lock — but a clean
  // shutdown should not look like a crash to the boot that follows it.
  process.on('exit', () => {
    lock.releaseSync();
  });
  // Bare: production registers no sign source (PH-24.1, `composition.test.ts`).
  const app = await NestFactory.create(AppModule.register(), {
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
  // **Whose address the venue thinks it is talking to (Cycle Audit 10).** The
  // rate limit keys on it, so with nothing configured behind the shipped
  // reverse proxy every client shared one bucket. Express only reads
  // `X-Forwarded-For` when it is told how many hops to trust, and trusting
  // that header from a direct client would be the same defect pointing the
  // other way — so this is 0 unless the deployment says otherwise.
  //
  // Typed, because `getInstance()` is `any` and `eslint .` refuses an unsafe
  // call on one: this line shipped in `ef32e12` and has been failing the lint
  // step of the gate ever since, which is a check nobody ran between the fix
  // and this audit. Not this fix's subject, and two lines away from it.
  const trustedProxies = trustedProxiesFromEnvironment(process.env);
  if (trustedProxies > 0) {
    // Typed, because `getInstance()` is `any` by default and the type-aware
    // lint refuses a call on one (the hop count arrived in Cycle Audit 10 and
    // took `npm run lint` red with it).
    const express = app.getHttpAdapter().getInstance() as Express;
    express.set('trust proxy', trustedProxies);
  }

  const origins = process.env.OTC_CORS_ORIGIN;
  const wildcard = origins === undefined || origins.trim() === '' || origins.trim() === '*';
  app.enableCors({
    origin: wildcard ? true : origins.split(',').map((origin) => origin.trim()),
    methods: wildcard ? ['GET', 'HEAD'] : ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
  });

  const venue = app.get(VenueService);
  // The venue renews the lock on its checkpoint cadence and stops publishing
  // the moment a renewal is refused, so the guarantee is two-sided: a second
  // process is refused at boot, and a first process that has been superseded
  // loses leadership rather than both carrying on.
  venue.holdWriterLock(lock);

  // Loopback by default (a6-01). The service used to listen on every interface,
  // which on a LAN meant anyone who could reach the port could create, rename
  // and retire assets. An operator who means to expose it says so:
  // `OTC_BIND=0.0.0.0` — and sets `OTC_ADMIN_TOKEN` first.
  const host = bindAddressFromEnvironment(process.env);
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  // From here `/health/live` answers, and `/health/ready` refuses with the
  // reason until the line below returns (a5-02).
  await app.listen(port, host);
  logger.log(`listening on ${host}:${port}; resuming the markets`);

  // Overlays before start: a retirement decides whether a market is resumed at
  // all, so it has to be known before the resume loop runs.
  venue.applyOverlays(await app.get<AssetRegistry>('ASSET_REGISTRY').overlays());
  await venue.start();

  const writes =
    app.get<string | null>(ADMIN_TOKEN) === null
      ? 'writes refused (OTC_ADMIN_TOKEN is not set)'
      : 'writes need the bearer token';
  // The boot line says plainly when the service is reachable from outside this
  // machine. It printed the address and left the reader to work out what it
  // meant, which is not the same thing (CA7-28).
  const reach = isExposedBind(host) ? 'REACHABLE FROM OTHER MACHINES' : 'this machine only';
  logger.log(`hosting ${venue.assetIds.length} markets on ${host}:${port} (${reach}); ${writes}`);
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
