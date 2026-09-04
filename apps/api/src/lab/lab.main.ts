import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { STATE_RECORD_VERSION, type AssetRegistry } from '@otc/runtime';
import { bindAddressFromEnvironment, isExposedBind } from '../bind.js';
import { markLabState } from '../labState.js';
import { VenueService } from '../venue.service.js';
import { LabModule } from './lab.module.js';
import { EngineEventObserver } from './engineEvents.js';
import { LabSession } from './session.js';
import { SessionFile } from './sessionFile.js';

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
  // The state directory is the Lab's own — the launcher gives it one.
  const stateDir = process.env['OTC_STATE_DIR'] ?? './.otc-state';
  // Cycle Audit 8 (a4, a6): mark it **before the first tick is published**, so a
  // Lab that ran for an hour and was never touched still cannot be mistaken for
  // production later. Production refuses to resume a marked directory.
  //
  // The instant comes from the venue's injected clock, not from `Date.now()`:
  // the no-ambient-time guardrail covers this file, and it caught the first
  // version of this line.
  const marker = markLabState(
    stateDir,
    venue.now(),
    `state-record/${String(STATE_RECORD_VERSION)}`,
  );
  logger.log(`this state directory is a simulation's: ${marker}`);

  venue.applyOverlays(await app.get<AssetRegistry>('ASSET_REGISTRY').overlays());
  await venue.start();
  // The session survives the process (PH-24.8): what a previous Lab in this
  // state directory recorded is loaded, and every record from here on is
  // appended.
  const sessionFile = new SessionFile(stateDir);
  const restored = app.get(LabSession).persistTo(sessionFile.existing(), sessionFile);
  logger.log(
    `session file ${sessionFile.file}: ${String(restored.loaded)} record(s) restored` +
      (restored.skipped > 0 ? `, ${String(restored.skipped)} unreadable line(s) skipped` : ''),
  );
  // The engine's timeline, fed from here on (PH-24.5 §4).
  app.get(EngineEventObserver).start();

  const host = bindAddressFromEnvironment(process.env);
  // ADR-0018: one engine per deployment. A Lab-composed process is the whole
  // engine in simulation mode, so it takes the engine's port unless told otherwise.
  const port = Number.parseInt(process.env['OTC_LAB_PORT'] ?? process.env['PORT'] ?? '3100', 10);
  await app.listen(port, host);
  logger.warn(
    `OTC LAB — SIMULATION ENVIRONMENT on ${host}:${String(port)} ` +
      `(${isExposedBind(host) ? 'REACHABLE FROM OTHER MACHINES' : 'this machine only'}). ` +
      `This process is the whole engine — catalogue, history, ticks — plus /lab, and it serves ` +
      `engine state and keystream cursors, which production never does (ADR-0018).`,
  );
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
