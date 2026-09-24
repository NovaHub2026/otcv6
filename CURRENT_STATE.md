# CURRENT STATE

Type: CURRENT STATE
Status: Authoritative record of current project state
Last synchronized: 2026-09-24

> This document is not a diary. It records where the project is **now** and what
> the **exact next legal action** is. History lives in Git, phase documents and
> audit records.

---

## Development cycle

| Field                            | Value                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active development cycle         | Cycle 13 — **1 of 3** phases approved (PH-37). Cycle 12 is audited and closed; Cycle 11 stays open                                                         |
| Approved phases in current cycle | **1 of 3** — PH-37. Cycle Audit 12 has run, gated green and merged                                                                                         |
| Cycle Audit state                | **012 closed** — 15 findings, 13 fixed with a guard each, 2 carried as phases; gated green on `audit/ca12-fixes` at `5edcc85` and merged                   |
| Last Cycle Audit                 | [Cycle Audit 012](docs/audits/CYCLE-AUDIT-012.md) — 2026-09-24, eight independent auditors, one worktree each, every finding put to an independent refuter |

## Phase and subphase

| Field                  | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Active phase           | PH-38 — The frame a stored price counts in                           |
| Phase lifecycle        | ACTIVE                                                               |
| Active subphase        | none — PH-38.1 is the next to open                                   |
| Subphase lifecycle     | none                                                                 |
| Last approved phase    | PH-37 — The staircase: a price you can read tick by tick             |
| Last approved subphase | PH-37.2 — The lattice by refund ceiling, and the thirty assets on it |

**Cycle 12 is audited and closed.** PH-34 (the market's tempo follows its
state), PH-35 (the level the market runs at) and PH-36 (a stalled market
reopens itself) are approved and merged, and `v2.2.0`, `v2.3.0` and `v2.3.1`
are tagged on the commits hosted CI corroborated. Cycle Audit 12 ran one phase
late, on the Human Owner's direction of 2026-09-23 and on `main` rather than on
the superseded commit, and the audit record says both things rather than
excusing them. Its fixes are merged; the two findings it could not close as
patches are Cycle 13's next phase and the one after it.

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

## PH-34 — the market's tempo follows its state

The Human Owner's second phase from operating the engine, in their broker, on
2026-09-22: ticks by character and regime (40% fewer on average), regimes that
last like a market's and move as a ladder, calm 20% above the real market's
typical movement with a floor under it. Branch `feature/ph-34-the-markets-tempo`
in `~/.otc-ph34`. PH-32 and PH-33 wait for it: their long measurements are of
the catalogue this phase replaces.

## A defect in the released `v2.0.0`, fixed ahead of the phase work

On 2026-09-22 the Human Owner reported their broker's `v2.0.0` deployment
drawing one figure repeatedly on a five-minute chart, on all thirty assets.
Measured: every genesis took key epoch 0, so under one secret a market started
from an empty state directory was the previous such market, tick for tick —
two production processes twenty seconds apart published the same thirty ticks.
Seams from one restored backup had the same defect. Fixed on
`fix/fresh-genesis-key` off `main` ([ADR-0019](docs/decisions/ADR-0019-a-keystream-is-keyed-by-when-it-starts.md)):
every keystream is keyed by the instant it starts. Released from `main` as
`v2.1.0` once hosted CI is green on the merge (`DECISION-LOG.md`, 2026-09-22).
PH-32 and PH-33 take it when they next merge `main`.

## Cycle 1 result

The cycle existed to settle one question: can a synthetic market be
simultaneously plausible and provably unexploitable, with executed evidence for
both?

**It can.** On 24 million ticks spanning 327 simulated days, one asset is:

