# Cycle Audit 006

Type: CYCLE AUDIT RECORD
Status: CLOSED — 40 of 46 findings closed in PH-19; the rest carried with reasons recorded there
Cycle audited: Cycle 6 (PH-16, PH-17, PH-18)
Commit audited: `dda0d84`
Conducted: 2026-09-01
Auditors: six independent agents, one git worktree each (B-020)

---

## 1. What was audited, and how

Six auditors, each with its own worktree at `dda0d84` and its own `node_modules`,
running concurrently and unable to see each other's plants. Cycle Audit 5 ran
seven auditors against one shared tree; three of them reported the contamination
without being asked, and B-020 records the rule. This is the first audit run
under it, and no auditor reported interference.

| Auditor | Subject                                                     |
| ------- | ----------------------------------------------------------- |
| a1      | Did PH-16 close what Cycle Audit 5 falsified?               |
| a2      | The dispersion budget, and whether it means anything        |
| a3      | INV-007 for a catalogue of a hundred assets                 |
| a4      | Backdated history and continuous persistence                |
| a5      | The operator surface: the admin API and the panel           |
| a6      | The gate as an instrument, and the honesty of the approvals |

**46 findings**, of which 6 are critical. Two were found by the Human Owner
before the auditors reported, simply by opening the panel — both invisible to
every test in the repository for the same reason, which is recorded below as
CA6-45.

## 2. The finding that matters most

**The gate's own configuration file was in no TypeScript program, and had been
silently ignoring two options for a whole cycle.**

`fileParallelism: false` and `maxWorkers: 8` sat inside the _project_ blocks of
`vitest.config.ts`, where Vitest 3 types them as `NonProjectOptions` and drops
them without a word. So:

- the statistical suite had **never** run serially, despite a comment saying it
  did — `detectionPower` alone reported 707 seconds of test time inside a
  749-second run that also ran everything else;
- PH-18's recorded determinism fix was a placebo, and the green gate that
  followed it was luck;
- every wall-clock assertion in the statistical suite was measuring whatever
  else happened to be running.

Root cause of the root cause: the root `tsconfig.json` has `"files": []` and ten
references, none covering the repository root. **The file that configures every
test in the repository was the one file nothing read.** That is the same shape as
PH-18.2's own finding about `apps/web`, one directory further out, and it is why
CA6-01 is recorded as the audit's headline rather than any individual defect.

## 3. Critical

| ID     | Finding                                                                                         | Auditor |
| ------ | ----------------------------------------------------------------------------------------------- | ------- |
| CA6-01 | `vitest.config.ts` is typechecked by nothing; `maxWorkers` and `fileParallelism` were inert     | a6      |
| CA6-02 | Hosted CI is **red** on the audited commit and no approval mentions it (`GOVERNANCE.md` §40.1)  | a6      |
| CA6-03 | A follower can still be given a real engine, with every guardrail green — regex-literal evasion | a1      |
| CA6-04 | `runStandingAssurance` reports `clean` on a record paying an observer **+1.4% per trade**       | a1      |
| CA6-05 | The backfill→live join **always** seams in the shipped service                                  | a4      |
| CA6-06 | The stored hourly tier disagrees with the stored minute tier at every recorder handoff          | a4      |

### CA6-02 in full, because it is a process failure and not a code defect

`GOVERNANCE.md` §40.1: _"A green local gate is not enough for a phase approval if
CI is red… A CI failure is valid evidence and must be addressed, not waived."_

Run `33562585323` on the PH-18 merge commit: **Statistical Gate — failure**, all
222 tests passing, one `Timeout calling "onTaskUpdate"`, exit 1. PH-18 §8 records
only the local gate. The phase was approved without the corroborating layer
Governance requires, and `CURRENT_STATE.md` then declared Cycle 6 complete.

The approval stands as _recorded evidence of a local gate_; it does not stand as
a phase approval under §40.1 until CI is green on the same tree. That is the
first thing PH-19 owes.

## 4. Material

