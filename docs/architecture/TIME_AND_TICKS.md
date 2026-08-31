# Architecture — Time and ticks

Type: SUPPORTING DOCUMENTATION (living)
Describes: what exists in `packages/core/src/time/` today

> **Scope note.** Ticks and candle aggregation arrive in PH-1.3. This document
> currently describes the time model only, and will be extended rather than
> replaced. A missing section means the layer does not exist yet, not that it is
> undocumented.

---

## Instants

The canonical instant is a **whole number of milliseconds since the Unix epoch**,
branded as `EpochMillis`.

Integer milliseconds rather than a floating-point or higher-resolution
representation, because every downstream invariant depends on exact arithmetic:
bucket alignment, replay and settlement all divide and compare instants, and a
representation carrying a fractional remainder makes those comparisons
platform-sensitive.

Pre-epoch instants are rejected. The market has no pre-1970 history, and allowing
negative values would make `t % duration` sign-dependent and bucket alignment
quietly wrong.

Tick ordering never depends on clock resolution: ticks carry a per-asset
monotonic sequence number, so two ticks inside the same millisecond stay strictly
ordered.

## Clocks

Everything that needs "now" takes a `Clock`. `SystemClock` is the single
sanctioned reader of ambient time, and the guardrail suite asserts that it is the
**only** file in generation code that reads it — a module that can reach the wall
clock cannot be replayed.

`FixedClock` and `SteppableClock` cover deterministic testing.

Server time is authoritative. Client-supplied timestamps are never able to
determine anything settlement-relevant.

## Timeframes

```
1s  5s  15s  30s  1m  5m  15m  30m  1h  4h  1d
  ×5  ×3   ×2  ×2  ×5   ×3   ×2  ×2  ×4  ×6
```

Two properties are load-bearing and are asserted by tests over **every ordered
pair**, not merely adjacent ones:

1. every duration divides every coarser duration;
2. every bucket is aligned to the Unix epoch.

Together they make a coarse candle exactly the union of the fine candles inside
it. Concretely, `bucketStart(bucketStart(t, fine), coarse) === bucketStart(t, coarse)`
for all `t` and all pairs. This is the structural precondition for INV-004: a
timeframe is a pure view over one tick stream, so selecting one cannot influence
the market.

**Weekly and monthly timeframes are deliberately absent.** Their lengths do not
divide a fixed grid, so they would break exact nesting and reintroduce calendar
logic into a market that runs continuously (§22). If they are ever required they
must be built as a presentation-layer concern over aligned candles, never as
another aggregation grid.

There is no session, market-hours or holiday concept anywhere in the time model,
for the same reason.
