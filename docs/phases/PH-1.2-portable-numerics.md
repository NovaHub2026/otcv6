# PH-1.2 — Portable numeric foundation and distribution samplers

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-1.2
Parent phase: PH-1 — Deterministic Market Kernel
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Give the kernel a numeric layer whose results are **bit-identical on every
platform and every Node version**, and build on it the distribution samplers the
market model will need.

## 2. Problem

PH-1.1 made the _bit source_ exactly reproducible. That is not yet enough.

The moment a market model computes `Math.exp(h)` to turn log-volatility into
volatility, reproducibility is lost. ECMAScript requires `Math.sqrt` to be
correctly rounded and specifies `+ - * /` and comparison exactly, but every
transcendental function — and the `**` operator — is _implementation-approximated_.
V8, JavaScriptCore and SpiderMonkey differ; V8's own results have changed between
versions as its `ieee754` routines were revised.

The consequence is not academic. INV-009 requires a settled contract to be
reproducible from records. "The price recomputes to within one ulp of the
recorded value" is not a defence in a dispute, and a market that replays
differently after a Node upgrade has lost its audit trail. A single
last-bit difference also diverges immediately: it changes a comparison, which
changes a rejection-sampling outcome, which changes every subsequent draw.

Both lint and the guardrail suite already refuse these functions in generation
code, so this subphase is what makes that ban satisfiable.

## 3. Scope

`packages/core/src/math/` and `packages/core/src/random/`.

### In scope

- **Portable elementary functions**: `exp`, `ln`, and `pow` derived from them,
  implemented with only exactly-specified operations.
- **Exact power-of-two scaling** via IEEE-754 bit construction.
- **Distribution samplers** over a `RandomStream`: uniform on a range, Bernoulli,
  categorical, standard normal, exponential, gamma, and chi-square / Student-t
  derived from gamma.
- Statistical and accuracy evidence for all of the above.

### Out of scope

- Trigonometric functions. The samplers are chosen so that none are needed; the
  polar normal method uses `ln` and `sqrt` only.
- Any market-model parameterisation. This subphase provides distributions, not
  decisions about which ones the market uses.
- Market domain primitives and aggregation (PH-1.3).

## 4. Contracts

### 4.1 Portable maths

```ts
/** e^x. Deterministic on every platform. */
export function exp(x: number): number;

/** Natural logarithm. Deterministic on every platform. */
export function ln(x: number): number;

/** x^y via exp(y * ln x). Deterministic; defined for x > 0. */
export function pow(x: number, y: number): number;

/** x * 2^n, exact, by IEEE-754 exponent construction. */
export function scaleByPowerOfTwo(x: number, n: number): number;
```

Algorithms, both the classic fdlibm decompositions:

- **`exp`** — range-reduce `x = k·ln2 + r` with `|r| ≤ ln2/2`, evaluate `exp(r)`
  by a minimax rational in `r`, then scale by `2^k` exactly. `ln2` is carried as
  a hi/lo pair so the reduction stays accurate for large `|x|`.
- **`ln`** — decompose `x = m · 2^e` with `m ∈ [√2/2, √2)` by bit extraction, then
  `ln m = 2·atanh(s)` with `s = (m−1)/(m+1)`, `|s| ≤ 0.1716`, evaluated as a
  polynomial in `s²`. Result is `e·ln2 + ln m`.

Special cases follow IEEE-754 and the ECMAScript specification for the
corresponding `Math` functions: `ln(0) = −∞`, `ln(x<0) = NaN`, `exp(−∞) = 0`,
`exp(+∞) = +∞`, overflow to `+∞`, underflow to `0`, and NaN propagation.

### 4.2 Samplers

```ts
export function uniform(s: RandomStream, min: number, max: number): number;
export function bernoulli(s: RandomStream, p: number): boolean;
export function categorical(s: RandomStream, weights: readonly number[]): number;
export function standardNormal(s: RandomStream): number;
export function normal(s: RandomStream, mean: number, stdDev: number): number;
export function exponential(s: RandomStream, rate: number): number;
export function gamma(s: RandomStream, shape: number, scale: number): number;
export function chiSquared(s: RandomStream, degreesOfFreedom: number): number;
export function studentT(s: RandomStream, degreesOfFreedom: number): number;
```

**Samplers are stateless.** Every one is a pure function of the stream position;
none caches a spare value between calls.

That rules out the usual optimisation in the polar and Box–Muller methods, which
generate two normals and cache one. A cached value is hidden state that does not
appear in `position()`, so a snapshot would omit it and replay would diverge — a
subtle, expensive bug precisely where the project can least afford one. The
second variate is discarded instead. The cost is roughly a factor of two in
normal generation; the entropy layer delivers 26M draws/second, so it is not a
constraint at any realistic tick rate.

`standardNormal` uses the **Marsaglia polar method**: draw `u, v` uniform on
`[−1, 1)`, accept when `0 < s = u² + v² < 1` (probability π/4), return
`u · √(−2 ln s / s)`. Rejection makes the number of draws variable, which is
harmless: the cursor records the exact position reached, so replay consumes the
same draws in the same order.

