# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Last clean session | 2026-09-25                                                                                                  |
| Branch             | `main` — PH-39 merged from `feature/ph-39-the-reopening-that-holds`                                         |
| Remote             | `origin` → NovaHub2026/otcv6, public                                                                        |
| Active cycle       | Cycle 13, **3 of 3** — PH-37, PH-38 and PH-39 approved. **Cycle Audit 13 is what runs next**; Cycle 11 open |
| Active phase       | none                                                                                                        |
| Active subphase    | none                                                                                                        |
| Cycle Audit        | **012 closed** — 15 findings, 13 fixed with a guard each, 2 carried as phases                               |
| Blockers           | none, and none possible — no Human gate (ADR-0008)                                                          |

---

## Right now (2026-09-25)

**PH-39 is approved and merged.** It closes the one item PH-38's
broker-readiness record named as stopping a deployment: a market that starves
before its first tick never reopened again, so a venue that lost its host under
load needed an operator. `VenueService.#reopen` now splits a market that has
published since its reopening (a new outage, the whole seam, rate-limited as
ADR-0020 says) from one still awaiting its first tick (re-armed at the clock, no
second seam, no eviction, and stalled by name until it publishes). New where an
operator reads: `otc_market_rearms_total`, `otc_seconds_since_last_pass`, and the
re-arming count inside `/health`'s stall reason.

**The next legal action is Cycle Audit 13** — Cycle 13 is full. `CURRENT_STATE.md`
says what it inherits.

**Two gate facts worth carrying.** The first PH-39 gate went red on three
statistical tests and the cause was the venue this session had just repaired,
publishing thirty markets on the gate's own host: the rpc probe saw a 15.9 s block
in the browser worker, the venue's new gauge saw the host withhold the CPU for
107 s, and the same two files alone on a quiet host passed 12/12. **Every gate
measured on this machine before 2026-09-25 ran beside a venue that was wedged,
and a wedged venue costs nothing.** Stop the engine before a gate.

**The engine on 7300 runs `~/.otc-genesis` on `main` again**, restarted after the
merge. It ran the branch build from 12:07Z to 13:54Z on the same state directory,
which is where PH-39.1 §6's live evidence comes from.

**The defect happened three times on 2026-09-25**, all on ordinary developer
load — a build, a unit suite, eight subagents — at 04:5x (60 reopenings), 11:39
(30) and 12:06 (120). Thirty markets stalled each time, `ready: false`, and
twice the machine was already idle again when they were still stalled. Captured
at `~/.otc-local/ph39/live-stall-2026-09-25b.txt`. Each one needed a hand
restart, which is a recorded seam per asset.

**Cycle Audit 12 is gated, merged and closed.** The full gate ran on
`audit/ca12-fixes` at `5edcc85` with `OTC_REQUIRE_BROWSER=1` and the browser
prefix: `GATE_EXIT=0` in 69 minutes — 173 unit files / 3,540 tests, the same
under coverage with the floors enforced, and 47 statistical files / 411 tests
in 3,622.7 s. No tag: these are audit fixes, not a release, and `v2.4.0` is
what a broker runs. What is owed on the merge commit is hosted CI on both jobs.

**The gate's first run was red, and it was the host.** A 20-second-ceiling
memory test timed out while the unit suite took 183.5 s; alone that test takes
4.2–4.4 s, and the two commits since the last green unit run are documentation.
Carry the number rather than the excuse: **the unit leg is 142 s on this box
now, against the 33–38 s four consecutive gates measured**, so the machine must
be quiet for a gate and not merely free of suites — restarting the engine, the
Lab and the panel eight minutes beforehand was enough to cost ninety minutes.

**Cycle Audit 12 is recorded**:
[`docs/audits/CYCLE-AUDIT-012.md`](docs/audits/CYCLE-AUDIT-012.md). Eight
auditors in a worktree each, three independent refuters. Fifteen findings,
thirteen closed with a guard each, **two carried as phases** and not started:

1. **The durable stores keep integers with no lattice.** The checkpoint was
   fixed in PH-37; the tick record and the candle history were not, so every
   historical price a read route renders uses today's quantum. Confirmed end to
   end on a real `MarketController`. The record cannot be rewritten — a client
   holds those integers — so the fix is a lattice history per asset, converted
   on read.
2. **The calibration simulates a market the engine does not run** — no
   volatility floor, no regime-driven arrivals — and the dispersion and pace
   fits absorb **none** of the bias, because both read the same biased walk.
   Measured: the lattice search starts from a quantile ×1.62–1.71 too fine and
   the refund estimate is biased **+1.91pp**. Fixing it moves every asset's
   volatility and seams every live market.

