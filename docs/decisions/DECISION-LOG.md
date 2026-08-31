# DECISION LOG

Type: SUPPORTING DOCUMENTATION (living)
Status: Running record of autonomous decisions
Canonical for: what was decided, by whom, and why — where a full ADR is not warranted

---

## Why this exists

`GOVERNANCE.md` §5 delegates every code and product decision to the Development
Agent, and replaces escalation with **documentation**. This is the other half of
that trade.

An ADR is for a durable decision that shapes the system and will be cited later.
This log is for everything else the Human Owner would want to be able to find:
product choices, scope calls, things deliberately not built, and decisions that
were close enough that the reasoning matters.

The test for whether something belongs here is not importance. It is: **would
someone reading the repository later be surprised, and unable to find out why?**

"It was autonomous" is not a reason to leave a decision unwritten. It is the
reason to write it down.

## How to read it

Newest first. Each entry states what was decided, what the alternative was, and
what would make it worth revisiting. Where a decision has an ADR, the log links
to it rather than repeating it.

---

## 2026-08-31 — Governance itself stays with the Human Owner

**Decided:** the Development Agent will not amend `GOVERNANCE.md` on its own
authority, despite the Human Owner delegating "absolutely all decisions".

**Why:** a system that can rewrite its own constraints has no constraints. The
value of that document comes entirely from being harder to change than the code
it governs. The delegation was over _code and product_; Governance is neither —
it is the control system over both.

**Alternative:** take the delegation literally and treat Governance as editable.
Rejected because the first time it became inconvenient, it would be edited.

**Revisit when:** the Human Owner says so. §5.1 is one sentence to change, and
that is the point — the mechanism works precisely because they hold that pen.

See [ADR-0008](ADR-0008-full-delegation.md).

---

## 2026-08-31 — Hosted CI is not replaced, and the gap is not papered over

**Decided:** with hosted CI removed from the verification model (ADR-0008), no
substitute "independent" check is invented. The local gate is stated as the sole
verification authority, and its limitation is recorded rather than mitigated with
something that looks like independence but is not.

**Why:** the tempting move is to add a second local check and describe it as
corroboration. It would not be. Every local check runs in the same session, on
the same machine, at the same operator's discretion. Manufacturing the appearance
of independence is worse than recording its absence, and this project has already
found six guards that existed, were documented as sufficient, and had never been
tested against what they guarded.

**The standing option, unused:** making the repository public would restore free
GitHub Actions immediately, at no cost. It is not taken because it is a decision
about the product's positioning, which `GOVERNANCE.md` §5.1 leaves with the Human
Owner. **This is the cheapest available route back to independent verification
and it needs one word from the Human Owner.**

**Revisit when:** a paid allowance exists, or the repository becomes public.

---

## 2026-08-31 — Cycle Audit 4 will name its own method limitation

**Decided:** the automatic Cycle Audit will state, in its first section, whether
it was conducted by the agent that wrote the code — and if so, will treat its own
clean result as weak evidence.

**Why:** the measured effect is large. Cycle Audit 2 used ten independent agents
with adversarial verification and found 31 material findings; Cycle Audit 3 was
run by the authoring agent and found one. Removing the human gate takes away one
of the two external checks, which makes the audit's method the whole of what
remains.

**Revisit when:** independent agents are used (B-008), at which point the caveat
becomes a record of method rather than a warning about it.
