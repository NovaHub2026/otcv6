# PH-22 — Distribution Under Thousands Of Observers

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-22
Status: APPROVED
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
| PH-22.3  | What happens when ten thousand clients come back at once | APPROVED |

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

## 6. What the phase answered

The five unknowns of §1, and what each turned out to be.

| #   | Question                                  | Answer                                                                                                            |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | What breaks first?                        | **Memory, in socket write buffers, under simultaneous resumption.** Not CPU, not descriptors, not the event loop. |
| 2   | What does one tick cost at N subscribers? | **27 µs of engine CPU per delivered tick**, and 0.187 µs of that is building the frame.                           |
| 3   | What does a connection cost?              | 2,000 observers took the engine from 0.4% to 8.7% of one core; 5,000 connections were held.                       |
| 4   | What does a reconnect storm cost?         | Nothing at the live edge — 2,000 connect inside 190 ms. **1,470 MB and 5.1 s when they all resume.**              |
| 5   | Can several charts share one connection?  | **Yes, and it is the largest win in the phase**: 5× fewer connections, 32% less CPU, 40% better tail latency.     |

**Two of the five answers contradicted what was written down before the
measurement**, and that is the phase's whole value.

Issue #15 said per-subscriber serialisation was "the largest known cost". It is
0.7% of it, and closing that issue took one profile: the engine under 500
observers is **98.6% idle**, and the largest thing in the remainder is `writev`.
Duplicated work is not the same as expensive work.

Issue #16 said multiplexing was a fix for a browser limit. It is also the
throughput change, for a reason nobody wrote down: five deliveries to five
sockets become five writes to one, and the operating system coalesces what
lands in the same event-loop turn into a single syscall.

## 7. The transport decision

**Server-sent events stay** — [ADR-0016](../decisions/ADR-0016-sse-stays.md).
The Human Owner delegated the choice and the measurement makes it: the cost is
one `writev` per socket per delivery, a WebSocket frame costs the same syscall,
and the sixteen bytes it would save are 0.7% of a framing cost that is itself
0.7% of the total.

At the stated target — ten thousand clients, eight charts, a hundred assets —
the scaling law is arithmetic on measured constants: 122,400 deliveries per
second at 27 µs is **3.3 cores of delivery**, and multiplexing takes about a
third off that. A server, not a rewrite.

## 8. What the phase leaves open

**The replay ceiling is unexercised.** PH-22.3 §8 criterion 2: the budget is
guarded by unit tests, each watched failing, and it did not engage in the
post-fix load run because the harness reads as fast as the server writes.
Closing it needs a harness that reads slowly on purpose.

**Ten thousand was never held.** Two thousand from one harness process is where
the instrument itself becomes the busier process. Several harness processes are
the next honest step, and PH-22.1's evidence says so rather than extrapolating.

**The panel is not multiplexed.** It opens one asset per chart and works; the
multiplexed endpoint is an addition. The OTC Market Lab is the observer that
will need it, and it is next.

**Socket memory at eighty thousand connections is unmeasured.** Feed retention
was measured by Cycle Audit 7 at 5.01 MB per asset; per-connection buffers at
the full target were not.
