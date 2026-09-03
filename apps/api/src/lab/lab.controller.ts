import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { displayPrice } from '@otc/chart';
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
const LAB_SAMPLE_TICKS = 1_000_000;

/**
 * Below this many surviving hypotheses there is no verdict, only a word.
 *
 * The battery drops any bucket holding fewer than 500 decided outcomes, so a
 * small sample does not weaken the verdict — it shrinks the number of
 * hypotheses behind it, and "clean" reads identically at 2 and at 378. Measured
 * on this engine, EUR/USD, on 2026-09-03:
 *
 * |     ticks | hypotheses | seconds |
 * | --------: | ---------: | ------: |
 * |    40,000 |          2 |     1.4 |
 * |   200,000 |         92 |     7.0 |
 * | 1,000,000 |        378 |     5.7 |
 * | 2,000,000 |        575 |     7.3 |
 *
 * The first row is what this route served until that table existed: a green
 * `clean` resting on two hypotheses out of the eight hundred the battery
 * defines. The recorded evidence runs above 300 (`report.stat.test.ts`), which
 * is where the default now sits, and it costs six seconds.
 */
const LAB_MIN_HYPOTHESES = 100;

/** The ceiling on a request-bound run. Beyond this belongs to a job with a record (§67). */
const LAB_MAX_SAMPLE_TICKS = 2_000_000;

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
  /**
   * The markets this Lab hosts — and only this Lab.
   *
   * The panel's Lab screen lists these rather than the production catalogue,
   * and that is the boundary rather than a convenience. §3 of the specification
   * says Lab controls must never be available for manipulating a live market
   * carrying positions; a screen that listed production's assets beside a
   * "select this close" control would be offering exactly that, whatever the
   * request underneath actually reached.
   *
   * So the Lab names its own venue. Run with its own state directory it hosts
   * its own markets, which carry nothing, and the screen has no way to name a
   * production asset because it never learns one.
   */
  @Get('markets')
  markets(): unknown {
    const hosted = new Set(this.venue.assetIds);
    return {
      environment: 'OTC LAB — SIMULATION ENVIRONMENT',
      markets: this.venue.catalogue
        .filter((asset) => hosted.has(asset.definition.id))
        .map((asset) => ({
          id: asset.definition.id,
          displayName: asset.definition.displayName,
          family: asset.definition.family,
        })),
    };
  }

  @Get('markets/:id/state')
  state(@Param('id') id: string): unknown {
    const market = this.venue.hostedMarket(id);
    if (market === null) throw new NotFoundException(`Asset ${id} is not hosted.`);
    const asset = this.venue.catalogue.find((entry) => entry.definition.id === id)!;
    const snapshot = market.snapshotEngine();
    return {
      environment: 'OTC LAB — SIMULATION ENVIRONMENT',
      asset: id,
      sequence: snapshot.sequence,
      instant: snapshot.instant,
      /**
       * Both, named for what each is.
       *
       * `snapshot.price` is the integer log-lattice level (ADR-0004), and for
       * EUR/USD it reads -12294 while the market shows 1.08. A field called
       * `price` carrying that number puts a lattice index on a screen under the
       * word price — and this is the screen where an operator decides whether a
       * close is reachable, so the two must not be confused.
       */
      latticeLevel: snapshot.price,
      price: displayPrice(snapshot.price, {
        logQuantum: asset.instrument.logQuantum,
        referencePrice: asset.instrument.referencePrice,
        displayPrecision: asset.instrument.displayPrecision,
      }).toFixed(asset.instrument.displayPrecision),
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
  async quality(@Param('id') id: string, @Query('ticks') requested?: string): Promise<unknown> {
    const market = this.venue.hostedMarket(id);
    const asset = this.venue.assetFor(id);
    if (market === null || asset === null)
      throw new NotFoundException(`Asset ${id} is not hosted.`);

    const sample = sampleSize(requested);
    const ticks = this.venue.labTicksAhead(id, sample);
    let at = 0;
    const dataset = await buildObserverDataset({
      source: { instrument: asset.instrument, next: () => ticks[at++] ?? null },
      maxTicks: ticks.length,
    });
    const realism = assessRealism(dataset);
    const predictability = runBattery(dataset);
    // The coarsest resolution across horizons: the verdict is only ever "no
    // edge above this". `VALIDATION.md` exists to keep those two claims apart.
    const resolutionPoints = predictability.sensitivity.reduce(
      (worst, s) => Math.max(worst, s.minimumDetectableEffectPoints),
      0,
    );
    const tested = predictability.coverage.hypothesesTested;
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
        /**
         * Why a failing metric here is a reading and not a finding.
         *
         * Measured on 2026-09-03: three consecutive forks of the same EUR/USD
         * market at this sample size returned 14/15, 15/15 and 15/15, the odd
         * one out being `aggregational-gaussianity`. So a bounded run's realism
         * verdict flips between runs, and printing `IMPLAUSIBLE` from one of
         * them is the same error as printing `clean` off two hypotheses — a
         * claim the sample cannot support, in a word that reads like one it
         * can.
         *
         * The stable verdict is the gate's, over 24 million ticks. This says
         * which metrics fell outside their band on this fork, and no more.
         */
        note:
          realism.failed.length === 0
            ? `All ${String(realism.metrics.length)} metrics inside their bands on this fork of ` +
              `${String(ticks.length)} ticks. The gate's verdict is the one over 24 million.`
            : `Outside their bands on this fork: ${realism.failed.join(', ')}. A bounded sample's ` +
              `realism verdict is not stable — three consecutive forks of one market measured ` +
              `14/15, 15/15 and 15/15 on 2026-09-03. This is a reading, not a finding.`,
        metrics: realism.metrics,
      },
      predictability: {
        /**
         * The word a screen prints, and it is never the bare `clean`.
         *
         * Three outcomes, because there are three things that can be true.
         * `inconclusive` when too few hypotheses survived the battery's
         * occupancy floor to have looked at the space at all — that is not a
         * weaker clean, it is no verdict. `exploitable` when an attack landed.
         * Otherwise `clean-above-resolution`, which is the honest name for what
         * a bounded run can establish: no edge **above** `resolutionPoints`.
         */
        verdict:
          tested < LAB_MIN_HYPOTHESES
            ? 'inconclusive'
            : predictability.clean
              ? 'clean-above-resolution'
              : 'exploitable',
        clean: predictability.clean,
        resolutionPoints,
        minimumHypotheses: LAB_MIN_HYPOTHESES,
        // Never separable from `clean`: see the docstring above.
        sensitivity: predictability.sensitivity,
        hypothesesTested: tested,
        bucketsSkippedForOccupancy: predictability.coverage.bucketsSkippedForOccupancy,
        worst: predictability.worst,
        exploitable: predictability.exploitable,
        // The battery's own account of what it could not test. This is the
        // sentence that keeps `clean` honest, and it was being computed and
        // dropped on the floor.
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

/**
 * How many ticks the bounded run looks at.
 *
 * A parameter rather than a constant because the answer it buys is not
 * linear in it: the battery drops any bucket holding fewer than its occupancy
 * floor of decided outcomes, so a small sample does not produce a weaker
 * verdict — it produces a verdict resting on two hypotheses out of eight
 * hundred, which is a different thing and reads identically on a screen.
 */
function sampleSize(requested?: string): number {
  if (requested === undefined || requested.trim().length === 0) return LAB_SAMPLE_TICKS;
  const value = Number(requested);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > LAB_MAX_SAMPLE_TICKS) {
    throw new BadRequestException(
      `ticks must be an integer in [1000, ${String(LAB_MAX_SAMPLE_TICKS)}], received ${requested}.`,
    );
  }
  return value;
}
