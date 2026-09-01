# PH-14 — Multi-Node Consistency and Horizontal Scale-Out

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-14
Status: APPROVED WITH OPEN FINDINGS
Cycle: 5 (phase 2 of 3)
Created: 2026-09-01
Branch: `feature/ph-14-multi-node`
Depends on: PH-1 … PH-13 (all APPROVED)
Decisions applied: [ADR-0002](../decisions/ADR-0002-deterministic-entropy-architecture.md),
[ADR-0010](../decisions/ADR-0010-catch-up-bound.md)

---

## 1. Objective

Let more than one node serve the venue without the record forking.

## 2. What PH-7 established, and what it did not

PH-7 proved that two nodes holding the same key agree about **what tick N is**,
and that any disagreement about whether it has happened yet is a **prefix**
relationship — one node behind, never divergent. That is the consistency contract
and it holds.

It was proved with both nodes generating from genesis, in one process, with no
restarts. The gap between that and a cluster is the whole of this phase.

## 3. The impossibility that shapes the design

**Two nodes cannot independently generate the same asset and stay identical
across a restart.**

A market is a pure function of key, genesis and elapsed time, so nodes agree
while they both run. But `resumeMarket` seams **forward to the resuming node's
own clock** (PH-5.2, and required: a market that replayed a gap would publish
prices nobody observed, which ADR-0010 refuses). Two nodes restarting at
different moments therefore seam to different instants and produce different
records from that point.

The seam is not a defect to remove. Removing it means either replaying an
unobserved gap — refused — or coordinating the seam, which is coordination.

So generation must be **single-writer per asset**. That is a conclusion, not a
preference, and it deserves an ADR because every later scale-out decision follows
from it.

## 4. What follows

If exactly one node generates an asset, the others must serve the published
record rather than reproduce it. That gives a clean split:

- **Leader** — holds a lease on an asset, generates, persists, publishes and
  commits (PH-12). One per asset, and different assets may lead on different
  nodes, which is where the horizontal scaling actually comes from.
- **Follower** — serves ticks from the published record. Never generates, never
  holds a keystream cursor, and cannot fork anything because it produces nothing.

Two hazards, and they are the phase's real work:

**Two leaders.** A partition where both nodes believe they lead the same asset
consumes the same keystream range twice and forks the commitment chain. The lease
must make that impossible rather than unlikely.

**A gap at failover.** A leader dies, another takes over from the last
checkpoint, and the interval between is unobserved. ADR-0010 already decided what
happens to an unobserved interval: it is refused, and the record shows a gap. The
new leader must seam **visibly**, not paper over it.

## 5. Scope

- A lease that admits exactly one leader per asset, with expiry and fencing.
- Followers serving from the record, with INV-002 across leader and followers.
- Failover: no duplicate keystream consumption, no forked chain, and a visible
  seam.
- The ADR recording why generation is single-writer.

## 6. Exclusions

- A consensus protocol. The lease needs a store with compare-and-set; building
  Raft is not this phase and would be the wrong instinct.
- Geographic distribution, latency optimisation, load balancing policy.
- Automatic leader election under Byzantine conditions. The failure model is
  crash and partition, not malice — the operator is the one running the nodes.

## 7. Phase invariants

- **INV-002** — same asset, same moment, same price, for every observer,
  regardless of which node they reach. This is the promise scale-out most
  threatens.
- **INV-003** — one underlying stream. Two leaders would make two.
- **INV-008** — continuous state. A failover seam is a discontinuity and must be
  recorded as one rather than hidden.
- **INV-010** — a follower holds no key material and cannot derive any.

## 8. Acceptance intent

A cluster where every node answers "the price at instant T" identically, exactly
one node generates each asset, a leader can die without the record forking, and
the seam that failover creates is visible in the published record.

## 9. Risks and unknowns

