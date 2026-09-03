# ADR-0016 — Server-sent events stay; the cost is a syscall, and every transport pays it

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-09-03
Deciders: Development Agent, on the Human Owner's explicit delegation of the choice
Supersedes: —
Relates to: PH-22.1, `docs/evidence/CYCLE-8-OBSERVER-LOAD.md`, GitHub Issues #15 and #16

---

## Context

The Human Owner asked, on 2026-09-02: _several charts per client and thousands
of clients at once — does that argue for WebSocket?_ And on 2026-09-03 they
delegated the answer explicitly, to be taken from the numbers.

The case for WebSocket was never wire size. A WebSocket frame saves about 16
bytes on a 76-byte SSE event, which at the venue's own rate is 24 bytes per
second per viewer. The case, if there was one, had to be that something about
holding thousands of streams is cheaper in a socket protocol than in a long HTTP
response.

## What was measured

PH-22.1 built a load harness, proved it fails loudly against five deliberately
broken servers, and ran it against a real engine. Recorded in
[`CYCLE-8-OBSERVER-LOAD.md`](../evidence/CYCLE-8-OBSERVER-LOAD.md):

- **2,000 observers**, every one established, **zero gaps, zero duplicates**,
  engine at **8.7% of one core**, p50 6 ms and p99 25 ms.
- An idle engine — five markets generating, recording and checkpointing with
  nobody watching — costs **0.4%** of a core. Essentially all the rest is
  delivery.
- The marginal cost is **27 µs of engine CPU per delivered tick**.
- A CPU profile under 500 observers is **98.6% idle**, and the largest cost in
  what remains is **`writev`** — the socket write syscall — at 32% of non-idle
  time. Nothing in JavaScript appears at all.

Per operation, measured directly: `JSON.stringify(tick)` 0.174 µs, the full SSE
frame 0.187 µs, `res.write` on a live socket 0.960 µs, one write each to two
thousand distinct sockets 0.890 µs.

## Decision

**Server-sent events stay.** The delivery cost is one `writev` per socket per
delivered tick, and a WebSocket frame costs the same syscall on the same socket.
Changing transport removes none of them.

The 16 bytes a binary frame would save are 0.7% of the framing cost, which is
itself 0.7% of the delivery cost. The whole transport question is worth about
five parts in ten thousand of what this actually costs.

At the stated target the scaling law is arithmetic on the measured constant:
80,000 subscriptions across a hundred assets is 800 subscribers per asset, and
PH-21.2 measured 153 ticks per second published venue-wide, so 122,400
deliveries per second at 27 µs is **3.3 cores of delivery**. That is a server,
not a rewrite.

## What decided it beyond the numbers

Even at parity, SSE would win here, and it is worth writing down why so this is
not reopened on taste.

**Resumption is the product's problem, not a nicety.** SSE resumes by sequence
and **refuses explicitly** when the sequence has been evicted — the whole of
`?from=`, `onGap=live`, and `Last-Event-ID`. INV-002 says a gap served in
silence is indistinguishable from the market, so a transport that does not carry
an exact resume with an explicit refusal is not cheaper here; it is a rewrite of
the guarantee. WebSocket brings no resumption at all: it would have to be built,
and then proved, against a property this project has already measured twice
(CA6-31, CA6-32).

**A long HTTP response is inspectable.** `curl -N` shows the stream. Every
guard, every browser test and every audit probe in this repository reads it that
way, and that has caught real defects — including, this cycle, the refused
resume that froze the panel's candle.

## Consequences

**Positive.** No transport work, and the guarantee stays where it is already
tested. The measured ceiling that remains is the browser's six connections per
origin (Issue #16), and it is a client-side limit that WebSocket would also
have to solve — by multiplexing, which is what PH-22.2 is building anyway.

**Negative.** No binary tick. At a genuinely larger scale — a venue an order of
magnitude past the stated target — a 16-byte binary tick against a 58-byte JSON
one becomes 2.2 MB/s against 9.1 MB/s of egress, and bandwidth cost is not
syscall cost. That is a real future argument and this decision does not close it;
it closes the version of it that was about CPU.

**Revisit when** a measurement shows egress bandwidth, not CPU, as the limiter —
or when a measured run past ten thousand clients from several harness processes
shows something this one could not see. PH-22.1's own evidence names that as
unmeasured: at 2,000 the harness used 1.60 s against the engine's 1.73 s, close
enough that a larger single-process run would be measuring the instrument.
