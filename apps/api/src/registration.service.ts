import { Injectable, Logger } from '@nestjs/common';
import { SystemClock, type Clock, type MasterKeyring } from '@otc/core';
import {
  checkIdentity,
  minimumDispersionSpanMs,
  registerAsset,
  requestFromBrief,
  traitDistanceCheck,
  type AssetBrief,
  type RegistrationStage,
} from '@otc/engine';
import { type AssetRegistry } from '@otc/runtime';
import { VenueService } from './venue.service.js';

/**
 * Creating an asset, as a job rather than an insert.
 *
 * ## Why this is not a request handler
 *
 * A registration is six stages, four of which are simulation: the personality
 * solve, the lattice calibration, the dispersion fit, the differentiation check.
 * **Measured across the eight archetypes at the settings below: 0.5s to 19.3s**,
 * the outlier being `major-crypto`, whose 625-hour fit span at its tick rate is
 * simply a lot of ticks. That is CPU held on the same event loop the venue
 * publishes from, for a duration that depends on which family an operator picked
 * — which is not something to hold an HTTP request open across. A proxy would
 * time out the slow ones, a retry would start a second registration of the same
 * id, and a browser that lost the response would have no way to learn whether
 * the asset exists.
 *
 * So `POST /assets` starts a job and returns its id; the panel polls. That is
 * also what makes the refusals usable: each stage names itself, and "the
 * personality solve could not reach the target tail weight from this ladder" is
 * actionable in a way that "rejected" is not.
 *
 * ## One at a time
 *
 * The queue holds one running job. The solve is CPU-bound and the venue is
 * publishing on the same event loop; the calibration yields to it every few
 * hundred thousand ticks (the `calibrateAssetAsync` convention), which keeps
 * ticks flowing but does not make the CPU free. Two concurrent registrations
 * would halve the venue's share for twice as long, and there is no operator
 * workflow that needs them.
 *
 * ## What a job reports (a6-06)
 *
 * A job is `queued`, `running`, and then one of `registered`, `refused` or
 * `failed`. While it runs, `stage` is the stage the pipeline has entered:
 * `registerAsset` calls `onStage` as each begins, and the panel's poll reads
 * it. Until the out-of-band audit of 2026-09-02 the service had no such hook
 * and said `identity` for the whole nineteen seconds of a `major-crypto` job —
 * a claim rather than a fact. A refusal still names the stage that refused.
 *
 * Jobs live in memory only. A restart forgets them, and the panel says so when
 * its poll comes back 404 (a6-10).
 *
 * ## What it may not do
 *
 * Choose a price. The brief carries a *dispersion budget* — how far the market
 * travels in a quarter — and nothing about direction; the process is a
 * martingale and there is no field here that could bias it (INV-001, INV-006).
 * The personality is drawn from the family's region rather than typed in, so an
 * operator cannot hand-author twenty near-identical markets (INV-007).
 */
export type JobState = 'queued' | 'running' | 'registered' | 'refused' | 'failed';

export interface RegistrationJob {
  readonly id: string;
  readonly brief: AssetBrief;
  readonly state: JobState;
  /**
   * The stage the pipeline is in while the job runs, the one that refused when
   * it refused, and null before the pipeline starts (a6-06).
   */
  readonly stage: RegistrationStage | null;
  /** Why it refused or failed, verbatim from the pipeline. */
  readonly reason: string | null;
  readonly assetId: string | null;
  readonly submittedAt: number;
  readonly finishedAt: number | null;
}

/**
 * Replicates of the minimum span the dispersion fit needs.
 *
 * `minimumDispersionSpanMs` already returns sixteen turnovers of this
 * personality's own cascade memory (`DISPERSION_FIT_TURNOVERS`, raised from four
 * by Cycle Audit 6). Two replicates of it is thirty-two, which is what the five
 * catalogue rates were re-measured at when CA6-18 found `eurusd` 12% high.
 *
 * It is also the whole cost of this job. One replicate would halve the wait and
 * publish a quarterly spread fitted to whichever volatility epoch the window
 * happened to contain.
 */
