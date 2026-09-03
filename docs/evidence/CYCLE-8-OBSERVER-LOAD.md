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
