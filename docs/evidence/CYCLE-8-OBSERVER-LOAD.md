# Two thousand observers, measured

Type: RECORDED EVIDENCE
Produced: 2026-09-03
Runner: `tools/sim/src/observerLoadRun.ts` — in the repository, and reproducible
Harness: `tools/sim/src/observerLoad.ts`, guarded by `observerLoad.test.ts`
Machine: 16 cores, 7.6 GB, no other load. The gate and every agent workflow were
stopped for this run, because a load figure taken under contention is worth
nothing (CA6-01, and the gate this instrument was built under was killed by
exactly that mistake the day before).

---

## Why this exists

The Human Owner named the target on 2026-09-02: several charts per client,
thousands of clients at once. Nobody had ever opened **two** simultaneous
clients against this engine, so every number PH-22 was going to act on was an
extrapolation from one client or an argument on a whiteboard.

## Result

Five assets, one engine process, observers spread across them in rotation. Every
size gets the same twenty-second window on the same warmed engine, and the sweep
runs forwards and backwards so residual warm-up cannot masquerade as a size
effect.

| observers | established | ticks in window | engine CPU | marginal | µs per delivery | p50 | p99  | gaps | duplicates |
| --------- | ----------- | --------------- | ---------- | -------- | --------------- | --- | ---- | ---- | ---------- |
| 0         | —           | —               | 0.08 s     | —        | —               | —   | —    | —    | —          |
| 100       | 100         | 2,400           | 0.32 s     | 0.24 s   | 100.0           | 2ms | 4ms  | 0    | 0          |
| 500       | 500         | 13,300          | 0.80 s     | 0.72 s   | 54.1            | 3ms | 10ms | 0    | 0          |
| 2,000     | 2,000       | 55,600          | 1.73 s     | 1.65 s   | 29.7            | 6ms | 25ms | 0    | 0          |
| 500       | 500         | 14,400          | 0.60 s     | 0.52 s   | 36.1            | 3ms | 12ms | 0    | 0          |
| 100       | 100         | 3,280           | 0.28 s     | 0.20 s   | 61.0            | 2ms | 3ms  | 0    | 0          |

**Two thousand observers is comfortable.** Every one established, not one gap,
not one duplicate, and the engine at **8.7% of one core**. An idle engine —
generating, recording and checkpointing five markets with nobody watching —
costs 0.4% of a core, so essentially all of it is delivery.

The per-delivery figure _falls_ with scale, from 100 µs to 30 µs. That is not
an economy of scale in the code; it is the operating system coalescing more
writes per syscall when they arrive closer together. The slope across the whole
range is the number to carry forward: **27 µs of engine CPU per delivered
tick**.

## What the cost is actually made of

This is the finding, and it contradicts the issue that was filed against it.

A CPU profile of the engine under 500 observers is **98.6% idle**. The largest
single cost in what remains is `writev` — the socket syscall — at 32% of all
non-idle time. Nothing in JavaScript appears at all.

Measured directly, per operation:

```
JSON.stringify(tick)                     0.174 us
full SSE frame (template + stringify)    0.187 us
Buffer.from(frame)                       0.100 us
res.write(frame) on a live socket        0.960 us
one write each to 2,000 distinct sockets 0.890 us
```

Against a measured marginal cost of ~27 µs per delivery, **building the frame is
0.7% of the work**.

## Issue #15 is refuted

> Every subscriber re-serialises the same tick … at ten thousand clients
> watching eight assets each, that is ~120,000 serialisations per second of an
> identical string. Transport-independent, and the largest known cost.

The arithmetic was right and the conclusion was wrong. 120,000 serialisations
per second of this string is 0.187 µs each — **22 milliseconds of CPU per
second**, or 2% of one core. It is not the largest known cost; it is a rounding
error against the syscall that follows it.

