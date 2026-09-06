import {
  epochMillis,
  logPrice,
  type EpochMillis,
  type LogPrice,
  type MasterKeyring,
  type RandomSource,
  type Tick,
  yieldToLoop,
} from '@otc/core';
import { configFor, createMarketEngine, type RegisteredAsset } from '@otc/engine';
import type { HostedMarket } from '@otc/runtime';

/**
 * What a venue hands a composition that may touch the engine — the Lab — and
 * nothing a production controller can hold (PH-28.2).
 *
 * Until this existed, `VenueService` carried `hostedMarket()`, `labFork()` and
 * the rest, and every production controller was injected with the object that
 * could snapshot the engine: all seven keystream cursors and the latent state
 * one method call away (Cycle Audit 9, a1-01, guarded by value at every
 * production GET route since). The methods live here now, and this object is
 * constructed by `VenueService` and handed out **once, through a callback the
 * composition passes** — `AppModuleOptions.engineAccess`, the way the sign
 * source is composed. `main.ts` registers the application bare, so in
 * production the object is never created; `LabModule` passes the callback and
 * provides what it receives. ADR-0015 §3 again: the boundary is what is
 * composed, not a flag, and a missing object cannot be misused.
 *
 * The ports are functions rather than the venue itself, so this class can name
 * the engine without the venue's type naming it back.
 */
export interface EnginePorts {
  /** The hosted market for an asset, or null when it is not hosted. */
  readonly marketFor: (assetId: string) => HostedMarket | null;
  readonly assetFor: (assetId: string) => RegisteredAsset | null;
  readonly keyring: MasterKeyring;
}

export class EngineAccess {
  constructor(private readonly ports: EnginePorts) {}

  /**
   * The hosted market for an asset, or null.
   *
   * The Lab reads engine state the product never publishes. The boundary that
   * makes that safe is composition — this object exists only in a process whose
   * composition asked for it (PH-28.2) — rather than a check here, because a
   * check here would be a flag (ADR-0015 §3).
   */
  hostedMarket(assetId: string): HostedMarket | null {
    return this.ports.marketFor(assetId);
  }

  /**
   * The unsigned step sizes the next `spanMs` of this market will produce.
   *
   * Read from a **fork**: the engine is snapshotted and a copy is run forward,
   * so the live market is not advanced and no keystream position is consumed
   * twice. The steps are the same whatever signs are drawn — that is ADR-0003's
   * theorem, and `stepIndependence.test.ts` verifies it on the shipped engine —
   * which is what makes an exact close cost two milliseconds instead of minutes.
   */
  labStepsAhead(assetId: string, spanMs: number): number[] {
    const market = this.hostedMarket(assetId);
    const asset = this.ports.assetFor(assetId);
    if (market === null || asset === null) return [];
    const snapshot = market.snapshotEngine();
    const fork = createMarketEngine({
      config: configFor(asset),
      keyring: this.ports.keyring,
      environment: 'production',
      start: { instant: epochMillis(snapshot.instant), price: logPrice(snapshot.price) },
    });
    fork.restore(snapshot);
    const steps: number[] = [];
    let price = snapshot.price;
    const until = snapshot.instant + spanMs;
    for (;;) {
      const tick = fork.next();
      if (tick === null || tick.instant > until) break;
      steps.push(Math.abs(tick.price - price));
      price = tick.price;
    }
    return steps;
  }

