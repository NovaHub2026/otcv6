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

Oldest first, newest at the end, so a reader who follows the log reads the
decisions in the order they were made. Each entry states what was decided, what the alternative was, and
what would make it worth revisiting. Where a decision has an ADR, the log links
to it rather than repeating it.

---

## 2026-08-31 — Lint keeps depending on the build, rather than resolving types itself

**Decided:** fix the clean-checkout lint failure by **ordering** — build before
lint — rather than by making ESLint resolve workspace types from sources through
path mapping, the way `vitest.config.ts` already does with aliases.

**Why:** path mapping would give the project two type resolvers that can
disagree — `tsc -b` through emitted declarations, ESLint through sources. Two
resolvers that can disagree is a worse failure mode than an ordering constraint,
because the disagreement is silent and the constraint is not.

**Cost:** `npm run gate` now always builds before linting, so a lint-only check
is no longer the cheapest thing you can run. That is a real ergonomic loss.

**Revisit when:** the build becomes slow enough that linting first matters, or
the two-resolver risk is eliminated some other way.

See [ADR-0009](ADR-0009-hosted-ci-reinstated.md).

---

## 2026-08-31 — The repository is public, and that was checked before it mattered

**Decided:** treat publication as safe, on evidence rather than on the assumption
that a synthetic engine has nothing to hide.

**Checked:** no committed key material, no tracked `.env`, no private keys in
history; `OTC_MASTER_SECRET` comes from the environment and the service refuses
to boot without it rather than inventing a default.

**Why it holds:** the security model never depended on the code being secret.
ADR-0002 puts secrecy in the key; ADR-0003 goes further and gives
`P(up) = P(down)` under _every public conditioning_, which includes an adversary
who has read the whole engine. Publishing gives an attacker nothing the theorem
had not already granted them.

**Revisit when:** anything key-derived, operator-specific, or customer-facing
enters the repository. The check is cheap and should be repeated then, not
assumed to still hold.

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

**Revisited 2026-09-01.** The Human Owner made the repository public, and hosted
CI was reinstated as required corroboration
([ADR-0009](ADR-0009-hosted-ci-reinstated.md)). The limitation this entry records
no longer holds; the entry stays because the reasoning about manufactured
independence does.

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

---

## 2026-09-01 — The lease term is tied to the catch-up bound, not chosen

**Decided:** `DEFAULT_LEASE_TERM_MS` equals `DEFAULT_MAX_CATCH_UP_MS` — 15
seconds — and the equality is asserted by a test rather than left as a
coincidence two constants happen to share.

**Why:** the tie is the argument. A leader that has failed to renew for a full
term has been out of contact for longer than ADR-0010 permits it to catch up, so
its next advance would be refused anyway; losing the lease takes away nothing the
bound had not already taken. And the maximum leaderless window then equals the
maximum catch-up burst, so failover cannot produce a gap larger than one the
running system already tolerates. Any other number would need its own
justification; this one inherits ADR-0010's.

**Revisit when:** the catch-up bound changes. The test fails if it does, which is
the point.

---

## 2026-09-01 — A follower's inability to generate is structural, not documented

**Decided:** `packages/runtime/src/follower.ts` and everything it transitively
imports may not reach `@otc/engine` or name any key-material identifier, enforced
by `packages/core/src/guardrails/singleWriter.test.ts`.

**Why:** PH-14 §9 names "a follower silently generating" as a hazard that would
fork the record invisibly. The plausible way it happens is not malice — it is a
future edit adding an engine "just to fill the gap during failover", which is the
most natural wrong instinct in this phase. A comment is no defence against that.

The guard earned itself immediately: it failed on its first run against real
code, on the type-only path
`follower -> replication -> lease -> state -> @otc/engine`. Type-only is exactly
why that would have been waved through, and it is one word from being real.

**Revisit when:** never, in the direction of relaxation. A follower that needs
the engine is a design error, not a guard that needs an exception.

---

## 2026-09-01 — A discontinuity is recorded, never inferred

**Decided:** the replication log holds `SeamMarker` entries, and the only way to
append past a sequence gap is to record one. `readRecord` returns entries rather
than ticks so no client can read across a discontinuity without being handed it.

**Why:** two correct rules contradicted. PH-5.2's seam moves the sequence past
the reserved block deliberately — "the gap is visible and free; a duplicate is
neither" — and PH-14.2's log refuses a gap, because one served to observers is
indistinguishable from the market. Relaxing either would have been wrong. Making
the discontinuity a thing the record _holds_ satisfies both and turns the
contradiction into the property the phase needed: a gap cannot be silent.

The follow-on consequences were not obvious in advance and are the more valuable
part: `priceAt` must return null inside a seam, because reporting the pre-seam
price answers for a window in which no node was generating; and `spansSeam` has
to exist, because ADR-0010's criterion — no unobserved interval may span a
contract — is something the settlement path has to be able to _ask_, not assume.

**Revisit when:** a deployment store implements the log. The seam is part of the
`CoordinatedStore` contract and its conformance battery.

**Revisited 2026-09-02.** `SqliteCoordinatedStore.recordSeam` implements it and
the conformance battery specifies it; the decision stands unchanged.

---

## 2026-09-02 — Retiring an asset is final

**Decided:** an operator may retire a market. There is no un-retire, in the
surface or in the store.

**Why:** a market resumed after a gap either invents the interval nobody
generated — which the catch-up bound (ADR-0010) refuses outright — or takes a
seam in a published record. The second is available and is worse than it looks:
an operator would be _choosing_ to put a discontinuity into a market that had
already printed prices, and every observer of that market would see it.

Nothing is lost by the refusal. Everything a retired market published stays
readable for ever: history, settlement, publication journal. The asset that
cannot come back is the _generator_, and an operator who wants that market again
registers one — which is a new id, a new keystream and an honest new market
rather than an old one with a hole in it.

**Alternative:** an un-retire that resumes the generator after the gap.
Rejected, because both ways of doing it are worse than a new registration: the
interval is either invented (which ADR-0010 refuses) or seamed on purpose.

**Where:** `AssetOverlay.retiredAt`, `VenueService.retire`,
`POST /assets/:id/retire` (409 on a second call), and the panel's confirmation
wording. Guarded by three plants in PH-20.3.

**Revisit when:** never in the direction of resuming a retired generator. A new
registration is the honest way back.

---

## 2026-09-02 — A cause for the gate's RPC timeout is accepted only with a reproduction

**Decided:** no change may be recorded as the cause of
`Timeout calling "onTaskUpdate"` unless it comes with a reproduction that
produces that exact error and a change that makes the same reproduction pass.

**Why:** the out-of-band audit (a1-07) found four causes recorded for this one
failure — file oversubscription (CA6-01), console and reporter traffic (CA6-02),
`execFileSync` in the meta-audit (`c736707`), long loops without a yield
(PH-21.1) — each written as settled, each followed by another red run, and none
consistent with the mechanism: a worker-to-main request whose reply is read too
late. The failure reproduces in a ten-line file in sixty-five seconds
(`spin(65_000)` after a test boundary). Anything that cannot make that file
fail and then pass has not explained it.

**Alternative:** keep recording the most plausible mechanism per occurrence.
Rejected: that is how the project spent a cycle fixing pressure on the channel
without touching the request that timed out.

**Revisit when:** the gate's instrument changes — `vitest.setup.statistical.ts`
now fails a file by name when a request stays unanswered for thirty seconds, so
the next occurrence should arrive with its own attribution.
