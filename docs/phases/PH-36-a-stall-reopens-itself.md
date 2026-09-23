# PH-36 — A Stalled Market Reopens Itself

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-36
Status: ACTIVE
Cycle: 12 (phase 3)
Created: 2026-09-23
Branch: `feature/ph-36-a-stall-reopens-itself`, cut from `main` at `4af1106`

---

## 1. What the Human Owner asked for

On 2026-09-23, for the third time on this machine, a host suspension left the
venue frozen: every one of the thirty markets was hours behind the clock, past
the fifteen-second catch-up bound, and the runtime refused to advance any of
them. `/health` said `degraded`, the panel showed a chart that had stopped, and
the only thing that brought the market back was a person noticing and
restarting the process.

The Human Owner's instruction, when the alternative was put to them:

> "sí, hazlo con la costura automática"

## 2. What is true today, and why it is nearly right

`HostedMarket.advanceTo` refuses when the runtime has not looked at the clock
for longer than `DEFAULT_MAX_CATCH_UP_MS` — fifteen seconds, half the shortest
contract the product sells. The reason is ADR-0010 and it is not in question:
**no burst may span a complete contract.** A venue starved for an hour must not
publish an hour of market in one pass, because entry and expiry would both be
invented in a moment nobody observed, and the record is what people settle
against.

The refusal is permanent by construction: `#lastAdvancedAt` moves only _after_
the bound check, so every later advance is further behind than the last. That
is deliberate — Cycle Audit 6 found the opposite failure, a market that had
stopped publishing while `/health` said `ok`.

What is wrong is not the refusal. It is that **the runtime already knows the
correct answer and will not apply it by itself**: a restart takes the market's
last published price, opens it at the clock on a fresh key epoch past its lease,
and records the discontinuity as a seam. That is the honest resolution of an
outage, it is published at `GET /markets/:id/seams`, and `settle()` already
refuses any contract whose window touches it. The only thing a restart adds is
a human being.

## 3. What this phase does

**A market past its catch-up bound reopens itself at the clock, as a recorded
seam, and publishes again.** Same price, new keystream, sequence past the lease,
the gap left as a gap.

The decision, its bounds and its refusals are
[ADR-0020](../decisions/ADR-0020-a-stall-reopens-itself.md).

## 4. What this phase may not do

- **Invent the gap.** The seam does not generate the missing interval; it skips
  it. ADR-0010's bound is untouched, and a market inside the bound still catches
  up tick by tick as it always has.
- **Seam a market whose record refused it.** A publish refusal or a record
  refusal means the venue and its record disagree about what was served, and a
  seam there would paper over a disagreement that must be looked at. Only
  `CatchUpTooLargeError` reopens.
- **Mint seams in a loop.** A pathological process that starves on every pass
  must not write a seam on every pass. A market must publish after a seam, and
  a minimum interval must pass, before it can seam again — otherwise it stays
  stalled by name, which is today's behaviour and the right one.
- **Hide it.** Every automatic seam is logged, counted in `/metrics`, visible in
  the market's recovery state, and published where every other seam is.
- **Break a settlement.** A contract whose window touches the seam is refused,
  not settled — the existing rule, which this phase makes reachable more often
  and therefore verifies.

## 5. Subphases

| Subphase | Title                                                   |
| -------- | ------------------------------------------------------- |
| PH-36.1  | The reopening, its bounds, and what a broker sees of it |

## 6. What it costs

- **More seams in a deployment with an unstable host.** That is the point: a
  seam is what the outage already was. A broker that settles across one is
  refused, which is what `v2.1.0` shipped and what the conformance suite checks.
- **A recorded discontinuity nobody chose.** Until now every seam was the
  consequence of an operator action — a restart, a restore, an upgrade. This one
  happens on its own, so the documents that describe seams to a broker must say
  that a seam is now also a thing that a live venue does.
