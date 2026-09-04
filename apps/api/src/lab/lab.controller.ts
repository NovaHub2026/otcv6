import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { displayPrice } from '@otc/chart';
import {
  epochMillis,
  isTimeframeId,
  logPrice,
  type EpochMillis,
  type LogPrice,
  type Tick,
} from '@otc/core';
import { assessRealism, buildObserverDataset, runBatteryAsync, tickGranularity } from '@otc/lab';
import {
  INTERVENTIONS,
  nextShock,
  selectClose,
  selectContinuation,
  type Continuation,
} from '@otc/engine';
import { STATE_RECORD_VERSION } from '@otc/runtime';
import { VenueService } from '../venue.service.js';
import {
  closeInstant,
  planClose,
  planConditionedClose,
  readWindow,
  resolveTarget,
  type CloseCondition,
} from './closeControl.js';
import { isPreset, LabPositions, presetLevel, PRESETS, type LabPosition } from './positions.js';
import { closesDiagnostic } from './closesDiagnostic.js';
import { positionsDiagnostic, type SettledPosition } from './positionsDiagnostic.js';
import { SCENARIOS, scenarioNamed, scenarioParameters, shapeOf } from './scenarios.js';
import { SelectableSigns, SignSelector, BIAS_MAX_MS } from './selectableSigns.js';
import { distanceUnitFrom, LabDistances, type DistanceUnit } from './distance.js';
import {
  ArrivalSelector,
  PACES,
  paceIntervalMs,
  SelectableArrival,
  type Pace,
} from './selectableArrival.js';
import { LabSession } from './session.js';

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
 * The span the bounded quality sample covers.
 *
 * Enough for the realism metrics to have an opinion and for the battery to
 * populate its buckets, and far short of a gate run. It was a million ticks;
 * PH-24.17 made it the sixteen days a million ticks covered on EUR/USD then,
 * because hypotheses at 30 s–15 m are bought with time, and a market with
 * three to four times the ticks a minute covered a quarter of the time with
 * the same count (129 hypotheses against 378). The number is named because a
 * verdict whose sample size is unstated is the same failure as one whose
 * sensitivity is.
 */
const LAB_SAMPLE_SPAN_MS = 1_000_000 * 1_380;

/** The default sample for an asset: its span in its own ticks, within the bound. */
function defaultSampleTicks(meanIntervalMs: number): number {
  return Math.min(
    LAB_MAX_SAMPLE_TICKS,
    Math.max(1_000, Math.round(LAB_SAMPLE_SPAN_MS / meanIntervalMs)),
  );
}

/** Every Lab response says what it is (§3). */
const LAB = 'OTC LAB — SIMULATION ENVIRONMENT';

/**
 * §37's synthetic terminal tick, refused by name (PH-24.5 §3, DECISION-LOG
 * 2026-09-03). Inside the Lab it has nowhere to go: appended to the feed it
 * collides with the engine's own sequence (INV-002); kept beside the feed it
 * settles a position at a price no chart showed (INV-003). Widen the window.
 */
/** A relative close, in lattice steps, or null when the request named a price. */
function deltaOf(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  return Number.parseInt(raw.trim(), 10);
}

const NON_NATURAL_REFUSED =
  'nonNatural is not available. A synthetic tick appended to the feed would collide with the ' +
  "engine's own sequence numbering (INV-002); one kept beside the feed would settle a position at " +
  'a price no chart showed (INV-003). Neither is a Lab. Widen the window — the next candle, a ' +
  'longer timeframe, an expiry further out — until selection reaches the target, or take a ' +
  'reachable neighbour.';

/**
 * What §78's "engine version" is, here.
 *
 * No code version constant exists in this repository — `@otc/engine` is
 * `0.0.0` and the commit is not available at runtime — so the honest identity a
 * record can carry is the state-record format the snapshot follows. It is
 * named as what it is rather than dressed as a semver.
 */
const ENGINE_VERSION = `state-record/${String(STATE_RECORD_VERSION)}`;

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
const LAB_MAX_SAMPLE_TICKS = 8_000_000;

/** The most ticks one push may arm: past this the operator is drawing a chart, not pushing (PH-24.10). */
const PUSH_MAX_TICKS = 50;
/** By distance the fork decides the count; this is how far it may look. */
const PUSH_MAX_TICKS_BY_DISTANCE = 400;

const PUSH_RUNNING =
  'PUSH_RUNNING: a push is running on this market and a plan computed on the keystream would ' +
  'not describe it. Wait for the push to end or release it.';

@Controller('lab')
export class LabController {
  constructor(
    private readonly venue: VenueService,
    private readonly signs: SignSelector,
    private readonly session: LabSession,
    private readonly positions: LabPositions = new LabPositions(),
    private readonly arrivals: ArrivalSelector = new ArrivalSelector(),
    private readonly distances: LabDistances = new LabDistances(),
  ) {}

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
      /**
       * The lattice itself (PH-24.20): the panel's ▲ ▼ step a price one unit
       * along it with the kernel's own conversions, so what they put in the
       * box is a level that renders back to itself — a price plus a fixed
       * increment is not, two times in three at EUR/USD's grain, and a close
       * asked there is refused as between two levels.
       */
      instrument: {
        logQuantum: asset.instrument.logQuantum,
        referencePrice: asset.instrument.referencePrice,
        displayPrecision: asset.instrument.displayPrecision,
      },
      previousMagnitude: snapshot.previousMagnitude,
      previousIntervalMs: snapshot.previousIntervalMs,
      /**
       * Trend strength, as what it is (PH-24.8 §1.4): net displacement in
       * lattice steps over the last minute and five minutes, read from the
       * Lab's own feed. The engine has no trend mechanism to expose; a realised
       * trend is an excursion of a fair walk, and this is its size.
       */
      netDisplacement: this.netDisplacement(id, snapshot.instant),
      distance: this.distanceUnit(id),
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

    const sample = sampleSize(requested, asset.evidence.meanIntervalMs);
    // PH-24.17: yielding — a span at the finer grain is millions of ticks.
    const ticks = await this.venue.labTicksAheadAsync(id, sample);
    let at = 0;
    const dataset = await buildObserverDataset({
      source: { instrument: asset.instrument, next: () => ticks[at++] ?? null },
      maxTicks: ticks.length,
    });
    const realism = assessRealism(dataset);
    // PH-24.17: what the chart shows of the tick structure — ticks per candle, the boundary gap.
    const granularity = tickGranularity(ticks);
    const predictability = await runBatteryAsync(dataset);
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
      granularity,
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
   * This route reports; it does not apply. Applying a close is PH-24.2, on the
   * sign source PH-24.1 composes, and it belongs behind the same boundary.
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

  // ── Candle Close Control on a real candle (PH-24.2) ─────────────────────

  /**
   * What applying this close would do, without doing it.
   *
   * The same computation `apply` performs — target resolved against the
   * lattice, window read from a fork up to and including the candle's end
   * (ADR-0017), selection attempted, reachability measured — returned as a
   * preview. A price that is not a lattice level answers with the two levels
   * around it (409); an off-parity level answers with its two reachable
   * neighbours; nothing is armed.
   */
  @Get('markets/:id/close/preview')
  closePreview(
    @Param('id') id: string,
    @Query('price') price?: string,
    @Query('bucket') bucket?: string,
    @Query('timeframe') tf?: string,
    @Query('expiry') expiry?: string,
    @Query('nonNatural') nonNatural?: string,
    @Query('delta') delta?: string,
    @Query('condition') condition?: string,
  ): unknown {
    if (nonNatural !== undefined) throw new BadRequestException(NON_NATURAL_REFUSED);
    const request = this.closeRequest(id, price, bucket, tf, expiry, delta, condition);
    return {
      ...this.planAt(id, request.price, request.instant, request.delta, request.condition),
      environment: LAB,
      armed: false,
    };
  }