The auditors' raw findings and the refutations are under
`~/.otc-audit12/findings/` and `~/.otc-audit12/refutations/`, with eight
worktrees beside them. They are disposable: the record is the record.

**The Human Owner's engine is up and is what they watch**: `~/.otc-genesis` on
`main`, ports 7300 (engine) and 7301 (panel), started with
`OTC_TREE=$HOME/.otc-genesis bash ~/.otc-local/start.sh`. It serves `v2.4.0`'s
catalogue — the staircase — and its prices were repaired by hand after the
lattice upgrade moved them: see the release record. **Do not restart it to test
something**; a restart costs a recorded seam per asset.

**Its candle history was converted** so nineteen days of chart draw on the
current lattice, with a consistent backup at
`~/.otc-local/state/history.db.bak-pre-relattice`. Ten candles between 04:45 and
04:54 UTC are left as published: the venue really served those prices, both
edges are recorded seams.

**Still paused** (`~/.otc-local/ph33/.hold`): PH-32's long run and PH-33's venue
scales. PH-32 is what would make the anti-predictability claim as strong at
1m–15m as it is at 30s — today the battery's own note says a clean verdict at
those horizons means "no edge above the stated resolution", not "no edge".

`~/Projects/orbit-otc-node` is the Human Owner's own broker stack (systemd user
services on 3010/3100/3030) — background load, never ours to stop. The untracked
`docs/governance-template/` in `~/Projects/otcv6` predates this session.

## Continuation point

`CURRENT_STATE.md` is authoritative for where the project stands; this file is
only what a fresh session needs first.

**Cycle 9 is complete and Cycle Audit 9 is closed and merged (`45187d9`).** PH-26, PH-25 and
PH-27 are approved and merged (`e8ed2ae`); eight independent auditors, one
worktree each under `~/.otc-audit9/` (cut by
`tools/sim/scripts/cycle-audit-worktrees.sh`), raised 64 claims and independent
refuters confirmed 62 — one critical (an aliased engine snapshot on a
production route passed the INV-010 scan; guarded by value now), 22 material,
39 minor. The fixes are merged, each with a guard watched failing; the audit
record is `docs/audits/CYCLE-AUDIT-009.md`. **Cycle 10 is planned as the
closing cycle** — PH-28 the durable venue, PH-29 the integration boundary,
PH-30 the release — on the Human Owner's direction of 2026-09-05; the plan and its
subphases are in `docs/phases/ROADMAP.md`, the decision in the decision log. Hosted CI on
this cycle's merges is recorded truthfully in `CURRENT_STATE.md` § "Hosted CI,
honestly" — the PH-25 merge was red on both gates, and **`npm run
state:check` before every approval commit** is the rule that came out of it.

The gate is run as:

```
LD_LIBRARY_PATH=$HOME/.otc-local/browser-prefix/usr/lib/x86_64-linux-gnu npm run gate
```

**PH-24 delivered what LA-03 named**, so this is history rather than the next
step. The Lab specification audit
([LAB-SPECIFICATION-AUDIT-001](docs/audits/LAB-SPECIFICATION-AUDIT-001.md))
found a correct mechanism and no controls, and every section it left open —
candle close control on a real candle, presets, simulated positions, scenarios,
release — rested on one design: how a chosen sign vector is played into a hosted
Lab engine for the remaining ticks and the keystream resumed at its cursor
afterwards. That is built: the sign source is still substitutable only at
construction (`createMarketEngine({streams: {sign}})`), and `LabSession` is fed
by `apps/api/src/lab/engineEvents.ts` and `lab.controller.ts`. ADR-0017 fixed
what "close" means before that work started: the price in force at the expiry
instant, inclusive. What comes next is Cycle 9's first phase; `CURRENT_STATE.md` holds the exact
next legal action.

## Local services

`~/.otc-local/start.sh` starts the engine (7300), the **Lab** (7302, its own
state directory `~/.otc-local/lab-state`) and the panel (7301), and prints the
tree, branch and commit it served — after 2026-09-02, when it served a stale
worktree for a whole round of "the chart is still broken". The panel points at
the Lab through `OTC_LAB_BASE`; without it the Lab screen says no Lab is
configured, which is the correct state (ADR-0015 §3).

## What the audits say about how to audit

Read [`CYCLE-AUDIT-007.md`](docs/audits/CYCLE-AUDIT-007.md) §5 before the next
one: **guards written against a constant rather than against a behaviour are
the ones that fail.** PH-23.5 added a fourth instance of a second pattern — a
guard that forbids a word fires on the comment explaining its own rule — and
every "this file must not contain X" assertion in `labScreen.test.ts` now runs
on comment-stripped source. And the Lab audit added a third: **a verdict that
reads identically at two hypotheses and at 378.** Ask what a number rests on
before printing it.
