# PH-8.2 — The streaming client and the frontend scaffold

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-8.2
Parent phase: PH-8 — Observer Frontend and Trading Chart Experience
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Let a browser reconstruct the server's record exactly, and render it.

## 2. A client can break INV-002 on its own

PH-7 made the server correct. A client can still produce a different market
without the server doing anything wrong, and all three ways look like ordinary
front-end pragmatism:

- **absorbing a gap** and drawing across it — which is the interpolation defect
  arriving through the network layer rather than the rendering layer;
- **evicting from the middle** to keep both ends of a long history, leaving a
  window that looks contiguous and is not;
- **assuming that because the connection came back, nothing was missed.**

`TickWindow` refuses each. It rejects a batch that does not continue it, evicts
only from the oldest end, and always knows the exact sequence to resume from —
never "the newest I have, probably".

A backgrounded tab is the ordinary case here, not the exotic one: browsers
throttle timers, the socket stalls, and the client returns needing to know
precisely what it missed. Reconnection always asks for `window.resumeFrom`.

Both guards were planted against. Absorbing a gap fails 2 tests; middle-eviction
fails 2 tests — in each case including the test written for that defect, which
after PH-8.1 is the standard being applied.

## 3. What building for a browser found

`@otc/chart` imported `@otc/core`, and the build failed on `node:crypto`.

The barrel at `@otc/core` re-exports everything, including the keyring. That is
correct for a server and wrong for a browser bundle — and no guardrail could see
it, because `@otc/core` is an _allowed_ dependency of `@otc/chart`. The
allowlist answers "may this package depend on that one?" and the question that
mattered was **which part**.

A rendering package needs prices, instants and ticks. It has no business anywhere
near key derivation, and shipping keyring code into a browser is undesirable even
when no secret travels with it.

So `@otc/core/browser` now exposes the time, market and math domains only, and
`dependencies.test.ts` compares package names rather than import paths so a
subpath is still recognised as a dependency on its package.

This is the second time in the project that a real architectural boundary was
found by _doing the thing_ rather than by reasoning about it — the first being
PH-5.3's process-boundary restart, which found an API reporting no price at all
after a deploy.

## 4. Scope delivered

- `TickWindow`: contiguity-enforcing, oldest-end-evicting, exactly resumable.
- `@otc/core/browser`: domain primitives without the entropy subsystem.
- Next.js 15 and React 19 scaffolded in `apps/web`, building clean.
- `streamMarket`: EventSource with resume-by-sequence reconnection.
- A chart that draws OHLC columns and nothing else — no smoothing, no curve
  fitting, no animated transitions, and a visible gap where the market was quiet.

## 5. Acceptance criteria

1. A gap is refused, naming the sequence to resume from.
2. Eviction keeps the window contiguous.
3. `resumeFrom` is exact, including after everything held was evicted.
4. The browser bundle contains no entropy code.
5. `next build` succeeds.
6. Each guard verified against its own planted defect.

## 6. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                       | Result                              |
| --------------------------- | ----------------------------------- |
| `npm run format:check`      | PASSED (exit 0)                     |
| `npm run lint`              | PASSED (exit 0)                     |
| `npm run build`             | PASSED (exit 0)                     |
| `packages/chart` unit tests | PASSED — 22 tests                   |
| Full unit project           | PASSED — 859 tests, 47 files        |
| `next build` (apps/web)     | PASSED (exit 0) — 105 kB first load |

### Known limitations carried forward

- The browser client has not been exercised against a running API in an
  automated test. The pieces either side of that boundary are tested; the join
  is not. PH-8.3.
- Timeframe switching is not yet wired to the UI, so INV-004 is demonstrated in
  the reduction but not in the product.