| Risk                                      | Assessment                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two leaders under partition               | The failure that matters. A lease with expiry is necessary and not sufficient without fencing; the test must construct the race, not assume it away. |
| A follower silently generating            | Would fork invisibly. Structural: a follower must not be able to construct an engine at all.                                                         |
| Failover hiding a gap                     | ADR-0010's reasoning applies unchanged — an unobserved interval is refused, not invented.                                                            |
| Building a consensus protocol by accident | Real. The lease is a compare-and-set on a store, and anything more is out of scope.                                                                  |

---

## 10. Integrated phase verification

`packages/runtime/src/cluster.test.ts` — three nodes, five assets, four
crashes, four recoveries, one damaged checkpoint, and a process suspended past
its lease term.

It is not a summary of the subphases. Each of them proved its own mechanism in
isolation, and the phase's claim only exists where they meet: nodes competing
for leases, leaders dying without releasing anything, successors taking over
from whatever the record holds, and followers serving throughout.

Asserted **at every step**, not at the end, because a divergence that heals is
still a divergence somebody was served:

- **Single writer.** No two live nodes hold a session for the same asset.
- **Prefix.** Every follower's history is a prefix of the record — checked
  incrementally so the run stays linear.

Asserted over the finished record:

- No sequence appears twice, however many nodes led the asset.
- Sequences strictly increase, and **every jump is accounted for by a recorded
  seam** — the two lists are compared element for element.
- Instants never move backwards across any takeover.
- The damaged checkpoint really did force a seam, so that comparison ran on two
  non-empty lists rather than being vacuously true.
- The suspended process was refused every time it tried to publish, by **both**
  defences independently.

### Two findings from building the integrated test

**A zombie that can reach the store is not a zombie.** The first draft kept
driving the crashed node's sessions every step and measured _zero_ refusals:
`advance` renews before it generates, so a process that can still reach the
store keeps leading — correctly. The hazard is the other one, a process
suspended past its term that wakes believing it still leads. Modelled as a
pause, it is refused every time.

**The renewal check and the fence are independent, and only one was reached.**
Removing the fence from `appendTicks` entirely left this test green: the woken
session throws at the renewal step and never reaches the write. So the test now
_also_ writes directly under the stale token, going round the first defence to
land on the second. With that write present, the same plant fails it.

Both are the same lesson the project keeps relearning: a guard is not finished
until it has been watched failing, and watching it fail is what tells you which
guard you were actually testing.

## 11. Phase quality gate

`npm run gate` — format:check, build, lint, unit suite and statistical suite,
in that order, on a clean tree. **Exit 0.**

| Suite       | Files | Tests |
| ----------- | ----- | ----- |
| unit        | 66    | 1,312 |
| statistical | 27    | 202   |
| **total**   | 93    | 1,514 |

Executed on merged `main`, after the phase branch was integrated — not on the
branch and then hoped for. An earlier run on the branch exited **1**, on four
state-consistency assertions: `CURRENT_STATE.md` still described the project as
it stood before this phase. That guard exists because exactly this drift reached
`main` twice before, and it is the reason the gate is recorded from a run whose
exit code was read rather than from the run that was expected to pass.

Build precedes lint, and that ordering is load-bearing (ADR-0009, B-011).

## 12. Invariants, and where the evidence is

| Invariant | Evidence                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------ |
| INV-002   | `multiNode.test.ts`, `cluster.test.ts` — every node agrees on the price at every covered instant |
| INV-003   | `RecordForkError`; `cluster.test.ts` proves no sequence is ever held twice                       |
| INV-008   | seams are recorded, never hidden; instants never move backwards across a takeover                |
| INV-009   | the record is the settlement source, and a takeover changes it by nothing                        |
| INV-010   | `singleWriter.test.ts` — a follower reaches no engine and no key material, transitively          |

## 13. What this phase decided

[ADR-0012](../decisions/ADR-0012-single-writer-generation.md). Generation is
single-writer per asset, permanently, and the argument is an impossibility
result rather than a preference: two nodes cannot independently generate the
same asset and stay identical across a restart.

## 14. Approval

**APPROVED** 2026-09-01, from executed evidence. All three subphases approved,
integrated verification passing, phase gate exit 0.
