# ADR-0011 — Subagents are an engineering decision, and audits require them

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-09-01
Deciders: **Human Owner** (removed the restriction) and the Development Agent (what follows from it)
Amends: `GOVERNANCE.md` §4
Informs: every Cycle Audit from 4 onward

---

## Context

The Development Agent operated under an environment restriction: _do not use
subagents unless the Human Owner requests them._ It sat outside Governance —
a property of the harness, not of the project — and it had a specific
consequence the project had already measured.

**Cycle Audit 2** ran with ten independent agents and adversarial verification.
It produced **31 confirmed material findings**, including a settlement rule that
lifted operator margin from 12.75% to 17.19% while passing 769 tests and 137
guardrails, and the discovery that INV-007's headline p-value of 5.1e-25 came
from a binomial that scored five _identical_ personalities at p = 4.1e-3.

**Cycle Audit 3** ran without them, conducted by the agent that had written the
code. It produced **one** finding.

Cycle 3 was not thirty times cleaner. An author shares their own blind spots by
construction — the things they did not think to check are the things they did not
think to build — and an audit is the one activity where that is the entire
problem. B-008 recorded it; §28.1 made adversarial method a requirement; and the
restriction still made the strongest available method unavailable.

The Human Owner removed it: _"usa los agentes siempre que lo creas necesario para
el producto, actualiza governanza."_

## Decision

**Spawning agents is an ordinary engineering decision**, made under §5 like any
other and recorded rather than requested.

**The Cycle Audit must use independent agents wherever they are available.** An
audit conducted by the authoring agent is a _degraded_ audit: it must say so in
its first section and treat its own clean result with corresponding suspicion.

## Consequences

### This restores the project's strongest check at the moment it needed it most

ADR-0008 removed the three-phase Human gate, leaving the audit's method as the
only external check. Two changes landing within a day of each other could have
been a net loss of assurance — the gate gone and the audit still self-conducted.
Together they are a net gain: a weaker checkpoint replaced by a stronger
examination.

### The rule that cost the project once, restated

`GOVERNANCE.md` §4.3, and it is not a formality. Cycle Audit 2's agents planted a
deliberate INV-001 backdoor to test whether the guardrails caught it. They did.
The orchestrator then ran `git add -A` in the window between the plant and its
restoration, and the backdoor reached `main`.

It never reached `origin` and `main` was reset, but it remains the most serious
process failure in the project's history (B-006). **No bulk staging while agents
are active; plants live in an isolated clone or worktree.**

The agents behaved correctly. The orchestrator committed a window it should not
have been able to commit — which is why the rule is about the orchestrator's
staging, not about the agents' discipline.

### What does not change

Agents are implementation mechanisms, not authorities (§4). The Development Agent
remains accountable for decisions, scope, evidence and Governance compliance, and
resolves disagreement between agents rather than deferring to a majority. An
audit finding is a finding when it has been **verified**, not when an agent
asserts it — Cycle Audit 2 refuted two of its own.

## Alternatives considered

**Use agents for implementation too, by default.** Not adopted as a rule. Parallel
agents help most where independence is the point — auditing, adversarial review,
searching a space too wide for one context. Implementation of a designed subphase
is usually better done in one place, because the cost of reconciling divergent
work exceeds the parallelism gained. It remains a judgement call per §4.1 rather
than a policy.