  /**
   * Select a close and arm it, in one critical section.
   *
   * Read, select and arm happen inside `betweenAdvances`, synchronously: the
   * fork describes the future from the engine's current state, and an advance
   * between the read and the arm would make the vector begin one tick late
   * (PH-24.2 §2). The session records the act with §78's fields whether or not
   * a vector was found — a refused close is an action too.
   */
  @Post('markets/:id/close')
  async applyClose(
    @Param('id') id: string,
    @Query('price') price?: string,
    @Query('bucket') bucket?: string,
    @Query('timeframe') tf?: string,
    @Query('expiry') expiry?: string,
    @Query('nonNatural') nonNatural?: string,
    @Query('delta') delta?: string,
    @Query('condition') condition?: string,
  ): Promise<unknown> {
    if (nonNatural !== undefined) throw new BadRequestException(NON_NATURAL_REFUSED);
    const request = this.closeRequest(id, price, bucket, tf, expiry, delta, condition);
    const result = await this.applyAt(
      id,
      {
        price: request.price,
        instant: request.instant,
        delta: request.delta,
        condition: request.condition,
      },
      'close.apply',
      {
        bucket: request.bucket,
        timeframe: request.timeframe,
        condition: request.condition,
      },
    );
    return { ...result.plan, environment: LAB, armed: result.armed, adjusted: result.adjusted };
  }

  /**
   * Apply a close at an instant: the one path `close` and every preset share.
   *
   * Read, select and arm inside `betweenAdvances`, synchronously (PH-24.2 §2);
   * record the act with §78's fields whether or not a vector was found — a
   * refused close is an action too; remember what was armed so `control` can
   * say what became of it.
   */
  private async applyAt(
    id: string,
    request: {
      price: string;
      instant: EpochMillis;
      delta?: number | null;
      condition?: CloseCondition;
    },
    action: string,
    parameters: Record<string, unknown>,
  ): Promise<{
    plan: ReturnType<LabController['planAt']>;
    armed: boolean;
    adjusted: { requested: string; applied: string; why: 'parity' } | null;
  }> {
    const wrapper = this.wrapperFor(id);
    // PH-24.24: an expiry that already ran is recorded before this act's own
    // record, so the session reads in the order things happened.
    this.noticeBiasExpiry(id, wrapper);
    const at = this.venue.now();
    const before = this.controlState(id);
    this.refuseWhilePushing(id, wrapper, action, parameters, before);
    const result = await this.venue.betweenAdvances(() => {
      const condition = request.condition ?? 'exact';
      let plan = this.planAt(id, request.price, request.instant, request.delta ?? null, condition);
      let adjusted: { requested: string; applied: string; why: 'parity' } | null = null;
      // PH-24.17: at three to four times the ticks a minute, the parity of the
      // window flips within a second of a preview — a price offered as
      // reachable a moment ago can be off-parity by the time it is applied. An
      // apply therefore takes the reachable neighbour on the requested side,
      // one lattice step away, and says so; a preview still names both.
      if (
        condition === 'exact' &&
        plan.selection === null &&
        plan.impossible !== null &&
        /parity/.test(plan.impossible) &&
        plan.reachableNeighbours !== null &&
        plan.reachableNeighbours.length === 2
      ) {
        const upward =
          request.delta !== undefined && request.delta !== null
            ? request.delta >= 0
            : plan.target >= plan.fromPrice;
        const neighbour = plan.reachableNeighbours[upward ? 1 : 0]!;
        const requested = plan.price;
        plan = this.planAt(id, neighbour, request.instant, null);
        adjusted = { requested, applied: plan.price, why: 'parity' };
      }
      const signs = plan.selection;
      if (signs !== null && signs.length > 0) wrapper.arm(signs);
      return { plan, armed: signs !== null && signs.length > 0, adjusted };
    });
    this.session.recordAction({
      at,
      asset: id,
      engineVersion: ENGINE_VERSION,
      action,
      parameters: { ...parameters, price: request.price, instant: request.instant },
      initialState: before,
      resultingState: this.controlState(id),
      succeeded: result.armed,
      diagnostics: {
        target: result.plan.target,
        delta: result.plan.delta,
        ticksInWindow: result.plan.ticksInWindow,
        attempts: result.plan.attempts,
        acceptanceRate: result.plan.acceptanceRate,
        reachability: result.plan.reachability,
        impossible: result.plan.impossible,
        adjusted: result.adjusted,
        condition: request.condition ?? 'exact',
        natural: result.plan.natural,
      },
    });
    if (result.armed) {
      this.applied.set(id, {
        instant: result.plan.instant,
        target: result.plan.target,
        fromSequence: before.sequence,
      });
    }
    return result;
  }

