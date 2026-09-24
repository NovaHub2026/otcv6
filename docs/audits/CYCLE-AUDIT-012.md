# Cycle Audit 012

Type: CYCLE AUDIT RECORD
Status: OPEN — findings closed in two waves; the two that need a phase are carried by name
Cycle audited: Cycle 12 (PH-34, PH-35, PH-36), on the tree that carries it plus PH-37
Commit audited: `8bcd00f` — `main` at the time, which is `v2.4.0` plus the packaging fix
Conducted: 2026-09-24
Auditors: eight independent agents, one detached git worktree each; every finding then put to one of three independent refuters working in a worktree that was not the finding's own, briefed to refute and to default to refuted when uncertain

---

## 1. Why it was audited on a later tree than the cycle it audits

Cycle 12's three phases are PH-34, PH-35 and PH-36. By the time the audit ran,
PH-37 had recalibrated the catalogue on top of them and `v2.4.0` had shipped.
Auditing the superseded commit would have described a market no deployment
runs — the same argument that keeps PH-32 and PH-33 paused — so the audit was
conducted on `main`.

It ran one phase late, by the Human Owner's direction of 2026-09-23. That is
recorded rather than excused: GOVERNANCE §28 puts the audit before the next
phase, and the phase that ran first is the one that produced the most serious
finding below.

## 2. The finding that matters most

**A release passed its full gate, passed hosted CI on both jobs, and was broken
in production anyway — in the one path no test walks.**

PH-37 coarsened every asset's lattice. A published price is an integer count of
quanta, so a market resuming onto a different lattice must re-express it, and
the conversion reads the quantum from the checkpoint. That field ships _in the
same release as the change that needs it_, so on the only upgrade that needs it
no checkpoint declares one. Thirty live markets moved by a median of 31.7% and
as much as 1,474%.

Auditor a6 named the general shape, and it is the lesson of this audit:

> The defect was not a missing test but a missing **test input**. Every test in
> the repository constructs its artefacts with the code under test. An upgrade
> feeds the _previous release's_ artefact to the _current_ reader, and nothing
> in the gate can produce one.

Nine persisted artefacts have a previous version that is an input; two have any
old-shape test. Every version check in the repository guards the _rollback_
direction; the upgrade direction is guarded by untested `?? default` arms or by
nothing. The prototype that closes it — materialise the previous tag from git,
build it, compare — costs about four seconds and is now
`packages/engine/src/lattices.test.ts`.

## 3. What the mechanisms did under attack

PH-36's automatic reopening (a3) held against everything: no seam storm (a
process starving on every pass produces one reopening and then stalls by name),
sequence integrity over eight reopenings with no duplicates, the feed losing no
ticks, settlement refusing the straddling contract, and seven planted defects
each caught by exactly one named test.

The market model (a4) reproduced: regime medians 93/139/55/21 minutes against a
re-measured 94/137/55/21 over thirty assets and sixty days each; **zero
non-adjacent transitions in 23,815**; `splitRegimeLevel`'s variance invariant
exact to twelve figures across twenty-five combinations; the volatility floor
load-bearing and never breached. PH-37's refund rates reproduced on fresh
families to a median difference of −0.015pp.

## 4. Findings, and what was done

