# Cycle Audit 007

Type: CYCLE AUDIT RECORD
Status: CLOSED — 34 of 35 findings closed in the audit itself; one carried with a reason (Issue #22)
Cycle audited: Cycle 7 (PH-19, PH-20, PH-21)
Commit audited: `3e4ec7e`
Conducted: 2026-09-03
Auditors: eight independent agents, one git worktree each (B-020)

---

## 1. What was audited, and how

Eight auditors, each with its own worktree at `3e4ec7e` and its own
`node_modules`, running concurrently and unable to see each other's plants.
Every finding was then put to an independent refuter told to attack it and to
default to refuted when uncertain.

| Auditor | Subject                                                    |
| ------- | ---------------------------------------------------------- |
| a1      | The ten invariants, attacked directly                      |
| a2      | The gate as an instrument                                  |
| a3      | The distribution surface and the stream work of 2026-09-02 |
| a4      | PH-21's claims about a hundred assets                      |
| a5      | The operator surface: auth, secrets, lifecycle, the panel  |
| a6      | Settlement, state integrity, failure recovery              |
| a7      | The records, the cold start, Git/GitHub                    |
| a8      | Implementation quality, and what the tests do not cover    |

**35 findings survived refutation** — 15 material, 20 minor, none critical.
Roughly a third of what the auditors raised did not survive, which is the
refuter doing its job.

`GOVERNANCE.md` §67 lets depth follow risk, and two things shaped it. The
out-of-band audit of 2026-09-02 had already swept most of PH-19 and PH-20, so
the auditors were told to check that **its fixes hold** rather than re-derive
its findings. And the PH-21 closure audit had already checked PH-21's
documentary claims — but had planted against nothing, and had not opened the
engine or the statistical layers at all. That is where this audit was pointed.

## 2. The finding that matters most

**Every mirror test in the repository passes on an engine carrying a
battery-confirmed exploitable edge.**

An auditor planted the canonical banned mechanism — the leverage effect,
volatility responding to the signed return, which `CLAUDE.md` §9 names as the
most dangerous change anyone can make here — behind `#sequence > 200_000`. Then:

- `npx vitest run --project unit packages/engine packages/core packages/runtime apps/api`
  — 58 files, 1,577 tests, exit 0. Every mirror assertion passed, including all
  five assets of `productionComposition.test.ts`.
- `sampledCatalogue.stat.test.ts`'s mirror over 24 sampled assets at 120,000
  ticks each — passed.
- `phaseAcceptance.stat.test.ts` — `VERDICT: EXPLOITABLE`, worst z **+5.95**,
  edge **+0.473pp** at 30 s, confirmed on a held-out sample at +0.513pp.

ADR-0003 §6 says a mechanism that reads a sign "fails this test immediately and
unambiguously", and calls the mirror test "the gate that a statistical battery
cannot replace". For this plant the relationship was **inverted**: the battery
caught what every structural test missed.

The cause is arithmetic, not subtlety. Every mirror invocation compares a
bounded run — 10,000 ticks in `productionComposition.test.ts`, the only one that
drives the shipped factory under `environment: 'production'`; 45,000 in
`phaseAcceptance`; 50,000 in `multiAsset`; 60,300 in `mirror.test.ts`; 120,000
in `sampledCatalogue`, the highest anywhere. At btcusd's recorded mean interval
of 333 ms, 120,000 ticks is eleven hours of market life and 10,000 is under an
hour. A hosted market runs for months and `#sequence` is monotonic across
restarts by design. Anything gated above the largest window is invisible.

**Refuted down from critical to material, correctly.** `ci.yml` runs the full
statistical suite on every pull request and every push to `main`, so the plant
turns hosted CI red and cannot reach trusted integrated state. `INVARIANTS.md`
already records INV-006 as jointly enforced by the mirror tests _and_ four
statistical guards. And the evasion needs code that deliberately waits: every
unconditionally applied sign-reading mechanism, the leverage effect included,
diverges at step one of every mirror test.

What was wrong was the **claim**, and it is corrected in ADR-0003 §6 and in
`mirror.ts`: the mirror test is exact about the window it runs, and the window
is a precondition that had never been written down or measured.

## 3. What the audit found about its own method

Two things, and §28.1 requires recording them.

**The refuters were not isolated.** The eight auditors each had a worktree; the
refuters ran against the main tree read-only, and one of them wrote a probe file
into `packages/distribution/src/` regardless. It was caught by a monitor within
a minute and removed, and it found something real on the way — `TickFeed.since`
accepting `NaN`, which became CA7-20. But it is exactly the contamination B-020
exists to prevent, committed in the half of the process this audit designed
after reading B-020. Isolation has to cover every agent that can write, not
every agent whose job description mentions writing.

**Eight worktrees are 3.5 GB inside the repository.** They appeared as untracked
files — one `git add -A` from being committed — and ESLint walked into them and
aborted on heap exhaustion. Both are now ignored, in `.gitignore` and in
`eslint.config.js` separately, because the first does not reach the second.

## 4. Findings

Severity after refutation. Every fix landed with the guard that names it watched
failing against the defect.

### Material

| Id     | Finding                                                                                             | State              |
| ------ | --------------------------------------------------------------------------------------------------- | ------------------ |
| CA7-01 | Every mirror test passes on an engine with a +0.473pp edge gated above the largest window           | Closed             |
| CA7-02 | `INVARIANTS.md` cited an INV-010 assertion that did not exist; forty planted sign draws passed      | Closed             |
| CA7-03 | The eviction boundary had no test; an off-by-one there is a silent one-tick skip                    | Closed             |
| CA7-04 | Replay ignored backpressure: 50,000 frames and 3.46 MiB to a socket full from byte one              | Closed             |
| CA7-05 | INV-007 at a hundred assets asserted from a metric whose docstring forbids that reliance            | Closed + Issue #21 |
| CA7-06 | The panel binds every interface: an unauthenticated LAN POST retired a market                       | Closed             |
| CA7-07 | A market that never published is wedged by any outage, and no restart clears it                     | Closed             |
| CA7-08 | Three of five `assertUsableRecord` branches were untested; each could be disabled silently          | Closed             |
| CA7-09 | `resumeMarket` measured the last tick's age and called it the checkpoint's                          | Closed             |
| CA7-10 | One stalled market pinned the whole scheduler to a 1 ms timer: 839 passes a second                  | Closed             |
| CA7-11 | Nothing checked the two fields that decide whether a cycle audit is due                             | Closed             |
| CA7-12 | An approved subphase's document could be deleted with the gate still green                          | Closed             |
| CA7-13 | A settlement engine refunding every contract on a seamed record passed all 2,203 tests              | Closed             |
| CA7-14 | The portability scan did not read the roots its own docstring claims; `apps/api` shipped `Math.exp` | Closed             |
| CA7-15 | Retiring a stalled asset pinned `/health` at degraded for the life of the process                   | Closed             |

### Minor

| Id     | Finding                                                                                  | State               |
| ------ | ---------------------------------------------------------------------------------------- | ------------------- |
| CA7-16 | Dropping one glob deleted the entire browser suite with every gate step still green      | Closed              |
| CA7-17 | A stray `it.only` silenced a failing sibling locally but not on CI                       | Closed              |
| CA7-18 | The CA6 fix making `?from=` strictly numeric had no test anywhere                        | Closed              |
| CA7-19 | `from=1` on a restarted process is answered with the live edge, silently                 | Carried — Issue #22 |
| CA7-20 | `since` accepted `NaN` and replayed the entire retained window as a continuation         | Closed              |
| CA7-21 | The WAL three-file sum defends nothing: 139% apart across a checkpoint                   | Closed              |
| CA7-22 | `MINIMUM_TRAIT_DISTANCE` unpinned: a 100× weakening of INV-007's floor passed everything | Closed              |
| CA7-23 | The corrected venue paragraph named the wrong families and the direction backwards       | Closed              |
| CA7-24 | "Flat to within 7%" is inside the instrument's own 4–11% repeat noise                    | Closed              |
| CA7-25 | The hourly tier is already inside 52 B/bar; the footnote told readers to double-count    | Closed              |
| CA7-26 | `venueScale.ts`'s docstring said smallest where the code builds at the largest           | Closed              |
| CA7-27 | The loopback bind default had no guard: `0.0.0.0` passed 557 tests                       | Closed              |
| CA7-28 | `OTC_BIND=0` is silently a wildcard, and the boot line did not say so                    | Closed              |
| CA7-29 | `referencePrice` × `displayPrecision` unbounded: the panel printed 34 digits of a double | Closed              |
| CA7-30 | The link guard skipped `GOVERNANCE.md`, `docs/audits/` and `docs/evidence/`              | Closed              |
| CA7-31 | `package-lock.json` still said `UNLICENSED`, dirtying every clean checkout               | Closed              |
| CA7-32 | `publish` half-applied a gapped batch: retained, never delivered, nobody told            | Closed              |
| CA7-33 | Feed retention unmeasured and unpinned: 501 MB at a hundred assets                       | Closed              |
| CA7-34 | Display price implemented twice; the copy the guards could not see used `Math.exp`       | Closed              |
| CA7-35 | A retired asset kept its 50,000-tick window for the life of the process                  | Closed              |

## 5. What the plants say about the guards

The auditors planted against roughly forty guards. The pattern in what survived
is worth more than the individual findings.

**Guards that caught everything thrown at them.** The gate's own failure
plumbing (a failing unit test, a failing statistical test, a swallowed
statistical failure, the 30-second RPC watchdog, a zero-test-file run, serial
execution, the browser requirement) caught eight of eight. The economic-blindness
and dependency-direction rules caught their plants. `priceFormat.ts` caught five
of five, including a plausible "equivalent" rewrite. The settlement rules caught
six of eight. The state-consistency guards caught every falsification of the
phase and subphase rows.

**What survived was almost always a guard written against a constant rather
than against a behaviour.** `MINIMUM_TRAIT_DISTANCE` could be weakened a
hundredfold because every assertion referenced the constant itself. The seam
tests asserted `toBeDefined()`. `assertUsableRecord`'s branches had no test at
all. The bind default had none. In each case the code was right and nothing
would have noticed it becoming wrong.

**And one class of guard was absent rather than weak**: the storage figure and
the throughput figure from PH-21.2 have no guard anywhere, because nothing
imports the runners that produce them. They are deliberate acts, recorded once.
That is a defensible design, and it means the numbers decay silently.

## 6. What the audit could not check

- **A hundred assets behaviourally.** CA7-05 is the finding; Issue #21 is the
  work. The proximity metric is necessary and not sufficient, and nothing has
  run the sufficient check above 24 assets.
- **The multi-node layer.** No deployment composes it (Issue #9), so the
  conformance battery is all there is to audit.
- **Fan-out.** Nobody has opened two simultaneous clients against this engine.
  That is PH-22, and CA7-04 and CA7-33 are both early sightings of it.

## 7. Verification

`npm run gate` and hosted CI, both on the audited-and-fixed tree. Recorded in
`CURRENT_STATE.md`.