|                              | Result                                                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unexploitable                | clean verdict across ~570 hypotheses and all four attack feature kinds                                                                                                                                                                                                      |
| At a resolution that matters | 30-second single-test detection floor 0.219pp (PH-37's catalogue; 0.215pp on PH-35's, 0.223pp on PH-34's), finer than the 0.2513pp margin the 99% payout implies; the gate's own 50%-power figure at 30 s is 0.312pp, and `VALIDATION.md` says which claim is which (a4-01) |
| Plausible                    | 15/15 realism metrics, bands unchanged since the commit that introduced the engine (906e398)                                                                                                                                                                                |
| Structurally guaranteed      | mirror test passes with zero divergences                                                                                                                                                                                                                                    |

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
The realised at-the-money rate on the published lattice is **0.167%-0.435%**
per asset (`MEASURED_LATTICE_TIE_RATES`), re-measured in PH-35 over 12
replicates per asset on 2026-09-23. It follows how far the market travels over
a contract on the lattice PH-26.3 recorded — a recalibration keeps a market's
lattice: 0.42%-0.53% before PH-34, 0.085%-0.267% at PH-34's 1.7× level, and
back to these when PH-35 put the market at the real instrument's own level.

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

| Commit    | What it was                                      | Hosted CI                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8f62e4b` | PH-23 approved                                   | green — the last phase approval CI has corroborated                                                                                                                                                                                                                                                                                                                                                                           |
| `d1aa02c` | **PH-24 merge, audited**                         | **red** — Quality Gate failed on unit; Statistical cancelled at its ceiling                                                                                                                                                                                                                                                                                                                                                   |
| `9e44ffb` | audit fix                                        | **red** — the meta-audit's own mutation anchor had gone missing from `vitest.config.ts`, so one of its mutations was a no-op                                                                                                                                                                                                                                                                                                  |
| `fa362e4` | audit fix                                        | green                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `c4757c5` | **PH-26 merge**                                  | **red** — Quality Gate on one unit test (`seats.test.ts`, 26.7 s hosted against a 20 s ceiling); Statistical Gate green, 88 min                                                                                                                                                                                                                                                                                               |
| `7f03abe` | **PH-25 merge**                                  | **red on both** — Quality Gate on the same test; Statistical Gate on `guardrailMetaAudit`, because the merged state documents already failed `stateConsistency` (the handoff named PH-25 active after the roadmap approved it)                                                                                                                                                                                                |
| `f2bab68` | PH-25 state fix                                  | Quality **red** (same test); Statistical **green**, 88 min                                                                                                                                                                                                                                                                                                                                                                    |
| `e8ed2ae` | **PH-27 merge, audited**                         | **green on both** — Quality Gate 3 min (with the `seats.test.ts` fix), Statistical Gate 112 min; the first phase-approval commit hosted CI has corroborated since PH-23                                                                                                                                                                                                                                                       |
| `45187d9` | **Cycle Audit 9 merge**                          | Quality **red** on one guard — `documentation.test.ts` holds historical documents to git's history and hosted CI checks out one commit, so four documents naming a retired test file failed on a clean tree; Statistical **green**, 120 min. Fixed in PH-28.3: the guard reads a shallow clone as no history, and CI checks out the history                                                                                   |
| `669661e` | Cycle 10 plan (docs)                             | the same **red** Quality Gate, the same guard; nothing else ran differently                                                                                                                                                                                                                                                                                                                                                   |
| `fd17ec0` | **PH-28 merge**                                  | **green on both** — Quality Gate 9 min, Statistical Gate 94 min; the shallow-clone fix landed with it                                                                                                                                                                                                                                                                                                                         |
| `668efa9` | **PH-29 merge**                                  | **green on both** — Quality Gate and Statistical Gate; the second consecutive phase merge corroborated                                                                                                                                                                                                                                                                                                                        |
| `353f101` | **PH-30 merge, `v1.0.0`**                        | Quality Gate **green** (9 min); Statistical Gate **red** at 2h3m on one browser test — `apps/web/src/lab.stat.test.ts`, "opens a CALL, applies WIN by minimum distance, and settlement agrees", which read `empate 1.1599862 · neto 0 — NO COINCIDE` where the armed close was a win. The local phase gate on the same code was green, so this is a finding about the gate, and it is Cycle Audit 10's (see the audit record) |
| `aeefef1` | **Cycle Audit 10 merge, first wave**             | Quality **green**; Statistical **red** at 2h0m on `servedRecord.stat.test.ts` — the a5-02 fix opens the listener before the markets resume, so `/health` answering no longer implies a market to read, and this suite proceeded into a venue that had published one tick. Six sibling suites had been corrected for it; this one was missed. Fixed in `73ae2c9`                                                               |
| `e97d12d` | **Cycle Audit 10 merge, second wave — `v2.0.0`** | **green on both** — Quality Gate 8 min, Statistical Gate 1h57m. The tag was cut on this commit _after_ the run, which is what PH-30 §3 asked for and what `v1.0.0` did not do                                                                                                                                                                                                                                                 |

**The release tag was pushed before its CI run finished, and the run went red.**
`v1.0.0` was tagged and pushed at 15:54Z on 2026-09-06; the Statistical Gate on
that push failed at 17:57Z on the Lab's browser suite, on a real defect in how
a position's entry price was read. `RELEASE-1.0.0.md` was written claiming
corroboration it did not yet have, and is corrected; the tag is superseded
rather than moved (`DECISION-LOG.md`, 2026-09-06).

**`v2.0.0` is cut the way the rule says.** It tags `e97d12d`, the commit whose
hosted run was green on both jobs, after the fact rather than before it. Both
of this audit's red hosted runs were findings about the gate, and both are
fixed rather than explained away.

Two things follow, and neither is comfortable. **No commit carrying a phase
approval has been corroborated by hosted CI since PH-23.** And the `9e44ffb`
failure was not a timeout but a guard doing its job: the meta-audit reported
that one of its own mutations had stopped mutating anything — "which is exactly
how a meta-audit becomes a formality". Both causes are fixed (the job ceiling is
180 minutes and the anchor is repaired; the file re-runs 35 tests, exit 0), but
the record should say that the audited commit itself was never green.

## Verification state

Executed on `audit/ca12-fixes` at `5edcc85`, 2026-09-24, with
`OTC_REQUIRE_BROWSER=1` and the browser prefix — the Cycle Audit 12 gate:

```
npm run gate  ->  GATE_EXIT=0        (19:12-20:21Z)
  unit         173 files, 3,540 tests         142.1s
  coverage     173 files, 3,540 tests         317.0s   (floors enforced)
  statistical   47 files,   411 tests       3,622.7s
```

The run before it was **red**, and the cause was the host rather than the code.
`commitmentsFile.test.ts`'s memory bound — it signs a 5.9 MB chain and verifies
it — timed out at its 20 s ceiling, while the unit suite as a whole took
183.5 s. Alone on the same tree that test takes **4.2–4.4 s over three runs**,
and the only two commits between that tree and the last green unit run are
documentation. The Human Owner's engine, Lab and panel had been restarted eight
minutes before the gate started, and the box was already 710 MB into swap.
Recorded rather than quietly repeated, and with one number worth carrying
forward: **the unit leg is 142 s on this host now, not the 33–38 s that four
consecutive gates measured.** The suite's own file parallelism is what a 7.8 GB
box has left to give, and the most expensive test in it sits closest to a
ceiling.

## Relevant records

| Kind     | Reference                                                                                                                                                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0001 | Repository, toolchain and package architecture (APPROVED)                                                                                                                                                                                                                                                                        |
| ADR-0002 | Deterministic entropy architecture (APPROVED)                                                                                                                                                                                                                                                                                    |
| ADR-0003 | Conditional sign symmetry as the anti-predictability architecture (APPROVED)                                                                                                                                                                                                                                                     |
| ADR-0004 | Canonical price representation: an integer log lattice (APPROVED)                                                                                                                                                                                                                                                                |
| ADR-0005 | A multifractal cascade as the volatility process (APPROVED)                                                                                                                                                                                                                                                                      |
| ADR-0006 | A layered sign-blind market model (APPROVED)                                                                                                                                                                                                                                                                                     |
| ADR-0007 | At-the-money settlement: a tie is refunded (APPROVED, Human Owner)                                                                                                                                                                                                                                                               |
| ADR-0008 | Full delegation: automatic audits, autonomous decisions (APPROVED)                                                                                                                                                                                                                                                               |
| ADR-0009 | Hosted CI reinstated after the repository was made public (APPROVED)                                                                                                                                                                                                                                                             |
| ADR-0010 | The catch-up bound: no unobserved burst may span a contract (APPROVED)                                                                                                                                                                                                                                                           |
| ADR-0011 | Subagents are an engineering decision; audits use independent ones (APPROVED)                                                                                                                                                                                                                                                    |
| ADR-0012 | Generation is single-writer per asset; leadership is a fenced lease (APPROVED)                                                                                                                                                                                                                                                   |
| ADR-0013 | Governance says what is true (PROPOSED — the Human Owner's to apply, Issue #14)                                                                                                                                                                                                                                                  |
| ADR-0014 | Chart library and repository licence: Lightweight Charts, Apache-2.0 (APPROVED)                                                                                                                                                                                                                                                  |
| ADR-0015 | The Lab may amend the rules that describe the system, not the guarantees it validates (APPROVED, Human Owner)                                                                                                                                                                                                                    |
| ADR-0016 | Server-sent events stay; the cost is a syscall and every transport pays it (APPROVED)                                                                                                                                                                                                                                            |
| ADR-0017 | The expiry price is the tick at or before expiry; a candle is half-open; settlement is authoritative (APPROVED)                                                                                                                                                                                                                  |
| ADR-0018 | One engine per deployment; a Lab-composed process is the engine in simulation mode; production is never Lab-composed (APPROVED)                                                                                                                                                                                                  |
| ADR-0019 | A keystream is keyed by the instant it starts: a fresh genesis no longer replays the previous one (APPROVED)                                                                                                                                                                                                                     |
| ADR-0020 | A market past its catch-up bound reopens itself at the clock as a recorded seam, instead of staying dead until an operator restarts the process (APPROVED)                                                                                                                                                                       |
| Backlog  | [GitHub Issues](https://github.com/NovaHub2026/otcv6/issues) #1–#22; closed: #1, #2, #4, #5, #6, #7, #8, #10, #11, #12, #13, #15, #16, #17, #18, #19, #20, #21, #22. #9 (the multi-node composition) is deferred by the Cycle 10 plan; #3 and #14 are the Human Owner's (Governance amendments). `docs/BACKLOG.md` mirrors them. |
| Roadmap  | `docs/phases/ROADMAP.md`                                                                                                                                                                                                                                                                                                         |
| Branch   | `audit/ca10-fixes` off `main` at the PH-30 merge `353f101` (tagged `v1.0.0`, Cycle 10 complete); before it the PH-29 merge `668efa9`, the PH-28 merge `fd17ec0` and the PH-27 merge `e8ed2ae` (Cycle 9 complete)                                                                                                                 |
| Audit    | [`CYCLE-AUDIT-010.md`](docs/audits/CYCLE-AUDIT-010.md) — the closing cycle's audit, eight independent auditors in a worktree each, every finding put to an independent refuter; [`CYCLE-AUDIT-009.md`](docs/audits/CYCLE-AUDIT-009.md) before it (64 claims, 62 confirmed, 61 resolved, one carried)                             |

---

## EXACT NEXT LEGAL ACTION

**Open PH-38.1 — a stored price states the frame it counts in.** PH-38 is
ACTIVE ([phase document](docs/phases/PH-38-the-frame-a-price-counts-in.md)) and
its first subphase is the next legal action. Cycle Audit 12 is closed: gated
green at `5edcc85`, merged, and hosted CI is the corroboration owed on the
merge commit. Thirteen of its fifteen findings
are fixed with a guard each; the two that are phases rather than patches are
Cycle 13's remaining work, and the order between them is a decision, not an
accident. **Finding 3 comes first**: it finishes what PH-37 began — the
checkpoint learned its quantum, the tick record and the candle history did not
— and it is live on every read route a broker calls, so every historical price
is rendered on today's quantum. The record cannot be rewritten, because a
client already holds those integers, so the fix is a lattice history per asset
converted on read. **Finding 7 comes after it**: correcting the calibration
moves every asset's volatility and seams every live market, and doing that
first would migrate a catalogue whose stores still cannot say which lattice
they were written on — the same defect twice, on more data.

**PH-38's premise is measured, not inherited.** Through a consistent snapshot
of the live venue (`state:backup`, which also gave the record its first backup
— it had none): **3,664,367 of 7,500,278 retained ticks, 48.9%, predate the
relattice seam of 2026-09-24 04:44:49 UTC and render wrong today**, on 30 of 30
assets, median error 31.7%, worst 1,472%. `eurusd-otc`'s last pre-seam tick was
published at `1.163184` and the venue renders it `1.201802`. The median
independently reproduces the 31.7% the audit measured by another route.

**Open PH-32 — the market time at which the anti-predictability claim stops resting on an hour.** The detection floor is `140.1 / sqrt(windows)`, so a year settles 30s (0.186pp gated) and leaves 15m at 1.018pp; every horizon crosses the 0.25pp product margin at about **seventeen years** of market time, which is 33 CPU-hours to generate and cannot be held in memory (936 GB). The phase makes the battery accumulate over chunks, proves the chunked path gives the same verdict as the whole-array one, and runs the thirty. Design notes: `~/.otc-local/ph32/DESIGN.md`. Cycle 11 is open and its first phase came from the Human Owner operating the Lab and saying what was wrong with it — the pace default, the push scale, a way to stop, and levels bounded by the market's own state. Cycle 10 is complete and audited; `v2.0.0` is the release that stands. Cycle 10 is complete and audited: three phases approved, Cycle Audit 10 closed (98 claims, 86 confirmed, 12 partial; every critical and material finding fixed in two gated waves, fourteen minor carried by name in the record), `v2.0.0` tagged on the commit hosted CI corroborated, and the integration package regenerated from that tag and verified inside itself. The roadmap's Cycle 10 section names what is deferred: Issue #9 (the multi-node composition), the engine's next stylised facts, jumps and volume; Issues #3 and #14 are the Human Owner's. The audit record's carried list is the first page of the next cycle's work.

Cycle 10 is complete and it was the closing cycle: PH-28 (the durable venue),
PH-29 (the integration boundary), PH-30 (release 1.0). The third merge is
`353f101`, tagged `v1.0.0`, with `docs/evidence/RELEASE-1.0.0.md` as the
release record and the integration package regenerated from the tag.

Cycle Audit 10 is running as this is written: eight independent auditors, one
detached worktree each (B-020), every finding put to an independent refuter in
a worktree that is not the finding's own. Its fixes are on `audit/ca10-fixes`,
and the audit record is `docs/audits/CYCLE-AUDIT-010.md`. **Hosted CI on the
release merge went red** — one browser test of the Lab, a real defect in how a
position's entry price was read, fixed on that branch — so `v1.0.0` does not
yet satisfy PH-30 §3's own rule that the tag is the commit hosted CI
corroborated. The full gate on `audit/ca10-fixes`, the merge, a green hosted
run and then the tag settle it.

**Hosted CI on this cycle's merges — corrected by Cycle Audit 9 (a7-01,
a2-03).** The PH-26 merge `c4757c5` was red on the Quality Gate (one unit
test, `seats.test.ts`, 26.7 s hosted against a 20 s ceiling) and green on the
Statistical Gate. The PH-25 merge `7f03abe` was **red on both**: the same
unit test, and `guardrailMetaAudit.stat.test.ts`, because the merged state
documents already failed `stateConsistency.test.ts` — the handoff named PH-25
active after the roadmap approved it, and the approval was committed with the
guard red (a7-02). `f2bab68` repaired the documents and its Statistical Gate
was green (88 min); its Quality Gate was still red on the unit test, fixed in
the PH-27 merge `e8ed2ae`, whose run is recorded in the table above when it
lands. `npm run state:check` now runs the two state guards in ten seconds and
belongs before every approval commit (CLAUDE.md §5).

This section named **PH-22.1** — a subphase approved and merged two phases ago —
until Cycle Audit 8 (a7) found it. A fresh session following `CLAUDE.md` §1 read
it, and the same document's own table said `Active phase: none`, so there was no
way to tell which half to believe. The guard that exists to prevent exactly that
passed on an incidental mention of a past audit elsewhere in the file; it reads
the stated action now.
