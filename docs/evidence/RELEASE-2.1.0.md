# Release 2.1.0 — A Keystream Is Keyed By When It Starts

Type: EVIDENCE (the release record)
Recorded: 2026-09-22
Tag: `v2.1.0` — the `fix/fresh-genesis-key` merge `d8aba15`, gated green locally and corroborated by hosted CI on both jobs
Supersedes: [`RELEASE-2.0.0.md`](RELEASE-2.0.0.md) for deployment. `v2.0.0` must not be run: see §1.
Package: `tools/sim/scripts/integration-package.sh v2.1.0 <dir>`

---

## 1. Why this release exists, and why `v2.0.0` must not be run

A broker running `v2.0.0` reported, on 2026-09-22, that all thirty of its
markets drew the same figure over and over on a five-minute chart: a vertical
candle to one level, the same climb, the same spike to the same high, the same
fall, again. Their deployment does not restart by hand.

**Every genesis derived its streams at key epoch 0 and started at lattice 0.**
The keyring is a pure function of the master secret and the label
`{env, asset, purpose, keyEpoch}`, so under one secret a market started from an
empty state directory was the same market as every other market started from
one — tick for tick, interval for interval, shifted only in time. Measured on
the shipped build: two production processes started twenty seconds apart
published the same first thirty ticks of EUR/USD, BTC and NVDA. In the
runtime's own tests two geneses agreed on the direction of **100%** of 400
ticks.

That is a directional leak of the most complete kind (INV-006): anyone who
recorded one run holds the next. It needs no restart an operator notices — a
container brought back by its restart policy, a state directory on no volume,
or a second replica behind one balancer is enough — and the predictability
battery cannot see it, because within one run nothing is wrong.

Two recoveries had the same defect in a weaker form: a seam took the record's
epoch plus one, so one backup restored twice seamed twice onto one keystream
from one price; a reopening past the record took a constant epoch 1.

## 2. What changed

[ADR-0019](../decisions/ADR-0019-a-keystream-is-keyed-by-when-it-starts.md):
**every keystream a market starts is keyed by the instant it starts** —
genesis, a backfill's genesis, a seam, a reopening past the record —
`startKeyEpoch(instant, previous)`, the instant in milliseconds times a span of
1,024, never at or below the epoch the market was on.

Nothing else changed. The API contract is unchanged at `2.1.0`, the catalogue
is unchanged, and the Lab additions of PH-31 came with `main` before this fix.

## 3. What it means for a running deployment

- **A market with its state intact does not move.** A checkpoint on epoch 0
  resumes on epoch 0: no re-key on upgrade, no seam, no jump.
- **A market that starts fresh is a new market — a different one each time.**
  Measured after the fix: two production processes twenty seconds apart share
  almost no prices, and agree on the direction of 42–48% of ticks, which is
  what two independent fair walks do.
- **What this does not fix is a deployment that keeps losing its state.** Each
  lost directory is still a genesis: the price returns to the reference price
  and the record starts over. `GET /markets` says so —
  `"recovery": {"kind": "fresh"}` after a first boot means the state directory
  did not survive — and the integration guide now says what to do about it,
  with two new checklist items: one engine process per deployment, and no
  `fresh` after a restart.

## 4. What was measured

| Measure                                               | Result                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Two fresh geneses, direction agreement over 400 ticks | 1.000 before the fix in all four recovery paths; 0.418–0.480 after                        |
| Two production processes, twenty seconds apart        | first 30 ticks identical before; almost no shared prices after                            |
| Each defect planted back separately                   | caught by its own test, four for four                                                     |
| The quality gate on the shipped tree (`c30d43c`)      | `GATE_EXIT=0` — unit 167 files / 3,446 tests; statistical 47 files / 411 tests in 5,187 s |
| Hosted CI on the merge (`d8aba15`)                    | green on both jobs — Quality Gate and Statistical Gate                                    |

## 5. Upgrading

Replace the binary and restart. There is no migration: a market with its state
resumes exactly as before, and a market without one starts a market nobody has
seen. If `GET /markets` reports `fresh` for assets that have served before, the
state directory is the thing to fix — the engine cannot tell a lost directory
from a first boot, and before this release that difference was invisible.
