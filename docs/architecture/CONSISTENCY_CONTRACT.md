# The consistency contract

Type: SUPPORTING DOCUMENTATION (living)
Canonical for: what the venue promises observers about agreement
Added: PH-7, which is the first phase where observers can disagree

---

## Why this needs writing down

INV-002 says: _same asset, same canonical moment, same price for every observer._
Until PH-7 that held for an uninteresting reason — one observer, one process, one
array. Distribution makes it a real claim, and it makes one part of it subtly
false unless the wording is precise.

The distinction that matters is between a question addressed to **a moment** and
a question addressed to **now**.

## What is exact

**A market is a pure function of `(key, genesis, elapsed time)`.** Two nodes
holding the same key and the same genesis produce the same tick sequence: tick N
has the same instant and the same price on both, forever. Nothing about a node —
its uptime, its load, how many clients it serves — enters price generation.

So all of the following are **exactly** consistent across nodes, clients and
reconnections:

| Question                            | Why it is exact                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "What is tick N?"                   | Sequence is the canonical address; the engine is deterministic.                                                   |
| "What was the price at instant T?"  | `priceAtOrBefore` over the tick record — the same rule the charts draw, the battery samples, and settlement uses. |
| "How does contract C settle?"       | Defined on the record by instant, not on any node's notion of the present.                                        |
| "What did I miss since sequence M?" | Replay is by sequence, and gaps are refused rather than propagated.                                               |

**Settlement is therefore node-independent.** Two nodes, two clients, or a client
and an auditor recomputing from the published record all reach the same outcome.
This is the guarantee that actually matters commercially, and it is unconditional.

## What is approximate, and by how much

**"What is the price _now_?"** is not exact, and cannot be.

A node publishes tick N once its clock reaches tick N's instant. Two nodes whose
clocks differ by δ will therefore cross that threshold δ apart. At any wall-clock
moment, one node may have published one or more ticks the other has not yet.

The bound is: **two nodes may differ by the ticks falling within their clock skew,
and by no more.** They never disagree about a tick's _content_ — only about
whether it has happened yet. The disagreement is always a prefix relationship:
one node's published stream is a prefix of the other's, never a divergence.

For the catalogue's fastest asset (334 ms mean interval), a clock skew of 50 ms
means the nodes agree except for at most one tick, transiently.

## What this rules out

Stating the contract this way forbids a family of otherwise-tempting designs:

- **No node may publish on its own schedule.** A market advances because time
  passed, not because a node was polled — otherwise the prefix relationship
  breaks and two clients genuinely diverge.
- **No client may be given a summary of what it missed.** Dropping, coalescing or
  fast-forwarding a slow client hands it a series nobody else has. The feed
  disconnects instead.
- **No node may invent a tick to fill a gap.** Publication refuses out-of-order
  or gapped input rather than smoothing it.

## The honest reading

If a user watches the same asset on two devices served by different nodes, they
may briefly see one device a tick ahead. That is real and should be documented
for users in those terms. What they will never see is the two devices reporting
_different prices for the same moment_, and no contract they trade will settle
differently depending on which node they were connected to.

That is the guarantee worth making, and it is the one the architecture actually
supports.
