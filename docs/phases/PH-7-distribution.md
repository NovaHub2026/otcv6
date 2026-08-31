# PH-7 — Public Market Distribution and Multi-User Consistency

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-7
Status: APPROVED
Cycle: 3 (phase 1 of 3)
Created: 2026-08-31
Branch: `feature/ph-7-distribution`
Depends on: PH-1 … PH-6 (all APPROVED)
Decisions applied: [ADR-0004](../decisions/ADR-0004-canonical-price-representation.md), [ADR-0007](../decisions/ADR-0007-at-the-money-settlement.md)

---

## 1. Objective

Let many people watch the same market at once, and be able to prove they are
watching the same market.

## 2. Problem

INV-002 — same asset, same canonical moment, same price for every observer — has
been true so far for an uninteresting reason: there has only ever been one
observer, in one process, holding the whole tick array. PH-7 is the first phase
where the invariant can fail.

Four things make it hard, and only the first is obvious.

### 2.1 A slow client must not get a different market

Fan-out means buffering, and buffering means backpressure. The tempting response
to a client that cannot keep up is to drop ticks, coalesce them, or send it the
latest price instead of the next one. Every one of those gives that client a
_different market_ — and it is invisible, because the client has no way to know
what it did not receive.

The only acceptable answers are: deliver every tick in order, or disconnect and
let the client resume from where it stopped. A tick feed that silently skips is
INV-002 broken in the one place nobody looks.

### 2.2 Reconnection must be exact, not approximate

A client that drops and returns must be able to say "I had through sequence N"
and receive N+1 onwards. That requires the server to retain a replay window and
to address ticks by sequence rather than by time.

It also requires the sequence to be trustworthy across a restart — which PH-5's
seam did not provide until Cycle Audit 2 found it restarting numbering at 1 and
leasing was introduced. Distribution is where that would have surfaced as two
clients holding irreconcilable histories.

### 2.3 The boundary is a new channel, and INV-001 must be re-established

PH-6 demonstrated that the tick stream is byte-identical whether or not the
market is traded — **in a single process**. PH-7 puts trading and price
generation on opposite sides of a network boundary, which is not obviously
weaker but is certainly different: subscription patterns, request timing,
connection counts and backpressure are all new inputs that reach the server while
the market is running.

None of them may influence what is generated. The demonstration has to be built
again on this side of the boundary, and it must be adversarial in the new
dimensions — many clients, hostile subscribe/unsubscribe timing, one client
deliberately slow.

### 2.4 Two nodes, two clocks

A market is a function of key, genesis and elapsed time, so two servers holding
the same key agree about what tick N _is_. They do not automatically agree about
whether tick N has happened yet: their clocks differ, so at a given wall-clock
instant one may have published further than the other.

That is not a violation — the price _at a canonical moment_ is identical, which
is what INV-002 states — but "what is the price now?" can return different
answers to two clients on different nodes. Whether that is acceptable, and what
the published consistency contract says, is a product question this phase must
answer explicitly rather than discover.

## 3. Expected product value

A market many people can watch simultaneously, with a stated and tested
consistency guarantee, and a feed a client can drop off and rejoin without
missing anything.

## 4. Scope

- A tick feed: sequence-addressed, ordered, resumable.
- A replay window with an explicit retention bound and explicit behaviour when a
  client asks for something older.
- The consistency contract, written down and tested.
- Backpressure policy: disconnect rather than degrade.
- Re-establishing the economic blindness demonstration across the boundary.
- Multi-observer verification: concurrent clients must receive identical streams.

## 5. Exclusions

- Any frontend — PH-8.
- Accounts, authentication, balances. A subscription is anonymous here.
- Horizontal scale-out and leader election. §2.4 is _characterised_ in this phase
  and its contract published; actually running multiple nodes is beyond it.
- Persistence changes. PH-5's store stands.

## 6. Architectural direction

### 6.1 Distribution is a new package above the runtime

`@otc/distribution` may depend on `@otc/core` and `@otc/runtime`. The engine must
remain drivable from a plain Node process by the batteries, and
`dependencies.test.ts` enforces the direction — including, since Cycle Audit 2,
dynamic imports and relative paths that escape a package.

### 6.2 Ticks are addressed by sequence, never by time

Time is ambiguous under skew and irregular arrival; a sequence number is not.
Resumption, replay and deduplication all key off it. This is also why PH-5's
sequence leasing matters here: a reused number would make two clients'
reconstructions disagree with no way to detect it.

### 6.3 Every consistency claim gets a planted defect

