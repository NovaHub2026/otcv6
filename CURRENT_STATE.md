# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-08-31

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                                                   |
| -------------------------------- | ----------------------------------------------------------------------- |
| Active development cycle         | Cycle 5                                                                 |
| Approved phases in current cycle | **1 of 3**                                                              |
| Cycle Audit state                | None active — 004 APPROVED; next after PH-15                            |
| Last Cycle Audit                 | [Cycle Audit 003](docs/audits/CYCLE-AUDIT-003.md) — APPROVED 2026-08-31 |

## Phase and subphase

| Field                  | Value                                         |
| ---------------------- | --------------------------------------------- |
| Active phase           | PH-14 — Multi-node consistency                |
| Phase lifecycle        | n/a                                           |
| Active subphase        | None                                          |
| Subphase lifecycle     | n/a                                           |
| Last approved phase    | PH-13 — Operator Risk                         |
| Last approved subphase | PH-13.3 — Enforcement, with INV-001 preserved |

## Cycle 1 result

The cycle existed to settle one question: can a synthetic market be
simultaneously plausible and provably unexploitable, with executed evidence for
both?

**It can.** On 24 million ticks spanning 327 simulated days, one asset is:

|                              | Result                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Unexploitable                | clean verdict across ~570 hypotheses and all four attack feature kinds                   |
| At a resolution that matters | 30-second detection floor 0.217pp, finer than the 0.2513pp margin the 99% payout implies |
| Plausible                    | 15/15 realism metrics, targets fixed before the model existed                            |
| Structurally guaranteed      | mirror test passes with zero divergences                                                 |

## Blockers

**None, and none are possible from the Human side.** As of 2026-08-31 the
three-phase gate is removed and every code and product decision is the
Development Agent's ([ADR-0008](docs/decisions/ADR-0008-full-delegation.md)).
Development neither stops nor waits.

## Decision authority

Delegated in full: product purpose, business model, payout and settlement rules,
architecture, roadmap, and what is not built. Decisions are **recorded, not
escalated** — an ADR for something durable,
[`DECISION-LOG.md`](docs/decisions/DECISION-LOG.md) for everything else worth
finding later.

Two things remain the Human Owner's (`GOVERNANCE.md` §5.1): **amendments to
Governance itself**, and **commitments that bind them outside the repository**
(legal, contractual, real-money, custody, paid services).

The **fairness-proof mechanism** — whether the product publishes verifiable
settlement proofs and in what form — is therefore no longer escalated. It is due
at PH-12 and will be decided and recorded there. Direction: Merkle roots of the
tick journal with inclusion proofs, never disclosure of generator keys, since
revealing a key hands an observer a latent-state snapshot with hours of forward
validity. PH-9.3 built the recomputable half; authenticity needs a publishing key
and a publication policy (B-009).

**At-the-money settlement** was decided by the Human Owner before delegation and
is recorded in
[ADR-0007](docs/decisions/ADR-0007-at-the-money-settlement.md): a tie is refunded.
The realised at-the-money rate on the published lattice is 0.42%-0.53% per asset,
re-measured in PH-10.2 over 15 replicates.

## Hosted CI: removed, not blocked

GitHub Actions refused eleven consecutive runs — the repository is private and
the account has no paid allowance. Rather than carry that as a blocker on someone
who could not clear it, hosted CI was **removed from the verification model**
(ADR-0008). `npm run gate` is the verification authority.

The cost is recorded rather than mitigated: **every quality claim in this
repository is attested by the operator running it locally.** Nothing independent
executes anything. That is the weakness PH-9 built an assurance layer to address,
and it cost PH-4 a phase gate — a failing `npm run lint` survived two subphase
approvals because nothing outside the session ever ran it.

What makes it acceptable is structural, not procedural: the gate is deterministic
and seeded so anyone can reproduce it, evidence is executed rather than asserted
(`GOVERNANCE.md` §68), and the guardrail suite fails the build on documentation
drift, state inconsistency, dependency direction, economic blindness and test
cost. The reader's assurance comes from being able to re-run the work, not from
anyone having already done so.

**The cheapest route back to independent verification is one word from the Human
Owner:** making the repository public restores free GitHub Actions immediately.
It is a positioning decision, so it stays with them (§5.1). Recorded in
[`DECISION-LOG.md`](docs/decisions/DECISION-LOG.md).

