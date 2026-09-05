# ADR-0003 — Conditional sign symmetry as the anti-predictability architecture

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-08-31
Deciders: Autonomous Development Agent (delegated authority, `GOVERNANCE.md` §41, §65)
Informs: PH-2, PH-3, PH-4, PH-6, PH-9
Supersedes: —

---

## Context

INV-006 requires that no deterministic or materially exploitable directional
pattern exist at the 30s–15m horizons. The product pays out on a **sign**: a
binary contract wins if the expiration price is above the entry price. At an 85%
payout an observer needs `P(up) > 1/1.85 = 0.5405` to profit; at the promotional
99% payout the threshold falls to `P(up) > 1/1.99 = 0.5025`.

That second number is the one that governs the architecture. **A directional bias
of a quarter of a percentage point is enough to make the product a losing
business.**

### The trap: a zero-drift market is not a fair market

The obvious design target is a martingale — a process whose expected future
return is zero. It is the wrong target, and the gap between it and the right one
is where the product would have died.

A binary contract pays on the **median** of the horizon return, not the mean. Any
skew in the distribution of the H-step displacement separates the two. A process
can be an exact martingale, with `E[x_k | F_{k−1}] = 0` holding identically, and
still have `P(up) ≠ 0.5` at every horizon that matters.

This was measured rather than assumed. Two processes were simulated for 6M ticks
each, both with increments `x_k = s_k · m_k`, `s_k` a fair coin, and therefore
both exact martingales:

| Process         | Volatility feedback          | Uncond. P(up), H=15 | Uncond. P(up), H=60 |
| --------------- | ---------------------------- | ------------------- | ------------------- |
| Sign-blind      | `σ` responds to `\|x\|`      | 0.49935             | 0.49979             |
| Leverage effect | `σ` responds to _signed_ `x` | **0.51751**         | **0.52925**         |

The leverage effect — that a fall raises volatility more than a rise — is one of
the most robust stylized facts in real markets and the single most likely feature
a competent quantitative developer would add to make the engine "more realistic".
It is also worth **2.9 percentage points** of directional edge at H=60. At the
99% payout that is a **+5.4% expected return per trade** to an adversary whose
entire strategy is _always bet UP_. No conditioning, no model, no private
information.

Conditioned on the previous move's sign and the realized-volatility tercile, the
sign-blind process stayed at 0.5000 in every bucket at every horizon; the
leverage process leaked in every bucket.

The correct invariant is therefore not "zero drift" but **conditional symmetry of
the sign**.

## Decision

### 1. Increments are a sign-blind magnitude times an independent fair coin

Every price increment is constructed as

```
x_k = s_k · m_k
```

where:

- `s_k` is drawn from a **dedicated cryptographic stream**, uniform on `{−1, +1}`,
  independent of every other stream and of all model state;
- `m_k ≥ 0` is produced by a magnitude-and-timing engine that is **structurally
  forbidden from observing any sign**. It may read magnitudes `|x_j|`,
  inter-arrival times, its own latent state, independent auxiliary randomness and
  authoritative wall-clock time. It may not read `s_j`, the price level, or any
  quantity derived from them.

### 2. The guarantee this buys is a theorem, not a calibration outcome

Let `F_n` be the entire public history through tick `n` — every price, every
timestamp, every candle on every timeframe. Let `D = Σ_{k=n+1}^{n+H} x_k` be the
displacement over any horizon `H`.

Given `F_n`, the future signs `s_{n+1..n+H}` remain i.i.d. fair and independent of
the future magnitudes `m_{n+1..n+H}`, because the magnitude engine never reads a
sign. Flipping every future sign is therefore a measure-preserving involution
that leaves every magnitude and every inter-arrival time **pointwise unchanged**
while negating `D`. Hence

```
P(D > 0 | F_n)  =  P(D < 0 | F_n)
```

**exactly**, for every horizon, every public conditioning event, and every public
stopping time. Anti-predictability becomes a property of the architecture rather
than something to be measured, tuned and hoped for.

Crucially, `m_k` must be sign-blind _globally_, not merely from `n` onwards. If
magnitudes were allowed to depend on past signs, the theorem fails for `n` earlier
than that dependence — and it must hold at every `n`, because every instant is
someone's entry.

### 3. The tie is the only remaining degree of freedom

The theorem gives `P(up) = P(down)`. It does **not** give `P(up) = 0.5` unless
`P(D = 0) = 0`, and on a discrete price lattice ties have positive probability,
concentrated at exactly the shortest horizons where the product sells most.

