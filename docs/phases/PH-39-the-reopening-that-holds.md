# PH-39 — The Reopening That Holds

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-39
Status: APPROVED
Approved: 2026-09-25 — on the integrated verification in PH-39.1 §6 (the venue serving through seventy-nine minutes of its own phase gate: six hundred automatic reopenings, twelve degraded samples every one of which recovered by the next, no operator) and the full gate on the merged tree, `GATE_EXIT=0`
Cycle: 13 (phase 3)
Created: 2026-09-25
Branch: `feature/ph-39-the-reopening-that-holds`, cut from `main` at `48244ae`

---

## 1. Why this phase exists, and why it is this phase and not the calibration

PH-38 closed with a verificado: the tick path a broker settles against is
verified end to end, corroborated by hosted CI, and passes the conformance
suite against a running venue
([BROKER-READINESS-2026-09-25](../evidence/BROKER-READINESS-2026-09-25.md)).
That record names one thing that would stop a deployment today, and it is not a
price:

> **A market that starves before its first tick never reopens again.** Thirty
> markets stalled, reopened themselves as PH-36 says they should, stalled again
> twenty-two seconds later and were still stalled twenty-three minutes on with
> the machine idle. The venue needed an operator.

Cycle Audit 12's finding 7 — the calibration that simulates a market the engine
does not run — was next in line and is deferred one phase, deliberately. It
moves every asset's volatility and seams every live market; doing that on a
venue that cannot survive its own host is putting cargo on a ship with a hole in
it. Recorded in `DECISION-LOG.md`, 2026-09-25.

## 2. What is true today, and what exactly is wrong

ADR-0020 gave the runtime the decision a person used to take: a market past its
fifteen-second catch-up bound reopens itself at the clock, from its last
published price, on a key epoch nothing has been drawn from, with the outage
left as a recorded seam. That works. It fired sixty times on the live venue and
every reopening is in the record.

The defect is in the bound that keeps it honest. `VenueService.#reopen` refuses
a market that has not published since its last reopening:

```ts
if (this.awaitingFirstTick.has(assetId)) return false;
```

The reason is right — a process starving on every pass must stall by name
instead of writing a seam per pass, or the record fills with discontinuities
nobody observed while the venue looks healthy. What is wrong is that the set is
only ever cleared by a publication (`#pass`, and `Venue.advanceDetailed` reports
an asset only when it emitted at least one tick). **A market that is reopened
and then starves again before its first tick stays in that set for the life of
the process**, so every later reopening is refused — including the ones that
would have succeeded the moment the load passed. The guard outlives the
condition it guards against.

## 3. The premise is measured, twice, on the live venue

**2026-09-25, 04:5x UTC** — the occurrence the evidence record names: 60
reopenings, 30 assets stalled, still stalled 23 minutes later at a load average
of 0.50, restarted by hand.

**2026-09-25, 11:39 UTC** — it happened again while this phase was being
opened, under nothing more exotic than a build, a test run and a load average of
9.8 on the same host: 30 reopenings, `otc_markets_stalled 30`, every market 110
seconds behind and falling further behind on every pass, `ready: false`, and no
path back. Captured at `~/.otc-local/ph39/live-stall-2026-09-25b.txt`, and the
venue restarted by hand a second time.

Two occurrences in one day on ordinary developer load is not an exotic host
event. It is what this venue does under load.

**And it reproduces deterministically.** Three tests in
`apps/api/src/venueReopen.test.ts`, on a `SteppableClock`, fail today: after a
second starvation inside one outage the market is 10,830 s behind and stays
stalled through thirty healthy passes. The eleven tests already in that file — the
ones that hold ADR-0020's mechanism and its bounds — pass unchanged, which is the
first evidence that what is wrong is the bound's permanence and not the
mechanism.

## 4. What this phase does

**A market that starved before its first tick comes back by itself once the
starvation passes, and one outage still leaves one seam.**

Both halves are the phase. Recovering by minting a seam per starved pass would
trade a dead market for an unreadable record, and ADR-0020's second bound exists
to prevent exactly that. The mechanism is the subphase's, chosen from three
candidates judged against the ADR and the invariants rather than from the first
thing that turns the tests green.

**And the venue says what it is doing while it does it.** Three times in one day
an operator had to decide from `/health` whether a venue was recovering or dead,
and the only numbers available were consequences: a stall count and a reopening
counter that had stopped moving. So the phase also carries the quantity the
catch-up bound is actually defined on — how long since a publish pass completed —
and a count of the re-armings, in the reason string and in `/metrics`.

## 5. What this phase may not do

- **Move the catch-up bound.** Fifteen seconds, half the shortest contract
  (ADR-0010). Nothing about what a catch-up may generate changes.
- **Report a market as healthy while it is publishing nothing.** Cycle Audit 6
  found that failure from the other side — a stopped market with `/health`
  saying `ok` — and a recovery that hides itself is worse than the stall it
  hides. `otc_markets_stalled`, `/health`, `/health/ready` and the stall log
  must go on saying so on every pass that served nothing.
- **Invent the gap, or shorten it.** The outage stays an outage; the seam skips
  it; `settle()` goes on refusing any contract whose window touches it.
- **Write a discontinuity nobody observed.** A pass that served nothing is not a
  discontinuity in anything.
- **Reopen what ADR-0020 says must stay stalled**: a publish refusal, a record
  refusal, a market that has never published, or anything at all when
  `OTC_AUTO_REOPEN=0`.
- **Be believed from a `SteppableClock` alone.** The defect was found on the
  live venue twice, so the fix is verified there too: deployed, then starved on
  purpose, and watched coming back without an operator.

## 6. Subphases

| Subphase | Title                                                          | State    |
| -------- | -------------------------------------------------------------- | -------- |
| PH-39.1  | A starved reopening is re-armed, and the outage keeps one seam | APPROVED |

## 7. What it costs

- **Work done on a host that is already in trouble.** Whatever the mechanism, it
  runs on the pass that just failed, for up to thirty assets at once. The
  subphase measures it rather than assuming it is free.
- **A state machine with one more state.** "Reopened" and "reopened but has
  served nothing yet" stop being the same thing, and every surface that reads
  the market's recovery has to mean the right one.
- **One more thing an operator can be told is fine when it is not.** A venue
  that re-arms in a loop for an hour is a venue with a host problem, and the
  phase has to leave that as legible as the stall it replaces.
