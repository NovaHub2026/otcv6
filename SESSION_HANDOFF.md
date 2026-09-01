# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| Last clean session | 2026-09-01                                                |
| Branch             | `feature/ph-15-operations` — approved, ready to merge     |
| Remote             | `origin` → NovaHub2026/otcv6 — public, hosted CI running  |
| Active cycle       | Cycle 5, **3 of 3** phases approved                       |
| Active phase       | none — Cycle Audit 5 is the current work                  |
| Active subphase    | none                                                      |
| Cycle Audit        | 005 **ACTIVE** — begins automatically, independent agents |
| Blockers           | none, and none possible — no Human gate (ADR-0008)        |

## Continuation point

Read `CURRENT_STATE.md` for the authoritative position; this is the short form.

**Merge `feature/ph-15-operations` into `main`, push, then run Cycle Audit 5.**
No authorization is required and none should be requested.

Cycle 5 is complete: PH-13, PH-14 and PH-15 are all approved. The audit runs
automatically (ADR-0008) and must use **independent agents** (ADR-0011) — the
authoring agent found 1 material finding in Cycle Audit 3; ten independent
agents found 31 in Cycle Audit 2 and seven found 12 in Cycle Audit 4.

Cycle 5 is the largest surface yet audited. Places to look hardest:

- The **SQLite store** has met two real processes only in one test. Its
  conformance battery is PH-14's, unmodified — check that it really is.
- **Key rotation**: the non-decreasing epoch rule is the whole reason rotation
  is worth doing. Try to sign later history with a retired key.
- **Retention** is the first thing in this repository that permits deletion.
- The **standing verdict**'s floor is computed, not read. Try to make it lie.
- PH-14's **seam**: the only way past a sequence gap. Try to close one silently.

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

`npm run gate` at the PH-14 phase gate, 2026-09-01: **exit 0**. Unit 66 files /
1,312 tests; statistical 27 files / 202 tests. Format, build and lint all exit 0,
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
