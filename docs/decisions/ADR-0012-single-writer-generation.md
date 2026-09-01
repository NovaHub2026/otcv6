# ADR-0012 — Generation is single-writer per asset

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-09-01
Deciders: Development Agent (`GOVERNANCE.md` §5, delegated by [ADR-0008](ADR-0008-full-delegation.md))
Constrains: every multi-node deployment of the venue
Informs: PH-14.1, PH-14.2, PH-14.3, PH-15

---

## Context

PH-7 established the consistency contract: two nodes holding the same key agree
about **what tick N is**, and any disagreement about whether it has happened yet
is a **prefix** relationship — one node behind, never divergent. INV-002 holds
across nodes, and it was proved.

It was proved with both nodes generating from genesis, in one process, with no
restarts. That premise is the whole question, because a cluster restarts nodes.

The obvious multi-node design follows directly from the proof: give every node
the key, let every node generate, and let them agree by construction. No
coordination, no single point of failure, linear scale-out. It is the design the
architecture appears to invite.

It does not survive a restart.

## The impossibility

**Two nodes cannot independently generate the same asset and stay identical
across a restart.**

A market is a pure function of key, genesis and elapsed time, so two running
nodes agree tick for tick. But `resumeMarket` (PH-5.2) seams **forward to the
resuming node's own clock**. Node A restarts at `t₁` and seams there; node B
restarts at `t₂` and seams there. From that point they hold different latent
state and publish different prices for the same asset at the same instant, which
is INV-002 violated at the only place it matters.

The seam is not a defect to be removed. Removing it requires one of two things:

- **Replay the unobserved gap.** The resuming node would generate and publish
  prices for an interval during which nobody was served. ADR-0010 refuses
  exactly this: ticks whose instants are historical but whose arrival is not.
  It is also unbounded — a node down for a day would publish a day of market
  into the present.
- **Coordinate the seam.** Have the nodes agree on the instant to seam to. That
  is coordination, and once there is coordination the independence that
  motivated the design is gone. What remains is a consensus protocol
  transporting an instant, which is strictly more machinery than transporting
  the ticks themselves.

There is no third option, because the seam instant is _information about the
outage_, and no amount of shared key material contains it.

## Decision

**Exactly one node generates any given asset at any given time.** That node is
the asset's **leader**. Every other node is a **follower** for that asset and
serves the published record; it never generates, never holds a keystream cursor
for that asset, and therefore cannot fork anything, because it produces nothing.

Horizontal scale-out comes from **different assets leading on different nodes**,
not from replicating generation of one asset.

Leadership is granted by a **lease**: a fenced, expiring, compare-and-set claim
on `(assetId)` in a shared store. Fencing means each grant carries a
monotonically increasing token, and a write to the asset's record is refused if
its token is stale. Expiry means a leader that dies stops being the leader
without anything having to notice.

## Consequences

### What this costs

A shared store on the write path, and a coordination dependency the pure-function
design did not have. That is the honest price, and it is charged once per lease
renewal rather than per tick.

An asset is unavailable for generation during a failover, for at most the lease
duration. The record is still served by followers throughout, so what is lost is
_new_ ticks, not the market's history.

### What this buys, and why the cost is not optional

Keystream positions are spent, not shared. ADR-0002 derives each stream from the
asset's key; two leaders consuming the same range produce two different tick
sequences from the same private draws, and the commitment chain of PH-12 then has
two valid-looking heads over the same sequence range. That is not degraded
service — it is the published record forking, with signatures on both branches.

The lease makes that impossible rather than unlikely. Fencing is the part that
does the work: expiry alone leaves the window where an old leader believes its
lease is live and the store has already granted a new one. A stale token cannot
write, whatever the old leader believes.

### The failover gap is visible, not repaired

A new leader takes over from the last checkpoint, and the interval since is
unobserved. ADR-0010 already decided what happens to an unobserved interval: it
is refused. So the new leader seams forward, and the record shows a
discontinuity. `RecoveryOutcome` already distinguishes `resumed` from `seam`
precisely so this is reportable rather than silent.

Papering over the gap would mean generating prices nobody observed and
publishing them as though they had been live. A visible seam is a worse-looking
record and a truer one, and INV-009 is about reproducibility of what was
actually published.

### What this forecloses

Active-active generation of one asset, in any form, permanently. Any future
proposal to "just let both nodes generate, they agree anyway" is answered here:
they agree until one restarts.

It also forecloses treating the key as sufficient authority to produce ticks.
Holding the key lets a node _verify_ the record and _serve_ it; producing it
additionally requires the lease.

## Alternatives rejected

**Deterministic seam from a shared function of wall time.** Have every node seam
to the same derived instant — say, the next multiple of a minute — so restarts
land together. This restores agreement only if the nodes restart within the same
window; a node down for ten minutes still seams to a different multiple. Shrink
the window and the seam becomes frequent enough to be the dominant feature of the
record. It replaces a coordination problem with a clock-synchronisation problem
that has strictly weaker guarantees.

**Never seam: replay from genesis on every restart.** Correct, and it makes every
node identical forever. It also re-consumes keystream from block zero on every
restart, costs time linear in the market's age, and publishes an unbounded
backlog. PH-5.2 rejected it and `FileStateStore.asRecord` exists specifically to
stop a `null` record from reaching it by accident.

**Consensus on the tick stream itself.** Replicate each tick through a consensus
log so all nodes commit the same sequence. This works and is what the decision
above amounts to, with the leader election generalised — but it puts a consensus
round on the 5-second cadence of every asset, where a lease renewal costs one
round per lease period. The leader lease is the same guarantee at a far lower
duty cycle, because the thing needing agreement is _who writes_, not _what they
write_: what they write is already determined by the key.
