# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Last clean session | 2026-09-03                                                                 |
| Branch             | `feature/ph-24-the-labs-controls` — off `main` at `8f62e4b` (PH-23 merged) |
| Remote             | `origin` → NovaHub2026/otcv6, public                                       |
| Active cycle       | Cycle 8, **2 of 3** phases approved (PH-22, PH-23)                         |
| Active phase       | PH-24 — The Lab's controls: applying a selection                           |
| Active subphase    | none                                                                       |
| Cycle Audit        | **007 closed** 2026-09-03; the next is due after three approved phases     |
| Blockers           | none, and none possible — no Human gate (ADR-0008)                         |

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

**PH-24.10–24.12 are approved; no subphase is active.** The Lab has the two
controls the Human Owner asked for (the Empujar strip; the exact close of the
current candle); a push wins over what is armed and the strip is never left
held (PH-24.11); and the deployment is **one engine** (PH-24.12, ADR-0018):
`~/.otc-local/start.sh` starts a single Lab-composed process (`lab.main.js`,
engine port and state, `OTC_LAB_BASE` = the engine origin; `OTC_LAB=0` for the
production composition), the panel declares Lab mode on every screen through
`/labmode`, and the Lab screen shows the market's chart through the read-only
`/labengine` proxy. Vista, the chart and the Lab show one market. Replay/mirror
groundwork (`2ff8559`) stays parked. **The next Lab item awaits the Human
Owner; the merge, hosted CI and Cycle Audit 8 wait until the Lab is complete**
(`DECISION-LOG.md`, 2026-09-03). Browser suites run under
`LD_LIBRARY_PATH=$HOME/.otc-local/browser-prefix/usr/lib/x86_64-linux-gnu`.

**The next phase is the decision LA-03 names.** The Lab specification audit
([LAB-SPECIFICATION-AUDIT-001](docs/audits/LAB-SPECIFICATION-AUDIT-001.md))
found a correct mechanism and no controls: nothing is ever applied to a hosted
market. Every remaining section — candle close control on a real candle,
presets, simulated positions, scenarios, release — waits on one design: how a
chosen sign vector is played into a hosted Lab engine for the remaining ticks
and the keystream resumed at its cursor afterwards. The engine's sign source is
substitutable at construction (`createMarketEngine({streams: {sign}})`) and
nowhere else; `LabSession` is written and never fed. ADR-0017 fixes what
"close" means before that work starts: the price in force at the expiry
instant, inclusive.

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
