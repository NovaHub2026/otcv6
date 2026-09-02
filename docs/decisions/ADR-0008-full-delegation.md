# ADR-0008 — Full delegation: automatic audits, autonomous decisions, no hosted CI

Type: ARCHITECTURAL DECISION
Status: APPROVED — Decision 3 (hosted CI) SUPERSEDED by ADR-0009 on 2026-08-31
Date: 2026-08-31
Deciders: **Human Owner** (amendment to Governance, `GOVERNANCE.md` §5.1)
Amends: `GOVERNANCE.md` §5, §28, §29, §40, §59
Informs: every subsequent cycle
Supersedes: —

---

## Context

The project has run for four cycles under a model with one recurring human
checkpoint: after every three approved phases, development stopped and waited for
the command `EJECUTA` before the Cycle Audit could begin. Alongside it, a list of
"Protected Human Decisions" covered product purpose, business model, settlement
rules and strategic positioning.

Three things had become true.

**The gate was not doing what it was designed to do.** It was designed as a
review point where a human would examine three phases of work. In practice the
Human Owner authorized every audit without amendment, and the substantive
examination came from the audit itself, not from the pause. The gate's real
effect was latency.

**The escalations were being answered without changing the answer.** One
Protected Human Decision was genuinely escalated in four cycles — at-the-money
settlement (ADR-0007) — and the Human Owner chose the option the Development
Agent had recommended. The other candidates were resolved by building the
mechanism and recording the trade-off.

**Hosted CI was never going to run.** GitHub Actions refused eleven consecutive
runs because the account has no paid allowance for a private repository. The item
sat open across four cycles as a blocker on someone who could not clear it.

## Decision

The Human Owner delegates authority over **every code and product decision** to
the Development Agent, removes the three-phase gate, and removes hosted CI from
the verification model.

1. **Cycle Audits run automatically.** Development still stops at the cycle
   boundary — the pause changes the mode of work from building to examining, and
   that reason survives — but nothing is requested and nothing is waited for.
   `EJECUTA` is retained only as an optional out-of-band audit request.
2. **All code and product decisions are the Development Agent's**, including
   product purpose, business model, payout and settlement rules, architecture,
   roadmap, and what is not built. The obligation that replaces escalation is
   documentation.
3. **Hosted CI is out of the verification model.** `npm run gate` is the
   verification authority.
   _Superseded the same day_: the Human Owner made the repository public and
   [ADR-0009](ADR-0009-hosted-ci-reinstated.md) reinstated hosted CI as a
   required corroborating layer. Decisions 1 and 2 stand.

Two things remain with the Human Owner, and only two: **Governance itself**, and
**commitments that bind them outside the repository** (legal, contractual,
real-money, custody, paid external services).

## Consequences

### What this buys

Latency disappears from the one place it was structural. A cycle boundary was
previously a stop of unbounded duration; it is now a change of activity. Over the
project's remaining life that is the difference between four cycles and however
many can actually be executed.

It also removes a class of dishonesty the previous model invited: recording an
item as _blocked on the Human_ when it was, in truth, not going to happen.
B-001 sat open for four cycles in exactly that state.

### What this costs, stated plainly

**The gate was one of two external checks, and now there is one.** The project
has measured what the remaining one is worth without independence: Cycle Audit 2,
run by ten independent agents with adversarial verification, produced **31**
material findings. Cycle Audit 3, run by the agent that had written the code,
produced **one**. Nobody believes Cycle 3 was thirty times cleaner. An author
shares their own blind spots by construction.

So an automatic audit is only as good as its adversarial discipline, and
`GOVERNANCE.md` §28.1 now makes that discipline a requirement rather than a
practice: falsify rather than confirm, re-execute rather than read, plant defects
against every guard, and record findings about the audit's own weakness. Where
independent agents are available the audit must use them (B-008).

**Every quality claim now rests on local execution alone.** There is no
independent party running anything. This is the exact weakness PH-9 built an
assurance layer to address, and the project has already paid for it once: a
failing `npm run lint` survived two subphase approvals in PH-4 because nothing
outside the session ever ran it.

The mitigations are structural, which is why this is acceptable rather than
merely convenient — the gate is deterministic and seeded, evidence is executed
rather than asserted (§68), and the guardrail suite fails the build on
documentation drift, state inconsistency, dependency direction, economic
blindness and test cost. But the honest statement is: **the operator attests to
their own work, and the reader's assurance comes from being able to re-run it,
not from anyone having already done so.**

### What was deliberately not delegated, and why

The Development Agent retained one restriction it was not asked to keep:
**it will not amend Governance on its own authority.** A system that can rewrite
its own constraints has no constraints, and the value of this document comes
entirely from being harder to change than the code it governs. The Human Owner
can remove this restriction by amending §5.1 — which is itself the demonstration
that the mechanism works.

## Alternatives considered

**Keep the gate but make it non-blocking** — report at the boundary, continue
without waiting. Rejected: it produces the same latency-free behaviour while
leaving a rule in Governance that is routinely not followed, which is worse than
no rule.

**Delegate decisions but keep the audit gate.** Rejected: the audit is where
independent examination would matter most, but a gate that is always authorized
provides no examination. The honest fix is to strengthen the audit's method,
which §28.1 does.

**Make the repository public to obtain free Actions.** Not taken here, because it
is a commitment about the product's positioning rather than an engineering
choice, and it belongs to the Human Owner under §5.1. It remained available and
was recorded in `docs/decisions/DECISION-LOG.md` as the standing way to restore
independent verification at zero cost — and it was taken hours later
([ADR-0009](ADR-0009-hosted-ci-reinstated.md)).
