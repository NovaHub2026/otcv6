# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Last clean session | 2026-09-02                                                                 |
| Branch             | `main` — PH-21 merged at its close                                         |
| Remote             | `origin` → NovaHub2026/otcv6, public                                       |
| Active cycle       | Cycle 7, **3 of 3** phases approved (PH-19, PH-20, PH-21)                  |
| Active phase       | none                                                                       |
| Active subphase    | none                                                                       |
| Cycle Audit        | **006 closed**; out-of-band audit 001 recorded 2026-09-02; **007 is next** |
| Blockers           | none, and none possible — no Human gate (ADR-0008)                         |

---

## Continuation point

**Run Cycle Audit 7, then PH-22.** Three approved phases is the boundary
`GOVERNANCE.md` §28 stops normal development at. It runs automatically: nothing
is requested and nothing is waited for. `CURRENT_STATE.md` is authoritative for
where the project stands; this file is only what a fresh session needs first.

Two things should shape its depth (§67):

- The **out-of-band audit of 2026-09-02** already swept most of this cycle —
  seven auditors, 83 findings, recorded in
  [`OUT-OF-BAND-AUDIT-001.md`](docs/audits/OUT-OF-BAND-AUDIT-001.md). It did not
  see anything PH-21 added after it.
- The **PH-21 closure audit** is the standard to match. Seven readers, one per
  claim area, each told to falsify; every finding put to an adversarial refuter
  before it counted. Twenty survived, and three were live defects in code
  written that day — a latch that survived a reconnect, a guard comparing a
  field nothing updated, and two clock reads with an await between them. Every
  one was found by **executing a sequence**, none by reading a guard.

Then **PH-22 — distribution under thousands of observers**, prioritised by the
Human Owner ahead of everything else. `docs/phases/ROADMAP.md` carries what is
already known: fan-out re-serialises every tick per subscriber (Issue #15), and
several charts per client hit HTTP/1.1's six-connection limit (Issue #16).

### What PH-21 leaves behind

- **Issue #17** — `CYCLE-7-CATALOGUE-SCALE.md` predates a parameter change.
- **Issue #18** — the 400-brief probe behind "one brief in 400" was never
  written up as evidence.
- **Issues #3 and #14** are the Human Owner's, and only theirs.
- The panel is not virtualised, by decision; a hundred markets have been
  scheduled but never hosted continuously.

### Running it locally

```bash
bash ~/.otc-local/start.sh
```

Panel on 7301, engine on 7300. It serves `~/Projects/otcv6` and prints the tree,
branch and commit it served. That line exists because it once served a different
worktree, and two rounds of "the chart is still broken" were about a program
that had never contained the fix (PH-21.3 §5.1).

## Last executed verification

**`npm run gate` on `feature/ph-21-catalogue-at-scale` at `e451647`** —
`GATE_EXIT=0`, with `OTC_REQUIRE_BROWSER=1` and zero skips: 90 unit files /
2,203 tests, 40 statistical files / 273 tests, worst RPC round trip 11.6 s
against the 30 s guard.

**Hosted CI on the same tree:**
[run 33701581822](https://github.com/NovaHub2026/otcv6/actions/runs/33701581822)
— success, Quality Gate and Statistical Gate, 48 minutes, 273 statistical tests
with the eight browser tests run on the runner.

Both layers, one tree. `GOVERNANCE.md` §40.1 wants the second, and PH-21 is the
first phase in this cycle to close with it green on its own tree rather than on
an ancestor's.

## Process, in force

Governance changed on 2026-08-31 (ADR-0008) and 2026-09-01 (ADR-0011): no
three-phase Human gate, Cycle Audits automatic, every code and product decision
the Development Agent's and recorded (ADR or `DECISION-LOG.md`), subagents an
engineering decision and a Cycle Audit must use independent ones, hosted CI a
required corroborating layer (ADR-0009). Two things stay the Human Owner's:
amendments to Governance, and commitments that bind them outside the repository.

## Standing rules, all learned the hard way

- **A guard is not finished until it has been watched failing.** Every material
  finding of this audit was a guard that existed and had never been planted
  against — the mirror test, the lexer, the watchdog, the retention boundary.
- **A claim is only as true as the run behind it.** PH-19's "hosted CI green on
  the same tree" was written about a different tree. Record the run id.
- **A cause for the gate's RPC timeout is accepted only with a reproduction**
  (`DECISION-LOG.md`, 2026-09-02). Four were recorded without one.
- **Check for a peer session before committing or running anything heavy**
  (`ListAgents`); uncommitted changes may be another live session's work.
- **Never `git add -A` while subagents are running**; plants live in worktrees.
- **A statistical test must never run thirty seconds of synchronous work with a
  request in flight** — and one is in flight at the start of every test
  (`CLAUDE.md` §5).

Before changing anything in the engine, read the last section of `CLAUDE.md`.
