# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| Last clean session | 2026-09-05                                                               |
| Branch             | `feature/ph-25-production-record-battery`, off `main` at `c4757c5`       |
| Remote             | `origin` → NovaHub2026/otcv6, public                                     |
| Active cycle       | Cycle 9, **1 of 3** phases approved — PH-26                              |
| Active phase       | **PH-25 — the battery against a production venue's own record** (ACTIVE) |
| Active subphase    | PH-25.1 — the served-record observer (ACTIVE)                            |
| Cycle Audit        | **008 closed** — 60 confirmed, all 60 resolved, none tracked             |
| Blockers           | none, and none possible — no Human gate (ADR-0008)                       |

---

## Continuation point

`CURRENT_STATE.md` is authoritative for where the project stands; this file is
only what a fresh session needs first.

**PH-23.5 and PH-23.6 are approved**, gated on this tree; hosted CI
corroborated `3582d04`, Quality Gate and Statistical Gate both green
(`GOVERNANCE.md` §40.1). The
browser suite skips under a bare `npm run gate` on this machine and executes
with the library prefix — run the gate as:

```
LD_LIBRARY_PATH=$HOME/.otc-local/browser-prefix/usr/lib/x86_64-linux-gnu npm run gate
```

**PH-24 is APPROVED and merged (`d1aa02c`); Cycle Audit 8 has run and is
CLOSED.** Eight auditors, one worktree each under `~/.otc-audit8/`, every
finding put to an independent refuter: 86 claims, 60 confirmed, 26 refuted.
**All 60 are resolved** — eighteen inside the audit (`ce2a544`, `769ce80`,
`396c0f4`, `fa362e4`), the rest after it, each with a guard watched failing
against a planted defect before it was believed. Nothing is tracked and nothing
was deferred to an Issue. The record is
[Cycle Audit 008](docs/audits/CYCLE-AUDIT-008.md); the full finding set, with
every verdict, is in `~/.otc-audit8/all-findings.json`.

**Cycle 9 is open: PH-26 is APPROVED and merged (`c4757c5`), PH-25 is
ACTIVE.** PH-26 replaced the five hand-authored assets with a catalogue of
thirty drawn under seed and calibrated ([evidence](docs/evidence/PH-26-CATALOGUE-OF-THIRTY.md));
the statistical suite runs the heavy files on a stratified sample of five and
took 4,159 s at thirty against 4,326 s at five. Hosted CI on `c4757c5` was in
flight when this was written — read its verdict first (`gh run list -c c4757c5`).

**PH-25 is the battery against the feed a real observer reads.** Nothing in the
repository has ever attacked `GET /markets/:id/stream` from outside the process;
PH-25.1 builds the SSE client in `packages/lab` that turns it into the
`TickSource` the battery consumes, PH-25.2 runs the battery on it across a
restart and a resume, PH-25.3 records the verdict and the standing job. Then
PH-27, the review phase (five subphases, closing with
`docs/reports/IMPROVEMENT-REPORT-001.md`), then Cycle Audit 9. The panel the
Human Owner asked for runs at http://localhost:7301/ against an engine on 7300.

Hosted CI needed two fixes of its own, neither a product defect: the unit
project now yields an event-loop turn between tests (a worker that cannot read
the main thread's reply inside sixty seconds turns a green suite into exit 1),
and two per-test ceilings plus the job ceiling were raised to fit a suite that
PH-24.17 made three to four times more expensive. Browser suites run under
`LD_LIBRARY_PATH=$HOME/.otc-local/browser-prefix/usr/lib/x86_64-linux-gnu`.

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
