import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AssetRegistry } from '@otc/runtime';
import { bindAddressFromEnvironment, isExposedBind } from '../bind.js';
import { VenueService } from '../venue.service.js';
import { LabModule } from './lab.module.js';
import { EngineEventObserver } from './engineEvents.js';

/**
 * The Lab's entry point, and the reason there are two.
 *
 * Production runs `main.ts`, which composes `AppModule` and nothing else. The
 * Lab runs this, which composes `LabModule` — and `LabModule` imports
 * `AppModule`, never the reverse.
 *
 * That direction is the whole boundary (ADR-0015 §3). A single entry point with
 * a `LAB_ENABLED` flag would put the Lab's routes in the production binary and
 * make their absence a claim about an environment variable. Cycle Audit 7
 * measured what claims about environment variables are worth.
 *
 * It binds loopback like the service does, and for a stronger reason: this
 * process serves keystream cursors (INV-010).
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('OtcLab');
  const app = await NestFactory.create(LabModule, { bufferLogs: false });
  app.enableShutdownHooks();

  const venue = app.get(VenueService);
  venue.applyOverlays(await app.get<AssetRegistry>('ASSET_REGISTRY').overlays());
  await venue.start();
  // The engine's timeline, fed from here on (PH-24.5 §4).
  app.get(EngineEventObserver).start();

  const host = bindAddressFromEnvironment(process.env);
  const port = Number.parseInt(process.env['OTC_LAB_PORT'] ?? '3100', 10);
  await app.listen(port, host);
  logger.warn(
    `OTC LAB — SIMULATION ENVIRONMENT on ${host}:${String(port)} ` +
      `(${isExposedBind(host) ? 'REACHABLE FROM OTHER MACHINES' : 'this machine only'}). ` +
      `This process serves engine state and keystream cursors, which production never does.`,
  );
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
