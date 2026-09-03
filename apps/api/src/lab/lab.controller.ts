import { BadRequestException, Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { selectClose } from '@otc/engine';
import { VenueService } from '../venue.service.js';

/**
 * The OTC Lab's read surface.
 *
 * Everything here is forbidden in production, and the boundary is **composition
 * rather than configuration** (ADR-0015 §3). This controller lives in
 * `LabModule`, which `AppModule` does not import. Not present and disabled —
 * absent. A flag is a thing that can be wrong, and Cycle Audit 7 measured what
 * claims about flags are worth: a bind default no test pinned, a portability
 * scan that skipped the directory its own docstring named, a browser suite
 * reporting passes while launching nothing.
 *
 * `labSurface.test.ts` asserts the absence by reading the production
 * composition, and is watched failing against a plant that imports this module.
 *
 * ## What is exposed here and nowhere else
 *
 * - Latent magnitude and rhythm state: not a leak on its own, an input to one.
 * - **Keystream cursors**, which INV-010 forbids publishing outright. A cursor
 *   with the key reconstructs every future price; a cursor alone narrows the
 *   search enormously. This is the sharpest item on the list and the reason the
 *   boundary is structural.
 */
@Controller('lab')
export class LabController {
  constructor(private readonly venue: VenueService) {}

  /**
   * The engine's internal state for one asset.
   *
   * §8 of the specification, and §10 corrected. The specification asks for the
   * engine's directional probabilities — "UP 51.8% / DOWN 48.2%" with an
   * influence breakdown. **Those numbers cannot exist here.** The sign is an
   * independent fair coin at every tick and the magnitude engine is
   * structurally unable to observe one, so the value is exactly 50/50 always,
   * and no influence can move it.
   *
   * What is returned instead is the latent *magnitude and rhythm* state, beside
   * a line saying why direction is 50/50. An operator asking whether this market
   * is exploitable is better served by that sentence, and by the battery behind
   * it, than by a number that would have to be invented to display.
   */
  @Get('markets/:id/state')
  state(@Param('id') id: string): unknown {
    const market = this.venue.hostedMarket(id);
    if (market === null) throw new NotFoundException(`Asset ${id} is not hosted.`);
    const snapshot = market.snapshotEngine();
    return {
      environment: 'OTC LAB — SIMULATION ENVIRONMENT',
      asset: id,
      sequence: snapshot.sequence,
      instant: snapshot.instant,
      price: snapshot.price,
      previousMagnitude: snapshot.previousMagnitude,
      previousIntervalMs: snapshot.previousIntervalMs,
      magnitudeState: snapshot.magnitudeState,
      arrivalState: snapshot.arrivalState,
      /** INV-010: this is the reason this route may not exist in production. */
      cursors: snapshot.cursors,
      direction: {
        up: 0.5,
        down: 0.5,
        why:
          'Exactly one half, always, by construction rather than by calibration. ' +
          'An increment is sign x magnitude; the sign is an independent fair coin and the ' +
          'magnitude engine cannot observe a sign, a price, or anything derived from them ' +
          '(ADR-0003). There is no influence breakdown because there is nothing to break down.',
      },
    };
  }

  /**
   * Whether a requested close is reachable, and how hard.
   *
   * §36. The answer is the sampler's own acceptance rate rather than a rule of
   * thumb — a measured probability. Parity and range impossibilities are named
   * without sampling, because exhaustion is a poor way to learn them.
   *
   * This route reports; it does not apply. Applying a close is PH-23.4, and it
   * belongs behind the same boundary.
   */
  @Get('markets/:id/reachable/:delta')
  reachable(@Param('id') id: string, @Param('delta') delta: string): unknown {
    const market = this.venue.hostedMarket(id);
    if (market === null) throw new NotFoundException(`Asset ${id} is not hosted.`);
    if (!/^-?\d+$/.test(delta)) {
      throw new BadRequestException(`delta must be a whole number of lattice steps, got ${delta}.`);
    }
    const steps = this.venue.labStepsAhead(id, 60_000);
    const selection = selectClose({
      steps,
      delta: Number.parseInt(delta, 10),
      random: this.venue.labRandom(id),
      maxAttempts: 200_000,
    });
    return {
      environment: 'OTC LAB — SIMULATION ENVIRONMENT',
      asset: id,
      delta: Number.parseInt(delta, 10),
      ticksRemaining: steps.length,
      attempts: selection.attempts,
      acceptanceRate: selection.acceptanceRate,
      reachability: selection.reachability,
      impossible: selection.impossible,
    };
  }
}