## Verification state

Executed 2026-09-01 at the PH-12 phase gate.

| Check                            | Status                                     |
| -------------------------------- | ------------------------------------------ |
| `npm run gate`                   | **PASSED (exit 0)** — 1250 tests, 80 files |
| `npm run format:check`           | PASSED (exit 0)                            |
| `npm run lint`                   | PASSED (exit 0), and now warning-free      |
| `npm run build` (full typecheck) | PASSED (exit 0)                            |
| Unhandled errors                 | none                                       |
| Hosted CI                        | BLOCKED — GitHub Actions account billing   |

Cycle 1's numbers, and the coverage figure, are in
[`docs/evidence/CYCLE-1-VERIFICATION.md`](docs/evidence/CYCLE-1-VERIFICATION.md).
They were presented here as the project's current verification state until Cycle
Audit 2 re-executed them and found both re-checkable rows false.

## Known limitations carried forward

- Only the 30-second horizon is policed to the promotional-payout threshold.
  Independent samples at a horizon are fixed by simulated duration, so the
  15-minute horizon needs roughly a hundred times the history. Every verdict
  states the floor it achieved.
- Assets are still easier to tell apart by size than by character. Scale-free
  _shape_ differentiation is 40.5% against a 20% null (PH-10, up from 30.0%),
  against a near-perfect figure on the full signature.
- Per-asset battery floors (0.562pp) sit above the 0.2513pp product margin.
  PH-3's full-rigor run covers the canonical configuration at 0.217pp.
- The venue is single-node. Distribution, fan-out and a resumable tick feed
  arrived in PH-7; horizontal scale-out has never been designed or tested.
- The catch-up bound is a default with defined behaviour, not a decided venue
  policy. It needs an owner before a real venue runs.

## Relevant records

| Kind     | Reference                                                                     |
| -------- | ----------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                     |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                 |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED)  |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)             |
| ADR-0005 | A multifractal cascade as the volatility process (APPROVED)                   |
| ADR-0006 | A layered sign-blind market model (APPROVED)                                  |
| ADR-0007 | At-the-money settlement: a tie is refunded (APPROVED, Human Owner)            |
| ADR-0008 | Full delegation: automatic audits, autonomous decisions (APPROVED)            |
| ADR-0009 | Hosted CI reinstated after the repository was made public (APPROVED)          |
| ADR-0010 | The catch-up bound: no unobserved burst may span a contract (APPROVED)        |
| ADR-0011 | Subagents are an engineering decision; audits use independent ones (APPROVED) |
| Backlog  | `docs/BACKLOG.md` B-001 … B-011 — **all closed**                              |
| Roadmap  | `docs/phases/ROADMAP.md`                                                      |
| Branch   | `main` — every phase branch merged and deleted                                |

---

## EXACT NEXT LEGAL ACTION

**Cycle 4 is complete.** PH-10 (per-asset market rhythm), PH-11 (detection power
across every horizon) and PH-12 (verifiable publication) are all APPROVED and
merged. `docs/BACKLOG.md` closed its last open item; every entry B-001 through
B-011 is closed.

**Cycle Audit 4 is ACTIVE and is the current work.** It runs automatically —
there is no Human gate (ADR-0008) — and it is being conducted by **independent
agents** as ADR-0011 now requires, after Cycle Audit 3 measured what a
self-conducted audit is worth: one finding against Cycle Audit 2's thirty-one.

That decision has already paid for itself. The audit has produced material
findings against code approved hours earlier, including two forgeries of the
PH-12 commitment scheme and a demonstration that the PH-11 evidence record could
be edited downward without failing its own guard.

**On completion of the audit:** record it in `docs/audits/CYCLE-AUDIT-004.md`,
fix every confirmed finding, reset the cycle counter, and begin Cycle 5 by
deriving its phases. No authorization is required and none should be requested
(`GOVERNANCE.md` §28).

## Verification standing

Two layers, and neither substitutes for the other:

- `npm run gate` — the authority for an approval, because it is what an agent can
  run before recording one.
- **Hosted CI** — required corroboration since ADR-0009. The repository is
  public, so Actions is free, and both the quality gate and the statistical gate
  run on every push to `main`. A red CI on a green local gate is a finding about
  the gate, which is exactly how B-011 was found.
