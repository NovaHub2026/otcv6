# CLAUDE.md — Coding-Agent Operational Entrypoint

Type: SUPPORTING DOCUMENTATION (operational entrypoint)
Canonical for: how an agent operates in this repository
Not canonical for: product intent, governance, project state

---

## 1. Read this first

You are operating under an autonomous-development governance model.

**Conversations are temporary. The repository is permanent.**

Read, in this order, before doing anything else:

1. `GOVERNANCE.md` — how this project operates. Authoritative and Governance-protected.
2. `PROJECT_INTRODUCTION.md` — what this project is and its foundational invariants. Authoritative.
3. `CURRENT_STATE.md` — where the project is right now and the exact next legal action.
4. `SESSION_HANDOFF.md` — what a fresh session needs to continue immediately.
5. `DOCS_INDEX.md` — where every other kind of knowledge lives.

Never treat this file, agent-local memory, or conversation history as a source of
product truth. Repository state always wins.

---

## 2. What this project is (one paragraph)

A continuous, multi-asset **synthetic OTC market engine** for fixed-expiration
binary-options trading. It must generate markets that are structurally and
statistically plausible (regimes, volatility clustering, trends, pullbacks,
emergent structure, rich tick microstructure, distinct per-asset personalities)
while remaining **resistant to exploitable directional prediction** at the
30s–15m expiration horizons, and while remaining **economically blind** — price
generation must never know whether the operator profits from the next move.

---

## 3. The ten foundational invariants

These come from `PROJECT_INTRODUCTION.md` §29 and are non-negotiable. Every
design, implementation and review decision must preserve them.

| ID      | Invariant                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| INV-001 | **Economic independence** — price generation is independent of positions, payout, exposure, and desired outcomes.    |
| INV-002 | **Shared market** — same asset, same canonical moment, same price for every observer.                                |
| INV-003 | **Single underlying stream** — ticks, candles, timeframes, entry and expiration prices all derive from one stream.   |
| INV-004 | **Timeframe observer independence** — changing the displayed timeframe never changes the market.                     |
| INV-005 | **Expiration independence** — expiration selection never changes price generation.                                   |
| INV-006 | **No deterministic exploitable directional rules.**                                                                  |
| INV-007 | **Asset differentiation** — assets have genuinely distinct statistical personalities.                                |
| INV-008 | **Continuous market state** — candle, clock and process boundaries never reset the process.                          |
| INV-009 | **Reproducible settlement** — historical outcomes are explainable and reproducible from records.                     |
| INV-010 | **Private generator state** — private randomness is never exposed in a way that enables future-price reconstruction. |

If a change would violate one of these, it is wrong, regardless of how convenient
it is.

---

## 4. Repository layout

```
GOVERNANCE.md              Authoritative process rules (Governance-protected)
PROJECT_INTRODUCTION.md    Authoritative product intent and invariants
PROJECT_CONTEXT.md         Compact stable project facts
CURRENT_STATE.md           Authoritative current lifecycle state + next legal action
SESSION_HANDOFF.md         Immediate session continuity
DOCS_INDEX.md              Documentation navigation

docs/architecture/         Current architecture (living)
docs/phases/ROADMAP.md     Dynamic roadmap (living)
docs/phases/PH-*.md        Phase Context Documents and Subphase Technical Documents
docs/decisions/ADR-*.md    Durable decisions
docs/audits/               Cycle Audit records
docs/evidence/             Recorded verification evidence referenced by approvals

packages/core              Deterministic kernel: time, entropy, market domain primitives
packages/engine            Market generation model
packages/fixtures          Planted-edge markets with known defects (calibrates the battery)
packages/lab               Adversarial predictability battery, realism metrics, economics
packages/runtime           Framework-free market runtime: hosted markets, scheduling, persistence
packages/trading           Contracts and deterministic settlement against the published record
packages/distribution      Sequence-addressed tick distribution and the consistency contract
packages/chart             The rendering contract: extreme-preserving reduction to columns
tools/sim                  Offline simulation runner and statistical evidence generator
apps/api                   NestJS runtime service hosting the catalogue continuously
apps/web                   Next.js observer frontend and trading chart
```

---

## 5. Commands

```bash
npm install            # install workspace dependencies (Node >= 22, developed on 24)

npm run build          # tsc -b across all composite projects (also full typecheck)
npm run typecheck      # same graph, no pretty output
npm run lint           # ESLint 9, type-aware
npm run format         # Prettier write
npm run format:check   # Prettier check

npx vitest run --project unit          # fast unit suite      (~90s)
npx vitest run --project statistical   # slow statistical suite (~10min)
npm test                               # both projects          (~12min)

npm run gate           # format:check + lint + build + both suites (~13min)
npm run test:cov       # coverage, both projects; excludes tools/
```

**Budget the time.** `npm run gate` runs the statistical suite and takes roughly
thirteen minutes — it has not hung. Run it in the background rather than under a
short command timeout. During subphase work use a **targeted** gate (a justified
subset — see `GOVERNANCE.md` §21); the full gate belongs at phase boundaries.

**The gate is the verification authority.** There is no hosted CI: the repository
is private and the account has no paid Actions allowance, so it was removed from
the verification model rather than left open as a blocker (ADR-0008). Nothing
outside this session runs anything, which means a claim is only as true as the
run behind it. Never write "PASSED" from a command whose exit code you did not
see — `| tail -1` discards it, and that is how a failing `npm run lint` survived
two subphase approvals in PH-4.

