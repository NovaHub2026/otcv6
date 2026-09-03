import { BadRequestException, Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { assessRealism, buildObserverDataset, runBattery } from '@otc/lab';
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
/**
 * Ticks the bounded quality sample looks at.
 *
 * Enough for the realism metrics to have an opinion and for the battery to
 * populate its buckets, and far short of a gate run. The number is named
 * because a verdict whose sample size is unstated is the same failure as one
 * whose sensitivity is.
 */
const LAB_SAMPLE_TICKS = 40_000;

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
   * The market's quality, from the laboratory that has been running headless
   * for eight phases.
   *
   * §52–§68 of the specification describe a laboratory. `packages/lab` **is**
   * that laboratory: fifteen realism metrics with bands, and an adversarial
   * battery of roughly eight hundred hypotheses across four feature families
   * with Benjamini–Hochberg correction and confirmation on a held-out sample.
   * What it has never had is a window. This is the window.
   *
   * ## The verdict is never served without its sensitivity
   *
   * A dashboard that reports `clean` and hides the resolution at which it
   * looked is worse than no dashboard. "Clean" and "clean at a minimum
   * detectable effect of 0.22pp" are different claims, and only the second can
   * be acted on — `VALIDATION.md` exists to keep them apart, and Cycle Audit 7
   * caught PH-21 collapsing exactly that distinction for a different metric
   * (CA7-05).
   *
   * So `sensitivity` travels with `clean`, and `labSurface.test.ts` asserts
   * they cannot be separated.
   *
   * ## Why it is bounded
   *
   * A real battery run is twenty-four million ticks and belongs to a job with a
   * record (§67). This serves a bounded sample so a screen has something
   * truthful on it, and says how many ticks it looked at, because a verdict
   * whose sample size is unstated is the same failure as one whose sensitivity
   * is.
   */
  @Get('markets/:id/quality')
  async quality(@Param('id') id: string): Promise<unknown> {
    const market = this.venue.hostedMarket(id);
    const asset = this.venue.assetFor(id);
    if (market === null || asset === null)
      throw new NotFoundException(`Asset ${id} is not hosted.`);

    const ticks = this.venue.labTicksAhead(id, LAB_SAMPLE_TICKS);
    let at = 0;
    const dataset = await buildObserverDataset({
      source: { instrument: asset.instrument, next: () => ticks[at++] ?? null },
      maxTicks: ticks.length,
    });
    const realism = assessRealism(dataset);
    const predictability = runBattery(dataset);
    return {
      environment: 'OTC LAB — SIMULATION ENVIRONMENT',
      asset: id,
      sampledTicks: ticks.length,
      bounded:
        `A bounded sample, not a gate run. The recorded evidence uses 24 million ticks; this ` +
        `looks at ${String(ticks.length)} so a screen has something truthful on it.`,
      realism: {
        plausible: realism.plausible,
        passed: realism.passed,
        of: realism.metrics.length,
        failed: realism.failed,
        metrics: realism.metrics,
      },
      predictability: {
        clean: predictability.clean,
        // Never separable from `clean`: see the docstring above.
        sensitivity: predictability.sensitivity,
        hypothesesTested: predictability.coverage.hypothesesTested,
        worst: predictability.worst,
        exploitable: predictability.exploitable,
        notes: predictability.notes,
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