`gamma` uses Marsaglia–Tsang, with the standard `shape < 1` boost.

## 5. Failure behaviour

| Condition                                                                 | Behaviour    |
| ------------------------------------------------------------------------- | ------------ |
| `uniform` with `min > max` or non-finite bounds                           | `RangeError` |
| `bernoulli` with `p` outside `[0, 1]` or NaN                              | `RangeError` |
| `categorical` with an empty, negative-weighted, or zero-sum weight vector | `RangeError` |
| `normal` with negative or non-finite `stdDev`                             | `RangeError` |
| `exponential` with non-positive `rate`                                    | `RangeError` |
| `gamma` with non-positive `shape` or `scale`                              | `RangeError` |
| `studentT` / `chiSquared` with non-positive degrees of freedom            | `RangeError` |

## 6. Acceptance criteria

| #   | Criterion                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `exp` and `ln` agree with the platform `Math` equivalents to within 2 ulp across a wide sampled domain including subnormals, extremes and overflow boundaries |
| B2  | `exp(ln(x)) ≈ x` and `ln(exp(x)) ≈ x` to within 4 ulp over the representable range                                                                            |
| B3  | Special-case behaviour matches IEEE-754 and `Math` exactly for zero, negatives, infinities, NaN, overflow and underflow                                       |
| B4  | The maths module contains no implementation-approximated operation, enforced by the existing guardrails                                                       |
| B5  | Every sampler is reproducible: same label and cursor gives the same value                                                                                     |
| B6  | Every sampler is stateless: re-deriving a stream at a recorded cursor continues identically                                                                   |
| B7  | `standardNormal` passes moment, Kolmogorov–Smirnov and tail tests against the normal distribution                                                             |
| B8  | `exponential`, `gamma`, `chiSquared` and `studentT` match their theoretical mean and variance within sampling error, with published critical values           |
| B9  | `categorical` reproduces its weight vector; `bernoulli` reproduces `p`                                                                                        |
| B10 | Sampler throughput is measured and recorded                                                                                                                   |

## 7. Verification requirements

- Unit tests for special cases, error behaviour and reproducibility.
- An accuracy suite comparing `exp`/`ln` against the platform implementation in
  ulp, over a deterministic sample of the domain.
- A seeded statistical suite for every sampler, using published critical values
  rather than thresholds fitted to observed output.
- `npm run build`, `npm run lint`, `npm run format:check`.
- A recorded throughput measurement.

## 8. Dependencies

PH-1.1 (`RandomStream`).

## 9. Expected result

The market model in PH-2 can compute volatilities, sample heavy-tailed
magnitudes and draw regime durations without ever reaching for a function whose
result depends on which machine it runs on.

---

## 10. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

| #   | Criterion                 | Evidence                                                                                                                                                                                     |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `exp`/`ln` accuracy       | `exp` within **1 ulp** and `ln` **bit-identical (0 ulp)** to the platform implementation across −745…709.7 and 400k sampled points including subnormals; unit sweep asserts ≤ 1 ulp for both |
| B2  | Round trip                | `ln(exp(x))` within `4e-16 · max(1,                                                                                                                                                          | x   | )`  |
| B3  | Special cases             | `portable.test.ts` — zero, negatives, both infinities, NaN, overflow, underflow, subnormals                                                                                                  |
| B4  | No approximated operation | existing guardrail and lint rules; the module passes both                                                                                                                                    |
| B5  | Reproducibility           | `distributions.test.ts` — all 12 samplers give identical output from an identical stream                                                                                                     |
| B6  | Statelessness             | `distributions.test.ts` — all 12 samplers continue identically from a recorded cursor                                                                                                        |
| B7  | Normal correctness        | four moments, Kolmogorov–Smirnov at α=0.001, five tail probabilities to 4σ, sign balance                                                                                                     |
| B8  | Other distributions       | exponential (mean, variance, memorylessness), gamma (4 shape/scale pairs including shape < 1), chi-squared (3 df), Student-t (variance and increasing tail mass as df falls)                 |
| B9  | Discrete samplers         | Bernoulli at four probabilities; categorical chi-square against its weight vector                                                                                                            |
| B10 | Throughput                | 4.27M `standardNormal`/s                                                                                                                                                                     |

### Verification executed

`npm run format:check`, `npm run lint`, `npm run build`, `npx vitest run` — all
passed. **212 tests across 13 files.** Hosted CI has not executed: no remote.

### Notes

- Two acceptance thresholds in the original draft of this document were wrong and
  were corrected rather than worked around: B2 was stated in ulp, but the
  `ln(exp(x))` round trip is ill-conditioned for small `x`, so the meaningful
  quantity is scaled absolute error. `pow` is likewise asserted on relative
  error, since it inherits error from both `exp` and `ln`.
- `standardNormal` discards the polar method's second variate rather than
  caching it. The cache would be hidden state absent from `position()`, so
  snapshots would omit it and replay would silently diverge. Measured cost is a
  factor of two against an entropy layer with five orders of magnitude of
  headroom.
