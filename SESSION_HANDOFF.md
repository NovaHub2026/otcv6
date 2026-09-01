# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| Last clean session | 2026-09-01                                               |
| Branch             | `feature/ph-14-multi-node` — approved, ready to merge    |
| Remote             | `origin` → NovaHub2026/otcv6 — public, hosted CI running |
| Active cycle       | Cycle 5, **2 of 3** phases approved                      |
| Active phase       | none — PH-15 next to create                              |
| Active subphase    | none                                                     |
| Cycle Audit        | 004 **APPROVED** — 12 material findings, all closed      |
| Blockers           | none, and none possible — no Human gate (ADR-0008)       |

## Continuation point

Read `CURRENT_STATE.md` for the authoritative position; this is the short form.

**Merge `feature/ph-14-multi-node` into `main`, push, then create the PH-15
Phase Context Document** on `feature/ph-15-operations`. No authorization is
required and none should be requested.

PH-15 — **Operations: the standing guarantee, running continuously** — is the
third and final phase of Cycle 5. Its subject is the gap between what an
operator _can_ do and what the venue _does_:

- Three exclusions carried from PH-12: where commitment roots are published, key
  rotation procedure, and journal retention.
- The assurance battery as a scheduled run against accumulated history rather
  than a thing invoked by hand.
- A deployment backend for PH-14's `CoordinatedStore`. The contract is already
  executable — `describeCoordinatedStore` is a battery any implementation must
  pass — but only the in-memory reference exists, so the multi-node design has
  never met a real store.

**When PH-15 is approved, Cycle 5 is complete and Cycle Audit 5 begins
automatically**, conducted by **independent agents** (ADR-0011).

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