Coverage measures `packages/*/src` only. `tools/sim` is excluded by
`vitest.config.ts`, and a file exercised solely by statistical tests reads as
uncovered unless coverage is run over both projects.

### Test conventions

- `*.test.ts` co-located in `src/` → the fast `unit` project.
- `*.stat.test.ts` co-located in `src/` → the slow `statistical` project.
- Statistical tests must be **deterministically seeded**. A statistical assertion
  that can fail randomly is a defect, not a flake.
- **A test body that drives the engine for more than a few seconds must yield to
  the event loop.** Make the callback `async` and
  `await new Promise((r) => setImmediate(r))` every few hundred thousand ticks —
  the convention `calibrateAssetAsync`, `runBatteryAsync` and `observer.ts`
  already follow.

  The symptom when you forget is the most confusing failure this project
  produces: **every test passes and the gate still exits 1**, with
  `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` buried above a green
  summary. A long synchronous block starves the worker's own RPC channel. It cost
  PH-4 a phase gate (B-005) and recurred in PH-10.3 — the cause is fixed each
  time, but the hazard is standing and returns with every new long test.

---

## 6. Engineering rules specific to this project

1. **The price core is economically blind.** `packages/engine` and the price path
   in `packages/core` must never import, receive, or reference positions, payout,
   balances, exposure, user identity, or expiration selection. This is enforced by
   architecture tests, not by discipline alone.
2. **No `Math.random()`, no ambient `Date.now()` inside the engine.** All
   randomness comes from an explicit deterministic stream; all time comes from an
   injected clock. Both are enforced by lint/architecture tests.
3. **Determinism is testable.** Any engine state must be able to produce an
   identical continuation from a serialized snapshot.
4. **No magic numbers in the market model.** Behavioural constants live in named,
   documented parameter objects that belong to an asset personality or a model
   configuration.
5. **Evidence over assertion.** Only executed checks may be reported as passing
   (`GOVERNANCE.md` §68).

---

## 7. The autonomous loop (summary of GOVERNANCE.md)

```
CREATE SUBPHASE TECHNICAL DOCUMENT -> ACTIVATE -> IMPLEMENT -> TEST
  -> FIX IN SCOPE -> TARGETED QUALITY GATE -> DOCUMENT -> APPROVE FROM EVIDENCE
  -> next subphase, autonomously
PHASE COMPLETE -> INTEGRATED PHASE VERIFICATION -> PHASE QUALITY GATE -> APPROVED
  -> next phase, autonomously
THREE APPROVED PHASES -> STOP NORMAL DEVELOPMENT -> RUN THE CYCLE AUDIT
  -> next cycle, autonomously
```

**The loop does not stop for anyone.** Since 2026-08-31 (ADR-0008) there is no
three-phase gate: the Cycle Audit runs automatically. Development still _pauses_
at the boundary, because the pause changes the mode of work from building to
examining — but nothing is requested and nothing is waited for.

Do **not** ask the Human Owner to approve anything: not architecture, libraries,
tests, refactors, phases, subphases, the roadmap, the business model, payout
rules, or what gets built next. **Decide, then record the decision** — an ADR for
something durable, `docs/decisions/DECISION-LOG.md` for everything else worth
finding later.

Two things are still the Human Owner's (`GOVERNANCE.md` §5.1): **amendments to
Governance itself**, and **commitments that bind them outside the repository**
(legal, contractual, real-money, custody, paid services). Nothing else.

The removal of the gate raises the stakes on the audit, and the project has
measured by how much: ten independent agents found **31** material findings in
Cycle Audit 2; the authoring agent found **one** in Cycle Audit 3. An automatic
audit is worth only as much as its adversarial discipline — falsify rather than
confirm, re-execute rather than read, plant defects against every guard
(`GOVERNANCE.md` §28.1).

Human commands: `START`, `GUARDAR`, `PARAR`, and `EJECUTA` — now optional, and
meaning only "run a Cycle Audit now" (`GOVERNANCE.md` §59).

---

## 8. Git

- `main` is trusted integrated state.
- Default branch granularity is **phase-level**: `feature/ph-N-<slug>`.
- Commits are coherent technical changes with conventional-commit subjects.
- Update `CURRENT_STATE.md` and `SESSION_HANDOFF.md` before closing a session.

---

## 9. What the project has established

Cycle 1 settled the question the whole product rests on, and three results are
worth knowing before changing anything in the engine.

**Anti-predictability is a theorem, not a calibration.** Increments are
`sign × magnitude` where the sign is an independent fair coin and the magnitude
engine is structurally unable to observe a sign, a price, or anything derived
from them. Flipping every future sign is then a measure-preserving involution, so
`P(up) = P(down)` exactly, at every horizon, under every public conditioning
(ADR-0003).

**The most dangerous change is the one that looks like an improvement.** The
leverage effect — volatility responding to the _signed_ return — is one of the
most robust stylized facts in real markets, arrives as a three-line change,
leaves the process an exact martingale, and is worth **2.9 percentage points** of
directional edge. Run the **mirror test** before believing any change to the
magnitude or timing path is safe.

**A conventional attack battery cannot see a level-anchored leak.** Measured:
translation-invariant and temporal attack families — everything a normal
validation suite contains — return _clean_ on an engine whose volatility is keyed
to the price level, across 354 hypotheses. That mechanism is exactly what a
designer reaches for when asked to make support and resistance feel real.

### Before changing the engine

```bash
npx vitest run --project unit packages/engine     # includes the mirror test
npx vitest run --project statistical              # includes the full battery
```

The mirror test is fast and exact; the battery is slow and statistical. A change
that passes the battery but fails the mirror test is broken.
