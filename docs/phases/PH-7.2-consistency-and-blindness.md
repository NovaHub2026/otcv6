# PH-7.2 — Multi-observer consistency and blindness across the boundary

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-7.2
Parent phase: PH-7 — Public Market Distribution and Multi-User Consistency
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Show that many observers hold the same market, and that the market does not know
they are there.

## 2. Two invariants, both re-established rather than inherited

**INV-002.** Until this phase the invariant was true for an uninteresting reason:
one observer, one process, one array. Now 25 concurrent observers of the same
asset are required to hold **byte-identical** tick arrays over 4,008 ticks, a
late joiner is required to receive a correct contiguous suffix, and a resumer's
history plus its continuation must reconstruct the server's record exactly.

**INV-001.** PH-6's demonstration was single-process, and it does not transfer.
Client behaviour is a new input arriving at a running server: how many are
connected, when they subscribe, how fast they read, what they ask to replay. The
demonstration is rebuilt here — a quiet run against one under hostile churn, with
subscriptions created and destroyed throughout, several sinks deliberately too
slow to survive, and replay requested from evicted positions — and the tick
arrays must be identical.

A second form covers the venue: an asset distributed as part of the full
catalogue must be the same market it is alone.

## 3. What the guards are worth, measured

Standing rule from Cycle Audit 2: a guard nobody has watched fail is not
evidence. Both plants were run.

**Silent truncation** — returning whatever history remains instead of raising
`EvictedError`. Caught: two tests fail.

**The "helpful" fast-forward** — when a sink refuses a batch, sending it just the
latest tick so it can keep up. This is the most dangerous defect at this layer,
because the client keeps receiving and therefore never notices the hole.

**The first version of this suite could not catch it.** Its only slow sink
refused _cumulatively_, so it refused the skip-ahead too and the subscription was
cancelled anyway — the plant passed. The test was measuring the wrong shape of
backpressure.

The fix was a sink that refuses large batches but would gladly accept a single
tick, which is what real backpressure looks like and exactly the client a
skip-ahead feed would corrupt. With it, the plant fails three tests.

That sequence is worth recording as it happened: the guard existed, looked
reasonable, and was worthless until someone tried to defeat it.

## 4. Acceptance criteria

1. 25 concurrent observers receive identical streams over thousands of ticks.
2. A late joiner receives a correct contiguous suffix.
3. A resumer reconstructs the server's record exactly.
4. A collapsing observer leaves its neighbours untouched, and what it holds is a
   correct **prefix**.
5. Ticks are identical between an unwatched market and one under hostile client
   churn.
6. An asset in a venue is identical to the same asset alone.
7. Each guard verified to fail on its planted defect.

## 5. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                                  | Result                                       |
| -------------------------------------- | -------------------------------------------- |
| `npm run format:check`                 | PASSED (exit 0)                              |
| `npm run lint`                         | PASSED (exit 0)                              |
| `npm run build`                        | PASSED (exit 0)                              |
| `packages/distribution` unit tests     | PASSED — 13 tests                            |
| `distributionConsistency.stat.test.ts` | PASSED — 5 tests, 4,008 ticks x 25 observers |

### Known limitations carried forward

- The feed is still in-process. Wiring it to a transport and to `apps/api`, with
  a real client over a socket, is PH-7.3.
- The two-node "price now" contract of the phase document §2.4 is not yet
  written down. It must be, before the phase closes.
