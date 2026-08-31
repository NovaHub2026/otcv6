# PROJECT CONTEXT

Type: PROJECT CONTEXT
Status: Living document
Canonical for: compact, stable project facts
Not canonical for: product intent (`PROJECT_INTRODUCTION.md`), process (`GOVERNANCE.md`), lifecycle state (`CURRENT_STATE.md`)

---

## 1. Purpose

A continuous, multi-asset **synthetic OTC market engine** that powers
fixed-expiration binary-options trading. It generates its own markets; it does
not mirror, proxy, or replay any real venue.

The product succeeds when the generated markets are simultaneously:

- **plausible** — recognizable regimes, volatility dynamics, emergent structure,
  rich tick microstructure, distinct asset personalities; and
- **unexploitable** — no material, reproducible directional edge is available to
  an observer of the public price stream at 30s–15m horizons; and
- **economically blind** — price generation never depends on who profits.

## 2. Product surface (stable facts)

- Instrument type: binary / fixed-expiration event contracts.
- Supported expirations: 30s, 1m, 2m, 3m, 4m, 5m, 10m, 15m.
- Typical payout ≈ 85%; promotional assets up to 99%. Payout is a
  **trading-layer** concern and is architecturally forbidden as a price input.
- Asset families: Forex, Crypto, Commodities, Indices, ETFs; the model must
  extend to further families without redesign.
- Market operates continuously, 24/7, across restarts.

## 3. Technical foundation (stable facts)

| Concern         | Choice                                                                               |
| --------------- | ------------------------------------------------------------------------------------ |
| Runtime         | Node.js ≥ 22 (developed on 24), ESM                                                  |
| Language        | TypeScript 5.8, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| Repository      | Single repository, npm workspaces monorepo, composite TS project references          |
| Test runner     | Vitest 3, two projects: `unit` (fast) and `statistical` (slow, seeded)               |
| Lint / format   | ESLint 9 flat config with type-aware rules; Prettier                                 |
| Backend service | NestJS (scaffolded in the phase that first needs a runtime surface)                  |
| Frontend        | React + Next.js (scaffolded in the phase that first needs a UI)                      |
| CI              | GitHub Actions — quality gate on every push/PR, statistical gate on PR/dispatch      |

Durable rationale lives in `docs/decisions/`.

## 4. Package boundaries (stable facts)

| Package             | Responsibility                                                                                                                                  | May depend on                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `@otc/core`         | Deterministic kernel: canonical time, entropy/random-stream architecture, market domain primitives (price, tick, candle), timeframe aggregation | nothing                                                 |
| `@otc/engine`       | Market generation model: latent market state, regimes, volatility, structure, microstructure, asset personalities                               | `@otc/core`                                             |
| `@otc/fixtures`     | Planted-edge generators and the symmetric control: markets with known, quantified defects, used to calibrate the battery                        | `@otc/core`                                             |
| `@otc/lab`          | Adversarial predictability battery, realism metrics and the outcome/economics model                                                             | `@otc/core`                                             |
| `@otc/runtime`      | Framework-free market runtime: hosted markets that advance with the clock, venue supervision, sealed state persistence                          | `@otc/core`, `@otc/engine`                              |
| `@otc/trading`      | Contracts and deterministic settlement, computed from the published tick record alone — no keys, no engine, no latent state                     | `@otc/core`                                             |
| `@otc/distribution` | Sequence-addressed tick distribution: ordered gapless delivery, exact resumption, and the consistency contract                                  | `@otc/core`                                             |
| `@otc/chart`        | The rendering contract: reduction of a tick record to drawable columns that invent no price, hide no extreme, and synthesise no empty bar       | `@otc/core`                                             |
| `@otc/sim`          | Offline simulation runner and statistical evidence generation                                                                                   | `@otc/core`, `@otc/engine`, `@otc/fixtures`, `@otc/lab` |
| `apps/api`          | NestJS runtime: market hosting, streaming, trading, settlement, persistence                                                                     | `@otc/core`, `@otc/engine`                              |
| `apps/web`          | Next.js client: charting and trading UI                                                                                                         | HTTP/WS contracts only                                  |

**Dependency rule:** information flows _outward_ from the price core. Nothing in
`@otc/core`'s price path or `@otc/engine` may depend on trading, position,
payout, exposure or user concepts. This is INV-001 expressed as an architectural
constraint and is enforced by automated architecture tests.

## 5. Major durable constraints

1. One canonical underlying tick stream per asset; every representation derives
   from it (INV-003, INV-004, INV-005).
2. Deterministic replay: given sealed private state and a tick index, the engine
   reproduces history exactly (INV-009).
3. Cryptographic unpredictability: public history must not permit reconstruction
   of the production random stream (INV-010).
4. Continuity across restarts without repetition, jumps, or discontinuity
   (INV-008).
5. Server time is authoritative for anything settlement-relevant.
6. Statistical validation is a release gate, not a nice-to-have (INV-006).

## 6. Explicit anti-goals

Restated from `PROJECT_INTRODUCTION.md` §31 because they are load-bearing:

- not a random walk with cosmetic candles;
- not a library of scripted chart patterns;
- not a market that reacts to operator exposure;
- not a set of statistical clones differing by a volatility multiplier;
- not a per-timeframe generator;
- not a visually random but statistically exploitable system;
- not a memoryless noise generator.
