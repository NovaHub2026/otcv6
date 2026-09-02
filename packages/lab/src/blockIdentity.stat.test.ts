// Invariant evidence: INV-006 (no deterministic exploitable directional rules).
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, type Tick } from '@otc/core';
import { BINARY_HORIZONS } from './horizons.js';
import { runStandingAssurance } from './standing.js';

/**
 * The leak the battery could not see, and now can.
 *
 * **Cycle Audit 6, CA6-04.** Every temporal family in the registry conditioned
 * on the clock's *phase* — where in a minute, an hour, a fifteen-minute grid.
 * None conditioned on the clock's **identity**. An auditor keyed the direction
 * of each 60-second block to a bit of `splitmix32(blockIndex)` — public
 * arithmetic anyone can recompute — and paid an observer **+1.4% per trade**,
 * 3.8 times the profitability threshold this laboratory exports, while the full
 * battery returned zero exploitable findings and `runStandingAssurance` signed
 * `clean` with 23 family names on it.
 *
 * The record here is that record. It is not something this engine can produce —
 * ADR-0003 makes every sign an independent fair coin — which is exactly why it
 * belongs in the laboratory: the battery's job is to fail an engine that leaks,
 * and a battery that cannot fail on a leak this blunt is not evidence of
 * anything.
 *
 * ## What this does not prove
 *
 * That the battery catches *every* index-keyed leak. An adversary may key on any
 * public function and no finite battery enumerates them all. What it proves is
 * that the class is represented at all, which it was not.
 */

const GENESIS = 1_776_000_000_000;
const TICK_MS = 30_000;
const BLOCK_MS = 60_000;
const TICKS = 400_000;

/** `splitmix32`'s finalizer — the attacker's function, computed as they would. */
function digest(value: number): number {
  let x = (value + 0x9e37_79b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0_aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a_2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/**
 * A near-symmetric walk whose direction inside each block is public.
 *
 * `strength` is the probability a step follows its block's bias. At 0.5 the
 * record is a fair walk; at 0.53 an observer who recomputes the digest wins
 * about 51.5% of 30-second contracts.
 */
function blockKeyedRecord(strength: number): Tick[] {
  const ticks: Tick[] = [];
  let price = 0;
  for (let i = 0; i < TICKS; i += 1) {
    const instant = GENESIS + i * TICK_MS;
    const bias = (digest(Math.floor(instant / BLOCK_MS)) & 1) === 1 ? 1 : -1;
    const follows = digest(i * 2_654_435_761 + 12_345) / 4_294_967_296 < strength;
    price += follows ? bias : -bias;
    ticks.push({ sequence: i + 1, instant: epochMillis(instant), price: logPrice(price) });
  }
  return ticks;
}

function withheldFor(ticks: readonly Tick[]) {
  return {
    seamIndices: [Math.floor(ticks.length / 3)],
    reference: {
      instants: Float64Array.from(ticks, (tick) => tick.instant),
      prices: Int32Array.from(ticks, (_, i) => (i * 7_919) % 1_000),
    },
  };
}

function observerEdge(ticks: readonly Tick[]): number {
  let wins = 0;
  let decided = 0;
  for (let i = 1; i < ticks.length; i += 1) {
    const bet = (digest(Math.floor(ticks[i - 1]!.instant / BLOCK_MS)) & 1) === 1 ? 1 : -1;
    const move = ticks[i]!.price - ticks[i - 1]!.price;
    if (move === 0) continue;
    decided += 1;
    if (Math.sign(move) === bet) wins += 1;
  }
  return 100 * (wins / decided - 0.5);
}

describe('a record keyed to the identity of a clock block', () => {
  it('is caught, and the leak is real before it is caught', async () => {
    const ticks = blockKeyedRecord(0.53);
    const edge = observerEdge(ticks);
    console.info(`block-keyed record: observer edge ${edge.toFixed(3)}pp per 30s contract`);
    // The leak has to be real, or catching it proves nothing.
    expect(edge).toBeGreaterThan(1);

    const verdict = await runStandingAssurance({
      assetId: 'block-keyed',
      instrument: {
        id: 'block-keyed',
        family: 'index',
        logQuantum: 1e-5,
        referencePrice: 100,
        displayPrecision: 5,
      },
      ticks,
      at: epochMillis(GENESIS + TICKS * TICK_MS),
      withheld: withheldFor(ticks),
      horizons: [BINARY_HORIZONS[0]!],
    });
    console.info(
      `verdict ${verdict.outcome}: ${verdict.families.length} families, ` +
        `${verdict.hypothesesTested} hypotheses, ${verdict.exploitable.length} exploitable, ` +
        `worst z ${verdict.worstZ?.toFixed(2) ?? 'n/a'}`,
    );

    expect(verdict.outcome).toBe('exploitable');
    // And caught by the family that exists for it, not incidentally by another.
    expect(verdict.exploitable.some((f) => f.family.startsWith('block-index-digest'))).toBe(true);
  }, 600_000);

  it('says nothing it cannot support about a fair walk of the same shape', async () => {
    // The control. A record built identically with no bias must not be reported
    // as exploitable — a family that fires on everything is not a detector.
    const ticks = blockKeyedRecord(0.5);
    expect(Math.abs(observerEdge(ticks))).toBeLessThan(0.5);

    const verdict = await runStandingAssurance({
      assetId: 'block-control',
      instrument: {
        id: 'block-control',
        family: 'index',
        logQuantum: 1e-5,
        referencePrice: 100,
        displayPrecision: 5,
      },
      ticks,
      at: epochMillis(GENESIS + TICKS * TICK_MS),
      withheld: withheldFor(ticks),
      horizons: [BINARY_HORIZONS[0]!],
    });
    console.info(
      `control verdict ${verdict.outcome}: ${verdict.exploitable.length} exploitable, ` +
        `worst z ${verdict.worstZ?.toFixed(2) ?? 'n/a'}`,
    );
    expect(verdict.exploitable).toEqual([]);
  }, 600_000);
});
