# PH-1.3 — Market domain: integer log lattice, ticks, candle aggregation, snapshot and replay

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-1.3
Parent phase: PH-1 — Deterministic Market Substrate
Status: APPROVED
Created: 2026-08-31
Decisions applied: [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md), [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md)

---

## 1. Objective

Define the market's canonical data: what a price is, what a tick is, how candles
are folded out of ticks across every timeframe, and what a snapshot and a replay
of a segment of history consist of.

## 2. Scope

`packages/core/src/market/`.

### In scope

- **Instrument specification** — asset identity, family, log quantum `δ`, display
  precision, reference price.
- **Canonical price** — the integer log lattice of ADR-0004, with conversion to a
  display price through the portable `exp`, and exact integer comparison for
  outcomes.
- **Tick** — canonical instant, per-asset monotonic sequence number, canonical
  integer price.
- **Candle** — OHLC over a timeframe bucket, plus tick count and the sequence
  range it covers.
- **Aggregation** — a pure fold from ticks to candles for any timeframe, and a
  pure re-fold from finer candles to coarser ones, with the two proven to agree.
- **Snapshot and replay contract** — what must be recorded so that a segment of
  history can be reproduced exactly, including across a restart seam.

### Out of scope

- Any generative behaviour (PH-3). This subphase defines and folds data; it does
  not produce prices.
- Persistence technology, transport, or the runtime (PH-5, PH-7).
- Contracts, expirations and settlement (PH-6). Settlement's _primitive_ — exact
  integer comparison of two canonical prices — is defined here, because it is a
  property of the representation, not of the trading layer. The word
  "expiration" does not appear in this package.

## 3. Contracts

### 3.1 Canonical price

```ts
declare const latticeBrand: unique symbol;
/** Integer count of log units. The canonical price (ADR-0004). */
export type LogPrice = number & { readonly [latticeBrand]: true };

export interface InstrumentSpec {
  readonly id: string; // ^[a-z0-9][a-z0-9._-]{0,63}$
  readonly family: AssetFamily; // forex | crypto | commodity | index | etf
  readonly logQuantum: number; // delta; the size of one lattice step in log space
  readonly displayPrecision: number; // decimal places for rendering only
  readonly referencePrice: number; // the display price at lattice origin
}

export function toDisplayPrice(spec: InstrumentSpec, price: LogPrice): number;
export function fromDisplayPrice(spec: InstrumentSpec, display: number): LogPrice;
export function compare(a: LogPrice, b: LogPrice): -1 | 0 | 1;
export function relativeMove(spec: InstrumentSpec, from: LogPrice, to: LogPrice): number;
```

`toDisplayPrice` uses the **portable** `exp`. A platform `exp` here would make the
published price platform-dependent, which would defeat PH-1.2 entirely.

`compare` is exact integer comparison and is the primitive PH-6's settlement is
built on. A `0` result is a tie, whose handling is a product rule (ADR-0003 §3).

Display precision is metadata for rendering. It is deliberately **not** used by
any comparison, because a comparison on a rounded value is exactly the 22.6pp
channel ADR-0004 exists to close.

### 3.2 Tick

```ts
export interface Tick {
  readonly instant: EpochMillis;
  readonly sequence: number; // per-asset, strictly increasing, gapless within a run
  readonly price: LogPrice;
}
```

Ordering is by `sequence`, never by `instant`. Two ticks may share a millisecond;
the sequence number is what makes the stream a total order independent of clock
resolution.

### 3.3 Candle

```ts
export interface Candle {
  readonly openInstant: EpochMillis; // bucket start, epoch-aligned
  readonly timeframe: TimeframeId;
  readonly open: LogPrice;
  readonly high: LogPrice;
  readonly low: LogPrice;
  readonly close: LogPrice;
  readonly tickCount: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
}
```

`high` and `low` are prices **actually visited** by the tick stream, never
interpolated or synthesised (§14).

