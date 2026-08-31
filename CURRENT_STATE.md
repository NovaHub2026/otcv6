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
| Approved phases in current cycle | **1 of 3**                                                              |
| Cycle Audit state                | None active — next due after three more phases                          |
| Last Cycle Audit                 | [Cycle Audit 003](docs/audits/CYCLE-AUDIT-003.md) — APPROVED 2026-08-31 |

## Phase and subphase

| Field                  | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| Active phase           | PH-11 — Detection Power Across Every Horizon                |
| Phase lifecycle        | ACTIVE — context document next                              |
| Active subphase        | None                                                        |
| Subphase lifecycle     | n/a                                                         |
| Last approved phase    | PH-10 — Per-Asset Market Rhythm                             |
| Last approved subphase | PH-10.3 — Revalidation: every asset, every guarantee, again |

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

None. Development is paused at the Governance Human Gate (`GOVERNANCE.md` §28),
not blocked.

## Pending protected Human decisions

None blocking. One remains open:

1. **Fairness-proof mechanism** — whether the product publishes verifiable
   settlement proofs, and in what form. Due at PH-12. Recommendation: Merkle
   roots of the tick journal with inclusion proofs, never disclosure of generator
   keys — revealing a key hands an observer a latent-state snapshot with hours of
   forward validity. PH-9.3 built the recomputable half; what is missing is
   authenticity, and that needs a publishing key and a publication policy (B-009).

**At-the-money settlement** was decided by the Human Owner and is recorded in
[ADR-0007](docs/decisions/ADR-0007-at-the-money-settlement.md): a tie is refunded.
The realised at-the-money rate on the published lattice is 0.42%-0.53% per asset,
re-measured in PH-10.2 over 15 replicates.

Infrastructure item requiring the Human Owner: `main` was pushed to
`origin → https://github.com/NovaHub2026/otcv6` on 2026-08-31 (commit `6766b8a`,
20 commits). The CI workflow triggered correctly and **could not run**:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased.

So hosted CI still has not executed, and the reason is now an account billing
state rather than a missing push. This is the one thing a local gate cannot
substitute for — PH-4 lost a phase gate to a failing lint that two subphase
approvals had recorded as passing, precisely because no independent check ever
ran (`docs/BACKLOG.md` B-001).

Cycle Audit 001 found this stated as "no remote configured" throughout PH-1, PH-2
and PH-3. The remote existed the whole time; the claim was asserted repeatedly
without ever running `git remote -v`. See [Cycle Audit 001](docs/audits/CYCLE-AUDIT-001.md).

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

The standing Human item is unchanged: **GitHub Actions has refused eleven
consecutive runs on account billing.** Every quality claim in this repository is
attested only by the operator running it locally, which is precisely what PH-9
built an assurance layer to avoid.

No Human authorization is required to proceed (`GOVERNANCE.md` §32).