### The instrument

| ID     | Finding                                                                                             | Auditor |
| ------ | --------------------------------------------------------------------------------------------------- | ------- |
| CA6-07 | The gate can exit 1 having **silently skipped the entire statistical suite** behind a green summary | a6      |
| CA6-08 | CI does not run `typecheck:web`, so `apps/web` is unchecked there                                   | a6      |
| CA6-09 | `npm run test:cov` exits 1; the coverage number it prints is unit-only                              | a6      |
| CA6-10 | `apps/*` is excluded from coverage — 840 lines of `apps/api`, 710 of `apps/web`, none measured      | a6      |
| CA6-11 | The guardrail scan's roots stop at `packages/`; `apps/` is in neither enforcement layer             | a5      |
| CA6-12 | The dependency guard reads only `.ts`, so seven of nine `apps/web` files are invisible              | a5, a6  |
| CA6-13 | `dependencies.test.ts` keeps a private two-regex `stripComments` — CA5-05's evasion still works     | a6      |
| CA6-14 | `guardrailMetaAudit` plants only inside `packages/`, and never against `singleWriter.test.ts`       | a1, a5  |

### The dispersion budget

| ID     | Finding                                                                                     | Auditor |
| ------ | ------------------------------------------------------------------------------------------- | ------- |
| CA6-15 | `DISPERSION_FIT_TURNOVERS = 4` does not bound the error to ±30% on **any** asset; 16 does   | a2      |
| CA6-16 | "The error is variance, not bias" is false at short spans; the median asset overshoots ~14% | a2      |
| CA6-17 | A **30% error** in `logVariancePerMs` passes the entire suite                               | a2      |
| CA6-18 | `eurusd`'s recorded diffusion rate is ~29% high; the published quarterly spread is ~15% off | a2      |
| CA6-19 | `dispersion.stat.test.ts` measures at 1.1–1.3 turnovers — below its own subphase's floor    | a2      |
| CA6-20 | `registerAsset` can return an instrument `assertValidInstrument` rejects (precision > 18)   | a2      |
| CA6-21 | `dispersionTurnovers` is unvalidated: `0`, `-5` and `NaN` all disable the guard             | a2      |

### INV-007 at scale

| ID     | Finding                                                                                     | Auditor |
| ------ | ------------------------------------------------------------------------------------------- | ------- |
| CA6-22 | The sibling-separation acceptance fails on **26 of 120** seed triples (21.7%)               | a3      |
| CA6-23 | `alt-crypto` siblings are not distinguishable from clones (lift 4.7pp, p ≈ 0.17)            | a3      |
| CA6-24 | `alt-crypto` has an infeasible corner: **36%** of 96-asset builds hit an unauthorable brief | a3      |
| CA6-25 | `traitDistanceCheck` admits an exact copy at 1.05× amplitude; the pair is one market        | a3      |
| CA6-26 | The acceptance's registered lattice is reproducible only to ~2×, against a ±15% standard    | a3      |
| CA6-27 | `blue-chip-index`'s slow corner cannot calibrate, and the refusal blames amplitude          | a2      |

### History, persistence and the panel

| ID     | Finding                                                                                        | Auditor |
| ------ | ---------------------------------------------------------------------------------------------- | ------- |
| CA6-28 | The "refuses to run twice" guard checks the state store while the damage is in the history one | a4      |
| CA6-29 | `readTimeframe` returns partial bars labelled whole, at both edges                             | a4, a5  |
| CA6-30 | The panel draws a candle the record does not hold, at the join                                 | a5      |
| CA6-31 | The stream's documented eviction refusal is unreachable — `writeHead` precedes `subscribe`     | a5      |
| CA6-32 | `Last-Event-ID` is ignored, so a reconnecting browser silently skips ticks                     | a5      |
| CA6-33 | `Venue.advance()` discards failures: a market that falls behind stops for ever, silently       | a5      |
| CA6-34 | The history endpoint is an unauthenticated memory and CPU amplifier (1.86 GB at 60 requests)   | a5      |
| CA6-35 | `FileStateStore` concurrent checkpoints race on one temp path — 200/200 reproduced             | a5      |