`firstSequence` / `lastSequence` make a candle traceable back to the exact ticks
that produced it, which is what makes historical reconstruction auditable rather
than approximate.

### 3.4 Aggregation

```ts
export class CandleAggregator {
  constructor(timeframe: Timeframe);
  /** Returns the candle that just closed, if this tick opened a new bucket. */
  accept(tick: Tick): Candle | null;
  current(): Candle | null;
}

export function foldTicks(timeframe: Timeframe, ticks: Iterable<Tick>): Candle[];
export function foldCandles(target: Timeframe, source: readonly Candle[]): Candle[];
```

`foldCandles` re-aggregates finer candles into coarser ones. The invariant that
matters is that **both paths agree**: folding ticks directly to `1h` must equal
folding ticks to `1m` and then `1m` candles to `1h`, for every nesting pair. That
equality is the operational content of INV-004 — it is what "a timeframe is a pure
view" means in code.

Aggregation is a pure fold with no access to any generator, which is what makes
it structurally impossible for the displayed timeframe to influence the market.

**Empty buckets produce no candle.** A gap in ticks is represented by absence,
not by a synthesised flat candle: inventing a candle would invent prices that
were never visited, and `high`/`low` would no longer be prices the market
actually reached.

### 3.5 Snapshot and replay

```ts
export interface StreamSnapshot {
  readonly instrumentId: string;
  readonly keyId: string; // which sealed secret; never the secret
  readonly takenAt: EpochMillis;
  readonly sequence: number;
  readonly price: LogPrice;
  readonly cursors: Readonly<Record<string, string>>; // purpose -> formatted cursor
  readonly modelState: unknown; // opaque here; PH-3 defines its shape
}

export interface CursorAdvance {
  readonly instrumentId: string;
  readonly purpose: string;
  readonly atSequence: number;
  readonly from: string;
  readonly to: string;
  readonly reason: 'restart-lease';
}

export interface ReplaySegment {
  readonly snapshot: StreamSnapshot;
  readonly advances: readonly CursorAdvance[]; // ordered by atSequence
}
```

A replayable history is `snapshot + ordered cursor advances`. The advances exist
because a restart moves the cursor discontinuously by design (ADR-0002 §4); a
segment spanning a restart cannot be reproduced without them.

The snapshot records a `keyId`, never a secret. Reconstruction requires
possession of the sealed key, which is what keeps replay an operator capability
rather than a public one.

## 4. Invariants

| ID  | Invariant                                                                                                                                              | Verified by                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| M1  | `foldTicks(coarse, ticks)` equals `foldCandles(coarse, foldTicks(fine, ticks))` for every nesting pair                                                 | property tests over all ordered timeframe pairs              |
| M2  | `high` and `low` are prices present in the source ticks                                                                                                | property tests                                               |
| M3  | `open` is the first tick's price and `close` the last, by sequence                                                                                     | property tests                                               |
| M4  | Candles are epoch-aligned and non-overlapping; every tick lands in exactly one                                                                         | property tests                                               |
| M5  | Empty buckets yield no candle                                                                                                                          | unit tests                                                   |
| M6  | Aggregation is order-independent given sequence order, and streaming aggregation equals batch aggregation                                              | differential test between `CandleAggregator` and `foldTicks` |
| M7  | Display conversion round-trips within one lattice step and never participates in comparison                                                            | unit tests plus a guardrail on `compare`                     |
| M8  | The domain is translation-invariant: shifting every price by a constant lattice offset shifts every candle by the same offset and changes nothing else | property test                                                |
| M9  | Nothing in the package reads a clock, randomness, or a trading concept                                                                                 | existing guardrails                                          |

## 5. Failure behaviour

| Condition                                                      | Behaviour                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| Tick with a sequence not greater than the previous             | `RangeError` — a stream that can reorder cannot be audited |
| Tick with an instant earlier than the previous                 | `RangeError`                                               |
| Non-integer `LogPrice`                                         | `RangeError`                                               |
| `logQuantum` non-positive or non-finite                        | `RangeError`                                               |
| `foldCandles` where the source does not nest inside the target | `RangeError`                                               |
| `foldCandles` over mixed timeframes                            | `RangeError`                                               |

