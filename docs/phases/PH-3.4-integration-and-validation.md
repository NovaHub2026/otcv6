# PH-3.4 — Canonical engine, restart continuity, and phase validation

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-3.4
Parent phase: PH-3 — Core Generative Market Process Under Continuous Falsification
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Assemble the layers into one canonical engine with a single entry point, prove
continuity across a restart seam, and run the phase's full acceptance at a
sensitivity fine enough to mean something.

## 2. Problem

Three gaps remain between "the pieces work" and "the phase is done".

**There is no canonical engine.** Every test assembles its own stack from five
components and five streams. PH-4 will instantiate many assets and PH-5 will host
them; both need one function that produces a correctly-wired engine, and a
configuration object that a personality can vary.

**Restart continuity is unproven at the engine level.** PH-1 proved the substrate
can replay across a seam, and PH-3.1 proved the engine can restore from a
snapshot. Nobody has yet crashed a running engine, resumed it under a cursor
lease, and checked that the resulting stream is continuous in price,
non-repeating in sequence, and free of a detectable discontinuity. That is
INV-008, and it is the invariant most likely to be quietly false.

**The validation so far is under-powered.** Every PH-3 run used four million
ticks at a five-second mean interval — 232 simulated days, giving a 30-second
detection floor of about 0.30 percentage points. The threshold the engine must
clear at the promotional payout is 0.25. A clean verdict at a floor coarser than
the threshold does not answer the question the phase exists to answer.

## 3. Scope

### In scope

- **`createMarketEngine`** — one factory producing the canonical stack from a
  single configuration object, with every stream derived and named.
- **`MarketEngineConfig`** — the complete parameter set, ready for PH-4 to vary
  per personality.
- **Restart seam test** — generate, snapshot, discard, resume from a leased
  cursor, and verify continuity, non-repetition and the absence of a detectable
  seam.
- **Phase acceptance run** — the full validation at a sample size that reaches a
  detection floor below the 0.2513pp threshold at the shortest horizon.
- `docs/architecture/MARKET_MODEL.md` and an ADR recording the assembled model.

### Out of scope

- Personalities and multiple assets (PH-4).
- Persistence technology and the runtime host (PH-5). The seam test simulates a
  restart in-process; the durable store arrives with the runtime.

## 4. Contracts

```ts
export interface MarketEngineConfig {
  readonly instrument: InstrumentSpec;
  readonly baseVolatility: number;
  readonly cascade: CascadeConfig;
  readonly regimes: RegimeConfig;
  readonly structure: StructureConfig;
  readonly arrival: HawkesConfig;
  readonly durationCoupling: number;
}

export const DEFAULT_ENGINE_CONFIG: MarketEngineConfig;

export function createMarketEngine(options: {
  config: MarketEngineConfig;
  keyring: MasterKeyring;
  environment: Environment;
  keyEpoch?: number;
  start: EngineStart;
  maxTicks?: number;
  cursors?: Readonly<Record<string, string>>;
}): MarketEngine;
```

The factory derives every stream from the keyring under a label containing the
environment, the instrument and the purpose, so two assets are cryptographically
isolated and a simulation can never collide with production.

## 5. The restart seam

The sequence the test exercises, matching what a runtime will do:

1. run, persisting a cursor lease high-water mark ahead of use;
2. snapshot;
3. simulate a crash — discard the engine, keep only the snapshot and the
   persisted high-water mark;
4. resume: seek every stream to the **leased** position, not the snapshotted one,
   so no keystream position is consumed twice;
5. continue.

The properties asserted are those §22 names: the price is continuous across the
seam, the sequence does not repeat, no keystream position is reused, and the
resulting series shows no discontinuity that a targeted test can find.

## 6. Acceptance criteria

