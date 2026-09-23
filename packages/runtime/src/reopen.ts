import {
  epochMillis,
  type Clock,
  type Environment,
  type MasterKeyring,
  type Tick,
} from '@otc/core';
import { configFor, createMarketEngine, type RegisteredAsset } from '@otc/engine';
import { startKeyEpoch } from './genesis.js';
import { HostedMarket } from './hosted.js';
import { personalityFingerprint } from './personality.js';
import { engineStreams, type RecoveryOutcome, type SignSourceFactory } from './resume.js';
import { DEFAULT_SEQUENCE_LEASE } from './state.js';

/**
 * The shortest time between two automatic reopenings of one market.
 *
 * A reopening is the acceptance of an outage, and an outage that recurs every
 * few seconds is not an outage — it is a process that cannot keep up, and the
 * honest report of that is a stall an operator sees, not a stream of seams that
 * makes the record unreadable while the venue looks healthy.
 *
 * Sixty seconds is four times the catch-up bound: long enough that a market
 * reopening at this rate is visibly wrong, short enough that a host which
 * suspends twice in a minute still comes back by itself the second time.
 */
export const MIN_REOPEN_INTERVAL_MS = 60_000;

export interface ReopenOptions {
  /** The market that was refused by its catch-up bound. */
  readonly market: HostedMarket;
  readonly asset: RegisteredAsset;
  readonly keyring: MasterKeyring;
  readonly environment: Environment;
  readonly clock: Clock;
  readonly maxCatchUpMs?: number;
  readonly retractable?: boolean;
  /**
   * The Lab's stream hooks, when a composition has them (PH-24.1).
   *
   * Carried through for the same reason a resume carries them: a reopened
   * market is the same market, and dropping the hook would hand a controlled
   * market back to the keystream halfway through a scenario. Production passes
   * neither.
   */
  readonly signSource?: SignSourceFactory;
  readonly arrivalSource?: SignSourceFactory;
}

export interface ReopenResult {
  readonly market: HostedMarket;
  readonly outcome: Extract<RecoveryOutcome, { kind: 'seam' }>;
  /** The tick the reopened market carries its price from. */
  readonly from: Pick<Tick, 'sequence' | 'instant' | 'price'>;
}

/**
 * A market that has never published cannot be reopened: there is no price to
 * carry, and inventing one would be a genesis wearing a seam's name.
 */
export class NothingPublishedError extends Error {
  constructor(readonly assetId: string) {
    super(
      `${assetId} has published nothing, so there is no price to reopen from. ` +
        `A market in this state is a genesis, which belongs to the boot path.`,
    );
    this.name = 'NothingPublishedError';
  }
}

/**
 * Reopen a market that its catch-up bound refuses, as a recorded seam.
 *
 * **Why this exists (ADR-0020).** The bound is permanent by construction:
 * `#lastAdvancedAt` moves only after the check it failed, so a market that falls
 * behind can never catch up and every later advance is refused too. That is the
 * correct refusal — publishing the missing interval at once would invent a
 * stretch of market nobody observed, and at thirty seconds that stretch is a
 * whole contract (ADR-0010) — but its only exit was a person restarting the
 * process.
 *
 * What a restart does is exactly this, and no more: the market opens at the
 * clock, from the last price anyone is known to have seen, on a key epoch
 * derived from that instant (ADR-0019), with its sequence a full lease past
 * everything published. The gap stays a gap, the record writes the
 * discontinuity when the first tick lands a sequence past the hole, and
 * `settle()` refuses any contract whose window touches it.
 *
 * Nothing here reads a price to decide anything: the carried price is the
 * market's own last published tick, and the only arithmetic is on sequences and
 * instants, which are public.
 */
export function reopenStalledMarket(options: ReopenOptions): ReopenResult {
  const { market, asset, clock } = options;
  const last = market.lastPublishedState;
  const assetId = asset.definition.id;
  if (last === null) throw new NothingPublishedError(assetId);

  // Forward only, as on every other seam path: a clock that has been rewound
  // must not reopen a market before the last instant it published at, which
  // would put two prices on one instant for observers either side of it.
  const instant = epochMillis(Math.max(last.instant, clock.now()));
  const keyEpoch = startKeyEpoch(instant, market.keyEpoch);
  const sequence = last.sequence + DEFAULT_SEQUENCE_LEASE;
  const engine = createMarketEngine({
    config: configFor(asset),
    keyring: options.keyring,
    environment: options.environment,
    keyEpoch,
    ...engineStreams(
      {
        asset,
        keyring: options.keyring,
        environment: options.environment,
        ...(options.signSource === undefined ? {} : { signSource: options.signSource }),
        ...(options.arrivalSource === undefined ? {} : { arrivalSource: options.arrivalSource }),
      },
      keyEpoch,
    ),
    start: { instant, price: last.price, sequence },
  });
  return {
    market: new HostedMarket({
      engine,
      clock,
      personality: personalityFingerprint(asset),
      keyEpoch,
      resumeLastPublished: last,
      ...(options.maxCatchUpMs === undefined ? {} : { maxCatchUpMs: options.maxCatchUpMs }),
      ...(options.retractable === undefined ? {} : { retractable: options.retractable }),
    }),
    outcome: {
      kind: 'seam',
      reason:
        `reopened in place at the clock: the market was past its catch-up bound, which no ` +
        `later advance can clear, so it continues from sequence ${last.sequence} on a new key ` +
        `epoch with the outage left as a gap (ADR-0020)`,
      fromSequence: last.sequence,
      // Stated from the lease, not read off a drawn tick: what the engine holds
      // before it is published is private state (INV-010).
      resumesAtSequence: sequence + 1,
    },
    from: last,
  };
}
