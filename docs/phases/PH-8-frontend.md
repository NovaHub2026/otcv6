# PH-8 — Observer Frontend and Trading Chart Experience

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-8
Status: APPROVED
Cycle: 3 (phase 2 of 3)
Created: 2026-08-31
Branch: `feature/ph-8-frontend`
Depends on: PH-1 … PH-7 (all APPROVED)
Decisions applied: [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md)

---

## 1. Objective

Show the market to a person, without showing them a market that does not exist.

## 2. Problem

Every layer so far has _verified_ the market. The frontend is the first that
**renders** it, and rendering is lossy by necessity: a chart has a few hundred
pixels of width and the record has hundreds of thousands of ticks. Something must
be discarded.

The danger is that every natural way to discard information invents prices the
market never visited. This is the mirror image of PH-7's trap — there, the
temptation was to give a slow client _less_ than the truth; here it is to give a
viewer something _smoother_ than the truth. Both are invisible to the person
affected.

### 2.1 Interpolation invents prices

A line chart drawn between two ticks implies every intermediate value was traded.
It was not. `query.ts` has said since PH-1.3 that "interpolating between ticks
would invent prices the market never visited, which is the same defect as
synthesising a candle for an empty bucket" — and a chart library will do it by
default, because for most data sources it is the right thing.

A binary option settles on whether the price was above or below a level. A chart
that draws a smooth path through a level the market never touched is not a
cosmetic problem.

### 2.2 Downsampling can hide the only thing that mattered

Rendering 200,000 ticks into 800 columns means roughly 250 ticks per column. Take
the first, the last, or every 250th and the spikes disappear — and a spike is
precisely what a trader is looking at.

The correct reduction keeps, per column, the **open, high, low and close** of the
ticks that fall in it. That is exactly what a candle is, which is not a
coincidence: the OHLC form exists because it is the lossy reduction that preserves
what matters about a price path.

So: **every extreme present in the underlying window must be present in what is
rendered.** That is a testable property, not a style preference.

### 2.3 An empty bucket is not a flat line

Markets tick irregularly. A minute with no ticks has no candle, and drawing a
flat bar there asserts a trade at a price that did not happen. `foldTicks` already
refuses to synthesise; the frontend must not undo that on the way to the screen.

### 2.4 The client is an observer, and observers must agree

A browser reconstructing the market from the stream must arrive at the same
series as the server's record. PH-7 established that for a programmatic client;
the same must hold when the consumer is a rendering pipeline with buffering,
animation frames, and a tab that gets backgrounded.

## 3. Expected product value

A chart a trader can act on, where what is drawn is what happened.

## 4. Scope

- A **rendering contract**: no interpolation, no synthesised bars,
  extreme-preserving reduction. Written down and enforced by tests.
- A headless chart-data pipeline in a testable package: ticks and candles in,
  render-ready columns out.
- Next.js and React scaffolded in `apps/web`.
- A client that consumes the PH-7 stream and reconstructs correctly, including
  across reconnection and a backgrounded tab.
- Timeframe switching that demonstrably does not change the market (INV-004).

## 5. Exclusions

- Placing trades from the UI. PH-6 built the trading boundary; exposing it
  through a browser needs accounts and entitlement, which no phase has scoped.
- Visual design beyond what the contract requires.
- Mobile-specific work.

## 6. Architectural direction

### 6.1 The reduction is a package, not a component

`@otc/chart` depends on `@otc/core` only, contains no React, and is where the
rendering contract is enforced. A property this important cannot live inside a
component where it can only be checked by looking at pixels.

### 6.2 The frontend consumes the same record as everything else

Ticks from the PH-7 stream, candles from `foldTicks`, the price at an instant
from `priceAtOrBefore`. If the chart needs a different rule, the rule is wrong.

### 6.3 Every rendering claim gets a planted defect

Standing rule, now twice-earned. And in the sharper form PH-7 produced: the plant
must actually succeed against the unfixed code, or the test is measuring
something else.

## 7. Phase invariants

- **INV-004** — changing the displayed timeframe never changes the market —
  becomes a rendered property rather than a folding property.
- **INV-002** extends to a browser client reconstructing from the stream.
- No new invariant. The frontend's job is to not break the ones that exist.

## 8. Dependencies

PH-7's feed and transport. Approved.

## 9. Initial decomposition strategy

Provisional:

- **PH-8.1** — the rendering contract and the reduction pipeline.
- **PH-8.2** — Next.js scaffolding and the streaming client.
- **PH-8.3** — the chart, timeframe switching, and phase integration.

## 10. Acceptance intent

A chart whose rendered series provably contains every extreme of the underlying
data, never a price that was not traded, and never a bar for a period with no
ticks — with a browser client that reconstructs the server's record exactly.

## 11. Risks and unknowns

| Risk                                               | Assessment                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A charting library interpolating by default        | Near-certain. The reduction must produce data that is already correct at the pixel level, so the library has nothing left to invent. |
| Downsampling that hides spikes                     | The central risk; §2.2 makes it a testable property.                                                                                 |
| A backgrounded tab silently falling behind         | Real. The browser throttles timers; the client must resume by sequence rather than assume continuity.                                |
| Rendering work drifting into the packages below it | Guarded by `dependencies.test.ts`.                                                                                                   |

---

## 12. Phase approval record

**APPROVED** from executed evidence, 2026-08-31.

### The result the phase existed to produce

A chart that shows what happened. Every value drawn is a price that was actually
observed, every extreme in the window survives at every resolution, a period with
no ticks produces no bar, and a client reconstructs the server's record exactly
across a disconnection.

| Subphase | Title                                          | State    |
| -------- | ---------------------------------------------- | -------- |
| PH-8.1   | The rendering contract                         | APPROVED |
| PH-8.2   | The streaming client and the frontend scaffold | APPROVED |
| PH-8.3   | The join, and timeframe switching              | APPROVED |

### Phase invariants

- **INV-004** becomes a product property: switching timeframe re-reduces what is
  already held and cannot change a price.
- **INV-002** extends to a browser-shaped client, verified against a running API.
- No new invariant. The frontend's job was to not break the ones that exist, and
  the interesting work was enumerating the ways it could.

### What the phase learned

**Rendering is where honesty is cheapest to lose.** Interpolation, sampling and
synthesised bars are the three natural ways to fit a price path into a few
hundred pixels, and each invents something. That the honest reduction turns out
to be OHLC is not a coincidence — the candle form exists because it is the lossy
reduction that preserves what matters about a price path.

**A guard must fail against the defect it names.** PH-8.1's "draws only values
that were actually observed" was written to catch interpolation and _passed_ with
interpolation planted: it checked set membership, and with 20,000 ticks the
observed price set is dense enough that an averaged value lands on a traded price
often enough to slip through. This was the third time in two phases that a
planted-defect test could not catch its own defect, and it sharpened the rule to
its final form.

**Real boundaries are found by crossing them.** `next build` found the keyring in
a browser bundle. Nothing else would have: the dependency was permitted, the
import was legitimate, and the failure was one of _granularity_ — which is why
`@otc/core/browser` now exists and why the allowlist compares package names
rather than import paths.

### Known limitations carried forward

- Trading from the UI is not built. PH-6 built the boundary; exposing it needs
  accounts and entitlement, which no phase has scoped.
- The chart is not exercised in a browser. The data reaching it is, which is
  where the invariants live.
- The join test costs 254 seconds, the slowest file in the suite.
