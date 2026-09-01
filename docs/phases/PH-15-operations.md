# PH-15 — Operations: The Standing Guarantee, Running Continuously

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-15
Status: APPROVED
Cycle: 5 (phase 3 of 3)
Created: 2026-09-01
Branch: `feature/ph-15-operations`
Depends on: PH-1 … PH-14 (all APPROVED)
Decisions applied: [ADR-0009](../decisions/ADR-0009-hosted-ci-reinstated.md),
[ADR-0012](../decisions/ADR-0012-single-writer-generation.md)

---

## 1. Objective

Turn three capabilities into three things the venue does.

## 2. The gap this phase closes

The product's central claim is that the market is plausible and provably
unexploitable. Fourteen phases have built the machinery to establish that, and
every piece of it is something an **operator can run**:

- PH-9 made the verdict re-derivable from the published record with no key.
- PH-11 gave it detection power at every horizon the product sells.
- PH-12 made the record provable — Merkle commitments over a signed chain.
- PH-14 made the venue survive a node dying.

None of them runs. A guarantee that requires someone to remember to run
something is a claim about the past, and the gap between "we verified this in
August" and "this is verified" is the whole of what a counterparty is buying.

## 3. What "standing" costs, and why it is not just a scheduler

A battery run against accumulated _real_ history is a different statistical
object from a battery run against a simulation, and treating them the same would
produce a verdict that is confidently wrong.

**Simulated runs choose their duration.** Real history arrives at one tick per
tick. PH-11's central finding is that every statistic here is limited by
**simulated duration, not sample count**, because the volatility process has
memory measured in days — consecutive observations are never independent draws,
and the design effect is real and large.

So the standing verdict's **detection floor moves** as history accumulates. A
standing report that quotes a fixed floor is lying in one direction on its first
day and the other direction on its hundredth. The floor is an output, recomputed
every run, and stated with the verdict.

## 4. The trap: a standing battery must not become a tuning loop

PH-9.1 withheld attack families from every tuning decision, deliberately, because
a battery that shapes the engine it tests stops being evidence about the engine.

A battery that runs continuously against live history, whose failures prompt
engine changes, is exactly that loop — arrived at by a route that looks like
diligence. So the standing run is **monitoring**: its results are recorded, a
failure is an incident, and no engine parameter changes because of it. Any change
it prompts must be validated against families withheld from it.

This is a constraint on operations, not on code, which makes it the kind of rule
that erodes silently. It is written into the phase because a comment in a
scheduler would not survive.

## 5. Key rotation is a chain problem, not a key problem

The commitment chain links each root to the one before, and each is signed. A
rotated publishing key means signatures before and after verify under different
keys — and a verifier that simply holds "the" public key sees the rotation as a
**forgery**.

That is the substance: rotation must be recorded **inside the chain**, as an
entry signed by the outgoing key naming the incoming one. Otherwise rotation and
compromise are indistinguishable to exactly the party the chain exists to
convince. A rotation that cannot be told apart from an attack is worse than no
rotation, because it trains a verifier to accept an unexplained key change.

## 6. Where roots are published

The constraint is not storage; it is that a counterparty who does not trust the
operator must be able to fetch them. A root served only by the venue's own API
proves nothing the venue could not also rewrite.

The repository is already public and independently hosted, which makes it an
available external anchor at no cost. Whether that is sufficient, and what the
cadence is, is PH-15.2's to decide and record.

## 7. Retention has a lower bound and it is a product decision

The journal must be retained at least as long as a settlement can be disputed.
That window has never been set, and it is the actual decision — the storage
follows from it.

It also interacts with what PH-14.2 built: a follower answers `evicted` for a
sequence it no longer holds. Retention decides how often an honest client gets
that answer, and a verifier asking about an old settlement must not.

## 8. A store that can run a cluster

PH-14 proved its design against an in-memory reference and made the contract
executable — `describeCoordinatedStore` is a battery any implementation must
pass. No implementation exists that two processes can share, so the multi-node
design has never met a real store.

Node 24 ships `node:sqlite`, which gives real transactions with no dependency to
add. A transactional store makes the fence exact rather than argued for.

## 9. Subphases

| Subphase | Title                                                      | State       |
| -------- | ---------------------------------------------------------- | ----------- |
| PH-15.1  | A durable coordinated store, and the contract it must pass | not started |
| PH-15.2  | Publication, rotation and retention                        | not started |
| PH-15.3  | The standing guarantee: assurance on a schedule            | not started |

The order is a dependency chain. A scheduled assurance run needs accumulated
history, which needs a durable store; its verdict needs publishing, which needs
the publication policy.

## 10. Scope

- A `CoordinatedStore` backed by `node:sqlite`, passing PH-14's conformance
  battery unchanged.
- Where commitment roots are published, at what cadence, and how a counterparty
  fetches them.
- Key rotation recorded in the chain, verifiable across the rotation.
- Journal retention, with the dispute window it derives from stated.
- The assurance battery as a scheduled run against accumulated history, with a
  recomputed detection floor and a verdict that is recorded rather than acted on.

## 11. Exclusions

- A deployment. Choosing a host, a domain or an operator is a commitment outside
  the repository (`GOVERNANCE.md` §5.1).
- A networked store — Postgres, a cloud object store. The contract makes one a
  drop-in; building one without a deployment to inform it would be guessing.
