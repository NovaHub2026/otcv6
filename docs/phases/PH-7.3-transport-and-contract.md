# PH-7.3 — The transport, and the consistency contract written down

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-7.3
Parent phase: PH-7 — Public Market Distribution and Multi-User Consistency
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Put the feed on a real socket, and answer the question the phase document flagged
as a product decision rather than leaving a user to discover it.

## 2. The transport

Server-sent events at `GET /markets/:id/stream`, with `?from=N` for resumption
and the tick's sequence carried as the SSE event id, so a reconnecting client
knows exactly where it stopped.

Two behaviours are inherited from the feed and matter more than the encoding:

- **`res.writableNeedDrain` is the backpressure signal.** When the socket buffer
  fills, the sink returns `false` and the feed disconnects. It does not send this
  client a summary of what it missed — that would hand it a series nobody else
  has.
- **An evicted replay is a 400, not a jump forward.** A client that asks for
  history the window no longer holds gets an error it can act on.

Everything the service publishes goes through the one feed, so the streaming and
REST views cannot drift apart: they are the same ticks, not two code paths that
happen to agree.

## 3. The two-node question, answered

The phase document §2.4 raised it and refused to guess. It is now written down in
[`docs/architecture/CONSISTENCY_CONTRACT.md`](../architecture/CONSISTENCY_CONTRACT.md),
and the distinction is between a question addressed to **a moment** and one
addressed to **now**.

**Exact, unconditionally:** what tick N is, what the price was at instant T, how a
contract settles, and what a client missed since sequence M. A market is a pure
function of key, genesis and elapsed time, so two nodes never disagree about a
tick's content — and settlement, which is defined by instant over the record, is
node-independent. That is the guarantee that matters commercially.

**Approximate, and bounded:** "what is the price _now_?" A node publishes tick N
once its clock reaches N's instant, so nodes separated by skew δ cross that
threshold δ apart. The disagreement is always a **prefix** relationship — one
node is behind, never divergent — and it is bounded by the skew.

Tested: two nodes 400 ms apart produce identical ticks for every shared sequence,
the lagging node holds a strict prefix, and `priceAtOrBefore` at a shared instant
agrees on both.

Stating it this way also forbids a family of tempting designs — a node publishing
on its own schedule, a summary for a slow client, an invented tick to fill a gap —
each of which would break the prefix relationship into a real divergence.

## 4. Acceptance criteria

1. Concurrent clients over real sockets receive identical ticks on their overlap.
2. A stream is strictly ordered and gapless per client.
3. A client resumes with `?from=N` and reconstructs contiguously across the
   disconnect.
4. An impossible or evicted replay request is rejected, not guessed.
5. Two nodes under clock skew agree on every shared sequence and on
   `priceAtOrBefore`; the lagging node holds a prefix.
6. The contract is written down where a fresh agent will find it.

## 5. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                                  | Result                         |
| -------------------------------------- | ------------------------------ |
| `npm run format:check`                 | PASSED (exit 0)                |
| `npm run lint`                         | PASSED (exit 0)                |
| `npm run build`                        | PASSED (exit 0)                |
| `stream.stat.test.ts`                  | PASSED — 2 tests, real sockets |
| `distributionConsistency.stat.test.ts` | PASSED — 8 tests               |

### Known limitations carried forward

- Multiple nodes are _characterised_ and their contract published; actually
  running more than one — leader election, shared persistence, coordinated
  restart — is beyond PH-7 and unclaimed.
- The stream is anonymous. Authentication and per-client entitlement arrive with
  accounts, which no phase has yet scoped.