  /**
   * Push or pull the price by `N` ticks — naturally (PH-24.10).
   *
   * Nothing is added to a price. The next `|N|` draws take the sign asked for;
   * the magnitudes and intervals are the engine's own, drawn as they would have
   * been, and then the keystream resumes. A push while one runs extends it in
   * the same direction and replaces what remains in the other. The landing is
   * computed on a fork playing the same signs: the Lab may look.
   */
  @Post('markets/:id/push')
  async push(
    @Param('id') id: string,
    @Query('ticks') ticksText?: string,
    @Query('pace') paceText?: string,
    @Query('distance') distanceText?: string,
  ): Promise<unknown> {
    // PH-24.18: a push may be asked as a distance in the market's own unit —
    // a quarter of its median 1m candle — and the Lab finds on a fork how many
    // ticks at this pace it takes. `ticks=` stays for the API's own use.
    const units = distanceText === undefined ? null : Number(distanceText);
    if (units !== null) {
      if (!/^[+-]?\d+$/.test(distanceText!.trim()) || units === 0 || Math.abs(units) > 20) {
        throw new BadRequestException(
          'distance must be a whole number of units, 1..20 or its negative.',
        );
      }
    }
    const ticks =
      units !== null ? Math.sign(units) * PUSH_MAX_TICKS_BY_DISTANCE : Number(ticksText);
    const pace: Pace = (paceText ?? 'rapido') as Pace;
    if (!PACES.includes(pace)) {
      throw new BadRequestException(
        `pace must be one of ${PACES.join(', ')}, received ${paceText}.`,
      );
    }
    if (
      units === null &&
      (ticksText === undefined ||
        !/^[+-]?\d+$/.test(ticksText.trim()) ||
        !Number.isSafeInteger(ticks) ||
        ticks === 0 ||
        Math.abs(ticks) > PUSH_MAX_TICKS)
    ) {
      throw new BadRequestException(
        `ticks must be a whole number of ticks, 1..${String(PUSH_MAX_TICKS)} or its negative.`,
      );
    }
    const wrapper = this.wrapperFor(id);
    this.noticeBiasExpiry(id, wrapper);
    const at = this.venue.now();
    const before = this.controlState(id);
    const direction: 1 | -1 = ticks > 0 ? 1 : -1;
    const unit = units === null ? null : this.distanceUnit(id);
    const targetSteps = units === null || unit === null ? null : Math.abs(units) * unit.unitSteps;
    let count = Math.abs(ticks);
    const running = this.pushes.get(id);
    const extended = running !== undefined && running.direction === direction;
    // PH-24.21: a push against the one running subtracts from what remains.
    const opposite = running !== undefined && running.direction !== direction;
    const signs: (1 | -1)[] = Array.from({ length: count }, () => direction);
    const result = await this.venue.betweenAdvances(() => {
      // PH-24.11: a push wins over a close, preset or scenario armed here. It is
      // released — recorded, counted — and its pending outcome dropped: a close
      // the operator superseded is not a close that failed.
      let released: { discarded: number } | null = null;
      if (wrapper.armed && !this.pushes.has(id)) {
        const discarded = wrapper.release();
        this.arrivals.for(id)?.release();
        this.applied.delete(id);
        this.session.recordAction({
          at,
          asset: id,
          engineVersion: ENGINE_VERSION,
          action: 'release',
          parameters: { by: 'push', ticks },
          initialState: before,
          resultingState: this.controlState(id),
          succeeded: true,
          diagnostics: { discarded },
        });
        released = { discarded };
      }
      // PH-24.13: the drawn, unpublished tick is retracted so the push begins at
      // the instant of the click. A retract restores the engine, and a restore
      // seeks, and a seek releases — so the scripts are read before and armed after.
      const market = this.venue.hostedMarket(id)!;
      const carried: (1 | -1)[] = extended ? [...wrapper.remainingScript()] : [];
      const arrival = this.arrivals.for(id);
      const carriedDraws: (number | null)[] =
        extended && arrival !== null ? [...arrival.remainingScript()] : [];
      // Read before the retract too: a retract restores, a restore seeks, a seek releases.
      const remainingOld: (1 | -1)[] = opposite ? [...wrapper.remainingScript()] : [];
      const remainingOldDraws: (number | null)[] =
        opposite && arrival !== null ? [...arrival.remainingScript()] : [];
      const retracted = market.retractPending();
      const script: (1 | -1)[] = [...carried, ...signs];
      const draw = this.paceDrawFor(id, pace, arrival !== null);
      const paced: (number | null)[] = signs.map(() => draw);
      // PH-24.16: the first pushed tick is anchored at now. Its draw is found on
      // forks so that its interval is the gap since the last published tick plus
      // the pace's own interval — otherwise a burst redrawn from a seconds-old
      // instant is due all at once and publishes as a jump. A running push is
      // not re-anchored: its next tick is already ahead of now.
      const draws: (number | null)[] =
        carriedDraws.length > 0
          ? [...carriedDraws, ...paced]
          : [this.anchoredFirstDraw(id, at, pace, arrival !== null), ...paced.slice(1)];
      const walk = (
        play: readonly (1 | -1)[],
        playDraws: readonly (number | null)[],
        stopAtSteps: number | null,
        skip: number,
      ): { level: number; landingInstant: EpochMillis; walked: number; startLevel: number } => {
        let forkSigns: SelectableSigns | null = null;
        let forkArrival: SelectableArrival | null = null;
        const fork = this.venue.labFork(
          id,
          (keystream) => {
            forkSigns = new SelectableSigns(keystream, id);
            return forkSigns;
          },
          arrival === null
            ? undefined
            : (keystream) => {
                forkArrival = new SelectableArrival(keystream, id);
                return forkArrival;
              },
        )!;
        // Armed after the fork restored: a restore seeks, and a seek releases.
        if (play.length > 0) (forkSigns as SelectableSigns | null)!.arm(play);
        if (playDraws.length > 0) (forkArrival as SelectableArrival | null)?.arm(playDraws);
        const startLevel = fork.price;
        let level = fork.price;
        let landingInstant = fork.instant;
        let walked = 0;
        for (let i = 0; i < play.length; i += 1) {
          const tick = fork.next();
          if (tick === null) break;
          level = tick.price;
          landingInstant = tick.instant;
          walked = i + 1;
          // By distance: stop at the first tick that reaches the units asked.
          if (stopAtSteps !== null && i >= skip && Math.abs(level - startLevel) >= stopAtSteps)
            break;
        }
        return { level, landingInstant, walked, startLevel };
      };
      const first = walk(script, draws, targetSteps, carried.length);
      let { level, landingInstant, startLevel } = first;
      if (targetSteps !== null) {
        count = Math.max(1, first.walked - carried.length);
        script.length = carried.length + count;
        draws.length = carried.length + count;
      }
      // PH-24.21: an opposite push subtracts. Larger than what remained: the
      // difference, in the new direction. Smaller: the running push shortened,
      // in its own direction and at its own pace. Equal: nothing — the market free.
      let netted: { previousRemaining: number; applied: number } | null = null;
      let survivor: 1 | -1 = direction;
      let survivorPace: Pace = pace;
      let requested = extended ? running.requested + count : count;
      if (opposite) {
        const previous = remainingOld.length;
        netted = { previousRemaining: previous, applied: count - previous };
        if (count > previous) {
          script.length = count - previous;
          draws.length = count - previous;
          requested = count - previous;
        } else if (count < previous) {
          script.splice(0, script.length, ...remainingOld.slice(0, previous - count));
          draws.splice(0, draws.length, ...remainingOldDraws.slice(0, previous - count));
          survivor = running.direction;
          survivorPace = running.pace;
          requested = previous - count;
        } else {
          script.length = 0;
          draws.length = 0;
          requested = 0;
        }
        // The landing is the netted script's, walked afresh: the first walk played the new signs.
        ({ level, landingInstant, startLevel } = walk(script, draws, null, 0));
      }
      if (script.length > 0) {
        wrapper.arm(script);
        arrival?.arm(draws);
        this.pushes.set(id, { direction: survivor, requested, pace: survivorPace });
      } else {
        // Nothing survives: the market is the keystream's again, both scripts let go.
        wrapper.release();
        arrival?.release();
        this.pushes.delete(id);
        this.pushLandings.delete(id);
      }
      // The fork started at the snapshot's sequence; the landing is script.length ticks on.
      const sequence = this.venue.hostedMarket(id)!.snapshotEngine().sequence + script.length;
      return {
        level,
        landingInstant,
        afterTicks: script.length,
        sequence,
        released,
        retracted,
        count,
        startLevel,
        netted,
        survivor,
      };
    });
    // The burst's first instant is already in the past: publish it now, not on the old timer.
    this.venue.wake();
    const asset = this.venue.assetFor(id)!;
    const landing = {
      latticeLevel: result.level,
      price: displayPrice(result.level, {
        logQuantum: asset.instrument.logQuantum,
        referencePrice: asset.instrument.referencePrice,
        displayPrecision: asset.instrument.displayPrecision,
      }).toFixed(asset.instrument.displayPrecision),
      instant: result.landingInstant,
      afterTicks: result.afterTicks,
    };
    if (result.afterTicks > 0) {
      this.pushLandings.set(id, {
        direction: result.survivor,
        ticks: result.afterTicks,
        sequence: result.sequence,
        level: result.level,
        price: landing.price,
      });
    }
    this.session.recordAction({
      at,
      asset: id,
      engineVersion: ENGINE_VERSION,
      action: 'push',
      parameters: {
        ticks: result.count * direction,
        pace,
        ...(units === null ? {} : { distance: units }),
      },
      initialState: before,
      resultingState: this.controlState(id),
      succeeded: true,
      diagnostics: {
        extended,
        netted: result.netted,
        landing,
        released: result.released,
        retracted: result.retracted,
      },
    });
    return {
      environment: LAB,
      asset: id,
      direction: result.survivor === 1 ? 'up' : 'down',
      ticks: result.count,
      pace,
      extended,
      netted: result.netted,
      distance:
        units === null || unit === null
          ? null
          : {
              units: Math.abs(units),
              unitSteps: unit.unitSteps,
              ticks: result.count,
              // Where the walk began: the last published level, the retracted tick undone.
              fromLevel: result.startLevel,
            },
      landing,
      released: result.released,
      retracted: result.retracted,
      ...this.controlState(id),
    };
  }

  /**
   * What became of the last push: the record's price at the sequence the
   * landing named, once published — `exact` when it is the price announced.
   * Read from the record like a close's outcome; nothing here is a claim.
   */
  private pushOutcome(id: string): ReturnType<LabController['controlState']>['lastPush'] {
    const landing = this.pushLandings.get(id);
    if (landing === undefined) return null;
    const asset = this.venue.assetFor(id);
    if (asset === null) return null;
    let landed: Tick | null = null;
    try {
      for (const tick of this.venue.feed.since(id, landing.sequence)) {
        if (tick.sequence === landing.sequence) landed = tick;
        break;
      }
    } catch {
      landed = null;
    }
    const landedPrice =
      landed === null
        ? null
        : displayPrice(landed.price, {
            logQuantum: asset.instrument.logQuantum,
            referencePrice: asset.instrument.referencePrice,
            displayPrecision: asset.instrument.displayPrecision,
          }).toFixed(asset.instrument.displayPrecision);
    return {
      direction: landing.direction,
      ticks: landing.ticks,
      sequence: landing.sequence,
      landingPrice: landing.price,
      landedPrice,
      exact: landed === null ? null : landed.price === landing.level,
    };
  }

  /**
   * The market's distance unit (PH-24.18): a quarter of the median 1m range,
   * measured over thirty minutes of a fork of the live market, cached briefly.
   */
  private distanceUnit(id: string): DistanceUnit {
    const now = this.venue.now();
    const cached = this.distances.cached(id, now);
    if (cached !== null) return cached;
    const asset = this.venue.assetFor(id)!;
    const ticks = this.venue.labTicksAhead(
      id,
      Math.min(50_000, Math.max(2_000, Math.round(1_800_000 / asset.evidence.meanIntervalMs))),
    );
    const level = this.venue.hostedMarket(id)!.snapshotEngine().price;
    return this.distances.remember(id, distanceUnitFrom(asset, level, ticks, now));
  }