const CALIBRATION_REPLICATES = 2;

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);
  private readonly jobs = new Map<string, RegistrationJob>();
  /** The tail of the queue: every job awaits the one before it. */
  private queue: Promise<void> = Promise.resolve();
  private sequence = 0;

  constructor(
    private readonly registry: AssetRegistry,
    private readonly venue: VenueService,
    private readonly keyring: MasterKeyring,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  /**
   * Queue a registration and return the job.
   *
   * The identity check that can be answered instantly is answered instantly: an
   * operator who mistypes an existing id learns now rather than after a solve.
   * Every other refusal needs the solve.
   */
  submit(brief: AssetBrief): RegistrationJob {
    const id = `job-${(this.sequence += 1)}`;
    const job: RegistrationJob = {
      id,
      brief,
      state: 'queued',
      stage: null,
      reason: null,
      assetId: null,
      submittedAt: this.clock.now(),
      finishedAt: null,
    };
    this.jobs.set(id, job);
    this.queue = this.queue.then(() => this.#run(id));
    return job;
  }

  get(id: string): RegistrationJob | null {
    return this.jobs.get(id) ?? null;
  }

  /** Every job this process has run, newest first. */
  list(): readonly RegistrationJob[] {
    return [...this.jobs.values()].sort((a, b) => b.submittedAt - a.submittedAt);
  }

  #update(id: string, patch: Partial<RegistrationJob>): void {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    this.jobs.set(id, { ...job, ...patch });
  }

  async #run(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    this.#update(id, { state: 'running', stage: null });
    const started = this.clock.now();
    try {
      // Identity again, against the catalogue as it is *now*: the controller
      // checked it at submission, but a job queued behind another registration
      // of the same id would otherwise reach the solve. And before
      // `requestFromBrief`, which derives streams under a label built from the
      // id and throws on one that is too long — a throw here is recorded as
      // `failed`, when the honest answer is `refused` at `identity` with the
      // pipeline's own words (a3-04).
      const identity = checkIdentity(job.brief, this.venue.catalogue);
      if (identity !== null) {
        this.logger.warn(`${job.brief.id}: refused at identity — ${identity}`);
        this.#update(id, {
          state: 'refused',
          stage: 'identity',
          reason: identity,
          finishedAt: this.clock.now(),
        });
        return;
      }
      const { request } = requestFromBrief(job.brief, {
        keyring: this.keyring,
        environment: 'production',
      });
      const outcome = await registerAsset(request, {
        keyring: this.keyring,
        environment: 'production',
        existing: this.venue.catalogue,
        differentiates: traitDistanceCheck(),
        calibration: {
          replicates: CALIBRATION_REPLICATES,
          simulatedMs: minimumDispersionSpanMs(request.traits),
        },
        // The panel's poll reads this; a job no longer says `identity` for
        // twenty seconds while the calibration runs (a6-06).
        onStage: (stage) => this.#update(id, { stage }),
      });
      if (outcome.kind === 'refused') {
        this.logger.warn(`${job.brief.id}: refused at ${outcome.stage} — ${outcome.reason}`);
        this.#update(id, {
          state: 'refused',
          stage: outcome.stage,
          reason: outcome.reason,
          finishedAt: this.clock.now(),
        });
        return;
      }
      // Stored before hosted, and that order is not arbitrary: an asset the
      // venue is publishing but the registry has never heard of would vanish at
      // the next restart, taking a market that had already printed prices with
      // it. Persistence first means the worst case is an asset that exists and
      // is not yet hosted, which the next restart fixes.
      await this.registry.add(outcome.asset);
      await this.venue.host(outcome.asset);
      this.logger.log(
        `${job.brief.id}: registered and hosted in ${((this.clock.now() - started) / 1000).toFixed(1)}s`,
      );
      this.#update(id, {
        state: 'registered',
        stage: null,
        assetId: outcome.asset.definition.id,
        finishedAt: this.clock.now(),
      });
    } catch (error) {
      this.logger.error(`${job.brief.id}: ${(error as Error).message}`);
      this.#update(id, {
        state: 'failed',
        reason: (error as Error).message,
        finishedAt: this.clock.now(),
      });
    }
  }
}
