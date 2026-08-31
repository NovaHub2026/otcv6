// Invariant evidence: INV-001 (economic independence).
import { describe, expect, it } from 'vitest';
import {
  durationMillis,
  epochMillis,
  logPrice,
  MasterKeyring,
  SteppableClock,
  type Tick,
} from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine } from '@otc/engine';
import { HostedMarket } from '@otc/runtime';
import { settle, tally, type Contract, type Settlement, type TickRecord } from '@otc/trading';

/**
 * The demonstration INV-001 has been standing in for.
 *
 * Until PH-6 the invariant was established *structurally*: the guardrail scan
 * proves the price path never names a payout, an exposure or a position. That is
 * a strong argument, and it is not a demonstration — it was also easy to make,
 * because contracts and the engine had never existed in the same process. There
 * were no positions to leak.
 *
 * So this runs the same market twice from the same key, the same genesis and the
 * same clock schedule. One run is quiet. The other is traded, hard and
 * adversarially. **Every published tick must be identical.**
 *
 * If a single tick differs, economic state reached price generation and the
 * product's central claim is false. The test is worth more than any review
 * because it fails on a mechanism nobody thought of.
 */

const GENESIS = epochMillis(1_776_000_000_000);
const keyring = MasterKeyring.forTesting('economic-blindness');
const STEP_MS = 5_000;
const STEPS = 720; // one hour of wall clock

function market(assetIndex: number, clock: SteppableClock): HostedMarket {
  const asset = ASSET_CATALOGUE[assetIndex]!;
  return new HostedMarket({
    engine: createMarketEngine({
      config: configFor(asset),
      keyring,
      environment: 'simulation',
      start: { instant: GENESIS, price: logPrice(0) },
    }),
    clock,
    maxCatchUpMs: 86_400_000,
  });
}

/** Run a market for an hour, doing nothing but publishing. */
function quietRun(assetIndex: number): Tick[] {
  const clock = new SteppableClock(GENESIS);
  const hosted = market(assetIndex, clock);
  const ticks: Tick[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    clock.advance(durationMillis(STEP_MS));
    ticks.push(...hosted.advance());
  }
  return ticks;
}

interface TradedRun {
  readonly ticks: Tick[];
  readonly settlements: Settlement[];
  readonly stakes: number[];
}

/**
 * The same market, traded the way a leak would be exploited.
 *
 * Not decorative trading. A demonstration that places ten contracts and finds
 * the ticks unchanged proves very little, so this does the things that would
 * matter if the engine could see them: heavy one-sided exposure, every contract
 * on the same asset, entries pinned to tick instants, and stakes scaled by
 * recent realised movement — so the *size* of the operator's exposure correlates
 * with the market's own state.
 */
function tradedRun(assetIndex: number): TradedRun {
  const clock = new SteppableClock(GENESIS);
  const hosted = market(assetIndex, clock);
  const ticks: Tick[] = [];
  const open: Contract[] = [];
  const settlements: Settlement[] = [];
  const stakes: number[] = [];
  let nextId = 0;

  for (let step = 0; step < STEPS; step += 1) {
    clock.advance(durationMillis(STEP_MS));
    const published = hosted.advance();
    ticks.push(...published);

    // Stake scaled by how far the market has just moved: exposure that tracks
    // the market's own state, which is what a naive "risk-managed" venue does
    // and exactly the coupling that would show up here if it existed.
    const recent = ticks.slice(-40);
    const movement =
      recent.length < 2 ? 1 : Math.abs(recent[recent.length - 1]!.price - recent[0]!.price) + 1;

    for (const tick of published) {
      if (nextId >= 4_000) break;
      open.push({
        id: `c${nextId++}`,
        assetId: ASSET_CATALOGUE[assetIndex]!.definition.id,
        // One-sided on purpose: maximal directional exposure for the operator.
        direction: 'up',
        stake: Math.min(10_000, movement),
        entryInstant: tick.instant,
        horizonMs: durationMillis(30_000),
        payoutRatio: 0.85,
      });
    }

    // Settle everything that can be settled, so the ledger is live and the
    // operator's position is genuinely changing throughout the run.
    const record: TickRecord = {
      instants: new Float64Array(ticks.map((t) => t.instant)),
      prices: Int32Array.from(ticks.map((t) => t.price)),
    };
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const contract = open[i]!;
      if (contract.entryInstant + contract.horizonMs > clock.now()) continue;
      try {
        settlements.push(settle(contract, record));
        stakes.push(contract.stake);
        open.splice(i, 1);
      } catch {
        // Not settleable yet against this record; try again next step.
      }
    }
  }
  return { ticks, settlements, stakes };
}

