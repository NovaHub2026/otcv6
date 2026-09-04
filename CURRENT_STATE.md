# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-09-04

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Active development cycle         | Cycle 9 — opened when Cycle Audit 8 closed                                                                    |
| Approved phases in current cycle | **0 of 3** — Cycle 8 approved PH-22, PH-23 and PH-24, and its audit is closed                                 |
| Cycle Audit state                | **008 closed** — 86 claims, 60 confirmed, 26 refuted; all 60 resolved                                         |
| Last Cycle Audit                 | [Cycle Audit 008](docs/audits/CYCLE-AUDIT-008.md) — 2026-09-04, eight independent auditors, one worktree each |

## Phase and subphase

| Field                  | Value                                            |
| ---------------------- | ------------------------------------------------ |
| Active phase           | **PH-26 — The catalogue of thirty**              |
| Phase lifecycle        | ACTIVE                                           |
| Active subphase        | PH-26.2 — the thirty personalities               |
| Subphase lifecycle     | ACTIVE                                           |
| Last approved phase    | PH-24 — The Lab's controls: applying a selection |
| Last approved subphase | PH-26.1 — The suites scale                       |

**PH-24 is APPROVED, and with it Cycle 8's third phase: the Cycle Audit runs
now (§28).** Twenty-four subphases, twenty-three of which stand — PH-24.23 was
approved and then reverted at the Human Owner's request. The Lab's mechanism
became controls an operator can hold: a close on a real candle, exact or on a
side of a mark; presets, positions and sixteen scenarios; a push in the
market's own distance unit at a chosen pace; a sustained direction that ends by
itself after two minutes; a control panel with the chart at three quarters and
the instrument behind a link. The engine was recalibrated inside the phase
(PH-24.17): three to four times as many ticks per candle at the same
dispersion. On 2026-09-04 the Human Owner lifted the pause on the merge, hosted
CI and this audit (`DECISION-LOG.md`).

PH-23.5 closed the first item PH-23 §10 left open — the Lab now has a screen in
the panel, behind a menu entry marked `SIM`. Building it found three defects
that reading the API could not: a `clean` predictability verdict resting on two
hypotheses out of eight hundred, a realism verdict that flipped between forks of
the same market, and a lattice index printed under the word `price`.

PH-23.6 closed the two defects the Lab specification audit found by execution
([LAB-SPECIFICATION-AUDIT-001](docs/audits/LAB-SPECIFICATION-AUDIT-001.md)): a
shock "intervention" the signs could not select, and a candle close and a
settlement price that name different ticks when the engine prints on a boundary
millisecond (ADR-0017). The audit's other six findings are the next phases: a
Lab with a correct mechanism and no controls.

## Cycle 1 result

The cycle existed to settle one question: can a synthetic market be
simultaneously plausible and provably unexploitable, with executed evidence for
both?

**It can.** On 24 million ticks spanning 327 simulated days, one asset is:

|                              | Result                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unexploitable                | clean verdict across ~570 hypotheses and all four attack feature kinds                                                                                                                                          |
| At a resolution that matters | 30-second single-test detection floor 0.221pp, finer than the 0.2513pp margin the 99% payout implies; the gate's own 50%-power figure at 30 s is 0.315pp, and `VALIDATION.md` says which claim is which (a4-01) |
| Plausible                    | 15/15 realism metrics, bands unchanged since the commit that introduced the engine (906e398)                                                                                                                    |
| Structurally guaranteed      | mirror test passes with zero divergences                                                                                                                                                                        |

## Blockers

**None, and none are possible from the Human side.** As of 2026-08-31 the
three-phase gate is removed and every code and product decision is the
Development Agent's ([ADR-0008](docs/decisions/ADR-0008-full-delegation.md)).
Development neither stops nor waits.

## Decision authority

Delegated in full: product purpose, business model, payout and settlement rules,
architecture, roadmap, and what is not built. Decisions are **recorded, not
escalated** — an ADR for something durable,
[`DECISION-LOG.md`](docs/decisions/DECISION-LOG.md) for everything else worth
finding later.

Two things remain the Human Owner's (`GOVERNANCE.md` §5.1): **amendments to
Governance itself**, and **commitments that bind them outside the repository**
(legal, contractual, real-money, custody, paid services).

