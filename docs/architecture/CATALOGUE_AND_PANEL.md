# The Catalogue and the Panel

Type: ARCHITECTURE (living)
Canonical for: how an asset comes to exist, what a family is, where history lives,
and what the operator surface may reach
Added: 2026-09-01, by Cycle Audit 6 (CA6-43), which found Cycle 6 had touched no
architecture document at all while `DOCS_INDEX.md` tells a reader that a missing
one means the layer does not exist

---

## 1. An asset is a registration, not a constant

`ASSET_CATALOGUE` used to be a compiled array. Creating an asset meant editing
TypeScript, which is why no panel could exist: there was nothing to administer.

What replaced it is not a table. It is a **job of order a minute**, with six
stages, each of which may refuse and each of which names itself when it does:

```
identity → safety → authoring → dispersion → calibration → differentiation
```

| Stage             | Refuses                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `identity`        | an id that cannot be a filename or a key label; a duplicate; an unusable reference price              |
| `safety`          | a personality whose layers compound past the realism ceiling — in microseconds, before the solve      |
| `authoring`       | a tail weight the ladder cannot reach                                                                 |
| `dispersion`      | a budget the personality cannot reach, or a calibration too short to fit it honestly                  |
| `calibration`     | a lattice that cannot be derived; a display coarser than that lattice; an instrument the core rejects |
| `differentiation` | an asset indistinguishable from one already registered                                                |

Two of these are simulation. Anything driving registration must treat it as a
job, not an insert.

**What is registered is what was solved, never what was asked for.** `clustering`
and `volatility` are computed — the first from a tail-weight target, the second
from a dispersion budget — and the definition records the result. Recording the
request would publish a personality nothing computed, and only the number would
be visible.

## 2. A family is a region

Eight archetypes, and every asset a fresh draw from one. Copying a personality
under a new id produces a different _chart_ — the id enters the key derivation
(ADR-0002) — and the same _market_: twenty copies of one personality are
statistically one asset with twenty names, which is INV-007 false as written.

So an archetype is a box in trait space, `clustering` and `volatility` absent
from it because they are solved. Three joint constraints a box cannot express are
handled at sample time rather than by refusing the corner:

- the **fastest cascade component** must stay slower than half a tick, so the
  spacing range is narrowed to the feasible part;
- the **safety gate runs before the solve**, so the starting `clustering` holds
  the cascade's contribution flat across every depth;
- the **tail-weight target must be reachable** by the rhythm just drawn, so it is
  clamped to what that rhythm can supply.

Each of those was a defect first. The third cost 36% of hundred-asset builds
until Cycle Audit 6 measured it.

## 3. Dispersion is a budget, and a price ceiling is a directional rule

The process is an exact martingale (ADR-0003): the expected price at any future
instant is the current one. Nothing accumulates a direction; what accumulates is
**dispersion**, growing as the square root of elapsed time.

A price ceiling was considered and refused. Near such a bound `P(down) > P(up)`,
which is INV-006 broken in the most visible way this system could manage — an
observer reads the public price, sees it near the ceiling, and sells.

Each family declares a quarterly dispersion band instead, chosen at authoring
time and blind to every price the asset will print. Hitting it costs **one**
simulation rather than a search, because the calibration is homogeneous of degree
one in `volatility`: measure once, multiply. That is checked against a real
recalibration rather than against the algebra.

The rate itself is free: the calibration already accumulates a full-precision
walk and windows it, and uncorrelated increments make variance additive in time,
so a month of simulation states a quarter's spread. It must be **sixteen
turnovers** of the asset's own volatility memory or it states nothing —
`DISPERSION_FIT_TURNOVERS`, four times larger than the first attempt, with the
measurement recorded beside it.

## 4. History is candles; ticks are for settlement

Ninety days of ticks is 2.3 to 22.8 million rows per asset. Ninety days of
candles is 131,759 — **for every asset**, because the count is fixed by the
calendar rather than by the pace. That single fact is what makes a hundred-asset
catalogue affordable.

Two stored tiers, one minute and one hour: every timeframe the product offers
nests into one of them, and each extra tier is another thing that can disagree
with the ticks. The hourly tier is derived from the **stored** minute series
rather than from anything a process remembers, so the two agree by construction
rather than by lifetime.

Nothing finer than a minute is served from history, and the refusal is the point:
returning a coarser series under a finer name would put a shape on the screen
that no tick produced. Sub-minute is served live, from the tick stream, through
PH-8's extreme-preserving reduction.

**A backfilled market is the market.** `backfillMarket` runs the live path —
`HostedMarket.advanceTo` in steps bounded by the catch-up bound — so there is
exactly one way prices are produced (INV-003). It is genesis and refuses to run
twice, on either store: a backfill that could be repeated could be repeated until
the chart looked right, and then the operator would be choosing the prices.

## 5. What the operator surface may reach

Nothing that generates.

`VenueService` publishes first and _then_ hands the ticks to the publisher and to
the history recorder. Both are views of what happened; a view that could
influence what happens next would be the whole product broken (INV-001).

Two layers keep that true, and Cycle Audit 6 found the documentation naming the
wrong one:

- the **guardrail scan** covers `packages/*` and `apps/api/src` — no ambient
  time, no ambient mutable state, no non-portable numerics, no economic
  vocabulary in the price path;
- the **dependency guard** covers every source file including `.tsx`, and the
  browser bundle may not import the engine, the laboratory, or the
  planted-defect corpus.

`apps/web` is deliberately outside the replayable set: a panel reads the wall
clock to choose a window and is not part of any record.

## 6. Where this is written down

| Concern                       | Module                                   |
| ----------------------------- | ---------------------------------------- |
| Registration pipeline         | `packages/engine/src/registration.ts`    |
| Archetypes and sampling       | `packages/engine/src/families.ts`        |
| Dispersion budgets            | `packages/engine/src/dispersion.ts`      |
| Differentiation guard         | `packages/engine/src/differentiation.ts` |
| Candle history and its tiers  | `packages/runtime/src/history.ts`        |
| Backdated provisioning        | `packages/runtime/src/backfill.ts`       |
| Administrative HTTP surface   | `apps/api/src/market.controller.ts`      |
| The bridge to a chart library | `packages/chart/src/bars.ts`             |