### Evidence and records

| ID     | Finding                                                                                     | Auditor |
| ------ | ------------------------------------------------------------------------------------------- | ------- |
| CA6-36 | Both Cycle 6 evidence documents name runner scripts that are **not in the repository**      | a4, a6  |
| CA6-37 | PH-17's headline numbers are `console.info`, not assertions; the band is 2–3× wider         | a6      |
| CA6-38 | `CYCLE-6-DRIFT.md` is falsified by its own table three lines above (btcusd median +1.5%)    | a2, a6  |
| CA6-39 | The reconciliation table in `CYCLE-6-DRIFT.md` does not reproduce from its stated inputs    | a2      |
| CA6-40 | `PH-18.2` plants seven defects in `series.ts`; no such file exists (it is `bars.ts`)        | a6      |
| CA6-41 | PH-16's own subphase table still says ACTIVE for two approved subphases                     | a6      |
| CA6-42 | `CYCLE-AUDIT-005.md` was never closed; `CURRENT_STATE.md` still names 004 as the last audit | a6      |
| CA6-43 | Cycle 6 touched no architecture document (B-023 recurring)                                  | a6      |
| CA6-44 | PH-18.3's "60 seconds in 65" is an alignment artefact of a 5-second poll                    | a6      |

### Found by the Human Owner

| ID     | Finding                                                                                      |
| ------ | -------------------------------------------------------------------------------------------- |
| CA6-45 | The engine sent no CORS headers, so the panel could not reach it from a browser at all       |
| CA6-46 | The panel needed a second port opened and free; the first host it met already had 3000 taken |

Both were invisible to every test in the repository **for the same reason**:
every check talks to the service with `fetch` from Node, where neither the
same-origin policy nor port forwarding exists. A suite that only ever tests the
server from the server cannot see the client's world. That is the general lesson,
and it is worth more than either fix.

## 5. Also recorded: what survived

An audit that reports only failures is not measuring; these were attacked and
held.

- **Homogeneity of degree one in `volatility` is exact**, and stronger than the
  documents claim: across 13 personalities and four factors the _published
  integer lattice_ was bit-identical, not merely equal to 1.2e-12 (a2).
- **No amplitude leak into the shape features**, proved structurally and then
  measured: re-levelling all 24 siblings onto one budget reproduces the sibling
  accuracies to the digit (a3).
- **Separation does not degrade at 96 assets** — per-archetype lift over the
  clone control holds as the catalogue grows (a3).
- **96 sampled personalities, 96 mirror tests, zero divergences** (a3).
- **160,000 sampled personalities, zero trait-bound or joint-bound violations** (a3).
- **Step-independence of the backfill**: six step sizes, an odd genesis, and a
  target on a tick instant all produce one stream (a4).
- **Recorder gap behaviour**: a three-hour silence, an empty minute and
  boundary-aligned ticks all produce _missing_ bars, never wrong ones (a4).
- **The CA5-08 variance fix is exactly right** — checked against enumeration over
  a four-contract book with mixed payout ratios, agreeing to eight decimals (a1).
- **All seven guardrails fail when planted against**, and five plant-table entries
  from Cycle 6 re-planted and were caught (a6).
- **Input handling**: path traversal, SQL metacharacters, prototype keys,
  `Infinity` and 20-digit integers are all correctly refused; every SQL binding
  is parameterised (a5).
- **No SSE subscription or socket leak** over 300 connect/abort cycles (a5).

## 6. Remediation

Cycle 7 opens with **PH-19 — Close what Cycle Audit 6 falsified**, on the model
of PH-16. Order is by what the other findings are verified _through_: the gate
first, then the guards, then the measurements, then the surface.

Nothing here is waived. Findings not closed in PH-19 are carried in
`docs/BACKLOG.md` with the reason.
