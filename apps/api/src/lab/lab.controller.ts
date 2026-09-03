import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
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
import { assessRealism, buildObserverDataset, runBattery } from '@otc/lab';
import {
  INTERVENTIONS,
  nextShock,
  selectClose,
  selectContinuation,
  type Continuation,
} from '@otc/engine';
import { STATE_RECORD_VERSION } from '@otc/runtime';
import { VenueService } from '../venue.service.js';
import { closeInstant, planClose, readWindow, resolveTarget } from './closeControl.js';
import { isPreset, LabPositions, presetLevel, PRESETS, type LabPosition } from './positions.js';
import { closesDiagnostic } from './closesDiagnostic.js';
import { SCENARIOS, scenarioNamed, scenarioParameters, shapeOf } from './scenarios.js';
import { SelectableSigns, SignSelector } from './selectableSigns.js';
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
 * Ticks the bounded quality sample looks at.
 *
 * Enough for the realism metrics to have an opinion and for the battery to
 * populate its buckets, and far short of a gate run. The number is named
 * because a verdict whose sample size is unstated is the same failure as one
 * whose sensitivity is.
 */
const LAB_SAMPLE_TICKS = 1_000_000;

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
const LAB_MAX_SAMPLE_TICKS = 2_000_000;

@Controller('lab')
export class LabController {
  constructor(
    private readonly venue: VenueService,
    private readonly signs: SignSelector,
    private readonly session: LabSession,
    private readonly positions: LabPositions = new LabPositions(),
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
  ): unknown {
    if (nonNatural !== undefined) throw new BadRequestException(NON_NATURAL_REFUSED);
    const request = this.closeRequest(id, price, bucket, tf, expiry, delta);
    return {
      ...this.planAt(id, request.price, request.instant, request.delta),
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
  ): Promise<unknown> {
    if (nonNatural !== undefined) throw new BadRequestException(NON_NATURAL_REFUSED);
    const request = this.closeRequest(id, price, bucket, tf, expiry, delta);
    const result = await this.applyAt(
      id,
      { price: request.price, instant: request.instant, delta: request.delta },
      'close.apply',
      {
        bucket: request.bucket,
        timeframe: request.timeframe,
      },
    );
    return { ...result.plan, environment: LAB, armed: result.armed };
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
    request: { price: string; instant: EpochMillis; delta?: number | null },
    action: string,
    parameters: Record<string, unknown>,
  ): Promise<{ plan: ReturnType<LabController['planAt']>; armed: boolean }> {
    const wrapper = this.wrapperFor(id);
    const at = this.venue.now();
    const before = this.controlState(id);
    const result = await this.venue.betweenAdvances(() => {
      const plan = this.planAt(id, request.price, request.instant, request.delta ?? null);
      const signs = plan.selection;
      if (signs !== null && signs.length > 0) wrapper.arm(signs);
      return { plan, armed: signs !== null && signs.length > 0 };
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
    const discarded = wrapper.release();
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

  /** Whether a script is being played into this market, and how much remains. */
  @Get('markets/:id/control')
  control(@Param('id') id: string): unknown {
    this.wrapperFor(id);
    return { environment: LAB, asset: id, ...this.controlState(id) };
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

  private outcomeFor(id: string): {
    instant: number;
    target: number;
    targetPrice: string;
    closed: number | null;
    closedPrice: string | null;
    exact: boolean | null;
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
    try {
      const window = this.venue.feed.retained(id);
      const from = Math.max(last.fromSequence, window?.oldest ?? last.fromSequence);
      for (const tick of this.venue.feed.since(id, from)) {
        if (tick.instant <= last.instant) closed = tick.price;
        else break;
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
    };
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
    sequence: number;
    lastApplied: ReturnType<LabController['outcomeFor']>;
  } {
    const wrapper = this.signs.for(id);
    const market = this.venue.hostedMarket(id);
    return {
      armed: wrapper?.armed ?? false,
      remaining: wrapper?.remaining ?? 0,
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
  ): {
    id: string;
    price: string;
    delta: number | null;
    instant: EpochMillis;
    bucket: string;
    timeframe: string;
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
    };
  }

  /** The computation preview and apply share. Never arms. */
  private planAt(
    id: string,
    priceText: string,
    instant: EpochMillis,
    delta: number | null = null,
  ): {
    environment: string;
    asset: string;
    price: string;
    target: number;
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
