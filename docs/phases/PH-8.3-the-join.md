# PH-8.3 — The join, and timeframe switching

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-8.3
Parent phase: PH-8 — Observer Frontend and Trading Chart Experience
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Test the thing nothing had tested: a real client reconstructing from a real
server, across a real boundary.

## 2. Why the join, specifically

PH-7 tested the server. PH-8.1 tested the reduction. PH-8.2 tested the client
window. All three passed, and none of them exercised the path a user actually
takes.

That gap is worth taking seriously, because **both times this project found a
genuine architectural defect, it was by running the real thing across a real
boundary** — never by reasoning about the pieces either side:

- **PH-5.3** spawned the service, killed it with `SIGKILL`, and found the API
  reporting _no price at all_ until the new process published its own first tick.
  Every in-process restart test passed.
- **PH-8.2** ran `next build` and found `@otc/chart` dragging `node:crypto` and
  the master keyring into a browser bundle. Every guardrail passed, because
  `@otc/core` is an _allowed_ dependency — the allowlist answers "may this depend
  on that?" when the question was **which part**.

Neither was visible to any test that existed at the time, and both took minutes
to find once something real ran.

## 3. What the join test does

Drives a real API process over HTTP into a real `TickWindow`:

- **Mid-stream disconnection.** Streams 60 ticks, drops the connection, resumes
  from `window.resumeFrom`, and requires the window to be contiguous end to end.
  The window refuses anything that does not continue it, so a server resuming
  from the wrong place fails here rather than being papered over.
- **The full render path.** server → HTTP → window → reduction, checking that
  every extreme survives at 7, 40 and 300 columns and that every tick is
  accounted for exactly once.
- **Two clients, one market.** Two independent HTTP clients compared price by
  price across their overlapping sequence range.

## 4. Timeframe switching

Switching the timeframe **re-reduces what is already held**. It does not refetch,
does not resample, and cannot change a price — which is INV-004 as a viewer
experiences it rather than as a folding property. Switching away and back shows
exactly what was there before.

A window shorter than the requested span is shown as-is, never padded: a bar
before the first tick would assert a trade that had not happened yet.

## 5. Acceptance criteria

1. A client resumes across a disconnection with no hole and no repeat.
2. Its reconstruction agrees with what the server reports.
3. Extremes survive the full path at every resolution.
4. Two clients of one server agree price by price.
5. Timeframe switching changes the view and nothing else.

## 6. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                               | Result                                   |
| ----------------------------------- | ---------------------------------------- |
| `npm run format:check`              | PASSED (exit 0)                          |
| `npm run lint`                      | PASSED (exit 0)                          |
| `npm run build`                     | PASSED (exit 0)                          |
| `clientReconstruction.stat.test.ts` | PASSED — 3 tests, 254s, real API process |
| `next build` (apps/web)             | PASSED (exit 0)                          |

### Known limitations carried forward

- The join test costs 254 seconds. It earns it — it is the only test covering the
  path a user takes — but it is the slowest single file in the suite.
- The chart is not exercised in a browser. What is tested is the data reaching
  it, which is where the invariants live; pixels are not.