| #   | Criterion                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------- |
| L1  | `createMarketEngine` produces a working engine from configuration alone, with every stream named in its snapshot        |
| L2  | Two instruments under the same keyring produce independent streams                                                      |
| L3  | A simulation-environment engine cannot collide with a production one                                                    |
| L4  | Across a restart seam: price is continuous, sequence does not repeat, and no keystream position is consumed twice       |
| L5  | The seam is not detectable: return statistics either side are consistent, and no attack family fires on the seam region |
| L6  | Phase acceptance run: attack battery clean at a 30-second detection floor **below 0.2513pp**                            |
| L7  | Realism plausible on the same run                                                                                       |
| L8  | The mirror test passes on the canonical engine                                                                          |
| L9  | Throughput recorded                                                                                                     |

## 7. Verification requirements

- Unit tests for the factory, stream isolation and configuration validation.
- A seam test covering L4 and L5.
- A phase acceptance statistical suite covering L6–L9.
- `npm run build`, `npm run lint`, `npm run format:check`.

## 8. Dependencies

PH-3.1, PH-3.2, PH-3.3.

## 9. Expected result

One function that produces a market which is continuous through restarts, clean
under attack at a sensitivity finer than the product's own margin, and plausible
on every realism metric.

---

## 10. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

### Phase acceptance run

24 million ticks spanning **327 simulated days**:

|                                     | Result                                                      |
| ----------------------------------- | ----------------------------------------------------------- |
| Attack battery                      | **clean** — all four feature kinds                          |
| Detection floor at 30s              | **0.217pp**, finer than the 0.2513pp the 99% payout implies |
| Realism                             | **15/15 metrics**                                           |
| Two-sided wick fraction             | 0.6449                                                      |
| Mirror test on the canonical engine | zero divergences                                            |
| Generation                          | 0.41M ticks/s                                               |

### Acceptance criteria

| #   | Criterion                                            | Evidence                                                                               |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| L1  | Factory produces a working engine from configuration | every stream named in the snapshot; reproducible; honours a tick limit                 |
| L2  | Two instruments are independent                      | distinct keys per label; series share no structure                                     |
| L3  | Simulation cannot collide with production            | a test keyring refuses a production label outright                                     |
| L4  | No keystream position reused across a seam           | the resumed engine starts strictly beyond the crashed one's position, on every stream  |
| L5  | The seam is not detectable                           | price continuous, sequence non-repeating, volatility statistics consistent either side |
| L6  | Clean at a floor below 0.2513pp                      | 0.217pp at 30s                                                                         |
| L7  | Realism plausible on the same run                    | 15/15                                                                                  |
| L8  | Mirror test on the canonical engine                  | zero divergences                                                                       |
| L9  | Throughput recorded                                  | 0.41M ticks/s                                                                          |

### Two defects found by measurement

**The arrival process never decayed.** The engine passed `intervalMs: 0` to the
arrival model, so a self-exciting process decayed its excitation over zero
elapsed time — it only ever accumulated, until it hit its safety clamp. The
realized tick rate was three times the configured one and nothing failed, because
the unit tests fed a context shape the engine never produced.

The fix was a type: an arrival model is deciding the interval about to elapse, so
the only duration it can know is the one already elapsed. `ArrivalContext` now
says that, and the ambiguity that allowed the bug is gone.

**The tick rate was a product decision nobody had made.** With the decay fixed,
the mean interval settled at 5.75 seconds — which means a 30-second contract
resolves on about five ticks. Two-sided wick fraction fell to 0.282 against a
floor of 0.30, and that metric was detecting a real product problem rather than a
cosmetic one. The rate is now about one second, making a 30-second contract
resolve on roughly thirty ticks, and the metric reads 0.645.

### A test that was invalid by design

`shortens intervals after large magnitudes` compared a market at constant
magnitude 40 against one at constant magnitude 1. Once excitation was normalised
against a running average, that comparison had no meaning: a market that is quiet
in absolute terms should not tick slowly forever. The test now measures what the
model actually claims — that a **burst above recent activity** shortens intervals
— and a second test asserts the property that replaced the old one: two markets
differing only in absolute scale tick at the same rate.

### Verification executed

`npm run format:check`, `npm run lint`, `npm run build`, `npx vitest run` — all
passed. Hosted CI has not executed: no remote.