The mistake is worth naming because it is the ordinary one: a cost was
identified by _reading the code_ and its size was assumed from how wasteful it
looked. Duplicated work is not the same thing as expensive work.

## What it means at the target

Ten thousand clients watching eight charts each is 80,000 subscriptions. On a
hundred-asset catalogue that is 800 subscribers per asset, and PH-21.2 measured
153 ticks per second published venue-wide:

```
153 ticks/s × 800 subscribers = 122,400 deliveries/s
122,400 × 27 µs                = 3.3 CPU-seconds per second
```

**About three and a half cores of delivery, on this hardware, for the whole
stated target.** Plus 501 MB of feed retention at a hundred assets (CA7-33) and
socket buffers for 80,000 connections, which is the memory question and not this
one.

## What this says about WebSocket

The question the Human Owner asked was whether thousands of clients argue for
WebSocket. Measured, the answer is no, and for a reason stronger than the byte
count: **a WebSocket frame costs the same syscall.** The dominant cost is one
`writev` per socket per delivery, and switching transports does not remove a
single one of them. The 16 bytes a binary frame would save on a 76-byte event
are 0.7% of a cost that is already 0.7% of the total.

## What this does not settle

**The connection limit is untouched by any of this.** A browser gets six
connections per origin on HTTP/1.1, so eight charts do not fit on one client
regardless of what the server can serve (Issue #16). That is a client-side
ceiling, and it is the one thing here that genuinely needs building.

**Nothing beyond 2,000 was measured from one machine.** At 2,000 the harness
itself used 1.60 s against the engine's 1.73 s — close enough that a larger
single-process run would be measuring the instrument. Ten thousand needs several
harness processes, and that is the next honest step, not an extrapolation.

**Memory per connection is not in this table.** Feed retention was measured by
Cycle Audit 7; socket buffers at eighty thousand connections were not.

---

## PH-22.2 — the same clients, with and without multiplexing

One connection per chart against one connection per client, five assets each,
same engine, same twenty-second window, zero-observer baseline subtracted.

| clients | charts/connection | connections | ticks in window | engine CPU | marginal | µs/delivery | p99  | gaps | duplicates |
| ------- | ----------------- | ----------- | --------------- | ---------- | -------- | ----------- | ---- | ---- | ---------- |
| 500     | 1                 | 2,500       | 60,000          | 2.47 s     | 2.38 s   | 39.7        | 26ms | 0    | 0          |
| 500     | 5                 | **500**     | 62,500          | 1.87 s     | 1.78 s   | 28.5        | 27ms | 0    | 0          |
| 1,000   | 1                 | 5,000       | 147,313         | 4.51 s     | 4.42 s   | 30.0        | 60ms | 0    | 0          |
| 1,000   | 5                 | **1,000**   | 145,000         | 3.05 s     | 2.96 s   | 20.4        | 36ms | 0    | 0          |

**Multiplexing wins on three axes at once**, and only one of them was the point:

- **Connections fall by the number of charts** — 5,000 to 1,000. That was the
  objective: a browser gets six per origin, so this is what makes eight charts
  per client possible at all.
- **Engine CPU falls 24–32%**, for the same ticks delivered. Not what it was
  built for. Five deliveries to five sockets become five writes to _one_, and
  the operating system coalesces what lands in the same event-loop turn into one
  `writev` — the syscall PH-22.1 measured as the whole cost.
- **Tail latency improves 40%** at a thousand clients, 60 ms to 36 ms, for the
  same reason.

Zero gaps and zero duplicates at every size, with sequences checked **per asset**
on the multiplexed streams — five interleaved series on one connection, each
continuous.

**Five thousand connections were held** on the single-asset side of this
comparison, which is past the two thousand PH-22.1 measured.

The contrast with the optimisation that was planned and abandoned is the lesson
worth keeping. Sharing a serialised frame across subscribers — Issue #15 — was
worth a measured 0.7%. Sharing a _socket_ across an observer's charts is worth
30%, and nobody proposed it as a throughput change: it was filed as a fix for a
browser limit.

---

## PH-22.3 — everybody comes back at once

A deploy is the case that decides whether this survives production: every client
reconnects in the same second, each asking to resume where it was.

### Before

Two thousand clients, five assets each, twenty seconds of window:

| arrival         | resume     | established | connect p50/p99/max          | engine CPU | RSS                | gaps | duplicates |
| --------------- | ---------- | ----------- | ---------------------------- | ---------- | ------------------ | ---- | ---------- |
| gradual, 60 s   | live edge  | 2,000       | 126 / 818 / 1,177 ms         | 11.84 s    | 99 → 192 MB        | 0    | 0          |
| **storm**, 0 ms | live edge  | 2,000       | 174 / 188 / **189** ms       | 4.24 s     | 192 → 252 MB       | 0    | 0          |
| **storm**, 0 ms | 5,000 back | 2,000       | 2,728 / 5,088 / **5,155** ms | 8.38 s     | 252 → **1,470 MB** | 0    | 0          |

**A storm on its own is nothing** — two thousand clients connect inside 190 ms.
**A storm that resumes is the problem**: 1.47 GB of resident memory and five
seconds to connect. Nobody was dropped and nobody was silently wrong, which is
the contract holding, but ten thousand clients on that shape is roughly six
gigabytes — past the heap Node gives itself and past the machine.

CA7-04's per-connection bound of 1 MB was working exactly as designed
throughout, and did nothing. **The quantity that matters in a storm is the sum**,
and nothing was counting it.

### The fix, and what the first attempt got wrong

A process-wide replay budget: past a ceiling, a resume is treated exactly like an
eviction, because from the client's side it is one — the ticks it asked for are
not coming. Told (`onGap=live`), it can refetch; jumped forward in silence, it
cannot tell that from a quiet market (INV-002).

**The first version of it counted the wrong thing, and the test written for it
said so.** It counted bytes buffered _before_ the response headers — and the
handler is synchronous, so only one connection is ever in that state and the
counter was always zero when the next one looked. The 1.47 GB was never in that
buffer: it was in the write buffers of two thousand sockets that could not drain
as fast as a replay filled them. That is `writableLength`, and it is what the
budget counts now.

### After

Fifteen hundred clients, five assets each:

| arrival       | resume     | established | connect p50/p99/max        | engine CPU | RSS              | gaps | duplicates | refused |
| ------------- | ---------- | ----------- | -------------------------- | ---------- | ---------------- | ---- | ---------- | ------- |
| gradual, 20 s | live edge  | 1,500       | 159 / 734 / 921 ms         | 4.77 s     | 97 → 165 MB      | 0    | 0          | 0       |
| storm, 0 ms   | live edge  | 1,500       | 578 / 1,707 / 1,707 ms     | 1.81 s     | 165 → 219 MB     | 0    | 0          | 0       |
| storm, 0 ms   | 5,000 back | 1,500       | 664 / 1,269 / **1,271** ms | 3.68 s     | 219 → **458 MB** | 0    | 0          | 0       |

**And the honest part: the budget did not engage in this run.** Nothing was
refused and no gap was reported, because the harness reads as fast as the server
writes, so `writableLength` stays near zero and no connection ever owes
anything. The improvement from 1,470 MB to 458 MB is a 25% smaller run plus
whatever else changed between them; it is **not** attributable to the ceiling.

What the ceiling is proven to do is what the unit tests prove: charge undrained
bytes, release them on drain or close, refuse a resume past the ceiling without
a gap policy, and serve the live edge with an explicit `gap` when asked to be
told. Each watched failing.

**What remains unmeasured** is the ceiling under a genuinely slow fleet — real
browsers on real networks, which is where `writableLength` actually grows. That
needs a harness that reads slowly on purpose, and it is the next honest step
rather than a claim this run supports.
