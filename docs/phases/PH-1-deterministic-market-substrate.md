# PH-1 — Deterministic Market Substrate

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-1
Status: ACTIVE
Cycle: 1 (phase 1 of 3)
Created: 2026-08-31
Branch: `feature/ph-1-deterministic-market-kernel`

---

## 1. Objective

Build the deterministic substrate that every later capability stands on: a
canonical time model, an entropy architecture that is simultaneously
**replayable** and **publicly unpredictable**, a numeric foundation whose results
are bit-identical across machines, the market domain primitives, and
tick-to-candle aggregation that is coherent across every timeframe.

This phase produces **no market behaviour**. It produces the substrate on which
market behaviour can be generated, replayed, audited and trusted.

## 2. Problem

Six of the ten foundational invariants are properties of the substrate, not of
the market model:

| Invariant | Substrate requirement                                          |
| --------- | -------------------------------------------------------------- |
| INV-003   | one canonical stream, every representation derived from it     |
| INV-004   | timeframe is a pure view over that stream                      |
| INV-008   | state survives candle, clock and process boundaries            |
| INV-009   | historical outcomes reproducible from records                  |
| INV-010   | private generator state never reconstructable from public data |
| INV-002   | one market per asset-moment, shared by all observers           |

If the substrate is built after the market model, every one of these becomes a
retrofit. Retrofitting determinism onto a stochastic simulator is close to a
rewrite, because determinism constrains the _primitives_ — which random source,
which numeric operations, which clock — not the composition above them.

There is also a concrete, non-obvious hazard this phase exists to close:
**floating-point transcendental functions are not portable.** ECMAScript does not
require `Math.log`, `Math.exp`, `Math.cos` or `Math.pow` to be correctly rounded,
and results differ between engines, platforms and versions. A market model built
on them replays _approximately_, which is worthless: INV-009 requires that a
settled contract be reproducible, and "the price was within 1 ulp of that" is not
a defence in a dispute. Only `+ - * /`, comparison and `Math.sqrt` are exactly
specified. The kernel must therefore own its own elementary functions.

## 3. Expected product value

- A settled contract can be reconstructed exactly, years later, from sealed
  records — the foundation of the auditability requirement (§21).
- The market survives restarts without repeating, jumping or discontinuity.
- An observer with the complete public price history cannot reconstruct the
  generator's future output.
- Assets are cryptographically isolated from each other; production is isolated
  from simulation, test and staging.
- Every later phase can be tested by _exact replay_ rather than by tolerance
  comparison, which makes statistical validation trustworthy.

## 4. Scope

1. **Canonical time model** — integer-millisecond instants, injected clocks,
   epoch-aligned timeframes with a strict divisibility chain, no session or
   market-hours concept (the market is continuous, §22).
2. **Deterministic entropy architecture** — keyed, seekable, counter-based
   keystream (ChaCha20, RFC 8439); per-stream key derivation via HKDF from a
   master secret; hierarchical stream labels carrying environment, asset,
   purpose and key epoch; cursor snapshot, seek and lease.
3. **Deterministic numeric foundation** — project-owned elementary functions
   (`exp`, `ln`, and what derives from them) implemented with exactly-specified
   IEEE-754 operations only, plus the distribution samplers the market model will
   need (uniform, Gaussian, exponential, heavy-tailed, discrete).
4. **Market domain primitives** — instrument specification, the canonical
   **integer log-lattice** price representation (ADR-0004), tick identity and
   ordering, candle.
5. **Timeframe aggregation** — tick stream to OHLC for every supported
   timeframe, with the coherence guarantees of §14 and §17.
6. **State, snapshot and replay contract** — what an engine snapshot is, how a
   cursor advance is recorded, and how a segment of history is replayed exactly.
7. **Architecture guardrails** — automated tests that fail the build if the
   engine acquires ambient randomness, ambient time, a non-portable
   transcendental, or a dependency on a trading concept.