The standing rule from Cycle Audit 2. Each guarantee in §4 — ordering, no gaps,
resumability, identical streams across observers — is accompanied by a test
verified to **fail** when the corresponding defect is planted. A guard nobody has
watched fail is not evidence.

## 7. Phase invariants

- **INV-002** moves from "true because there is one observer" to demonstrated
  across concurrent observers.
- **INV-001** re-established across the network boundary.
- INV-008 and INV-009 unaffected but re-checked: a client's reconstruction from
  the feed must match the server's record exactly.

## 8. Dependencies

PH-5's runtime and PH-6's trading boundary, both approved.

## 9. Initial decomposition strategy

Provisional:

- **PH-7.1** — the feed: sequence addressing, ordering, replay window,
  backpressure policy.
- **PH-7.2** — multi-observer consistency and the blindness demonstration across
  the boundary.
- **PH-7.3** — service integration and phase verification.

## 10. Acceptance intent

Concurrent observers of the same asset receive byte-identical tick streams; a
client that disconnects and resumes reconstructs the server's record exactly; and
the market is unchanged by how many clients watch it, how they subscribe, or how
slowly they read.

## 11. Risks and unknowns

| Risk                                                                                | Assessment                                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Backpressure silently degrading one client's view                                   | The central risk; §2.1 names it and §6.3 requires a planted-defect test.                         |
| A replay window that quietly truncates                                              | Real. Retention must be explicit and asking for something evicted must be an error, not a shrug. |
| Client behaviour reaching price generation                                          | Re-established from scratch; the single-process demonstration does not transfer.                 |
| Two-node "price now" divergence being discovered by a user rather than stated by us | Live. §2.4 requires the contract to be written down in this phase.                               |

---

## 12. Phase approval record

**APPROVED** from executed evidence, 2026-08-31.

### The result the phase existed to produce

Many people can watch the same market, and it can be shown they are watching the
same market. 25 concurrent in-process observers hold byte-identical arrays over
4,008 ticks; concurrent clients over real sockets agree on their overlap; a client
that disconnects resumes contiguously; and the tick stream is unchanged by how
many clients watch, when they subscribe, or how slowly they read.

| Subphase | Title                                                        | State    |
| -------- | ------------------------------------------------------------ | -------- |
| PH-7.1   | The tick feed: ordering, resumption, backpressure            | APPROVED |
| PH-7.2   | Multi-observer consistency and blindness across the boundary | APPROVED |
| PH-7.3   | The transport, and the consistency contract written down     | APPROVED |

### Phase invariants

- **INV-002** re-established across concurrent observers, a real transport, and
  two nodes under clock skew — not inherited from "there is only one observer".
- **INV-001** re-established across the boundary. Client behaviour is a new input
  reaching a running server, and the demonstration was rebuilt on this side of it.
- INV-008 and INV-009 re-checked: a client's reconstruction from the feed matches
  the server's record exactly, and settlement remains node-independent.

### What the phase learned

**The dangerous defect at this layer disguises itself as performance work.**
Dropping, coalescing, or fast-forwarding a slow client are the three natural
things to do about backpressure, and all three hand that client a different
market — invisibly, because a client cannot know what it never received. The only
acceptable answers are ordered delivery or disconnection. This is not a
performance trade-off that happens to touch correctness; it _is_ the correctness
boundary, and it lives in the file a performance-minded reviewer would optimise.

**A guard was written, looked reasonable, and could not catch its own defect.**
The first version of the backpressure suite planted the fast-forward leak and
**passed**: its only slow sink refused cumulatively, so it refused the skip-ahead
too and the subscription cancelled anyway. The test measured the wrong shape of
backpressure. A sink refusing large batches but accepting single ticks — what real
backpressure looks like, and precisely the client a skip-ahead feed corrupts —
fails three tests on the same plant.

That is Cycle Audit 2's standing rule earning itself within a day of being
written, and it is worth stating in its sharpest form: _writing the planted-defect
test is not enough; the plant has to actually succeed against the unfixed code, or
the test is measuring something else._

**Distribution is where PH-5's sequence leasing pays off.** It was introduced in
the runtime to stop a seam reusing numbers. This is the layer where the reuse
would have surfaced — as two clients holding irreconcilable reconstructions, with
no way to detect the disagreement.

### Known limitations carried forward

- Multiple nodes are characterised and their contract published; running more than
  one is unclaimed by any phase.
- The stream is anonymous; accounts and entitlement are unscoped.
- No frontend. PH-8.
