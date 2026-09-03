import type { OnModuleDestroy } from '@nestjs/common';
import type { EpochMillis } from '@otc/core';
import type { VenueService } from '../venue.service.js';
import type { LabSession } from './session.js';

/**
 * Feeds the engine's timeline (§72–§73) by watching what the engine does.
 *
 * Polling, on purpose: a hook in `VenueService.tick` would be a production-side
 * change for a Lab need, and a one-second diff of the engine's own snapshot is
 * all a diagnostics timeline needs. What changes is recorded — regime, cascade
 * phase, a stall and its recovery — and what does not is not.
 *
 * Only the engine's behaviour reaches `recordEvent`. Lab actions have their own
 * stream and `labSession.test.ts` keeps it that way.
 */
interface Seen {
  regime: string | null;
  phase: string | null;
  stalled: boolean;
}

export class EngineEventObserver implements OnModuleDestroy {
  readonly #seen = new Map<string, Seen>();
  #timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly venue: VenueService,
    private readonly session: LabSession,
    private readonly everyMs = 1_000,
  ) {}

  start(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      this.observe();
    }, this.everyMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** One pass, exposed so a test can drive it without a timer. */
  observe(now: EpochMillis = this.venue.now()): void {
    const stalled = new Set(this.venue.stalledMarkets.map((m) => m.assetId));
    for (const assetId of this.venue.assetIds) {
      const market = this.venue.hostedMarket(assetId);
      if (market === null) continue;
      const snapshot = market.snapshotEngine() as {
        magnitudeState?: { modulators?: ({ regime?: string; phase?: string } | null)[] };
      };
      const modulators = snapshot.magnitudeState?.modulators ?? [];
      const regime = modulators.find((m) => m !== null && 'regime' in m)?.regime ?? null;
      const phase = modulators.find((m) => m !== null && 'phase' in m)?.phase ?? null;
      const previous = this.#seen.get(assetId);
      const isStalled = stalled.has(assetId);
      if (previous === undefined) {
        // First sight: record where things stand, so the timeline has a start.
        this.session.recordEvent({
          at: now,
          asset: assetId,
          kind: 'regime',
          detail: `observed: regime ${regime ?? '?'}, cascade ${phase ?? '?'}`,
        });
      } else {
        if (regime !== previous.regime) {
          this.session.recordEvent({
            at: now,
            asset: assetId,
            kind: 'regime',
            detail: `volatility regime ${previous.regime ?? '?'} → ${regime ?? '?'}`,
          });
        }
        if (phase !== previous.phase) {
          this.session.recordEvent({
            at: now,
            asset: assetId,
            kind: 'volatility',
            detail: `cascade phase ${previous.phase ?? '?'} → ${phase ?? '?'}`,
          });
        }
        if (isStalled && !previous.stalled) {
          this.session.recordEvent({
            at: now,
            asset: assetId,
            kind: 'stall',
            detail: 'market stalled (catch-up bound)',
          });
        }
        if (!isStalled && previous.stalled) {
          this.session.recordEvent({
            at: now,
            asset: assetId,
            kind: 'recovery',
            detail: 'market publishing again',
          });
        }
      }
      this.#seen.set(assetId, { regime, phase, stalled: isStalled });
    }
  }
}