- Alerting, dashboards, on-call. The standing run records a verdict; who reads it
  is an operational matter with no code in this repository.
- Real money, custody, or anything binding the Human Owner externally.

## 12. Phase invariants

- **INV-009** — reproducible settlement. Retention and rotation both threaten it:
  a discarded journal or an unverifiable signature makes a past settlement
  unexplainable.
- **INV-010** — private generator state. Rotation moves _publishing_ keys and
  must never touch generation keys, and a published root must never narrow the
  latent state.
- **INV-002** — the durable store is what keeps it true across nodes, so it must
  pass PH-14's battery unchanged rather than a relaxed version of it.

## 13. Acceptance intent

A venue that, left running, produces a signed and externally anchored record, a
current assurance verdict with an honest floor, and survives a key rotation
without a verifier seeing a forgery.

## 14. Risks and unknowns

| Risk                                             | Assessment                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| The standing battery becomes a tuning loop       | The one that would quietly destroy the product's central claim. It is a discipline, so it needs a structural guard, not a rule. |
| A standing verdict quoting a stale floor         | Likely, and it looks correct. The floor must be an output of every run.                                                         |
| Rotation indistinguishable from compromise       | Fatal to the chain's purpose. The rotation belongs inside the chain, signed by the outgoing key.                                |
| `node:sqlite` weakening the conformance contract | Real: the temptation is to relax the battery to fit the backend. The battery is unchanged, or the backend is wrong.             |
| Retention set by storage rather than by dispute  | The window is a product decision; sizing storage first would decide it by accident.                                             |

---

## 15. Integrated phase verification

`tools/sim/src/operations.stat.test.ts` — a venue that is operated rather than
built. It runs two catalogue assets on the SQLite store for an hour of market
time, closes the process, reopens the database, commits the record in windows
across a **key rotation**, verifies the chain from the genesis key alone, builds
and extends an anchor, applies the retention policy, and produces a standing
verdict.

The claim it exists to check is that the three subphases are one system. Each
proved its own mechanism; a venue left running uses them together.

What it asserts that no subphase battery could:

- The record survives the process that wrote it, and is read back by a **second
  connection** after the first is closed.
- A chain whose windows are signed by two different keys verifies from the
  genesis key **and the rotation log**, and is refused without the log.
- An anchor over that chain extends itself, and refuses a truncated successor.
- Every journal is retained today and pruneable after 200 days, while **no age
  makes a commitment discardable**.
- The standing verdict on an hour of history is **`undecided`**, not `clean` —
  the honest answer, and the one the system would get wrong if it borrowed
  confidence from PH-3's 327-day run.
- Within that verdict, the 30-second horizon has more trials and a finer floor
  than the 15-minute one, which is PH-11's finding reproduced by a live record
  rather than asserted.

## 16. A guardrail this phase had to add

`publicSurface.test.ts`. PH-14.3's entire leader loop — `LeaderSession` — was
missing from `@otc/runtime`'s index, and it was found only because this
integrated test happened to import it.

Nothing else would have. Tests inside a package import their neighbours by
relative path, so a module can be complete, tested, approved and unreachable
from outside all at once.

The cause is the repository's most repeated one: an edit whose anchor no longer
matched because Prettier had reformatted the surrounding lines, reporting
success and doing nothing. It defeated six edits to `CURRENT_STATE.md` between
PH-4 and PH-6, and it did it again here. The surface is now checked, and a module
that is genuinely internal has to be named as such — three were, each with a
reason.

## 17. Phase quality gate

`npm run gate` — format:check, build, lint, unit suite and statistical suite, in
that order, on a clean tree. **Exit 0.**

| Suite       | Files | Tests |
| ----------- | ----- | ----- |
| unit        | 73    | 1,495 |
| statistical | 29    | 204   |
| **total**   | 102   | 1,699 |

## 18. Invariants, and where the evidence is

| Invariant | Evidence                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------- |
| INV-002   | the SQLite store passes PH-14's conformance battery unmodified, and admits one leader across processes  |
| INV-006   | the standing verdict reports `exploitable` at any power, and `undecided` rather than `clean`            |
| INV-009   | retention keeps the journal for the dispute window and the chain forever                                |
| INV-010   | rotation moves publishing keys only; `publishingKeyFromEnvironment` still refuses the generation secret |

## 19. What this phase decided

- The **dispute window is 90 days**, and retention derives from it rather than
  from storage. Journals may be pruned; commitments never.
- **Key rotation is recorded inside the chain**, signed by the outgoing key, and
  epochs are non-decreasing so a retired key cannot sign later history.
- The **standing verdict has three outcomes**, and `undecided` is the one that
  makes the other two honest.
- The standing run **refuses to produce a verdict without the withheld
  families**, making PH-9.1's independence structural rather than procedural.
- `engines` is **Node >= 24**, because `node:sqlite` needs an experimental flag
  before then and a store whose correctness depends on a flag being passed is
  not one.

## 20. Approval

**APPROVED** 2026-09-01, from executed evidence. All three subphases approved,
integrated verification passing, phase gate exit 0.

**Cycle 5 is complete.** PH-13, PH-14 and PH-15 are approved and merged, so
Cycle Audit 5 begins automatically — conducted by independent agents, as
[ADR-0011](../decisions/ADR-0011-subagent-authority.md) requires.
