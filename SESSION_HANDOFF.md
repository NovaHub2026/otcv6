# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| Last clean session | 2026-09-01                                               |
| Branch             | `feature/ph-19-close-audit-six`                          |
| Remote             | `origin` → NovaHub2026/otcv6 — public, hosted CI running |
| Active cycle       | Cycle 7, **0 of 3** phases approved                      |
| Active phase       | PH-19 — Close what Cycle Audit 6 falsified               |
| Active subphase    | PH-19.1 — The instrument                                 |
| Cycle Audit        | **006 recorded — 46 findings, 6 critical**               |
| Blockers           | none, and none possible — no Human gate (ADR-0008)       |

## Continuation point

Read `CURRENT_STATE.md` for the authoritative position; this is the short form.

**Continue PH-19.** Six independent auditors returned 46 findings against a tree
whose gate was green. The full record is `docs/audits/CYCLE-AUDIT-006.md`.

Six are already closed, in their own commits: the runner config (CA6-01), CI's
missing typecheck (CA6-08), the backfill seam (CA6-05), the hourly tier
(CA6-06), partial bars at a window's edges (CA6-29), and the two the Human Owner
found by opening the panel (CA6-45/46).

The three that decide whether anything else is worth doing:

- **CA6-02.** Hosted CI was red on the commit PH-18 was approved from, and
  `GOVERNANCE.md` §40.1 says a green local gate is not enough when it is. That
  approval is not complete until CI is green on the same tree.
- **CA6-03.** A follower can still be given a real engine with every guardrail
  green: `stripCommentsKeepingStrings` knows a string from a comment and does not
  know a **regular-expression literal**, thirty lines above a function in the same
  file that does.
- **CA6-04.** `runStandingAssurance` reports `clean` on a record paying an
  observer +1.4% per trade — 3.8× the threshold the module itself exports. The
  battery conditions on clock _phase_ and never on any other public function of
  the index.

The audit's own standard, for whoever continues: falsify rather than confirm,
re-execute rather than read, and plant a defect against every guard. Six of the
things this audit found were things a previous phase had recorded as fixed.

## What Cycle 5 has established so far

- **PH-13 APPROVED** — operator risk: the settlement event as the unit of risk
  rather than the contract, a Lundberg adjustment coefficient for ruin, capacity
  and growth-optimal fraction, and enforcement that is provably blind to price
  generation.
- **PH-14 APPROVED** — multi-node consistency. It rests on an impossibility
  result ([ADR-0012](docs/decisions/ADR-0012-single-writer-generation.md)): two
  nodes cannot independently generate the same asset and stay identical across a
  restart, because `resumeMarket` seams forward to the resuming node's own
  clock. So generation is single-writer per asset, leadership is a fenced
  expiring lease, followers serve the record and cannot construct an engine at
  all, and a failover seam is recorded rather than hidden.

Earlier phases and audits are summarised in `docs/phases/ROADMAP.md` and the
records under `docs/audits/`. This document is not the place for them.

## Last executed verification

`npm run gate` on the Cycle Audit 5 remediation tree, 2026-09-01: **exit 0** —
103 files, 1,770 tests (unit 74/1,566, statistical 29/204).

Before that run the gate was **not reproducible**: an auditor measured a ~25%
failure rate on an idle box, because ten unit tests sat between 2.5s and 4.2s
against a 5s timeout. The timeout is now 20s and eleven consecutive unit runs
have passed. B-021's other half — the `onTaskUpdate` RPC starvation when two
long statistical suites overlap — is still open. Format, build and lint all exit 0,
in that order — build before lint, because the type-aware rules resolve workspace
types through emitted declarations.

## Process, in force

Governance changed on 2026-08-31
([ADR-0008](docs/decisions/ADR-0008-full-delegation.md)) and again on 2026-09-01
([ADR-0011](docs/decisions/ADR-0011-subagent-authority.md)):

- **There is no three-phase Human gate.** Cycle Audits run automatically. Stop
  normal development at the boundary, run the audit, continue. Never wait for
  `EJECUTA` and never report a cycle as blocked pending it.
- **Every code and product decision is yours** — purpose, business model, payout
  and settlement rules, architecture, roadmap, what does not get built. Decide,
  then record it: an ADR for something durable,
  [`DECISION-LOG.md`](docs/decisions/DECISION-LOG.md) for everything else.
- **Two things are still the Human Owner's**: amendments to Governance itself,
  and commitments that bind them outside the repository (legal, contractual,
  real-money, custody, paid services).
- **Subagents are an engineering decision**, and a Cycle Audit must use
  independent ones.
- **Hosted CI runs.** The repository is public, so Actions is free, and
  `.github/workflows/ci.yml` runs the quality gate and the statistical gate on
  every push to `main` (ADR-0009). It corroborates `npm run gate`; it does not
  replace it. A red CI on a green local gate is a finding about the gate.

## Standing rules, all learned the hard way

- **A guard is not finished until it has been watched failing.** Every material
  finding in Cycle Audit 2 was a guard that existed, was documented as
  sufficient, and had never been tested against the thing it guarded against.
  PH-14 found two more of these in its own new tests.
- **A claim is only as true as the run behind it.** Never write PASSED from a
  command whose exit code you did not see — `| tail -1` discards it.
- **A recorded number that nothing reads is a comment.**
- **Never `git add -A` while subagents are running**, and keep audit plants in an
  isolated clone.
- **A long test body must yield to the event loop** (`CLAUDE.md` §5). The gate
  otherwise exits 1 with every test reported as passing. It has happened twice.

Before changing anything in the engine, read the last section of `CLAUDE.md`.
