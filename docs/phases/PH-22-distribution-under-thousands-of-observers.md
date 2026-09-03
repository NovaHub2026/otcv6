# PH-22 — Distribution Under Thousands Of Observers

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-22
Status: ACTIVE
Cycle: 8 (phase 1 of 3)
Created: 2026-09-03
Branch: `feature/ph-22-distribution`

---

## 1. What is actually unknown

**Nobody has ever opened two simultaneous clients against this engine.**

Every number this phase will act on is either an extrapolation from a
single-client measurement or an arithmetic argument. The Human Owner named the
target on 2026-09-02 and it is concrete: **several charts per client, thousands
of clients at once**. Against that, the honest list of what nobody knows is
short and expensive to get wrong:

1. **What actually breaks first?** Heap, file descriptors, event-loop lag,
   socket buffers, or serialisation CPU. Four of those have plausible arguments
   behind them and no measurement.
2. **What does one tick cost at N subscribers?** Issue #15 says every subscriber
   re-serialises the same tick — `feed.ts` walks the subscriptions and the
   controller builds the SSE frame inside the callback. At ten thousand clients
   watching eight assets against PH-21.2's measured 153 ticks/s venue-wide, that
   is on the order of 120,000 `JSON.stringify` calls per second of an identical
   string. Nobody has measured what it costs at 10, let alone at 800.
3. **What does a connection cost?** Cycle Audit 7 measured the _feed_ at 5.01 MB
   per asset (CA7-33), which is retention and not connections. Per-connection
   memory in this Node version is quoted from general knowledge, not measured
   here.
4. **What does a reconnect storm cost?** CA7-04 found replay ignoring
   backpressure entirely — 50,000 frames and 3.46 MiB accumulated for one client
   full from its first byte — and bounded it at **1 MB, a number chosen rather
   than measured**. Ten thousand clients reconnecting after a deploy is the case
   that number exists for, and it has never been run.
5. **Can several charts share one connection without losing the resume
   contract?** Issue #16 is the six-connections-per-origin limit. Multiplexing
   fixes it, and SSE's `Last-Event-ID` carries exactly one sequence — so a
   stream carrying several assets has to answer what resumption means, and that
   answer must not be weaker than the one it replaces.

## 2. Why this phase, and why now

The Human Owner prioritised it ahead of everything else, and the reason it is
the right next phase is structural rather than deferential: **PH-21 proved the
catalogue can exist, and nothing has proved anyone can watch it.** A hundred
assets that no one can observe is not a product, and the OTC Market Lab that
follows this phase is a heavy observer — many charts, dense ticks — built on
whatever this phase leaves behind. Building the Lab first would build it twice.

Cycle Audit 7 hands this phase two measurements it did not ask for, and they are
the best starting point in the repository: CA7-04's replay bound and CA7-33's
5.01 MB per asset. Both are early sightings of this phase's subject, found while
looking at something else.

## 3. What this phase may not do

**It may not trade away exact resumption.** SSE gives resumption by sequence and
an **explicit refusal** when the sequence has been evicted. A gap served in
silence is indistinguishable from the market (INV-002), which is the whole of
why `?from=` exists and why `onGap=live` sends an event rather than jumping
quietly. Any transport or multiplexing that replaces this has to bring that
property with it, tested, before it ships.

**It may not choose a transport before it has measured a bottleneck.** The
question the Human Owner asked was whether thousands of clients argue for
WebSocket. Measuring the running engine said the transport is not the lever — a
WebSocket frame saves 16 bytes on a 76-byte event, 24 bytes per second per
viewer — and the largest known cost is transport-independent. That is an
argument, not a measurement, and this phase exists to replace it.

**It may not let the delivery path reach generation.** INV-001. A publisher sees
the record; it does not participate in producing it. Whatever sharing,
buffering or batching this phase introduces sits strictly downstream of
`venue.tick()`.

**It may not report a load figure taken under contention.** CA6-01 is this
project's record of what that is worth, and the gate this phase runs was killed
by exactly that mistake on 2026-09-03: a load-measuring workflow and the
statistical suite on one 7.6 GB machine.

## 4. Phase invariants

INV-002 (one market per asset per moment, however many observers), INV-003 (one
stream per asset — multiplexing changes the pipe, never the source), INV-001
(the delivery path is downstream of generation and never reaches back).

## 5. Subphases

| Subphase | Title                                                    | State    |
| -------- | -------------------------------------------------------- | -------- |
| PH-22.1  | An instrument that can hold thousands of connections     | APPROVED |
| PH-22.2  | Many assets, one connection, the same resume contract    | APPROVED |
| PH-22.3  | What happens when ten thousand clients come back at once | ACTIVE   |

**"One tick, serialised once" was planned here and is not being built.** PH-22.1
measured the thing it would have optimised: building an SSE frame costs 0.187 µs
against a marginal delivery cost of 27 µs, so the whole of Issue #15 is 0.7% of
the work. A CPU profile of the engine under 500 observers is 98.6% idle, and the
largest remaining cost is `writev` — the socket syscall — which no amount of
shared buffering removes and which is identical in every transport. Issue #15 is
closed with the measurement.

That is the phase working as intended rather than a change of plan. The order
was written to make the second subphase's claim a before-and-after number, and
the "before" said there was nothing there to improve.

What remains is forced by dependency. PH-22.2 changes what a connection _is_,
and it is the only measured ceiling left: a browser gets six connections per
origin on HTTP/1.1, so eight charts do not fit on one client whatever the server
can serve. PH-22.3 is the failure case and needs the new connection shape to
characterise.

**PH-22.1 is an instrument, and it will be audited as one.** This project's most
expensive class of defect is an instrument that silently stops measuring — the
gate config in no TypeScript program, six browser tests reporting passed while
launching no browser. A load harness that measures itself, or that quietly fails
to open the connections it claims, would produce exactly the reassuring numbers
this phase must not generate. It owes a planted defect of its own: a harness
that cannot detect a server refusing connections is not a harness.
