# The Lab, answering

Type: RECORDED EVIDENCE
Produced: 2026-09-03
Subject: PH-23.1, PH-23.2, PH-23.3
Runner: `apps/api/dist/lab/lab.main.js`, booted against a temporary state
directory, queried over HTTP

---

## Why this exists

The Lab's three claims are that an exact close can be selected rather than
steered, that the surface exposing engine internals cannot exist in production,
and that the analysis this repository has run headless for eight phases can be
served. Each is asserted by a unit test. This is the three of them, running.

## The engine's internal state

`GET /lab/markets/eurusd/state`:

```
environment: OTC LAB — SIMULATION ENVIRONMENT
sequence: 4   price: 11
cursors: [sign, rounding, cascade, shock, arrival, regime, structure]
direction: 0.5 / 0.5
why: Exactly one half, always, by construction rather than by calibration...
```

**All seven keystream cursors, served.** That is the reason the boundary is
composition rather than configuration: INV-010 forbids exposing private
generator state in a way that enables future-price reconstruction, and a cursor
is exactly that. `labSurface.test.ts` asserts no production response carries
them, and that `AppModule` neither imports nor names the Lab.

And §10 as corrected: exactly one half each way, with ADR-0003's reason attached
and no influence breakdown, because there is nothing to break down.

## Reachability, measured rather than estimated

`GET /lab/markets/eurusd/reachable/{delta}`, on a market with 25 ticks left in
the bucket:

| delta  | attempts | acceptance rate | verdict               |
| ------ | -------- | --------------- | --------------------- |
| 0      | 14       | 0.0714          | easy                  |
| 200    | **0**    | —               | outside natural range |
| 999999 | **0**    | —               | outside natural range |

The two refusals cost **no sampling at all**: the remaining ticks can move at
most 140 lattice steps, and that is knowable by addition. §36 asks for an
estimate of reachability; what comes back is a measured probability, or an
arithmetic impossibility named in words.

## The quality dashboard

`GET /lab/markets/eurusd/quality`, over a bounded 40,000-tick sample forked from
the live engine:

```
sampled ticks: 40,000
realism: 15/15 — plausible
predictability: clean, sensitivity reported for 8 horizons
```

**Fifteen of fifteen realism metrics inside their bands**, from the same
`assessRealism` the gate calls — not a reimplementation.

The predictability verdict is served **with its sensitivity and its sample
size**, and a guard asserts they cannot be separated. This matters more than the
verdict: "clean" and "clean at a minimum detectable effect of 0.22pp" are
different claims, and Cycle Audit 7 caught PH-21 collapsing exactly that
distinction for a different metric (CA7-05). At 40,000 ticks only three
hypotheses had enough decided outcomes to be tested at all, and the response
says so rather than presenting a thin verdict as a clean bill of health.

## What this run does not establish

**It is not a gate run.** The recorded evidence for predictability uses
twenty-four million ticks; this uses forty thousand so a screen has something
truthful on it. A real battery belongs to a job with a record (§67), and that is
PH-23.4.

**The ticks are forked, not published.** `labTicksAhead` snapshots the live
engine and runs a copy forward, so the market is not advanced and no keystream
position is consumed twice. The Lab reads the future; it does not spend it.
