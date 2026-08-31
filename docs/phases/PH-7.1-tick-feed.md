# PH-7.1 — The tick feed: ordering, resumption and the backpressure decision

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-7.1
Parent phase: PH-7 — Public Market Distribution and Multi-User Consistency
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Distribute one market to many observers without any of them getting a different
market.

## 2. The decision this subphase is really about

Fan-out means buffering, and buffering means some client will eventually fall
behind. Every intuitive response to that is wrong in the same way:

- **drop ticks** — the client's market now has holes it cannot see;
- **coalesce them** — the client's market moves in jumps the real one did not;
- **send the latest price instead of the next one** — the client is now watching
  a different series entirely.

All three are invisible from the client's side, because a client cannot know what
it never received. That is INV-002 broken in the one place nobody looks: not in
the engine, not in settlement, but in the delivery path, where it looks like
performance work.

So there are exactly two acceptable outcomes: **every tick in order, or
disconnection with a reason and a sequence to resume from.** A subscriber that
refuses delivery is closed, and what it already holds is guaranteed to be a
correct _prefix_ of what every other subscriber holds — never a divergent view.

## 3. Sequence, not time

Ticks are addressed by sequence throughout. Time is ambiguous at this layer:
arrivals are irregular, two nodes' clocks differ, and a client's "now" is its
own. A sequence number is the one identifier every party agrees on.

This is also where PH-5's sequence _leasing_ earns its place. Before Cycle Audit
2, a restart seam restarted numbering at 1; two clients reconstructing across
that seam would have held irreconcilable histories with no way to detect the
disagreement. The fix was made in the runtime, and this is the layer that would
have exposed it.

## 4. Retention is bounded, and saying so is the point

The replay window is explicit, and asking for something evicted is an **error**,
not a silent jump forward. Quiet truncation would turn a resumable feed into one
that skips — the same defect as dropping, arriving through the back door.

## 5. Gaps are refused, not propagated

`publish` requires strictly increasing sequences. A gap here reaches every
observer simultaneously, and the feed cannot invent what the runtime did not give
it.

## 6. Acceptance criteria

1. Concurrent subscribers receive identical tick arrays.
2. Ordering is strict and gapless; a gap in publication is refused.
3. A subscriber that cannot keep up is closed, and its received prefix is a
   correct prefix of the full stream.
4. A cancelled subscriber can resume exactly from `deliveredThrough + 1`.
5. Asking for evicted history raises `EvictedError`.
6. Each of the above has a test verified to fail on the corresponding planted
   defect.

## 7. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                              | Result             |
| ---------------------------------- | ------------------ |
| `npm run format:check`             | PASSED (exit 0)    |
| `npm run lint`                     | PASSED (exit 0)    |
| `npm run build`                    | PASSED (exit 0)    |
| `packages/distribution` unit tests | PASSED — 12 tests  |
| Guardrails                         | PASSED — 153 tests |

### Known limitations carried forward

- The feed is in-process. Wiring it to a transport and to `apps/api` is PH-7.3.
- The economic blindness demonstration has **not** yet been re-established across
  the boundary; the single-process result does not transfer. PH-7.2.
- The two-node "price now" contract of the phase document §2.4 is not yet
  written down.
