# PH-14 — Multi-Node Consistency and Horizontal Scale-Out

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-14
Status: ACTIVE
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
