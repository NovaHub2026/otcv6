import type { Clock, EpochMillis, Tick } from '@otc/core';
import type { RegisteredAsset } from '@otc/engine';
import { type HostedMarket } from './hosted.js';

/** Ticks published for one asset in one advance. */
export interface AssetTicks {
  readonly assetId: string;
  readonly ticks: readonly Tick[];
}

/** A market that could not be advanced, and why. */
export interface AssetFailure {
  readonly assetId: string;
  readonly error: Error;
}

/** The result of advancing every market once. */
export interface VenueAdvance {
  readonly published: readonly AssetTicks[];
  readonly failures: readonly AssetFailure[];
}

export interface VenueOptions {
  readonly clock: Clock;
  readonly markets: readonly { asset: RegisteredAsset; market: HostedMarket }[];
}

/**
 * Every hosted market, advanced together against one clock.
 *
 * The markets share a clock and nothing else. They have separate engines,
 * separate key material and separate latent state, so hosting them together adds
 * no coupling: a venue is a scheduling convenience, not a market-level entity.
 * That matters because a shared object here would be the obvious route for one
 * asset's state to influence another's prices, which nothing in the model
 * permits.
 */
export class Venue {
  readonly #clock: Clock;
  readonly #markets: Map<string, HostedMarket>;
  readonly #assets: Map<string, RegisteredAsset>;

  constructor(options: VenueOptions) {
    if (options.markets.length === 0) {
      throw new RangeError('A venue needs at least one market.');
    }
    this.#clock = options.clock;
    this.#markets = new Map();
    this.#assets = new Map();
    for (const { asset, market } of options.markets) {
      const id = asset.definition.id;
      if (this.#markets.has(id)) {
        throw new RangeError(`Duplicate asset in venue: ${id}.`);
      }
      this.#markets.set(id, market);
      this.#assets.set(id, asset);
    }
  }

  get assetIds(): readonly string[] {
    return [...this.#markets.keys()];
  }

  /**
   * Host a market that was registered after this venue started.
   *
   * An asset created from the operator panel has to become tradeable without a
   * restart, and this is the whole of what that takes: the markets share a clock
   * and nothing else, so adding one couples it to nothing already running.
   *
   * The market must be **primed and already advanced to now** before it arrives
   * here. A market whose last advance is older than the catch-up bound refuses
   * every later advance permanently (PH-19.5), so handing the venue a market
   * that was built at genesis and never caught up would add an asset that is
   * dead on arrival and reports `degraded` for ever.
   */
  host(asset: RegisteredAsset, market: HostedMarket): void {
    const id = asset.definition.id;
    if (this.#markets.has(id)) {
      throw new RangeError(`Duplicate asset in venue: ${id}.`);
    }
    this.#markets.set(id, market);
    this.#assets.set(id, asset);
  }

  /**
   * Stop hosting a market, leaving its record untouched.
   *
   * The venue forgets it; nothing about what it published is removed, rewritten
   * or replayed. Every checkpoint, candle and journal entry stays exactly where
   * it was, because a retirement is a decision to stop generating and never a
   * statement about the past (INV-009).
   */
  unhost(assetId: string): void {
    if (!this.#markets.has(assetId)) {
      throw new RangeError(`Unknown asset ${assetId}; the venue does not host it.`);
    }
    this.#markets.delete(assetId);
    this.#assets.delete(assetId);
  }

  marketFor(assetId: string): HostedMarket {
    const market = this.#markets.get(assetId);
    if (market === undefined) {
      throw new RangeError(
        `Unknown asset ${assetId}. The venue hosts: ${[...this.#markets.keys()].join(', ')}.`,
      );
    }
    return market;
  }

  assetFor(assetId: string): RegisteredAsset {
    this.marketFor(assetId);
    return this.#assets.get(assetId)!;
  }

  /** Prime every market so the next deadline is known. */
  prime(): void {
    for (const market of this.#markets.values()) market.prime();
  }

  /** Advance every market to the current clock reading. */
  advance(): readonly AssetTicks[] {
    return this.advanceTo(this.#clock.now());
  }

  /**
   * Advance every market to `now`, in a stable asset order.
   *
   * Markets are isolated from each other. They were not: a single loop with no
   * per-market handling meant a throw from one asset discarded the ticks every
   * earlier asset had *already consumed* — gone from the return value but
   * consumed from their engines — and skipped every later asset entirely, on
   * every subsequent call. One asset breaching its catch-up bound froze the
   * whole venue permanently, which is the coupling this class's own docstring
   * says must not exist.
   */
  advanceTo(now: EpochMillis): readonly AssetTicks[] {
    return this.advanceDetailed(now).published;
  }

  /** Advance every market, reporting per-asset failures instead of throwing. */
  advanceDetailed(now: EpochMillis = this.#clock.now()): VenueAdvance {
    const published: AssetTicks[] = [];
    const failures: AssetFailure[] = [];
    for (const [assetId, market] of this.#markets) {
      try {
        const ticks = market.advanceTo(now);
        if (ticks.length > 0) published.push({ assetId, ticks });
      } catch (error) {
        // Isolated deliberately: a fault in one asset must not lose another
        // asset's already-consumed ticks, and must not stop the rest advancing.
        failures.push({
          assetId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
    return { published, failures };
  }

  /**
   * Milliseconds until the soonest tick across all markets.
   *
   * A scheduler sleeps for this rather than on a fixed interval. The catalogue
   * spans 333ms to 3352ms of mean interval, so any single interval would either
   * burn CPU on the slow assets or publish the fast ones late.
   */
  msUntilNextTick(now: EpochMillis = this.#clock.now()): number | null {
    let soonest: number | null = null;
    for (const market of this.#markets.values()) {
      const wait = market.msUntilNextTick(now);
      if (wait === null) continue;
      if (soonest === null || wait < soonest) soonest = wait;
    }
    return soonest;
  }
}