**At-the-money settlement** was decided by the Human Owner before delegation and
is recorded in
[ADR-0007](docs/decisions/ADR-0007-at-the-money-settlement.md): a tie is refunded.
The realised at-the-money rate on the published lattice is 0.42%-0.48% per asset
(`MEASURED_LATTICE_TIE_RATES`), re-measured in PH-24.17 over 12 replicates on one
stream family after the recalibration moved every rate.

## Verification standing

Two layers, and neither substitutes for the other:

- `npm run gate` — the authority for an approval, because it is what an agent can
  run before recording one.
- **Hosted CI** — required corroboration since
  [ADR-0009](docs/decisions/ADR-0009-hosted-ci-reinstated.md). The repository is
  public, so Actions is free, and both the quality gate and the statistical gate
  run on every push to `main`. A red CI on a green local gate is a finding about
  the gate, which is exactly how B-011 was found.

Build precedes lint, and that ordering is load-bearing: on a clean checkout the
type-aware rules resolve workspace types through emitted declarations, so linting
first reports 46 unresolved-type errors. Every `GATE_EXIT=0` recorded through
PH-10 was conditional on a previous build's `dist/` being present.

### Hosted CI, honestly

Found while closing Cycle Audit 8, and carried forward by nobody until then:

| Commit    | What it was              | Hosted CI                                                                                                                    |
| --------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `8f62e4b` | PH-23 approved           | green — the last phase approval CI has corroborated                                                                          |
| `d1aa02c` | **PH-24 merge, audited** | **red** — Quality Gate failed on unit; Statistical cancelled at its ceiling                                                  |
| `9e44ffb` | audit fix                | **red** — the meta-audit's own mutation anchor had gone missing from `vitest.config.ts`, so one of its mutations was a no-op |
| `fa362e4` | audit fix                | green                                                                                                                        |

Two things follow, and neither is comfortable. **No commit carrying a phase
approval has been corroborated by hosted CI since PH-23.** And the `9e44ffb`
failure was not a timeout but a guard doing its job: the meta-audit reported
that one of its own mutations had stopped mutating anything — "which is exactly
how a meta-audit becomes a formality". Both causes are fixed (the job ceiling is
180 minutes and the anchor is repaired; the file re-runs 35 tests, exit 0), but
the record should say that the audited commit itself was never green.

## Verification state

Executed on `main` with the Cycle Audit 8 closure in the working tree,
2026-09-04, with `OTC_REQUIRE_BROWSER=1` so a missing Chromium is a failure
rather than a skip — **zero tests reported skipped in either layer**.

```
npm run gate  ->  GATE_EXIT=0
  format:check     0
  build            0
  typecheck:web    0
  typecheck:config 0
  lint             0
  unit         133 files, 2,661 tests          31.3s
  coverage     133 files, 2,661 tests         103.9s   (floors enforced)
  statistical   43 files,   290 tests       4,326.2s
GATE COMPLETE: unit, coverage floors and statistical suites all ran, with a real browser
```

Two numbers in that block are worth reading against the last one recorded. The
unit project grew from 90 files to 133 and from 2,203 tests to 2,661 across
PH-22, PH-23, PH-24 and this audit, and it still runs in half a minute. The
statistical suite is 4,326 s — 72 minutes, against 3,386 s on 2026-09-02, which
is PH-24.17's tick recalibration showing up as wall clock in every suite that
samples in ticks.

The gate was run three times over this tree and only the third is reported. The
first two were stopped deliberately: a gate that overlaps an edit measures a tree
that never existed, and both times new work arrived — the two findings §5 had
left tracked, and the roadmap repair — that would have made the run a claim about
the wrong thing.

## Relevant records

