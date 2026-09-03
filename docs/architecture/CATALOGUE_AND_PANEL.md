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

What replaced it is not a table. It is a **job**, with six stages, each of which
may refuse and each of which names itself when it does:

```
identity → safety → authoring → dispersion → calibration → differentiation
```

| Stage             | Refuses                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`        | an id that cannot be a filename or a key label (51 characters at most, no trailing dot); a duplicate; a reference price outside [1e-15, 1e15]; a display precision above 18           |
| `safety`          | a personality whose layers compound past the realism ceiling, or a target tail weight outside the realism band — in microseconds, before the solve                                    |
| `authoring`       | a tail weight the ladder cannot reach                                                                                                                                                 |
| `dispersion`      | a budget the personality cannot reach — including one that scales the base volatility out of bounds, checked ahead of the safety gate — or a calibration too short to fit it honestly |
| `calibration`     | a lattice that cannot be derived; a display coarser than that lattice; an instrument the core rejects                                                                                 |
| `differentiation` | an asset indistinguishable from one already registered                                                                                                                                |

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
  clamped to what that rhythm can supply — and the sample records `clampedFrom`
  when that happened, the request and the registered asset carry
  `drawnExcessKurtosis` and `retreats` beside the achieved value, and a family
  whose box cannot reach its own band is a defect in the box. The out-of-band
  audit of 2026-09-02 (a3-05) measured `alt-crypto` landing below its band in
  one draw in twenty at cascade depths 5 and 6; its depth floor is 7 now, and 0
  of 2,000 draws land below the band.

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

A recorder never stores a bucket it did not see from its start: its first bucket
is stored only when its first tick immediately follows the newest stored bar, or
is sequence 1. A restart therefore leaves a visible one-minute hole rather than
a short bar labelled whole; the backfill hands its own recorder to the live path
so the join minute is whole (out-of-band audit, a5-01 — Cycle Audit 6 had fixed
the same defect one tier up, CA6-06). The first bar of any coarser read, and the
first hour ever rolled up, is withheld unless the series covers it from its start
or it holds genesis (a5-04).

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

**And nothing without the operator's token.** Every method other than `GET`,
`HEAD` and `OPTIONS` needs `Authorization: Bearer <OTC_ADMIN_TOKEN>` and a JSON
body (`AdminWriteGuard`, out-of-band audit a6-01); unset, the service boots
with every write refused by name and reads unaffected. CORS decides only which
origins may _read_ an answer — a `POST` with no body is a simple request a
browser sends without a preflight, and until the audit the service executed a
cross-origin retire. The service listens on `127.0.0.1` unless `OTC_BIND` says
otherwise.

### Operator environment

| Variable            | Engine (`apps/api`)                                                   |
| ------------------- | --------------------------------------------------------------------- |
| `OTC_MASTER_SECRET` | required, 64 hex characters; the service refuses to boot without it   |
| `OTC_ADMIN_TOKEN`   | at least 16 characters; unset means every write is refused            |
| `OTC_BIND`          | default `127.0.0.1`; `0.0.0.0` exposes the port — set the token first |
| `PORT`              | default 3000                                                          |
| `OTC_STATE_DIR`     | checkpoints, the candle database and the registry; created if missing |
| `OTC_BACKFILL_DAYS` | whole days as digits, at most 365; default 0 (a backfill is genesis)  |
| `OTC_CORS_ORIGIN`   | origins allowed to read cross-origin; none by default                 |

The panel (`next start`) reads `OTC_API_BASE` and the same `OTC_ADMIN_TOKEN`;
without the token every panel write is the engine's 403, shown verbatim.

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

## 5.1 One origin, and it has to stream

The browser talks to exactly one host and one port. The engine is served under
the panel's own origin at `/engine`, by a route handler
(`apps/web/src/app/engine/[...path]/route.ts`) that hands the upstream body to
the response **unread** — and adds the bearer token to every write from its own
`OTC_ADMIN_TOKEN`, so the browser never holds it.

Both halves of that sentence were learned the hard way.

It was a **rewrite** in `next.config.mjs` first. Ordinary endpoints proxied
correctly and the tick stream did not: measured against a running pair,
`/engine/catalogue` and `/engine/markets/eurusd/history` returned in
milliseconds while `/engine/markets/eurusd/stream` returned nothing in fifteen
seconds. A rewrite to an external destination is not a streaming proxy, and a
live market is nothing but a stream.

And the address was **inlined at build time**. `next.config.mjs` carried
`env: { OTC_API_BASE }`, which Next substitutes when the bundle is built, so a
panel started with an explicit engine address proxied to the default anyway. On
a machine that happened to have a stale, stalled engine on port 3000, the panel
talked to that one: the catalogue and the history answered, so it looked
healthy, and only the ticks were missing. The browser suite booted its own
engine and then tested a different one for everything the stream touched. The
address is read per request now, and `env` is gone — it also published the
engine's internal host to every viewer.

## 5.2 Resuming the stream, or being told it cannot be

The tick stream is resumable by sequence: `?from=N` asks for sequence N onwards,
and a client that was delivered through M asks for `M+1` and gets an exact
continuation. Asking for something the replay window has evicted is a `400`
rather than a silent jump forward, because a client cannot detect what it never
received (CA6-31, CA6-32).

That refusal is right, and for one client it was ruinous. **The panel resumes
from where the _record_ stops, not from where it was last delivered** — it has
just loaded history, and the sequence after the newest stored candle is where
its own account ends. But the feed keeps a bounded window of ticks (50 000 by
default) and a restart empties it, so that sequence is routinely older than
anything the feed still holds, through no fault of the client. Refused, the
panel fell back to drawing no live bar at all: the price line moved and the
newest candle stood still for up to an hour on the default one-hour chart.
Reported twice by the Human Owner on 2026-09-02, and reproduced by hosted CI
(run 33689094040): a 400 on the resume in a console error, and two panel tests
failing on a status stuck at `live — reconnected after a gap`.

So the endpoint takes **`onGap=live`**, and it is opt-in: without it the refusal
is exactly what it was, and no existing client's contract moves. With it, a
sequence the feed cannot serve yields the live edge **and an explicit `gap`
event** carrying the sequence asked for and the feed's own reason. That is the
whole difference between this and the silent jump forward the refusal exists to
prevent: a gap a client is _told_ about is not a gap it mistakes for the market
(INV-002). What the client does with it is its own business — the panel draws
the forming bucket from the record instead, and re-reads it as it fills.

**A seed is not a join.** The panel folds the record's complete minute bars into
the bucket now forming, at any timeframe coarser than a minute. When the stream
resumed exactly at the tick after the last of them, the seed and the stream meet
with nothing between them and live ticks extend the bar. When it did not, they
do not meet: this client's first tick comes after a hole, and folding the tail
onto the seed would draw one bar out of two pieces. `LiveBarBuilder` therefore
requires `gaplessFromHistory` explicitly and does not infer it from having been
seeded — the bar advances by being seeded again, every completed minute, which
is the record re-read rather than a rebuild from a partial view (CA6-30).

## 6. Creating an asset is a job

`POST /assets` returns a **job id**, and the panel polls `/registrations/:id`.
The pipeline reports each stage as it enters it (`onStage`, added by the
out-of-band audit, a6-06 — until then a running job showed `identity` for its
whole life), and a refusal names the stage that refused. Jobs live in the
engine's memory; after a restart the poll answers 404 and the panel says so
(a6-10).
Four of the six stages are simulation: measured across the eight archetypes at
two replicates of `minimumDispersionSpanMs`, a registration costs **under a second
to about twenty seconds** depending on the family — the canonical figures are the
per-archetype table in
[`CYCLE-7-CATALOGUE-SCALE.md`](../evidence/CYCLE-7-CATALOGUE-SCALE.md), produced
by `tools/sim/src/catalogueScale.ts` and re-measured whenever that runner runs —
the outlier being `major-crypto`: a 625-hour fit span at its tick rate is simply a
lot of ticks. That is CPU on the same event loop the venue publishes
from, for a duration that depends on which family was picked, which is not
something to hold an HTTP request open across.

One job runs at a time. What is registered is persisted **before** it is hosted:
an asset the venue is publishing but the registry never stored would vanish at
the next restart, taking a market that had already printed prices with it.

An asset created this way joins the venue, the history recorder and the
publisher together, without a restart, and is still there after one — with a
bit-identical quantum, because the registry returns what was solved and never
re-derives it (INV-009).

## 7. Where this is written down

| Concern                       | Module                                       |
| ----------------------------- | -------------------------------------------- |
| Registration pipeline         | `packages/engine/src/registration.ts`        |
| Archetypes and sampling       | `packages/engine/src/families.ts`            |
| Dispersion budgets            | `packages/engine/src/dispersion.ts`          |
| Differentiation guard         | `packages/engine/src/differentiation.ts`     |
| Candle history and its tiers  | `packages/runtime/src/history.ts`            |
| Backdated provisioning        | `packages/runtime/src/backfill.ts`           |
| Administrative HTTP surface   | `apps/api/src/market.controller.ts`          |
| The bridge to a chart library | `packages/chart/src/bars.ts`                 |
| Runtime registration jobs     | `apps/api/src/registration.service.ts`       |
| The durable asset registry    | `packages/runtime/src/registry.ts`           |
| An operator brief             | `packages/engine/src/brief.ts`               |
| The panel's one origin        | `apps/web/src/app/engine/[...path]/route.ts` |
| The write credential          | `apps/api/src/adminAuth.guard.ts`            |
