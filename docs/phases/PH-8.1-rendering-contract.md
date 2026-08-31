# PH-8.1 — The rendering contract

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-8.1
Parent phase: PH-8 — Observer Frontend and Trading Chart Experience
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Reduce a tick record to something drawable without lying about what happened.

## 2. Three ways a chart lies, and what forbids each

Rendering is lossy by necessity — a few hundred pixels against a few hundred
thousand ticks — so something must be discarded. Each natural way to discard
invents something.

**Interpolation invents prices.** A line drawn between two ticks implies every
intermediate value traded. `query.ts` has said since PH-1.3 that interpolating
"would invent prices the market never visited, which is the same defect as
synthesising a candle for an empty bucket". A binary option settles on whether a
level was crossed, so a smooth path through a level the market never touched is
not cosmetic. **Forbidden:** every value drawn is the first, maximum, minimum or
last _observed_ price of its slice, recomputed from the record.

**Sampling hides extremes.** Taking the first tick per column, or every Nth,
discards spikes — and a spike is usually what the viewer is looking at.
**Forbidden:** the maximum of the columns' highs equals the maximum tick in the
window, at every resolution, and likewise for lows.

**A flat bar asserts a trade that did not happen.** Markets tick irregularly.
**Forbidden:** a slice with no ticks produces no column at all.

That the honest reduction turns out to be OHLC is not a coincidence: the candle
form exists precisely because it is the lossy reduction that preserves what
matters about a price path.

## 3. The contract lives in a package, not a component

`@otc/chart` depends on `@otc/core` only and contains no React. A property this
important cannot live inside a component, where it could only be checked by
looking at pixels. It also means the data handed to a charting library is already
correct at the pixel level, so the library has nothing left to invent.

## 4. What the guards are worth, measured

All three plants were run against the unfixed code.

| Plant                                                              | Result                                             |
| ------------------------------------------------------------------ | -------------------------------------------------- |
| Sampling reduction (keep first per column, drop high/low tracking) | **4 tests fail**                                   |
| Synthesise a flat column for empty slices                          | **4 tests fail**                                   |
| Interpolate the close (average of open and close)                  | **1 test failed — and not the one written for it** |

### The third plant, and why it matters

"Draws only values that were actually observed" was written specifically to catch
interpolation. It **passed** with interpolation planted.

The reason is instructive: it checked set membership against every observed price
in the window. With 20,000 ticks the observed set is dense, so an averaged value
lands on _some_ traded price often enough that the test never fired.

The fix was to stop asking a weak question. Each column's four values are now
recomputed independently from the record — first, max, min and last of the ticks
inside that column's own time range — so a value that is merely _plausible_ fails.
With that, the same plant fails with `close is not the last observed price of the
slice: expected 17 to be 25`.

This is the third time in two phases that a planted-defect test could not catch
its own defect. The rule from Cycle Audit 2 needs its sharpest form recorded
here: **a guard must be watched failing against the specific defect it names, not
merely watched failing.** A plant that trips some other assertion tells you
nothing about the guard you wrote.

## 5. Acceptance criteria

1. Every drawn value is the first, max, min or last observed price of its slice,
   verified by independent recomputation.
2. Window extremes survive at every resolution.
3. Empty slices produce no column.
4. Every tick in the window is accounted for exactly once.
5. Coarse and fine reductions agree about what happened (the rendered form of
   INV-004).
6. Each of the above verified to fail on its own planted defect.

## 6. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                       | Result                       |
| --------------------------- | ---------------------------- |
| `npm run format:check`      | PASSED (exit 0)              |
| `npm run lint`              | PASSED (exit 0)              |
| `npm run build`             | PASSED (exit 0)              |
| `packages/chart` unit tests | PASSED — 11 tests            |
| Full unit project           | PASSED — 846 tests, 46 files |

### Known limitations carried forward

- Nothing renders yet. Next.js, React and a streaming browser client are PH-8.2.
- The reduction is over a tick record held in memory. How a browser bounds that
  record — and what it does when the window exceeds it — is PH-8.2's problem.