8. **Offline simulation runner** — enough of `@otc/sim` to drive a generator
   over a horizon and emit ticks and candles for later analysis.
9. **Planted-edge fixture corpus** — a set of generators carrying deliberate,
   tunable directional edges of known size, plus a symmetric control. This is
   what PH-2 calibrates its attack battery against; without it, a battery
   reporting "no edge found" cannot be distinguished from a broken one.

## 5. Exclusions

Explicitly **not** in this phase:

- the generative market model itself — regimes, volatility dynamics, structure,
  microstructure, personalities (PH-2);
- statistical or adversarial validation of market behaviour (PH-3);
- NestJS, HTTP, WebSocket, persistence technology, deployment (later);
- any trading, position, payout, expiration or settlement concept. Expiration
  horizons are deliberately **absent** from this phase so that INV-005 cannot be
  violated by an accidental import.

## 6. Architectural direction

### 6.1 Entropy: reproducible _and_ unpredictable

These two requirements look contradictory and are not. A **counter-based stream
cipher** satisfies both:

```
streamKey = HKDF-SHA256(masterSecret, salt, canonicalStreamLabel)
bytes(i)  = ChaCha20-keystream(streamKey, blockIndex = i)
```

- **Reproducible**: given the sealed master secret and an index, output is a pure
  function. Replay is exact and _random-access_ — history can be reconstructed
  from any point without regenerating everything before it.
- **Unpredictable**: without the key, predicting future keystream from observed
  output is the ChaCha20 distinguishing problem. Public price history therefore
  reveals nothing about future draws (INV-010).