| #   | Finding                                                                                                                                               | Verdict after refutation                                                                                                                                                                     | Closed                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | `settle()` treated silence about seams as "no seams"; `seams` was optional, so a caller holding them and omitting them settled across one             | CONFIRMED, **severity raised** — a1 and a2 both called settlement safe; the refuter found the opt-out                                                                                        | Yes: required, and refused at runtime          |
| 2   | `seamPastRecord` carried its price across a lattice change unconverted — live price, not rendering (−9.8%, −26.8%, −46.9%)                            | CONFIRMED by execution                                                                                                                                                                       | Yes                                            |
| 3   | Every read route renders a recorded tick on the _current_ lattice; the tick record and candle history store integers with no quantum                  | CONFIRMED end to end on a real `MarketController`                                                                                                                                            | **No — carried, §6**                           |
| 4   | `nextBoolean`'s fairness had no named test; ADR-0003's theorem rests on it                                                                            | PARTIAL — the mechanism is real, the severity is not: `npm run test:unit` goes red in 8 files under a biased coin, and the mirror test _does_ catch bias composed above the stream interface | Yes: a chi-square, one second                  |
| 5   | `OTC_AUTO_REOPEN=0` had no test; a lint-clean plant makes it a silent no-op                                                                           | CONFIRMED exactly                                                                                                                                                                            | Yes                                            |
| 6   | The lattice table's guard computed its expectation from the constant it tested; a 2.58×-wrong value passed 3,529 tests                                | CONFIRMED, and independently by two auditors                                                                                                                                                 | Yes: compares against `v2.3.1`'s own catalogue |
| 7   | The calibration simulates a market the engine does not run (no volatility floor, no regime-driven arrivals), and the fits absorb **none** of the bias | CONFIRMED; the decision log's premise was false. Magnitudes: quantile ×1.62–1.71, refund bias **+1.91pp**. The dispersion claim was REFUTED as fit noise                                     | **No — carried, §6**                           |
| 8   | `PH-35-THE-LEVEL.md`'s tick-rate column was measured at `REGIME_ACTIVITY_SHARE` ½; the engine ships ¼                                                 | CONFIRMED, with wider damage than reported and a second document affected                                                                                                                    | Yes: both records carry it                     |
| 9   | The Lab's push tooltip multiplies the unit by a literal 4; a unit has been a tenth of the candle since PH-31                                          | CONFIRMED — understates every asset's candle by exactly 2.5×                                                                                                                                 | Yes                                            |
| 10  | The hole notice reached three of seven statuses; the browser case cannot discriminate the defect                                                      | CONFIRMED in substance, counting corrected by the refuter                                                                                                                                    | Yes                                            |
| 11  | `regime.levelInForce` is referenced by no test; a plant survives 709                                                                                  | CONFIRMED, and worse: it shifts realised pace and pushes an asset out of tolerance                                                                                                           | Yes                                            |
| 12  | `v2.4.0` is tagged on a tree no gate ran on                                                                                                           | **REFUTED as headlined** — hosted CI ran the full gate on the tagged tree and the tag was cut 101 seconds later. What survives is one imprecise sentence                                     | Yes: the record says which tree                |
| 13  | A fabricated gate hash passes every guard                                                                                                             | CONFIRMED                                                                                                                                                                                    | Yes                                            |
| 14  | The coarsening was documented as "×12 to ×16"; it is ×9.10 to ×22.97, and fourteen of thirty fall outside                                             | CONFIRMED by three separate agents                                                                                                                                                           | Yes                                            |
| 15  | `INTEGRATION.md` documents a pre-PH-37 `logQuantum` in the example a broker copies                                                                    | CONFIRMED                                                                                                                                                                                    | Yes                                            |

## 5. What the method cost, and what it bought

Three of the eight auditors overstated a severity that its refuter then took
apart (4, 12, and a5's dispersion claim), and one auditor's headline rested on a
subset of the suite rather than the suite. That is the method working: the
refutation step exists because an auditor who finds something is motivated to
find it large.

It also worked the other way. Finding 1 was called _safe_ by two auditors and
turned out to be the most consequential defect in the audit, because the refuter
read the optional field instead of the happy path.

## 6. Carried

Two findings are phases, not fixes, and are recorded here rather than patched:

- **The durable stores keep integers with no lattice** (finding 3). The
  checkpoint was fixed in PH-37; the tick record and the candle history were
  not, so every historical price a broker reads is rendered on today's quantum.
  The record cannot be rewritten — a client holds those integers — so the fix is
  a lattice history per asset, converted on read.
- **The calibration simulates a market the engine does not run** (finding 7).
  Correcting it moves every asset's volatility and seams every live market.
  Measured cost of the deferral: the lattice search starts from a quantile
  ×1.62–1.71 too fine, and the refund estimate is biased +1.91pp.