  /**
   * The arrival draw that puts the first pushed tick at now plus the pace's
   * interval (PH-24.16), found by bisection on forks — the model is the
   * engine's own, so the fork's answer is the market's.
   */
  private anchoredFirstDraw(
    id: string,
    at: EpochMillis,
    pace: Pace,
    selectable: boolean,
  ): number | null {
    if (!selectable) return null;
    const asset = this.venue.assetFor(id)!;
    const firstIntervalWith = (draw: number | null): number => {
      let armed: SelectableArrival | null = null;
      const fork = this.venue.labFork(id, undefined, (keystream) => {
        armed = new SelectableArrival(keystream, id);
        return armed;
      })!;
      (armed as SelectableArrival | null)!.arm([draw]);
      const tick = fork.next();
      return tick === null ? Number.POSITIVE_INFINITY : tick.instant - fork.instant;
    };
    const paceMs = paceIntervalMs(pace, asset.evidence.meanIntervalMs);
    const own = paceMs === null ? firstIntervalWith(null) : paceMs;
    const snapshot = this.venue.hostedMarket(id)!.snapshotEngine();
    const gap = Math.max(0, at - snapshot.instant);
    const target = gap + own;
    // The interval grows with the draw: bisect until it is within a millisecond.
    let lo = 0;
    let hi = 1 - 1e-12;
    let best = hi;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      const interval = firstIntervalWith(mid);
      best = mid;
      if (Math.abs(interval - target) <= 1) break;
      if (interval < target) lo = mid;
      else hi = mid;
    }
    return best;
  }

  /**
   * The arrival draw for a pace on this market now (PH-24.18): the draw whose
   * interval, from the market's current state, is the pace's fraction of the
   * mean interval — found by bisection on a fork, like the anchored first tick.
   * One draw serves the whole burst; the burst's own excitation then shortens
   * the later intervals, as it would for any fast stretch.
   */
  private paceDrawFor(id: string, pace: Pace, selectable: boolean): number | null {
    if (!selectable) return null;
    const asset = this.venue.assetFor(id)!;
    const target = paceIntervalMs(pace, asset.evidence.meanIntervalMs);
    if (target === null) return null;
    const intervalWith = (draw: number): number => {
      let armed: SelectableArrival | null = null;
      const fork = this.venue.labFork(id, undefined, (keystream) => {
        armed = new SelectableArrival(keystream, id);
        return armed;
      })!;
      (armed as SelectableArrival | null)!.arm([draw]);
      const tick = fork.next();
      return tick === null ? Number.POSITIVE_INFINITY : tick.instant - fork.instant;
    };
    let lo = 0;
    let hi = 1 - 1e-12;
    let best = hi;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      const interval = intervalWith(mid);
      best = mid;
      if (Math.abs(interval - target) <= 1) break;
      if (interval < target) lo = mid;
      else hi = mid;
    }
    return best;
  }

  /**
   * Sube / baja (PH-24.16): prioritise a direction until told otherwise.
   * Runs for it and shorter runs against it, at the market's own pace.
   */
  @Post('markets/:id/bias')
  async bias(@Param('id') id: string, @Query('direction') direction?: string): Promise<unknown> {
    if (direction !== 'up' && direction !== 'down' && direction !== 'off') {
      throw new BadRequestException("direction must be 'up', 'down' or 'off'.");
    }
    const wrapper = this.wrapperFor(id);
    const at = this.venue.now();
    const before = this.controlState(id);
    await this.venue.betweenAdvances(() => {
      if (direction === 'off') {
        // PH-24.24: an expiry that already happened is recorded before this
        // erases the note — otherwise turning off a bias that had run out would
        // swallow its expiry. Then the note goes: this is a request, not an expiry.
        this.noticeBiasExpiry(id, wrapper);
        this.biasNoted.delete(id);
        wrapper.clearBias();
      } else {
        wrapper.setBias(
          direction === 'up' ? 1 : -1,
          this.venue.labRandom(id),
          this.biasRuns(id),
          // PH-24.24: two minutes on the venue's clock, injected, never ambient.
          { at: this.venue.now() + BIAS_MAX_MS, now: () => this.venue.now() },
        );
        this.biasNoted.set(id, {
          direction: direction === 'up' ? 1 : -1,
          expiresAt: this.venue.now() + BIAS_MAX_MS,
        });
      }
    });
    this.session.recordAction({
      at,
      asset: id,
      engineVersion: ENGINE_VERSION,
      action: 'bias',
      parameters: { direction },
      initialState: before,
      resultingState: this.controlState(id),
      succeeded: true,
      // PH-24.24: when it must end. A process that restarts drops the bias with
      // it (a restarted market gets a new wrapper), and nothing is left running
      // to notice that — but the record still says when it could not outlive.
      diagnostics: direction === 'off' ? {} : { expiresAt: at + BIAS_MAX_MS },
    });
    return {
      environment: LAB,
      asset: id,
      direction,
      runs: direction === 'off' ? null : wrapper.biasRuns,
      // PH-24.24: what the operator most needs to know about a sustained direction —
      // when it ends by itself.
      expiresInMs: direction === 'off' ? null : BIAS_MAX_MS,
      ...this.controlState(id),
    };
  }

  /**
   * Bias runs in market time (PH-24.18): a run for the direction lasts one to
   * three seconds of the market's own pace, never fewer than two ticks.
   */
  private biasRuns(id: string): { min: number; max: number } {
    const mean = this.venue.assetFor(id)!.evidence.meanIntervalMs;
    const min = Math.max(2, Math.round(1_000 / mean));
    const max = Math.max(min + 1, Math.round(3_000 / mean));
    return { min, max };
  }

  /** A plan drawn on the keystream cannot describe a market playing a push (PH-24.10). */
  private refuseWhilePushing(
    id: string,
    wrapper: SelectableSigns,
    action: string,
    parameters: Record<string, unknown>,
    before: ReturnType<LabController['controlState']>,
  ): void {
    if (!wrapper.armed || !this.pushes.has(id)) return;
    this.session.recordAction({
      at: this.venue.now(),
      asset: id,
      engineVersion: ENGINE_VERSION,
      action,
      parameters,
      initialState: before,
      resultingState: before,
      succeeded: false,
      diagnostics: { refused: 'PUSH_RUNNING' },
    });
    throw new ConflictException(PUSH_RUNNING);
  }

  /**
   * Back to the keystream. Says how many scripted signs were never drawn.
   *
   * And which tick, if any, is already drawn: a hosted market holds one drawn,
   * unpublished tick, and if its coin was tossed under the script it is
   * published as drawn — nothing un-tosses a coin. The keystream resumes with
   * the next draw. No jump, no invalid state (H5), one tick of latency, named.
   */
  @Post('markets/:id/release')
  release(@Param('id') id: string): unknown {
    const wrapper = this.wrapperFor(id);
    const before = this.controlState(id);
    const pendingTick = this.venue.hostedMarket(id)?.pending?.sequence ?? null;
    // PH-24.24: an expiry already run is recorded first; then the note goes,
    // because `release` clearing a bias is a request, not an expiry.
    this.noticeBias(id);
    this.biasNoted.delete(id);
    const discarded = wrapper.release();
    this.arrivals.for(id)?.release();
    this.pushes.delete(id);
    this.session.recordAction({
      at: this.venue.now(),
      asset: id,
      engineVersion: ENGINE_VERSION,
      action: 'release',
      parameters: {},
      initialState: before,
      resultingState: this.controlState(id),
      succeeded: true,
      diagnostics: { discarded, pendingTick },
    });
    return {
      environment: LAB,
      asset: id,
      released: true,
      discarded,
      pendingTick,
      ...this.controlState(id),
    };
  }

  /**
   * Every hosted market's state at once (PH-24.9): what is armed where, what
   * landed, what is open — so a session across markets reads as one thing and
   * the asset list can carry a badge without a request per market.
   */
  @Get('control')
  controlAll(): unknown {
    // PH-24.24: the board reads every market, so an expiry on one nobody has
    // selected is noticed here rather than waiting for someone to open it.
    for (const id of this.venue.assetIds) {
      const wrapper = this.signs.for(id);
      if (wrapper !== null) this.noticeBiasExpiry(id, wrapper);
    }
    return {
      environment: LAB,
      markets: this.venue.assetIds.map((id) => {
        const asset = this.venue.assetFor(id)!;
        const snapshot = this.venue.hostedMarket(id)?.snapshotEngine();
        const modulators =
          (snapshot?.magnitudeState as { modulators?: ({ regime?: string } | null)[] } | undefined)
            ?.modulators ?? [];
        return {
          id,
          displayName: asset.definition.displayName,
          price:
            snapshot === undefined
              ? null
              : displayPrice(snapshot.price, {
                  logQuantum: asset.instrument.logQuantum,
                  referencePrice: asset.instrument.referencePrice,
                  displayPrecision: asset.instrument.displayPrecision,
                }).toFixed(asset.instrument.displayPrecision),
          regime: modulators.find((mm) => mm !== null && 'regime' in mm)?.regime ?? null,
          openPositions: this.positions.list(id).filter((p) => this.venue.now() <= p.expiryInstant)
            .length,
          ...this.controlState(id),
        };
      }),
    };
  }

  /**
   * Every armed market back to its keystream, one recorded action per market
   * released. The one act safe to batch: it only ever returns markets to
   * themselves.
   */
  @Post('release-all')
  releaseAll(): unknown {
    const released: { id: string; discarded: number; pendingTick: number | null }[] = [];
    for (const id of this.venue.assetIds) {
      const wrapper = this.signs.for(id);
      // PH-24.24: a bias is something to be released too. Until this line a
      // market carrying only a sustained direction was skipped here, so "release
      // every market" left running exactly the act the operator most wanted off.
      if (wrapper !== null) this.noticeBiasExpiry(id, wrapper);
      if (wrapper === null || (!wrapper.armed && wrapper.bias === null)) continue;
      const before = this.controlState(id);
      const pendingTick = this.venue.hostedMarket(id)?.pending?.sequence ?? null;
      this.biasNoted.delete(id);
      const discarded = wrapper.release();
      this.arrivals.for(id)?.release();
      this.pushes.delete(id);
      this.session.recordAction({
        at: this.venue.now(),
        asset: id,
        engineVersion: ENGINE_VERSION,
        action: 'release',
        parameters: { all: true },
        initialState: before,
        resultingState: this.controlState(id),
        succeeded: true,
        diagnostics: { discarded, pendingTick },
      });
      released.push({ id, discarded, pendingTick });
    }
    return { environment: LAB, released };
  }

  /** Whether a script is being played into this market, and how much remains. */
  @Get('markets/:id/control')
  control(@Param('id') id: string): unknown {
    const wrapper = this.wrapperFor(id);
    this.noticeBiasExpiry(id, wrapper);
    return { environment: LAB, asset: id, ...this.controlState(id) };
  }

  /**
   * A bias that ran out is an act of the Lab, and the session says so (PH-24.24).
   *
   * The sign source turns it off on a tick, inside the engine, where nothing can
   * be recorded; this notices it on the next read and records it once. The
   * screen polls the control, so in practice the record is written seconds after
   * the market stopped being biased.
   */
  private noticeBiasExpiry(id: string, wrapper: SelectableSigns): void {
    const noted = this.biasNoted.get(id);
    if (noted === undefined || wrapper.bias === noted.direction) return;
    this.biasNoted.delete(id);
    // Only an expiry is unrecorded: a release and a new direction record themselves.
    if (wrapper.bias !== null) return;
    const now = this.venue.now();
    const after = this.controlState(id);
    // What ended, said as a transition: the state the market was in differed
    // from this one in exactly one way, and a record whose initial state equals
    // its resulting state describes nothing.
    const before = { ...after, bias: noted.direction, biasMsLeft: 0 };
    this.session.recordAction({
      // The instant it expired, which is the deadline — not the instant someone
      // happened to read the control, which can be a poll later.
      at: epochMillis(Math.min(noted.expiresAt, now)),
      asset: id,
      engineVersion: ENGINE_VERSION,
      action: 'bias.expired',
      parameters: { direction: noted.direction === 1 ? 'up' : 'down', afterMs: BIAS_MAX_MS },
      initialState: before,
      resultingState: after,
      succeeded: true,
      diagnostics: { expiredAt: noted.expiresAt, noticedAt: now },
    });
  }

  /** Notice an expiry before an act that would erase what is left to notice. */
  private noticeBias(id: string): void {
    const wrapper = this.signs.for(id);
    if (wrapper !== null) this.noticeBiasExpiry(id, wrapper);
  }

  /** The session, as two timelines that are never merged (§72–§73). */
  @Get('session')
  sessionTimelines(): unknown {
    return this.session.timelines();
  }

  // ── §70 over the session's closes (PH-24.5) ─────────────────────────────

  /**
   * The distribution of this session's controlled closes, with what it rests on.
   *
   * The paths carry no signature (PH-23.1); the operator's choices can. Served
   * beside the two timelines so a session reads as evidence about both.
   */
  @Get('session/closes')
  sessionCloses(): unknown {
    return { environment: LAB, ...closesDiagnostic(this.session.labActions) };
  }

  /**
   * The session as its file reads (PH-24.8 §2): one JSON line per record, the
   * two streams told apart by a field the class itself never carries.
   */
  @Get('session/export')
  @Header('content-type', 'application/x-ndjson; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="otc-lab-session.jsonl"')
  sessionExport(): string {
    // The file says what it is on its first line, like every other answer here.
    const header = JSON.stringify({
      stream: 'meta',
      environment: LAB,
      exportedAt: this.venue.now(),
    });
    return `${[header, ...this.session.toLines()].join('\n')}\n`;
  }

  /**
   * §70 over the positions: how the session's settled positions ended, by
   * outcome and by the preset that decided them, with the count it rests on.
   */
  @Get('session/positions')
  sessionPositions(): unknown {
    const settled: SettledPosition[] = [];
    for (const position of this.positions.list()) {
      const actual = LabPositions.actual(position, this.recordTicks(position.contract.assetId));
      if (actual === null) continue;
      const preset = this.session.labActions
        .filter(
          (a) =>
            a.action === 'preset.apply' &&
            a.succeeded &&
            a.parameters['position'] === position.contract.id,
        )
        .map((a) => String(a.parameters['preset']))
        .pop();
      settled.push({ id: position.contract.id, outcome: actual.outcome, preset: preset ?? null });
    }
    return { environment: LAB, ...positionsDiagnostic(settled) };
  }

  // ── Simulated positions and presets (PH-24.3) ───────────────────────────

  /**
   * Open a simulated position on a Lab market.
   *
   * A `Contract` from `packages/trading`, unchanged: the production shape,
   * settled later by the production `settle` against this market's own record.
   * Entry is now, and the entry price is the price in force now, read as
   * settlement reads (ADR-0017). Kept in this process and nowhere else (O10).
   */
  @Post('markets/:id/positions')
  openPosition(
    @Param('id') id: string,
    @Query('direction') direction?: string,
    @Query('stake') stake?: string,
    @Query('horizonMs') horizonMs?: string,
  ): unknown {
    if (this.venue.hostedMarket(id) === null)
      throw new NotFoundException(`Asset ${id} is not hosted.`);
    if (direction !== 'up' && direction !== 'down') {
      throw new BadRequestException("direction must be 'up' (CALL) or 'down' (PUT).");
    }
    const stakeValue = Number(stake);
    const horizon = Number(horizonMs);
    try {
      const position = this.positions.open(
        { assetId: id, direction, stake: stakeValue, horizonMs: horizon },
        this.venue.now(),
        this.recordTicks(id),
      );
      this.session.recordAction({
        at: this.venue.now(),
        asset: id,
        engineVersion: ENGINE_VERSION,
        action: 'position.open',
        parameters: { direction, stake: stakeValue, horizonMs: horizon },
        initialState: {},
        resultingState: { id: position.contract.id, entryPrice: position.entryPrice },
        succeeded: true,
        diagnostics: { expiryInstant: position.expiryInstant },
      });
      return { environment: LAB, asset: id, position: this.describe(position) };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /** Every position on this market, with what it is expected to be and what it was. */
  @Get('markets/:id/positions')
  listPositions(@Param('id') id: string): unknown {
    if (this.venue.hostedMarket(id) === null)
      throw new NotFoundException(`Asset ${id} is not hosted.`);
    return {
      environment: LAB,
      asset: id,
      positions: this.positions.list(id).map((position) => this.describe(position)),
    };
  }

  /**
   * Make a position end a chosen way: a close at the preset's level, at the
   * position's expiry, through the same window, selection and critical section
   * as `close`. Parity is not redefined: when `entry ± 1` is off-parity the
   * reachable neighbours are named and nothing is armed.
   */
  @Post('markets/:id/positions/:pid/preset')
  async applyPreset(
    @Param('id') id: string,
    @Param('pid') pid: string,
    @Query('name') name?: string,
  ): Promise<unknown> {
    const position = this.positions.get(pid);
    if (position === null || position.contract.assetId !== id) {
      throw new NotFoundException(`Position ${pid} is not open on ${id}.`);
    }
    if (name === undefined || !isPreset(name)) {
      throw new BadRequestException(`name must be one of ${PRESETS.join(', ')}.`);
    }
    if (this.venue.now() >= position.expiryInstant) {
      throw new ConflictException(`Position ${pid} has expired; nothing to arm.`);
    }
    const level = presetLevel(name, position.entryPrice, position.contract.direction);
    const asset = this.venue.assetFor(id)!;
    const price = displayPrice(level, {
      logQuantum: asset.instrument.logQuantum,
      referencePrice: asset.instrument.referencePrice,
      displayPrecision: asset.instrument.displayPrecision,
    }).toFixed(asset.instrument.displayPrecision);
    const result = await this.applyAt(
      id,
      { price, instant: position.expiryInstant },
      'preset.apply',
      {
        preset: name,
        position: pid,
      },
    );
    return {
      ...result.plan,
      environment: LAB,
      armed: result.armed,
      adjusted: result.adjusted,
      preset: name,
      position: this.describe(position),
    };
  }

  /**
   * Ticks this market's feed retains, oldest first: the Lab's record.
   *
   * From the feed's own `retained()` window, never from a guess at it. The
   * first version walked back 49,000 sequences and stepped forward by a
   * thousand until `since` stopped throwing — which, on a Lab restarted minutes
   * earlier with a window a few hundred ticks wide, overshot to the newest tick
   * and produced a record that started after every position's entry. `settle`
   * refused, correctly, and the screen said "not expired" for ever while the
   * control row beside it read `EXACT`. Found on the long-running local Lab;
   * invisible to a test whose feed starts at sequence 1.
   */
  private recordTicks(id: string): readonly Tick[] {
    const window = this.venue.feed.retained(id);
    if (window === null) return [];
    return this.venue.feed.since(id, window.oldest);
  }

  private describe(position: LabPosition): unknown {
    const asset = this.venue.assetFor(position.contract.assetId)!;
    const render = (level: number): string =>
      displayPrice(level, {
        logQuantum: asset.instrument.logQuantum,
        referencePrice: asset.instrument.referencePrice,
        displayPrecision: asset.instrument.displayPrecision,
      }).toFixed(asset.instrument.displayPrecision);
    const ticks = this.recordTicks(position.contract.assetId);
    const armed = this.applied.get(position.contract.assetId);
    const basis =
      armed !== undefined && armed.instant === position.expiryInstant
        ? 'armed-target'
        : 'current-price';
    const closeLevel: LogPrice =
      basis === 'armed-target'
        ? logPrice(armed!.target)
        : (this.venue.hostedMarket(position.contract.assetId)?.snapshotEngine().price ??
          position.entryPrice);
    const expected = LabPositions.expected(position, closeLevel, basis);
    const actual =
      this.venue.now() > position.expiryInstant ? LabPositions.actual(position, ticks) : null;
    return {
      id: position.contract.id,
      direction: position.contract.direction,
      stake: position.contract.stake,
      payoutRatio: position.contract.payoutRatio,
      entryInstant: position.contract.entryInstant,
      entryPrice: position.entryPrice,
      entryDisplay: render(position.entryPrice),
      expiryInstant: position.expiryInstant,
      expected: { ...expected, closeDisplay: render(expected.close) },
      actual:
        actual === null
          ? null
          : {
              outcome: actual.outcome,
              expiryPrice: actual.expiryPrice,
              expiryDisplay: render(actual.expiryPrice),
              returned: actual.returned,
              net: actual.net,
              agrees: actual.outcome === expected.outcome,
            },
    };
  }

  // ── Scenarios (PH-24.4) ─────────────────────────────────────────────────

  /**
   * The sixteen, each with its parameters — and, for the two that are not
   * criteria over sign vectors, the reason instead of a button.
   */
  @Get('scenarios')
  scenarios(): unknown {
    return {
      environment: LAB,
      scenarios: SCENARIOS.map((s) => ({
        name: s.name,
        label: s.label,
        selectable: s.selectable,
        why: s.why ?? null,
        parameters: s.parameters,
      })),
      shock: {
        name: 'shock',
        label: 'F Shock: locate the next large step and choose its direction',
        parameters: [
          { name: 'size', label: 'step ≥ (lattice steps)', default: 40 },
          { name: 'direction', label: '+1 up, -1 down', default: 1 },
        ],
        why:
          'A shock is a magnitude event the signs cannot produce (LA-01). The Lab finds the ' +
          'next step of at least this size in the window, if the engine is about to make one, ' +
          'and selects its direction — a coin toss the fair coin could have produced.',
      },
    };
  }

  /** What applying a scenario over the next window would select, without arming. */
  @Get('markets/:id/scenario/preview')
  scenarioPreview(
    @Param('id') id: string,
    @Query() query: Record<string, string | undefined>,
  ): unknown {
    const request = this.scenarioRequest(id, query);
    return { ...this.planScenario(id, request), environment: LAB, armed: false };
  }

  /**
   * Select a continuation with the scenario's shape and arm it.
   *
   * Same critical section as a close (PH-24.2 §2). A criterion nothing satisfies
   * in the draws reports a rate of zero and arms nothing (PH-23.4 §4): "this
   * market does not do that in this window" is an answer, and a nudged path
   * that nearly does is not.
   */
  @Post('markets/:id/scenario')
  async applyScenario(
    @Param('id') id: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    const request = this.scenarioRequest(id, query);
    const wrapper = this.wrapperFor(id);
    const at = this.venue.now();
    const before = this.controlState(id);
    this.refuseWhilePushing(id, wrapper, 'scenario.apply', { scenario: request.name }, before);
    const result = await this.venue.betweenAdvances(() => {
      const plan = this.planScenario(id, request);
      if (plan.selection !== null && plan.selection.length > 0) wrapper.arm(plan.selection);
      return { plan, armed: plan.selection !== null && plan.selection.length > 0 };
    });
    this.session.recordAction({
      at,
      asset: id,
      engineVersion: ENGINE_VERSION,
      action: 'scenario.apply',
      parameters: { scenario: request.name, windowMs: request.windowMs, ...request.params },
      initialState: before,
      resultingState: this.controlState(id),
      succeeded: result.armed,
      diagnostics: {
        attempts: result.plan.attempts,
        acceptanceRate: result.plan.acceptanceRate,
        shape: result.plan.shape,
        impossible: result.plan.impossible,
      },
    });
    return { ...result.plan, environment: LAB, armed: result.armed };
  }

  private scenarioRequest(
    id: string,
    query: Record<string, string | undefined>,
  ): {
    name: string;
    windowMs: number;
    params: Readonly<Record<string, number>>;
    absoluteLevel?: number;
  } {
    if (this.venue.hostedMarket(id) === null)
      throw new NotFoundException(`Asset ${id} is not hosted.`);
    const name = query['name'];
    if (name === undefined)
      throw new BadRequestException('name is required: a scenario, or shock.');
    const windowMs = Number(query['window'] ?? '60000');
    if (!Number.isSafeInteger(windowMs) || windowMs < 5_000 || windowMs > 900_000) {
      throw new BadRequestException('window must be 5000..900000 milliseconds.');
    }
    if (name === 'shock') {
      const size = Number(query['size'] ?? '40');
      const direction = Number(query['direction'] ?? '1');
      if (!Number.isSafeInteger(size) || size < 1)
        throw new BadRequestException('size must be ≥ 1.');
      if (direction !== 1 && direction !== -1)
        throw new BadRequestException('direction must be 1 or -1.');
      return { name, windowMs, params: { size, direction } };
    }
    const scenario = scenarioNamed(name);
    if (scenario === null) throw new BadRequestException(`Unknown scenario ${name}.`);
    if (!scenario.selectable) {
      throw new ConflictException({
        environment: LAB,
        asset: id,
        scenario: name,
        message: scenario.why,
      });
    }
    // Target Price by price: resolved against the lattice like a close, kept as
    // an absolute level so the plan measures the distance from where the market
    // stands when it is read, not when the request was parsed.
    if (
      name === 'target-price' &&
      query['price'] !== undefined &&
      query['price'].trim().length > 0
    ) {
      const asset = this.venue.assetFor(id)!;
      let resolved;
      try {
        resolved = resolveTarget(asset.instrument, query['price']);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      if (resolved.kind === 'between') {
        throw new ConflictException({
          environment: LAB,
          asset: id,
          message: `${resolved.requested} is not a lattice level for this asset. The two around it are ${resolved.below} and ${resolved.above}.`,
          below: resolved.below,
          above: resolved.above,
        });
      }
      return { name, windowMs, params: { level: 0 }, absoluteLevel: resolved.level };
    }
    try {
      return { name, windowMs, params: scenarioParameters(scenario, query) };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /** The computation preview and apply share. Never arms. */
  private planScenario(
    id: string,
    request: {
      name: string;
      windowMs: number;
      params: Readonly<Record<string, number>>;
      absoluteLevel?: number;
    },
  ): {
    environment: string;
    asset: string;
    scenario: string;
    windowMs: number;
    instant: number;
    ticksInWindow: number;
    attempts: number;
    acceptanceRate: number;
    shape: ReturnType<typeof shapeOf> | null;
    impossible: string | null;
    selection: readonly (1 | -1)[] | null;
    shockAt: number | null;
    targetLevel: number | null;
    targetPrice: string | null;
  } {
    const instant = epochMillis(this.venue.now() + request.windowMs);
    const window = readWindow(this.venue.labFork(id)!, instant);
    // Target Price: the level to touch, as a distance from where the market
    // stands now (the window's start), whichever way it was addressed.
    const targetLevel =
      request.name === 'target-price'
        ? (request.absoluteLevel ?? window.fromPrice + request.params['level']!)
        : null;
    const params =
      targetLevel === null
        ? request.params
        : { ...request.params, level: targetLevel - window.fromPrice };
    const base = {
      environment: LAB,
      asset: id,
      scenario: request.name,
      windowMs: request.windowMs,
      instant,
      ticksInWindow: window.steps.length,
      targetLevel,
      // The level as a price too (PH-23.5 §6): the screen prints this, never the index.
      targetPrice:
        targetLevel === null
          ? null
          : displayPrice(targetLevel, {
              logQuantum: this.venue.assetFor(id)!.instrument.logQuantum,
              referencePrice: this.venue.assetFor(id)!.instrument.referencePrice,
              displayPrecision: this.venue.assetFor(id)!.instrument.displayPrecision,
            }).toFixed(this.venue.assetFor(id)!.instrument.displayPrecision),
    };
    let criterion: (c: Continuation) => boolean;
    let shockAt: number | null = null;
    if (request.name === 'shock') {
      const found = nextShock(window.steps, request.params['size']!);
      if (found === null) {
        return {
          ...base,
          attempts: 0,
          acceptanceRate: 0,
          shape: null,
          impossible:
            `The engine produces no step of at least ${String(request.params['size'])} lattice ` +
            `steps in the next ${String(window.steps.length)} ticks. A shock is not something the ` +
            `Lab can order (LA-01); widen the window or lower the size.`,
          selection: null,
          shockAt: null,
        };
      }
      shockAt = found.atTick;
      criterion = INTERVENTIONS.directionAt(
        found.atTick,
        request.params['direction'] === 1 ? 1 : -1,
      );
    } else {
      criterion = scenarioNamed(request.name)!.criterion!(params);
    }
    if (window.steps.length === 0) {
      return {
        ...base,
        attempts: 0,
        acceptanceRate: 0,
        shape: null,
        impossible: 'No tick falls inside the window.',
        selection: null,
        shockAt,
      };
    }
    const result = selectContinuation({
      steps: window.steps,
      random: this.venue.labRandom(id),
      criterion,
      maxAttempts: 20_000,
    });
    return {
      ...base,
      attempts: result.attempts,
      acceptanceRate: result.acceptanceRate,
      shape: result.chosen === null ? null : shapeOf(result.chosen),
      impossible:
        result.chosen === null
          ? `No natural continuation of ${String(window.steps.length)} ticks satisfied ` +
            `${request.name} in ${String(result.attempts)} draws. This market does not do that ` +
            `in this window; that is the answer, not a shortfall of effort.`
          : null,
      selection: result.chosen?.signs ?? null,
      shockAt,
    };
  }

  /**
   * The last close applied per asset, so `control` can say what became of it.
   *
   * Once the candle's end has passed, the outcome is read from the Lab's own
   * feed exactly as settlement would read it — the price in force at the
   * instant (ADR-0017) — and compared with the target. "Applied" is a claim
   * about the future; this is the sentence that checks it.
   */
  private readonly applied = new Map<
    string,
    { instant: number; target: number; fromSequence: number }
  >();

  /** Pushes running per market (PH-24.10): direction and how many ticks were asked in all. */
  private readonly pushes = new Map<string, { direction: 1 | -1; requested: number; pace: Pace }>();
  /**
   * PH-24.24: the bias each market is carrying, noted when it is set.
   *
   * Noted at the act rather than at the first read, so a bias nobody watched
   * still records its own expiry — the case this cap exists for is precisely
   * the one where nobody was looking. A request that ends a bias removes the
   * note, so only an expiry is ever left to claim.
   */
  private readonly biasNoted = new Map<string, { direction: 1 | -1; expiresAt: number }>();

  /** Where the last push said it would land, so `control` can read the record there (PH-24.10). */
  private readonly pushLandings = new Map<
    string,
    { direction: 1 | -1; ticks: number; sequence: number; level: number; price: string }
  >();

  private outcomeFor(id: string): {
    instant: number;
    target: number;
    targetPrice: string;
    closed: number | null;
    closedPrice: string | null;
    exact: boolean | null;
    onBoundary?: boolean;
    unreadable?: string;
  } | null {
    const last = this.applied.get(id);
    if (last === undefined) return null;
    // Both the level and the price, named for what each is (PH-23.5 §6): the
    // operator typed a price, and a line reading `target -12518` under the
    // word target is a lattice index dressed as one.
    const asset = this.venue.assetFor(id)!;
    const render = (level: number): string =>
      displayPrice(level, {
        logQuantum: asset.instrument.logQuantum,
        referencePrice: asset.instrument.referencePrice,
        displayPrecision: asset.instrument.displayPrecision,
      }).toFixed(asset.instrument.displayPrecision);
    if (this.venue.now() <= last.instant) {
      return {
        instant: last.instant,
        target: last.target,
        targetPrice: render(last.target),
        closed: null,
        closedPrice: null,
        exact: null,
      };
    }
    // Read from the sequence the market stood at when the close was armed, not
    // from 1: the feed retains 50,000 ticks (CA7-33), so on a Lab that has run
    // for hours `since(id, 1)` throws Evicted, and the first version of this
    // caught that and reported "pending" for ever. Found from the screen, which
    // said pending three minutes after the candle had ended. A window is at
    // most fifteen minutes; retention is hours.
    let closed: number | null = null;
    let closedAt: number | null = null;
    try {
      const window = this.venue.feed.retained(id);
      const from = Math.max(last.fromSequence, window?.oldest ?? last.fromSequence);
      for (const tick of this.venue.feed.since(id, from)) {
        if (tick.instant <= last.instant) {
          closed = tick.price;
          closedAt = tick.instant;
        } else break;
      }
    } catch (error) {
      return {
        instant: last.instant,
        target: last.target,
        targetPrice: render(last.target),
        closed: null,
        closedPrice: null,
        exact: null,
        unreadable: (error as Error).message,
      };
    }
    return {
      instant: last.instant,
      target: last.target,
      targetPrice: render(last.target),
      closed,
      closedPrice: closed === null ? null : render(closed),
      exact: closed === null ? null : closed === last.target,
      // ADR-0017 on the screen: a settlement tick that landed exactly on the
      // instant is the chart's *next* candle's open, so the candle an operator
      // watches will not show this close — the outcome line says so.
      onBoundary: closedAt === last.instant,
    };
  }

  private netDisplacement(id: string, now: number): { '1m': number | null; '5m': number | null } {
    const ticks = this.recordTicks(id);
    const last = ticks[ticks.length - 1];
    if (last === undefined) return { '1m': null, '5m': null };
    const over = (ms: number): number | null => {
      let before: number | null = null;
      for (const tick of ticks) {
        if (tick.instant <= now - ms) before = tick.price;
        else break;
      }
      return before === null ? null : last.price - before;
    };
    return { '1m': over(60_000), '5m': over(300_000) };
  }

  private wrapperFor(id: string): SelectableSigns {
    if (this.venue.hostedMarket(id) === null)
      throw new NotFoundException(`Asset ${id} is not hosted.`);
    const wrapper = this.signs.for(id);
    if (wrapper === null) {
      // Hosted and yet unwrapped: the venue was not composed through the Lab.
      throw new ConflictException(
        `Asset ${id} is hosted but its sign source is not selectable. This process was not ` +
          `composed as a Lab (PH-24.1).`,
      );
    }
    return wrapper;
  }

  private controlState(id: string): {
    armed: boolean;
    remaining: number;
    pushing: { direction: 1 | -1; requested: number; remaining: number; pace: Pace } | null;
    lastPush: {
      direction: 1 | -1;
      ticks: number;
      sequence: number;
      landingPrice: string;
      landedPrice: string | null;
      exact: boolean | null;
    } | null;
    bias: 1 | -1 | null;
    biasMsLeft: number;
    sequence: number;
    lastApplied: ReturnType<LabController['outcomeFor']>;
  } {
    const wrapper = this.signs.for(id);
    const market = this.venue.hostedMarket(id);
    // A push that played out is over; the wrapper is the truth, the map a memo.
    if (wrapper !== null && !wrapper.armed) this.pushes.delete(id);
    const push = this.pushes.get(id);
    return {
      armed: wrapper?.armed ?? false,
      remaining: wrapper?.remaining ?? 0,
      pushing:
        push === undefined
          ? null
          : {
              direction: push.direction,
              requested: push.requested,
              remaining: wrapper?.remaining ?? 0,
              pace: push.pace,
            },
      lastPush: this.pushOutcome(id),
      bias: wrapper?.bias ?? null,
      // PH-24.24: how long the sustained direction has left, so the screen can
      // show it running out and a bias is never open-ended.
      biasMsLeft: wrapper?.biasMsLeft ?? 0,
      sequence: market?.snapshotEngine().sequence ?? -1,
      lastApplied: this.outcomeFor(id),
    };
  }

  /**
   * A close is addressed either to a candle — `bucket` and `timeframe` — or to
   * an **instant** — `expiry`, epoch milliseconds — which is what a position's
   * expiration is (PH-24.3 §2, the specification's I7). Both resolve to one
   * instant and everything downstream is the same.
   */
  private closeRequest(
    id: string,
    price: string | undefined,
    bucket: string | undefined,
    tf: string | undefined,
    expiry: string | undefined,
    delta?: string,
    condition?: string,
  ): {
    id: string;
    price: string;
    delta: number | null;
    instant: EpochMillis;
    bucket: string;
    timeframe: string;
    condition: CloseCondition;
  } {
    if (this.venue.hostedMarket(id) === null)
      throw new NotFoundException(`Asset ${id} is not hosted.`);
    if (
      (price === undefined || price.trim().length === 0) &&
      (delta === undefined || delta.trim().length === 0)
    ) {
      throw new BadRequestException(
        'price (display units) or delta (lattice steps from now) is required.',
      );
    }
    if (delta !== undefined && delta.trim().length > 0 && !/^-?\d+$/.test(delta.trim())) {
      throw new BadRequestException('delta must be a whole number of lattice steps.');
    }
    // PH-24.21: where the close must end relative to the mark.
    const closeCondition =
      condition === undefined || condition.trim().length === 0 ? 'exact' : condition.trim();
    if (closeCondition !== 'exact' && closeCondition !== 'above' && closeCondition !== 'below') {
      throw new BadRequestException("condition must be 'exact', 'above' or 'below'.");
    }
    if (expiry !== undefined) {
      const instant = Number(expiry);
      if (!Number.isSafeInteger(instant) || instant <= this.venue.now()) {
        throw new BadRequestException('expiry must be a future instant in epoch milliseconds.');
      }
      return {
        id,
        price: price ?? '',
        delta: deltaOf(delta),
        instant: epochMillis(instant),
        bucket: 'expiry',
        timeframe: '-',
        condition: closeCondition,
      };
    }
    if (bucket !== 'current' && bucket !== 'next') {
      throw new BadRequestException("bucket must be 'current' or 'next' (or give expiry=).");
    }
    if (tf === undefined || !isTimeframeId(tf)) {
      throw new BadRequestException(
        `timeframe must be one of the chart's timeframes, received ${tf}.`,
      );
    }
    return {
      id,
      price: price ?? '',
      delta: deltaOf(delta),
      instant: closeInstant(this.venue.now(), tf, bucket),
      bucket,
      timeframe: tf,
      condition: closeCondition,
    };
  }

  /** The computation preview and apply share. Never arms. */
  private planAt(
    id: string,
    priceText: string,
    instant: EpochMillis,
    delta: number | null = null,
    condition: CloseCondition = 'exact',
  ): {
    environment: string;
    asset: string;
    price: string;
    target: number;
    /** PH-24.21: a sided close — its condition, its mark, and whether the market's own path is the plan. */
    condition: CloseCondition;
    mark: string | null;
    natural: boolean;
    instant: number;
    fromPrice: number;
    ticksInWindow: number;
    lastTickInWindow: number | null;
    delta: number;
    attempts: number;
    acceptanceRate: number;
    reachability: string;
    impossible: string | null;
    reachableNeighbours: readonly string[] | null;
    selection: readonly (1 | -1)[] | null;
  } {
    const asset = this.venue.assetFor(id)!;
    const fork = this.venue.labFork(id)!;
    let resolved;
    if (delta !== null) {
      // Relative: N lattice steps from where the market stands as the plan is
      // read — the pending tick's price, which is also where the window starts.
      const level = logPrice(fork.price + delta);
      resolved = {
        kind: 'level' as const,
        level,
        display: displayPrice(level, {
          logQuantum: asset.instrument.logQuantum,
          referencePrice: asset.instrument.referencePrice,
          displayPrecision: asset.instrument.displayPrecision,
        }).toFixed(asset.instrument.displayPrecision),
      };
    } else {
      try {
        resolved = resolveTarget(asset.instrument, priceText);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
    }
    if (condition !== 'exact') {
      // PH-24.21: a side of a mark. A typed price between two levels is a fine
      // mark — the side begins at the level on its far side.
      const edge =
        resolved.kind === 'level'
          ? resolved
          : resolveTarget(
              asset.instrument,
              condition === 'above' ? resolved.below : resolved.above,
            );
      if (edge.kind !== 'level') {
        throw new BadRequestException('The mark could not be placed on the lattice.');
      }
      const window = readWindow(fork, instant);
      const plan = planConditionedClose(
        asset.instrument,
        edge.level,
        condition,
        window,
        this.venue.labRandom(id),
      );
      return {
        environment: LAB,
        asset: id,
        price: plan.display,
        target: plan.target,
        condition,
        mark: edge.display,
        natural: plan.natural,
        instant,
        fromPrice: window.fromPrice,
        ticksInWindow: window.steps.length,
        lastTickInWindow: window.lastInstant,
        delta: plan.delta,
        attempts: plan.selection.attempts,
        acceptanceRate: plan.selection.acceptanceRate,
        reachability: plan.selection.reachability,
        impossible: plan.selection.impossible,
        reachableNeighbours: null,
        selection: plan.selection.signs,
      };
    }
    if (resolved.kind === 'between') {
      throw new ConflictException({
        environment: LAB,
        asset: id,
        message:
          `${resolved.requested} is not a lattice level for this asset. The two around it are ` +
          `${resolved.below} and ${resolved.above}. Nothing was armed.`,
        below: resolved.below,
        above: resolved.above,
      });
    }
    const window = readWindow(fork, instant);
    const plan = planClose(asset.instrument, resolved.level, window, this.venue.labRandom(id));
    return {
      environment: LAB,
      asset: id,
      price: plan.display,
      target: plan.target,
      condition: 'exact',
      mark: null,
      natural: false,
      instant,
      fromPrice: window.fromPrice,
      ticksInWindow: window.steps.length,
      lastTickInWindow: window.lastInstant,
      delta: plan.delta,
      attempts: plan.selection.attempts,
      acceptanceRate: plan.selection.acceptanceRate,
      reachability: plan.selection.reachability,
      impossible: plan.selection.impossible,
      reachableNeighbours: plan.reachableNeighbours,
      selection: plan.selection.signs,
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
function sampleSize(requested: string | undefined, meanIntervalMs: number): number {
  if (requested === undefined || requested.trim().length === 0)
    return defaultSampleTicks(meanIntervalMs);
  const value = Number(requested);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > LAB_MAX_SAMPLE_TICKS) {
    throw new BadRequestException(
      `ticks must be an integer in [1000, ${String(LAB_MAX_SAMPLE_TICKS)}], received ${requested}.`,
    );
  }
  return value;
}
