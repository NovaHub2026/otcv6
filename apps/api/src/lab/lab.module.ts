import { Module } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { LabController } from './lab.controller.js';
import { SignSelector } from './selectableSigns.js';
import { ArrivalSelector } from './selectableArrival.js';
import { LabDistances } from './distance.js';
import { LabSession } from './session.js';
import { LabPositions } from './positions.js';
import { EngineEventObserver } from './engineEvents.js';
import { VenueService } from '../venue.service.js';

/**
 * The Lab, composed **on top of** the application rather than inside it.
 *
 * The direction of this import is the whole design: the Lab knows about the
 * application, and the application does not know the Lab exists. Reversing it —
 * an `AppModule` that imports a Lab it disables by flag — is the arrangement
 * ADR-0015 §3 refuses, because a flag is a thing that can be wrong.
 */
/**
 * The Lab's handle on every hosted engine's coin, created here and handed
 * *into* the application. The import direction is unchanged: the Lab knows the
 * application; the application receives a function and does not know whose.
 */
const selector = new SignSelector();
const arrivals = new ArrivalSelector();

@Module({
  imports: [
    AppModule.register({
      signSource: (keystream, assetId) => selector.wrap(keystream, assetId),
      arrivalSource: (keystream, assetId) => arrivals.wrap(keystream, assetId),
      /**
       * Cycle Audit 8 (a6): every checkpoint says whether this market's signs
       * were being chosen, so a restart seams instead of regenerating ticks the
       * keystream would sign differently.
       */
      control: {
        controlledSince: (assetId) => selector.for(assetId)?.controlledSinceCheckpoint ?? false,
        checkpointTaken: (assetId) => {
          selector.for(assetId)?.checkpointTaken();
        },
      },
    }),
  ],
  controllers: [LabController],
  providers: [
    { provide: SignSelector, useValue: selector },
    { provide: ArrivalSelector, useValue: arrivals },
    // PH-24.18: the distance units' cache. Every constructor parameter of the
    // controller must be a provider here — the browser suite boots the real
    // module and found this one missing. Nothing boots the module in the unit
    // project; what stands in for it is `labProviders.test.ts`, which reads
    // this list and the controller's constructor and fails by the parameter's
    // name. A provider defect elsewhere — a bad `inject` token, say — is still
    // found only at boot (Cycle Audit 8, a8).
    { provide: LabDistances, useValue: new LabDistances() },
    LabSession,
    LabPositions,
    {
      // Feeds the engine's timeline by watching the engine (PH-24.5 §4). Started
      // by `lab.main.ts` once the venue runs; stopped with the module.
      provide: EngineEventObserver,
      inject: [VenueService, LabSession],
      useFactory: (venue: VenueService, session: LabSession): EngineEventObserver =>
        new EngineEventObserver(venue, session),
    },
  ],
})
export class LabModule {}