  /**
   * The next `count` ticks this market will produce, from a fork.
   *
   * Same fork discipline as {@link VenueService.labStepsAhead}: the live engine
   * is snapshotted and a copy run forward, so the market is not advanced and no
   * keystream position is consumed twice. The Lab reads the future; it does not
   * spend it.
   */
  /**
   * `labTicksAhead`, yielding to the event loop every `chunk` ticks (PH-24.17).
   *
   * The quality sample is a span in the asset's own ticks — millions at the
   * finer grain — and a synchronous walk of that length held the process for
   * seconds: the panel's polls answered 502 and the screen read the Lab as
   * gone. The venue keeps ticking between chunks.
   */
  async labTicksAheadAsync(assetId: string, count: number, chunk = 250_000): Promise<Tick[]> {
    const market = this.hostedMarket(assetId);
    const asset = this.ports.assetFor(assetId);
    if (market === null || asset === null) return [];
    const snapshot = market.snapshotEngine();
    const fork = createMarketEngine({
      config: configFor(asset),
      keyring: this.ports.keyring,
      environment: 'production',
      start: { instant: epochMillis(snapshot.instant), price: logPrice(snapshot.price) },
    });
    fork.restore(snapshot);
    const ticks: Tick[] = [];
    for (let i = 0; i < count; i += 1) {
      const tick = fork.next();
      if (tick === null) break;
      ticks.push(tick);
      if (ticks.length % chunk === 0) await yieldToLoop();
    }
    return ticks;
  }

  labTicksAhead(assetId: string, count: number): Tick[] {
    const market = this.hostedMarket(assetId);
    const asset = this.ports.assetFor(assetId);
    if (market === null || asset === null) return [];
    const snapshot = market.snapshotEngine();
    const fork = createMarketEngine({
      config: configFor(asset),
      keyring: this.ports.keyring,
      environment: 'production',
      start: { instant: epochMillis(snapshot.instant), price: logPrice(snapshot.price) },
    });
    fork.restore(snapshot);
    const ticks: Tick[] = [];
    for (let i = 0; i < count; i += 1) {
      const tick = fork.next();
      if (tick === null) break;
      ticks.push(tick);
    }
    return ticks;
  }

  /**
   * A fork of a hosted market, positioned where the live engine stands.
   *
   * Same discipline as {@link VenueService.labStepsAhead}: snapshot, copy,
   * restore — the live market is not advanced and no keystream position is
   * spent twice. The fork stands at the engine's current price, which is the
   * pending tick's when one is drawn (the snapshot is taken after that draw),
   * and its first `next()` is the tick the live engine will draw next. That is
   * exactly the alignment PH-24.2 needs for an armed vector to begin on the
   * right tick.
   */
  labFork(
    assetId: string,
    wrapSign?: (keystream: RandomSource) => RandomSource,
    wrapArrival?: (keystream: RandomSource) => RandomSource,
  ): {
    readonly price: LogPrice;
    readonly instant: EpochMillis;
    next(): Tick | null;
  } | null {
    const market = this.hostedMarket(assetId);
    const asset = this.ports.assetFor(assetId);
    if (market === null || asset === null) return null;
    const snapshot = market.snapshotEngine();
    const config = configFor(asset);
    // PH-24.10: a fork whose signs the Lab chooses — the landing of a push is
    // the engine's own magnitudes under the pushed signs. Only the sign stream
    // is substituted, as the mirror harness does; `restore` seeks it, so a
    // wrapper that releases on seek must be armed after this returns.
    const derive = (purpose: 'sign' | 'arrival'): RandomSource =>
      this.ports.keyring.derive({
        env: 'production',
        asset: config.instrument.id,
        purpose,
        keyEpoch: 0,
      });
    const streams =
      wrapSign === undefined && wrapArrival === undefined
        ? {}
        : {
            streams: {
              ...(wrapSign === undefined ? {} : { sign: wrapSign(derive('sign')) }),
              ...(wrapArrival === undefined ? {} : { arrival: wrapArrival(derive('arrival')) }),
            },
          };
    const fork = createMarketEngine({
      config,
      keyring: this.ports.keyring,
      environment: 'production',
      start: { instant: epochMillis(snapshot.instant), price: logPrice(snapshot.price) },
      ...streams,
    });
    fork.restore(snapshot);
    return {
      price: snapshot.price,
      instant: epochMillis(snapshot.instant),
      next: () => fork.next(),
    };
  }

  /** A Lab-only randomness stream: never a market one. */
  labRandom(assetId: string): RandomSource {
    return this.ports.keyring.derive({
      env: 'simulation',
      asset: assetId,
      purpose: 'lab-close-selection',
      keyEpoch: 0,
    });
  }
}
