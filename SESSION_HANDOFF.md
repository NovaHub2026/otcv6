# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| Last clean session | 2026-09-05                                                               |
| Branch             | `main` at `45187d9` (the Cycle Audit 9 merge)                            |
| Remote             | `origin` → NovaHub2026/otcv6, public                                     |
| Active cycle       | Cycle 10, **0 of 3** — planned as the closing cycle: PH-28, PH-29, PH-30 |
| Active phase       | none                                                                     |
| Active subphase    | none                                                                     |
| Cycle Audit        | **009 closed** — 62 confirmed, 61 resolved, one carried (a8-12)          |
| Blockers           | none, and none possible — no Human gate (ADR-0008)                       |

---

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