- **Isolated**: distinct labels produce independent keys, so assets and purposes
  are cryptographically separated (INV-007's precondition), and the environment
  component of the label makes production streams unreachable from simulation.
- **Small state**: a stream's entire position is a 64-bit counter, so snapshots
  stay tiny (INV-008).

The master secret is never serialised into a snapshot; snapshots reference a key
identifier.

### 6.2 Restart must not repeat — the cursor lease

A crash between emitting a tick and persisting the cursor would, on restart,
replay random values already used, reproducing a price sequence that observers
have already seen. §22 forbids exactly this.

The kernel therefore **reserves ahead of use**: cursor positions are leased in
blocks and the lease high-water mark is persisted _before_ the draws are
consumed. On restart the engine resumes at the high-water mark, discarding any
unused remainder. Discarding is free — the stream is i.i.d. — and it converts a
correctness hazard into a bounded, recorded gap.

Because a restart advances the cursor discontinuously, exact replay needs the
jumps. A replayable history is therefore `snapshot + ordered cursor-advance
records`, which is also the audit artefact INV-009 requires.

### 6.3 Portable numerics

The kernel owns `exp` and `ln` and builds every distribution on them plus
`Math.sqrt` and exact arithmetic. Determinism is verified by test, not assumed,
and the guardrail suite fails the build if engine code reaches for a
platform-dependent `Math` function.

### 6.4 One stream, many views

A tick is the only generated artefact. Candles are a **pure fold** over ticks:
`open` is the first tick in the bucket, `high`/`low` are extremes of prices
actually visited, `close` is the last. Timeframes are epoch-aligned and their
durations form a divisibility chain, so a higher-timeframe candle is exactly the
union of the lower-timeframe candles inside it. Aggregation never consults a
generator, so INV-004 holds structurally: a timeframe cannot influence the market
because the aggregation code has no path to it.

## 7. Phase invariants

| ID     | Invariant                                                                                 | Enforced by                                    |
| ------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| PH1-I1 | Identical `(key label, cursor)` yields identical bytes on every platform and Node version | RFC 8439 vectors + cross-run determinism tests |
| PH1-I2 | Every numeric result in the kernel is bit-reproducible                                    | determinism suite over all samplers            |
| PH1-I3 | Distinct stream labels are statistically and cryptographically independent                | isolation tests                                |
| PH1-I4 | A cursor is never consumed twice across a restart                                         | lease tests including simulated crash          |
| PH1-I5 | Candle aggregation is a pure fold with no generator access                                | guardrail test on the dependency graph         |
| PH1-I6 | Higher-timeframe candles equal the exact union of contained lower-timeframe candles       | property tests across all timeframe pairs      |
| PH1-I7 | `high`/`low` are prices actually present in the tick stream                               | property tests                                 |
| PH1-I8 | The kernel contains no trading, payout, position or expiration concept                    | guardrail test on imports and identifiers      |
| PH1-I9 | The kernel never reads ambient time or ambient randomness                                 | guardrail test on source and on runtime        |

## 8. Dependencies

None beyond the bootstrapped toolchain. This phase is the root of the dependency
graph.

## 9. Initial decomposition strategy

| Subphase   | Objective                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| **PH-1.1** | Canonical time model and deterministic entropy architecture                                                       |
| **PH-1.2** | Portable numeric foundation and distribution samplers                                                             |
| **PH-1.3** | Market domain primitives, timeframe aggregation, snapshot/replay contract, guardrails, simulation runner skeleton |

Decomposition is adaptive (`GOVERNANCE.md` §16); subphases may be added if
implementation reveals the need.

## 10. Acceptance intent

PH-1 is complete when a developer can, from the repository alone:

1. derive a named random stream, draw from it, snapshot the cursor, restore it,
   and obtain a byte-identical continuation;
2. demonstrate that two different stream labels produce independent output, and
   that a simulation-environment label can never collide with a production one;
3. draw from every distribution sampler and reproduce the results exactly;
4. feed a synthetic tick stream through aggregation and get candles that satisfy
   every coherence property across every supported timeframe;
5. simulate a crash and observe that no cursor position is ever consumed twice;
6. replay a recorded segment from `snapshot + cursor records` and reproduce it
   exactly;
7. observe the guardrail suite fail when ambient time, ambient randomness, a
   non-portable transcendental, or a trading import is deliberately introduced;
8. run a generator with a deliberately planted directional edge of a chosen size
   and recover that edge from the emitted stream, which is what makes PH-2's
   battery calibratable.

## 11. Success criteria

- All phase invariants PH1-I1..PH1-I9 covered by executed, passing tests.
- Full quality gate green: format, lint, build/typecheck, unit and statistical
  suites.
- `docs/architecture/ENTROPY.md` and `docs/architecture/TIME_AND_TICKS.md` exist
  and describe what was actually built.
- ADRs persisted for the entropy architecture and the portable-numerics decision.
- Kernel throughput measured and recorded, sufficient to host many assets
  concurrently at realistic tick rates.

## 12. Expected result

`@otc/core` becomes a dependency-free, fully deterministic, fully tested kernel
that PH-2 can build a market model on without ever thinking about reproducibility
again.

## 13. Risks and unknowns

| Risk                                                               | Assessment | Mitigation                                                                                                                                                  |
| ------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChaCha20 in TypeScript too slow for many assets at high tick rates | Medium     | Benchmark early; buffer 64-byte blocks; reduced-round variant is available as a documented fallback if evidence demands it                                  |
| Own `exp`/`ln` less accurate than the platform's                   | Low impact | Accuracy target stated and tested against high-precision references; exactness matters more than the last ulp here, and the error is _identical everywhere_ |
| Cursor-lease waste at high restart frequency                       | Low        | Lease size is configurable; waste is bounded and recorded                                                                                                   |
| Millisecond time resolution too coarse for tick ordering           | Medium     | Ticks carry a per-asset monotonic sequence number, so ordering never depends on clock resolution                                                            |
| Over-engineering the kernel before the market model exists         | Real       | Scope is fixed to what the invariants require; anything the market model _might_ want is deferred to PH-2                                                   |