Since `P(up) = P(down) = (1 − P(tie))/2`, **any settlement policy that awards ties
to the house is the one and only way this architecture can produce an edge** —
and it produces it precisely where it is largest.

The engineering position is therefore that ties must be **void and refunded**. As
a settlement rule with material business consequence this is a Protected Human
Decision (`GOVERNANCE.md` §5); it is recorded in the roadmap for escalation at
PH-6 with this reasoning and that recommendation.

### 4. Mechanisms that are consequently banned

Each of these is something a competent contributor would propose as an
improvement or a bug fix. Each breaks the theorem. They are banned by name so
that the reason survives the person who found it:

| Banned                                                                                                                          | Why                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Leverage effect** — volatility responding to the _signed_ return                                                              | Measured at 2.9pp of edge. The archetypal "more realistic" change.                                                                                                                                                                                                                                                                                                           |
| **Itô convexity correction** (`−σ²/2` drift)                                                                                    | Looks like a mathematical bug fix when moving between price and log-price. It is a drift term, and drift is exactly what may not exist.                                                                                                                                                                                                                                      |
| **Additive microstructure / bid-ask-bounce noise**                                                                              | Introduces negative autocorrelation in the observed series, which is a directly tradeable signal at short horizons.                                                                                                                                                                                                                                                          |
| **Any return autocorrelation**, of either sign                                                                                  | Directly tradeable; it is the first thing an adversary tests.                                                                                                                                                                                                                                                                                                                |
| **Level-anchored structure** — support/resistance, dwell fields, or any volatility modulation that is a function of price level | The level is defined by a public statistic, so an adversary can recompute the generator's own rule and trade toward the nearest low-volatility node. Structure must instead emerge from _time_-anchored compression and expansion driven by reflection-invariant path features, which is visually indistinguishable to a chartist.                                           |
| **Regime or phase durations drawn in ticks, candles or any fixed grid unit**                                                    | Lattice-valued durations phase-lock to candle and expiry boundaries. Durations must be continuous-time and non-lattice, so that regime phase equidistributes against every fixed grid.                                                                                                                                                                                       |
| **Non-cryptographic randomness for the sign stream**                                                                            | The sign of every increment is publicly readable from the price path, giving an adversary a perfectly aligned, noiseless known-keystream oracle of order 10⁸ bits per asset per year. A 64-bit-keyed counter RNG is brute-forceable against that. ADR-0002's ChaCha20 with a full 256-bit derived key is the requirement, and the sign stream must have its own derived key. |

### 5. What remains available — the realism budget

The restriction costs far less realism than it appears to, because **every
stylized fact of real markets except the leverage effect lives in the magnitude
and timing process**, which is entirely unconstrained.

A sign-blind two-timescale stochastic-volatility process with heavy tails was
simulated for 3M ticks against a plain Gaussian random walk:

| Statistic                                | Random walk | Sign-blind SV                 | Real markets |
| ---------------------------------------- | ----------- | ----------------------------- | ------------ |
| Excess kurtosis                          | 0.00        | 49.6                          | 3 – 30+      |
| ACF(returns) lag 1 / 5 / 20              | ~0          | 0.001 / −0.000 / −0.000       | ~0           |
| ACF(\|returns\|) lag 1 / 20 / 200 / 2000 | ~0          | 0.324 / 0.305 / 0.187 / 0.068 | slow decay   |
| 60-tick displacement p99/p50             | 3.87        | **8.44**                      | high         |
| Same-sign run length, mean               | 2.000       | 2.000                         | ~2           |

The signature of a real market — near-zero return autocorrelation with _slowly
decaying_ absolute-return autocorrelation — is reproduced. The heterogeneity of
displacement across windows is more than double the random walk's, and that
heterogeneity is precisely what a viewer reads as alternating trend and
consolidation.

So the model may still have: multi-timescale stochastic volatility, volatility
clustering and long memory, heavy and time-varying tails, volatility jumps,
self-exciting tick arrivals, semi-Markov regimes over volatility and activity,
nested compression and expansion phases, and per-asset personality across all of
them. Trends, ranges, breakouts, false breakouts and retests all emerge from
recurrence and volatility geometry at 50/50 direction.

What it may not have is a rule that makes the _next direction_ predictable. That
was never a realism feature; in real markets direction is close to unpredictable
too.

### 6. The mirror test is the primary structural gate

Statistical batteries can only find leaks someone thought to condition on. The
theorem admits a direct structural test instead:

1. run the engine for a large number of ticks so the latent state is genuinely
   asymmetric — a test starting from a symmetric initial state passes vacuously;