| Kind     | Reference                                                                                                                                                                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                                                                                                                                                                                                                                                                              |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                                                                                                                                                                                                                                                                          |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED)                                                                                                                                                                                                                                                           |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)                                                                                                                                                                                                                                                                      |
| ADR-0005 | A multifractal cascade as the volatility process (APPROVED)                                                                                                                                                                                                                                                                            |
| ADR-0006 | A layered sign-blind market model (APPROVED)                                                                                                                                                                                                                                                                                           |
| ADR-0007 | At-the-money settlement: a tie is refunded (APPROVED, Human Owner)                                                                                                                                                                                                                                                                     |
| ADR-0008 | Full delegation: automatic audits, autonomous decisions (APPROVED)                                                                                                                                                                                                                                                                     |
| ADR-0009 | Hosted CI reinstated after the repository was made public (APPROVED)                                                                                                                                                                                                                                                                   |
| ADR-0010 | The catch-up bound: no unobserved burst may span a contract (APPROVED)                                                                                                                                                                                                                                                                 |
| ADR-0011 | Subagents are an engineering decision; audits use independent ones (APPROVED)                                                                                                                                                                                                                                                          |
| ADR-0012 | Generation is single-writer per asset; leadership is a fenced lease (APPROVED)                                                                                                                                                                                                                                                         |
| ADR-0013 | Governance says what is true (PROPOSED — the Human Owner's to apply, Issue #14)                                                                                                                                                                                                                                                        |
| ADR-0014 | Chart library and repository licence: Lightweight Charts, Apache-2.0 (APPROVED)                                                                                                                                                                                                                                                        |
| ADR-0015 | The Lab may amend the rules that describe the system, not the guarantees it validates (APPROVED, Human Owner)                                                                                                                                                                                                                          |
| ADR-0016 | Server-sent events stay; the cost is a syscall and every transport pays it (APPROVED)                                                                                                                                                                                                                                                  |
| ADR-0017 | The expiry price is the tick at or before expiry; a candle is half-open; settlement is authoritative (APPROVED)                                                                                                                                                                                                                        |
| ADR-0018 | One engine per deployment; a Lab-composed process is the engine in simulation mode; production is never Lab-composed (APPROVED)                                                                                                                                                                                                        |
| Backlog  | [GitHub Issues](https://github.com/NovaHub2026/otcv6/issues) #1–#22; #1, #13 and #15 closed. Two remain the Human Owner's: #3 and #14                                                                                                                                                                                                  |
| Roadmap  | `docs/phases/ROADMAP.md`                                                                                                                                                                                                                                                                                                               |
| Branch   | `main`, ending at the PH-24 merge `d1aa02c` and the Cycle Audit 8 fixes after it; before it PH-23 at `8f62e4b`, Cycle Audit 7 and PH-22.1 at `f07e71d`, PH-21 at `3e4ec7e`. PH-21.1 sits under two hashes (`3a5f0a5`, `36bbf89`) because the branch was merged rather than rebased; both are ancestors and the duplication is cosmetic |
| Audit    | [`CYCLE-AUDIT-008.md`](docs/audits/CYCLE-AUDIT-008.md) — 86 claims, 60 confirmed, all resolved, eight independent auditors. Before it, [`OUT-OF-BAND-AUDIT-001.md`](docs/audits/OUT-OF-BAND-AUDIT-001.md) — 83 findings, 6 critical, seven auditors                                                                                    |

---

## EXACT NEXT LEGAL ACTION

**PH-26.2 — the thirty personalities: seats, drawn under seed, checked as
archetypes are.**

PH-26.1 is approved: the three heavy statistical suites measure a fixed,
stratified sample of five and say what they did not measure, the six id-keyed
tables refuse by name, the differentiation thresholds are multiples of chance
with the control sized to the catalogue, and at five assets every verdict is the
one it was (`TARGETED_GATE_EXIT=0`, 134 unit files / 2,675 tests, three
statistical files / 33 tests in 529 s).

PH-26.2 records the thirty **seats** — a narrowing of each asset's archetype,
from which its personality is drawn under a stream seeded by its own id — and
the guard that checks every seat exactly the way `families.test.ts` checks every
archetype: inside its parent on every trait, feasible at its worst corner, its
budget departure declared, and no two seats close enough for the
differentiation check to refuse a draw. Nothing is added to `ASSET_ARCHETYPES`
and no family is added: both are the Human Owner's decisions. The thirty ids
carry `-otc`; `eurusd`, `gbpjpy`, `btcusd`, `spx` and `xauusd` are retired and
never reused, because a checkpoint carries no personality fingerprint and a
state file written by the old personality must not be resumable by the new one
under the same name.

This section named **PH-22.1** — a subphase approved and merged two phases ago —
until Cycle Audit 8 (a7) found it. A fresh session following `CLAUDE.md` §1 read
it, and the same document's own table said `Active phase: none`, so there was no
way to tell which half to believe. The guard that exists to prevent exactly that
passed on an incidental mention of a past audit elsewhere in the file; it reads
the stated action now.
