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
| Active development cycle         | Cycle 4                                                                 |
| Approved phases in current cycle | **3 of 3**                                                              |
| Cycle Audit state                | **Cycle Audit 4 ACTIVE** — automatic (ADR-0008)                         |
| Last Cycle Audit                 | [Cycle Audit 003](docs/audits/CYCLE-AUDIT-003.md) — APPROVED 2026-08-31 |

## Phase and subphase

| Field                  | Value                                   |
| ---------------------- | --------------------------------------- |
| Active phase           | None — Cycle Audit 4 is running         |
| Phase lifecycle        | n/a                                     |
| Active subphase        | None                                    |
| Subphase lifecycle     | n/a                                     |
| Last approved phase    | PH-12 — Verifiable Publication          |
| Last approved subphase | PH-12.3 — The service emits the journal |

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

Executed 2026-08-31 at the PH-10 phase gate.

| Check                            | Status                                     |
| -------------------------------- | ------------------------------------------ |
| `npm run gate`                   | **PASSED (exit 0)** — 1108 tests, 71 files |
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

| Kind     | Reference                                                                    |
| -------- | ---------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                    |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED) |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)            |
| ADR-0005 | A multifractal cascade as the volatility process (APPROVED)                  |
| ADR-0006 | A layered sign-blind market model (APPROVED)                                 |
| ADR-0007 | At-the-money settlement: a tie is refunded (APPROVED, Human Owner)           |
| Backlog  | `docs/BACKLOG.md` B-001 … B-005                                              |
| Roadmap  | `docs/phases/ROADMAP.md`                                                     |
| Branch   | `main` — every phase branch merged and deleted                               |

---

## EXACT NEXT LEGAL ACTION

Cycle Audits [001](docs/audits/CYCLE-AUDIT-001.md),
[002](docs/audits/CYCLE-AUDIT-002.md) and
[003](docs/audits/CYCLE-AUDIT-003.md) are APPROVED and closed. Read Cycle Audit
2's §2 before any session that runs subagents — a deliberately planted INV-001
backdoor reached `main` through a concurrent `git add -A`. It never reached
`origin`, and the rule it produced is standing: **never `git add -A` while
subagents are running, and keep audit plants in an isolated clone.**

Read Cycle Audit 3's §1 too: it was conducted by the agent that wrote the code,
found one finding against Cycle Audit 2's thirty-one, and says plainly that the
difference is probably method rather than quality. **Cycle Audit 4 must use
independent agents** (B-008).

**PH-10 is APPROVED.** Assets now differ in rhythm, not only in pace and scale:
scale-free shape differentiation rose from 30.0% to **40.5%** against a 20% null,
permutation p = 0.005, with every asset's tail weight and realised amplitude
pinned to its PH-4 value so the gain is attributable to time structure alone.
B-004 is closed.

**Create the PH-11 Phase Context Document** — detection power across every
horizon the product sells — and continue. It closes B-002 and B-003.

PH-11 should start from what PH-10 established rather than from B-002's original
framing: **every statistic of this market is limited by simulated duration, not
by sample count**, because the volatility process has memory measured in days.
That single fact is behind Cycle Audit 2's binomial finding on INV-007, behind
B-002's hundred-fold history requirement at the 15-minute horizon, and behind the
lattice tie rates PH-10.2 had to re-measure over 15 replicates. Simulating longer
is one answer; an estimator that respects the dependence is probably a better one.

**There is no longer a Human item and no longer a gate.** Cycle Audit 4 runs
automatically once PH-12 is approved, and every code and product decision belongs
to the Development Agent (ADR-0008). The audit must state its own method
limitation and, where independent agents are available, use them (B-008) — with
the gate removed, the audit's adversarial discipline is the only external check
that remains.