describe('the market cannot see that it is being traded', () => {
  it.each(ASSET_CATALOGUE.map((a, i) => [a.definition.id, i] as const))(
    '%s produces identical ticks whether or not it is traded',
    (id, index) => {
      const quiet = quietRun(index);
      const traded = tradedRun(index);

      // The test must not be able to pass vacuously.
      expect(quiet.length, `${id} produced no ticks`).toBeGreaterThan(500);
      expect(traded.settlements.length, `${id} settled no contracts`).toBeGreaterThan(200);

      // The claim itself. Not "statistically similar" — identical.
      expect(traded.ticks.length, `${id} tick count`).toBe(quiet.length);
      expect(traded.ticks, `${id} tick stream diverged under trading`).toEqual(quiet);
    },
  );

  it('reports an operator margin consistent with the payout and nothing else', () => {
    // A second, economic check on the same runs. With a fair coin and an 85%
    // payout, the operator keeps about 7.5% of everything staked — that is the
    // advertised edge, and under ADR-0007 it is the whole of it, because ties
    // are refunded rather than taken.
    const traded = tradedRun(0);
    const ledger = tally(traded.settlements, traded.stakes);
    expect(ledger.contracts).toBeGreaterThan(200);

    // Wide bands, and the reason matters. Contracts are entered at *every* tick
    // with a 30-second horizon, so at a ~1.3s tick interval roughly twenty are
    // open at once and they share most of their price path. They are nowhere
    // near independent, and `outcomes.ts` flags exactly this trap: the effective
    // sample size is a small fraction of the contract count.
    //
    // So a measured win rate of ~47% over 4,000 overlapping contracts is well
    // inside one standard error, and reading it as evidence of bias would be the
    // same mistake as reading a single realisation's kurtosis as the truth
    // (PH-4.1). The claim this test makes is the tick-identity above; the ledger
    // is a sanity check, deliberately loose.
    expect(ledger.winRateOfDecided).toBeGreaterThan(0.3);
    expect(ledger.winRateOfDecided).toBeLessThan(0.7);
    expect(ledger.operatorMargin).toBeGreaterThan(-0.35);
    expect(ledger.operatorMargin).toBeLessThan(0.45);

    console.info(
      `blindness ledger: ${ledger.contracts} contracts, ` +
        `${ledger.refunds} refunded (${((100 * ledger.refunds) / ledger.contracts).toFixed(2)}%), ` +
        `win rate of decided ${(100 * ledger.winRateOfDecided).toFixed(2)}%, ` +
        `operator margin ${(100 * ledger.operatorMargin).toFixed(2)}%`,
    );
  });
});

describe('settlement is blind too, on real market data', () => {
  /**
   * Cycle Audit 2 found that the demonstration above has a blind spot exactly
   * where it matters: it compares tick streams, and a leak in *settlement*
   * leaves the ticks untouched. A rule shaving small wins into refunds passed
   * all 769 unit tests, all 137 guardrails and this very file, while lifting the
   * operator's margin from 12.75% to 17.19%.
   *
   * Ticks alone were never going to catch that. The property that does is
   * symmetry: over a real generated record, flipping the trade direction must
   * exchange wins and losses exactly and leave ties untouched, because a tie
   * belongs to the prices and not to the bet.
   */
  it('exchanges wins and losses exactly when the direction is flipped', () => {
    const traded = tradedRun(0);
    const record: TickRecord = {
      instants: new Float64Array(traded.ticks.map((t) => t.instant)),
      prices: Int32Array.from(traded.ticks.map((t) => t.price)),
    };

    let mirrored = 0;
    let ties = 0;
    for (let i = 0; i < traded.ticks.length - 60; i += 7) {
      const base: Contract = {
        id: `mirror-${i}`,
        assetId: ASSET_CATALOGUE[0]!.definition.id,
        direction: 'up',
        stake: 100,
        entryInstant: traded.ticks[i]!.instant,
        horizonMs: durationMillis(30_000),
        payoutRatio: 0.85,
      };
      let up: Settlement;
      let down: Settlement;
      try {
        up = settle(base, record);
        down = settle({ ...base, direction: 'down' }, record);
      } catch {
        continue; // beyond the record
      }
      if (up.outcome === 'refund' || down.outcome === 'refund') {
        expect(down.outcome, `contract ${i}: a tie must be seen by both sides`).toBe(up.outcome);
        ties += 1;
      } else {
        expect(down.outcome, `contract ${i}: ${up.outcome} did not mirror`).toBe(
          up.outcome === 'win' ? 'loss' : 'win',
        );
        mirrored += 1;
      }
    }

    // Cannot pass vacuously.
    expect(mirrored, 'no decided contracts were compared').toBeGreaterThan(500);
    // eslint-disable-next-line no-console -- recorded evidence for the audit
    console.info(`settlement mirror: ${mirrored} decided pairs exchanged, ${ties} ties symmetric`);
  });
});