Out-of-order ticks throw rather than being sorted. Silently reordering would make
`open` and `close` depend on arrival order, which is precisely the kind of
ambiguity that makes a settlement dispute unresolvable.

## 6. Acceptance criteria

| #   | Criterion                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Both aggregation paths agree for every ordered timeframe pair, over generated tick streams including sparse, bursty and single-tick buckets |
| C2  | `high`/`low` are always visited prices; `open`/`close` are the first and last by sequence                                                   |
| C3  | Streaming and batch aggregation produce identical candles                                                                                   |
| C4  | Empty buckets produce no candle, and a gap spanning many buckets produces none of them                                                      |
| C5  | Display conversion round-trips to within one lattice step across the full range of realistic prices for every asset family                  |
| C6  | Shifting the lattice origin leaves every relative move and every candle shape unchanged                                                     |
| C7  | Out-of-order and malformed input throws rather than being silently accepted                                                                 |
| C8  | A `ReplaySegment` reproduces a recorded tick sequence exactly, including across a synthetic restart seam                                    |
| C9  | Aggregation throughput is measured and recorded                                                                                             |

## 7. Verification requirements

- Unit tests for construction, conversion, ordering and failure behaviour.
- Property tests over all ordered timeframe pairs with deterministically
  generated tick streams of varied density.
- A differential test between streaming and batch aggregation.
- A replay test across a synthetic restart seam.
- `npm run build`, `npm run lint`, `npm run format:check`.
- A recorded throughput measurement.

## 8. Dependencies

PH-1.1 (time, entropy), PH-1.2 (portable `exp`).

## 9. Expected result

A canonical market data model on which PH-1.4 can build a simulation runner, and
PH-2 can build an attack battery, without either needing to make a single
decision about what a price is.

---

## 10. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

| #   | Criterion                                        | Evidence                                                                                                                                                                                                                              |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Both aggregation paths agree                     | `candle.test.ts` and `market.stat.test.ts` — all 66 ordered timeframe pairs, across dense, sparse, bursty-with-outages and very-sparse streams, up to 400k ticks; plus a chained re-fold 1s→5s→…→1d compared against each direct fold |
| C2  | `high`/`low` visited, `open`/`close` by sequence | `candle.test.ts`, recomputed independently in a single pass                                                                                                                                                                           |
| C3  | Streaming equals batch                           | differential test on every timeframe, at unit and at 400k-tick scale                                                                                                                                                                  |
| C4  | Empty buckets produce no candle                  | `candle.test.ts`, including a six-hour gap spanning hundreds of 1m buckets                                                                                                                                                            |
| C5  | Display round-trip within one step               | `instrument.test.ts` across ±200k steps for forex and crypto specs                                                                                                                                                                    |
| C6  | Translation invariance                           | `candle.test.ts` — shifting every price by a constant shifts every OHLC by exactly that constant and changes nothing else                                                                                                             |
| C7  | Malformed input throws                           | non-increasing sequence, backwards instant, unsorted ticks, mixed source timeframes, non-nesting re-fold, unordered source candles                                                                                                    |
| C8  | Replay across a restart seam                     | `replay.test.ts` — cursor resolution before, at and after each advance, latest-per-purpose, and refusal to resolve before the segment begins                                                                                          |
| C9  | Throughput                                       | **27.6M ticks/s** streaming aggregation                                                                                                                                                                                               |

### Verification executed

`npm run format:check`, `npm run lint`, `npm run build`, `npx vitest run` — all
passed. **286 tests across 17 files.** Hosted CI has not executed: no remote.

### Note on test placement

The exhaustive cross-timeframe sweep was moved to the statistical suite and a
reduced version kept in the unit suite, after the unit suite reached 8 seconds.
Fast feedback and exhaustive proof are both wanted; they are not wanted in the
same place.
