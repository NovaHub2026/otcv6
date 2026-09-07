# PH-30 — Ten Thousand Observers, From Several Processes

Type: EVIDENCE
Recorded: 2026-09-06
Commit: `cafcb64` (the driver), rerun at ten thousand on the tree of the approval commit
Machine: 16 cores, 7.6 GB, WSL2, shared with another project's dev server and a second session at the time of the run
Method: `npm run observer:fleet -- --sizes 1000,2500,5000,10000 --workers 8 --hold 20000 --per-connection 8`; eight worker processes, each holding its share of the observers over the multiplexed stream (eight assets per connection, the shape a page has since PH-30.2), the venue sampled on `/metrics` during and after each size

---

## 1. Result

`CYCLE-8-OBSERVER-LOAD.md` stopped at two thousand observers from one process
because the harness had become what was measured. Eight processes measure the
venue:

| observers | workers | established | connections | subscribers | RSS during (MB) | RSS after (MB) | MB per connection | ticks in window | gaps | duplicates | p50   | p99   | complete |
| --------- | ------- | ----------- | ----------- | ----------- | --------------- | -------------- | ----------------- | --------------- | ---- | ---------- | ----- | ----- | -------- |
| 1000      | 8       | 1000        | 1000        | 8000        | 168             | 174            | 0.069             | 354726          | 0    | 0          | 5ms   | 25ms  | yes      |
| 2500      | 8       | 2500        | 2500        | 20000       | 256             | 264            | 0.063             | 1119531         | 0    | 0          | 11ms  | 41ms  | yes      |
| 5000      | 8       | 5000        | 5000        | 40000       | 355             | 359            | 0.051             | 2795298         | 0    | 0          | 84ms  | 211ms | yes      |
| 10000     | 8       | 8752        | 8753        | 70024       | 887             | 888            | 0.090             | 5390844         | 0    | 0          | 502ms | 915ms | **no**   |

Then ten thousand alone, twice, at the driver's default arrival (one attempt
every 2 ms per worker) and at a gentler one (every 8 ms), naming what refused:

| arrival | established | connections | subscribers | RSS during (MB) | p50   | p99   | refused                                                                        |
| ------- | ----------- | ----------- | ----------- | --------------- | ----- | ----- | ------------------------------------------------------------------------------ |
| 2 ms    | 7801        | 7802        | 62416       | 474             | 169ms | 386ms | 2101 × no first byte within the connect timeout; 98 × connect: read ECONNRESET |
| 8 ms    | 7724        | 7724        | 61792       | 397             | 173ms | 402ms | 2276 × no first byte within the connect timeout                                |

## 2. What it says

- **Five thousand observers — forty thousand subscriptions — are held whole**
  on this machine: every observer established, every tick contiguous, zero
  gaps and zero duplicates over 2.8 million deliveries in the window, delivery
  p99 211 ms, the venue at 355 MB resident.
- **Ten thousand are not, and the reason is the event loop, not memory.** At
  7,700–8,750 connections the venue's resident memory is 0.4–0.9 GB
  (0.04–0.09 MB per connection, socket buffers included) and every established
  observer is still gapless; what refuses the rest is that a new connection's
  first byte does not arrive within the harness's connect timeout while
  delivery p99 has climbed past 400 ms — one thread delivering to sixty
  thousand subscriptions has no time left to complete handshakes. A gentler
  arrival does not change that (7,724 at 8 ms against 7,801 at 2 ms).
- **For a broker's planning:** one venue process on a machine of this class
  holds about five thousand simultaneous observers of eight charts each with
  sub-quarter-second delivery, and reaches seven to nine thousand with
  degraded latency. Ten thousand needs more than one process — the multi-node
  composition the Cycle 10 plan deferred (Issue #9) — or fewer subscriptions
  per observer. The ceiling is CPU time on one loop, which a bigger machine
  raises linearly with single-core speed and not with cores.

## 3. What it does not say

The machine was shared during the run (load average above 1 from another
project's dev server and a second session), so the latencies are upper
bounds on a quiet machine of the same class. The harness's own eight processes
ran on the same machine; at five thousand they used cores the venue did not
need, and at ten thousand the contention is in the numbers. Memory was not the
constraint at any size measured.

## 4. What the table above could not have shown (Cycle Audit 10, a8-03)

The rows in §1 were produced by a driver that dropped two of the harness's own
counters. `gapEvents` and `closeEvents` — the venue saying an asset's history
was evicted, and the venue cutting an observer off mid-hold — were counted per
worker (Cycle Audit 8 added them for exactly this) and then **not carried into
the fleet row**: `FleetRow` had no field for them, the table had no column, and
`complete` was `established === size`. Reproduced on a fake venue that serves
three ticks and then closes every observer with `client fell behind`: the
driver rendered `complete: yes`, `gaps 0`. `instrumentBound` was worse than
uncounted — the driver never passed the engine's pid to a worker, so the flag
that says the harness outworked the engine could not be true in any fleet row
ever produced, this one included.

So the numbers above stand for what they measure — established, gaps,
duplicates, memory, latency — and **cannot** be read as saying the established
observers held to the end. In particular the 8,752 established at ten thousand
were not shown to be uncut; the row simply had nowhere to say so. The p99 of
915 ms at that size is the conditions under which a venue starts cutting clients
that fall behind, which is why this matters here rather than in the abstract.

The driver now carries `gap frames`, `closed` and `bound` as columns, refuses to
call a row complete over a non-zero counter, and passes the engine's pid to its
workers; `observerLoad`'s own `complete` means established **and** held, which
is what its docblock always said. A rerun at five and ten thousand belongs to
whoever next needs those two rows to mean the stronger thing; it was not
re-executed here, and this section is the record of that.