2. snapshot at a **random interior index** `N`;
3. continue two runs from that snapshot, one with the sign stream negated for all
   `k > N`;
4. assert that every latent state variable is **bit-identical** between the runs,
   and that every increment is **exactly negated**;
5. randomise `N` over many seeds per CI run.

Any mechanism that reads a sign, a price level, or anything derived from them
**within the window the test runs** fails it immediately and unambiguously. It
is cheap, exact, and it is the gate that a statistical battery cannot replace.

**The window is a precondition, and it was unstated until Cycle Audit 7
(CA7-01).** Every mirror invocation in the repository compares a bounded run:
10,000 ticks in `productionComposition.test.ts` — the only one that drives the
shipped factory under `environment: 'production'` — 45,000 in
`phaseAcceptance`, 50,000 in `multiAsset`, 60,300 in `mirror.test.ts`, and
120,000 in `sampledCatalogue`, the highest anywhere. Against dogeusdt-otc's recorded
`meanIntervalMs` of 93 — the fastest tape in the catalogue of thirty (PH-26.3),
so the least market time a fixed window buys — 120,000 ticks is **3.1 hours** of
market life and the 10,000 of `productionComposition.test.ts` is **15.5
minutes**; a hosted market runs for months, and `#sequence` is monotonic across
restarts by design.

Those figures are a tempo away from being wrong, and were: they read eleven
hours and under an hour until PH-24.17 divided the catalogue's tempo by three
to four **inside this same cycle**, and nothing failed when they stopped being
true (Cycle Audit 8, a1). The tick counts above are the thing the callers fix;
what a tick is worth in market time is a property of `ASSET_CATALOGUE`, and it
moves.

An auditor planted the canonical banned mechanism — the leverage effect —
behind `#sequence > 200_000` and **every mirror test in the repository passed**,
while the battery in `phaseAcceptance.stat.test.ts` returned `EXPLOITABLE` at
+0.473pp with z = 5.95. The relationship this section describes was inverted for
that plant: the statistical gate caught what the structural one could not see.

This does not change the decision, and it is not a hole an ordinary mistake
falls into — every _unconditionally_ applied sign-reading mechanism, the
leverage effect included, diverges at step one of every mirror test, and the
evasion requires code that deliberately waits. It changes what the sentence
above is entitled to claim. The mirror test is exact **about the window it
runs**, INV-006 is enforced jointly with the battery (`INVARIANTS.md`), and
hosted CI runs the full statistical suite on every pull request and every push
to `main`, so the plant cannot reach trusted integrated state.

## Consequences

**Positive**

- The central product risk is closed by construction and provable, rather than
  measured and hoped for.
- The mirror test gives an exact, cheap CI gate that no statistical battery can
  match.
- The banned list makes the most dangerous "improvements" reviewable by name.
- Realism is essentially unaffected, as measured.

**Negative / accepted costs**

- The leverage effect cannot be reproduced. It is a genuine stylized fact of real
  markets and its absence is detectable by a sophisticated analyst. Accepted
  deliberately: it is worth 2.9pp of edge, which is many times the business
  margin. The market is synthetic and is not claiming to be any real instrument.
- Structure must be time-anchored rather than level-anchored, which is a harder
  mechanism to build well.
- The magnitude engine needs a disciplined boundary. It is not enough for it to
  happen not to read signs; it must be _unable_ to, which is an architectural
  constraint on PH-3 and a guardrail obligation.

## Verification obligations this creates

1. **Mirror test** as specified above, in CI (PH-3).
2. The PH-2 battery must condition on **level-anchored** axes, not only
   translation-invariant ones: raw absolute price, price modulo a swept grid of
   candidate cell widths, published price modulo the quote quantum, and signed
   distance to the nearest local minimum of the level-conditioned realized
   volatility curve. Every published attack battery in the literature of this
   design space conditions only on translation-invariant features, which is
   exactly why a level-anchored leak would survive one.
3. Gate on the **worst bin under Benjamini–Hochberg FDR control**, never on the
   pooled mean, which averages a local leak away to nothing.
4. Report the **minimum detectable effect**. Certifying `|edge| < 0.05pp` at 3σ
   needs on the order of 10⁷ independent samples per horizon per asset; at the
   15-minute horizon that is roughly 285 simulated years. Overlapping windows
   invalidate naive i.i.d. confidence intervals, so the battery must use
   non-overlapping windows or a block-bootstrap variance estimator, and must
   publish the floor it actually achieved instead of claiming "no edge".
