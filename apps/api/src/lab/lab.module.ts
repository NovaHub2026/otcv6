import { Module } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { LabController } from './lab.controller.js';

/**
 * The Lab, composed **on top of** the application rather than inside it.
 *
 * The direction of this import is the whole design: the Lab knows about the
 * application, and the application does not know the Lab exists. Reversing it —
 * an `AppModule` that imports a Lab it disables by flag — is the arrangement
 * ADR-0015 §3 refuses, because a flag is a thing that can be wrong.
 */
@Module({ imports: [AppModule], controllers: [LabController] })
export class LabModule {}
