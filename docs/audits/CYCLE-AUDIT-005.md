# Cycle Audit 005

Type: CYCLE AUDIT
Status: ACTIVE — findings recorded, remediation in progress
Cycle: 5 (PH-13, PH-14, PH-15)
Started: 2026-09-01
Method: **seven independent agents**, adversarial, working in an isolated worktree

---

## 1. Method

Seven auditors, none of which wrote the code, each instructed to **falsify rather
than confirm** and to **re-execute rather than read**. Every mutation is confined
to a detached-HEAD worktree, never the protected tree (B-006).

| Auditor | Dimension                                                                  |
| ------- | -------------------------------------------------------------------------- |
| 1       | PH-15.1 — the SQLite store: two leaders, stale writes, rollback            |
| 2       | PH-15.2 — forge a rotation, a chain across it, or an anchor                |
| 3       | PH-14 — break INV-002 across nodes; fork the record; close a gap           |
| 4       | PH-15.3 — make the standing verdict say `clean` when it should not         |
| 5       | PH-13 + retention — misreport risk, or delete a disputable journal         |
| 6       | The guardrails themselves — plant against every guard, find the blind spot |
| 7       | Cold start and documentation truth — re-execute every re-checkable claim   |

`ADR-0011` requires independent agents, and the measurement behind that
requirement is why:

| Audit         | Method                   | Material findings |
| ------------- | ------------------------ | ----------------- |
| Cycle Audit 2 | ten independent agents   | 31                |
| Cycle Audit 3 | the authoring agent      | 1                 |
| Cycle Audit 4 | seven independent agents | 12                |

## 2. What Cycle 5 put at risk

This is the largest new surface the project has audited, and most of it is
load-bearing in a way earlier cycles' work was not:

- **A store that has never met two real processes** outside one test file. Every
  claim about multi-node correctness rests on it.
- **An impossibility result** (ADR-0012) that forecloses an entire class of
  design permanently. If the argument is wrong, the architecture is wrong.
- **A key-rotation scheme.** Cryptographic code, newly written, where a mistake
  is a forgery rather than a bug.
- **The first code in this repository that permits deletion** (retention).
- **A verdict the product's central claim rests on**, now produced continuously
  and read by people who will not re-derive it.

## 3. Result

**Cycle 5's approvals do not stand.** Six auditors have reported roughly fifty
material findings against code approved hours earlier, including a live
production defect, two working cryptographic forgeries, a constructed INV-002
break, and a headline risk number understated by a factor of two.

| Audit         | Method                   | Material findings |
| ------------- | ------------------------ | ----------------- |
| Cycle Audit 2 | ten independent agents   | 31                |
| Cycle Audit 3 | the authoring agent      | 1                 |
| Cycle Audit 4 | seven independent agents | 12                |
| Cycle Audit 5 | seven independent agents | ~50               |

The baseline is `b983727` on `main`, at which `npm run gate` exited 0 with 102
files and 1,699 tests. **Every finding below is against a tree whose gate was
green.**

## 4. The finding that matters most

**CA5-01 — a routine failover killed the asset, permanently and silently, at
the defaults the repository ships.**

`DEFAULT_CHECKPOINT_INTERVAL_MS` was 30 seconds; `DEFAULT_MAX_CATCH_UP_MS` is 15. A successor resumed from a checkpoint up to 30 seconds stale, and
`HostedMarket` measured how far behind it was **from that checkpoint's
instant** — so the first advance was refused by ADR-0010's bound before
anything was published. Nothing then moved the measurement forward, so every
later advance was further behind than the last. The asset stopped for good.

No seam. No lost lease. `session.lost` false, `session.pendingSeam` false. And
silent: `apps/api` calls `venue.advance()`, which discards the failure list.

Measured by the auditor on a **graceful** zero-downtime handover, with no option
overrides:

```
ran 20s -> CatchUpTooLargeError: Market is 20s behind the clock, past the 15s bound
ran 60s -> CatchUpTooLargeError: Market is 31s behind ...
head before takeover 21 / head after 100s of the successor 21 / advances thrown 50 / seams 0
```

It wedges on roughly half of all failovers and on **every** takeover that waits
out the lease term — which is what a crash produces.

**Why nobody saw it.** Every PH-14 test that exercises a failover sets
`maxCatchUpMs` to a day. `failover.test.ts`, `cluster.test.ts` and
`multiNode.test.ts` all disable the bound. ADR-0010's rule — the phase's only
defence against publishing an unobserved interval — was switched off in every
integrated verification of the phase whose entire subject is unobserved
intervals. ADR-0012's argument that "losing the lease takes away nothing the
catch-up bound had not already taken" reasons only about the _old_ leader; the
new one inherits the same bound measured from a stale checkpoint.

**Fixed**, and the fix exposed a second defect underneath it: `behind` was
measured from the last published _tick_, which conflates "the venue was down"
with "the market was quiet". Arrivals are self-exciting, so a quiet stretch
longer than the bound is ordinary, and it was being refused as though the
runtime had lost the CPU. It is now measured from the last time the runtime
looked at the clock, floored at the engine's own start instant — which is also
what lets a seam escape the bound the outage put it past.
`failoverBound.test.ts` runs at the production defaults, because that is the
whole point.

## 5. The forgeries

**CA5-02 — a retired key signed live history, under a hex alias.**

`Buffer.from(hex, 'hex')` truncates at the first non-hex character and is
case-insensitive, so `deadbeefzz` and `DEADBEEF` both decode to `deadbeef`.
Every identity check in the rotation scheme compared JS **strings**. An auditor
rotated "back" to the retired genesis key under the alias `HEX_0 + 'zz'`,
walking straight through the guard whose comment reads _"Rotating back to a
retired key would restore its ability to sign, which is exactly what retiring it
was for"_ — and then had the retired key sign a link at the newest epoch. The
forged chain verified from the genesis key.

Reproduced independently before fixing: `FORGED CHAIN VERDICT: null`.

**CA5-03 — "a retired key cannot sign history that follows its rotation" was not
what the code enforced.**

`KeyRotation` carried nothing binding it to a position in the record, so
"follows its rotation" meant only "appears later in the array the verifier was
handed" — and the attacker chooses that array. An auditor holding **only the
retired key** produced a chain signed entirely at epoch 0, and a partially
genuine one whose real epoch-0 prefix was continued with forged epoch-0
windows. Both verified. PH-15.2 §4's escape clause ("can still produce a
complete conflicting chain") does not cover the second, and the residual defence
it points at is CA5-04, which did not fire.

**Fixed.** Keys are now refused unless canonically encoded, and a rotation names
the chain head in force per asset when it was signed — a position the
hash-linking makes unmovable.

**CA5-04 — the append-only anchor was append-only only when nothing had been
appended.**

`extendsAnchor`'s head-root comparison sat behind `toSequence` **and**
`commitments` both being unchanged — the one case in which two anchors would not
differ at all. Whenever the record had grown, nothing looked at any root. An
operator who rewrote history from window three, re-derived every root after it
and appended five more windows was accepted as having extended the record. So
was a total rewrite, and so was re-windowing the same range.

This is the direct cost of a correct conclusion carried one step too far. PH-15.2
removed `rootsDigest` because `headRoot` already commits to the whole prefix —
true, **of a fixed chain**. Comparing the heads of two chains of _different
lengths_ yields nothing, and neither would a digest. An append-only claim needs a
relation _between_ the artefacts.

**Fixed.** `extendsAnchor` now requires the later chain and checks that the
window the earlier anchor summarised is still present with the same root; because
every root binds its predecessor, that single match certifies the whole prefix.

## 6. Findings not yet fixed

Recorded here in full, because a finding that is only in a transcript is not
recorded at all. Each is confirmed by a constructed counterexample or an uncaught
plant.

### CA5-05 — a follower really can generate, and INV-002 breaks at 120 of 120 samples

`singleWriter.test.ts` strips block comments before scanning, so two adjacent
string constants (`const OPEN = '/*'` … `const CLOSE = '*/'`) blind it to a plain
static `import * as engineModule from '@otc/engine'`. Template-literal and
computed dynamic imports evade it too. An auditor used one to give
`FollowerMarket` a `fillGap()` reaching `resumeMarket`, and then measured leader
against follower over the window both cover:

```
sampled 120 instants, DISAGREED at 120 (first divergence 210 lattice steps)
follower replicated head 9 | leader published 17 ticks; follower GENERATED 22
```

PH-14 §12 cites this guard as the evidence for INV-002 and INV-010. It is also
missing `@otc/core`'s entropy primitives — `RandomStream`, `expandKey`,
`chacha20Block`, `CursorLease` — from its forbidden list, so a follower may
import the material key material is made of.

### CA5-06 — the standing verdict asserts provenance it does not have

`assertIndependentFamilies` is a **name check on a string array**. No
`AttackFamily` is constructed anywhere in the call graph; `familyNames` is used
in exactly two places, the refusal's `Set` and the spread into the report. The
verdict is signed with the withheld families' names while being derived from a
single statistic none of them computes: the unconditional up-rate per horizon.

An auditor built a record whose direction is the Thue–Morse parity of the hour —
fully predictable, every contract at every horizon won with certainty — and it
reports **`clean`** at every horizon, because the up-rate is 0.5 by
construction.

This is the most serious unfixed finding. PH-15.3's §5 says the constraint is
"made structural here: the runner will not sign its name to such a verdict". What
is enforced is that a caller types four strings.

### CA5-07 — a profitable leak reports `undecided`, because the leak inflates its own floor

`designEffect` estimates between-block variance against a common-`p` null, so
_fixed_ block heterogeneity reads as dependence. An auditor built a record paying
an observer **+10.5% expected value per trade** at the promotional payout
(up-rate 0.5554, pooled z = 12.3) and it reported `undecided` with a floor of
33.97pp against an honest 1.27pp — a 27× inflation, produced by the leak's own
structure. Both terms are linear in the leak, so **more history never helps**.

`dependence.ts`'s own docstring forbids this use: _"for a run-wide component,
measure the pooled statistic's variance across genuinely independent runs
instead."_ `standing.ts` has one path, cuts it into contiguous segments of that
one path, and licenses the error bar with the result.

Related: `blocks` is caller-supplied and unbounded, and above `ticks/3` the
measurement silently stops running while still reporting `designEffect: 1` as
"measured"; a zero between-block variance throws an unhandled `RangeError` out of
the daily run; and 7 of 8 plants against the floor's calibration survived the
battery, including one that lets `clean` be reported at **40× the product
margin**. The test that should catch that asserts inside an `if` that never
fires — measured: the finest floor its fixtures reach is 77× the margin.

### CA5-08 — the operator's headline risk number is understated by (1+r)/r

`assessBookRisk.standardDeviation` computes variance as `(netExposure/2)²` with
`netExposure = r·|C−P|`. The operator's P&L actually swings by `|P−C|·(1+r)`
between the two resolutions, so the reported spread is short by `(1+r)/r` —
**2.01× at the 99% payout**, verified against the real settlement arithmetic over
200k resolutions at four payouts, matching the predicted ratio to six figures.

The module is internally inconsistent: `expectedProfit` knows the two resolutions
are different sizes and the variance does not, and `ruin.ts` gets the same
quantity right. The test that should have caught it simulates the model's own
`netExposure/2` rather than settling contracts — it validates the model against
itself.

### CA5-09 — the limiter is defeated 39.6× by one millisecond of entry jitter

Events are keyed on the submitted `entryInstant`, but `settle` resolves entries
with `priceAtOrBefore`, so every contract inside one tick interval is the _same
comparison_. Measured median tick spacing on `eurusd` is 1.1 seconds. Two hundred
contracts entered one millisecond apart inside an 11.4-second gap produce one
entry tick, one expiry tick and one outcome — and are reported as **200 effective
bets**, accepted in full by the limiter at a peak of 99 against a limit of 500,
while the true single-comparison obligation is 39.6× the limit. The identical
book without jitter is capped at five contracts.

`effectiveBets` reporting 200 where the truth is 1 is precisely the number PH-13
exists to produce.

### CA5-10 — retention deletes the entry ticks of settlements still under dispute

`journalIsPruneable` has no horizon term. A settlement is disputable while its
_expiry_ is inside the window, but re-deriving it needs the _entry_ tick, up to
one contract horizon earlier. There is a rolling 15-minute band of settlements
whose expiry is inside the window and whose entry price has been deleted. `now`
is also unvalidated in the only code in this repository that permits deletion:
`now = Infinity` prunes everything.

### CA5-11 — the guardrails have blind spots one syntactic form wide

Cycle Audit 4 named the pattern as "a blind spot exactly one directory wide".
Cycle 5's is narrower:

| Caught                  | Not caught                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Date.now()`            | `Date['now']()` — and every rule in the scanner falls the same way, because the stripper replaces string literals before matching |
| `.ts`                   | `.tsx` — `apps/web/src/app/` is entirely `.tsx`, so the browser bundle may import `@otc/lab` and `@otc/fixtures` invisibly        |
| `src/*.ts`              | `src/*/*.ts` — the check on `@otc/core` is effectively vacuous                                                                    |
| an `export` line        | a `// export` line                                                                                                                |
| `for (…) { expect }`    | `for (…) expect` — and `for..of`, `while`, `forEach`, decrementing                                                                |
| `lab.runBattery(x)`     | `const d = lab.runBattery; d(x)`                                                                                                  |
| `import('@otc/engine')` | `import(GENERATOR)`                                                                                                               |
| `APPROVED`              | `NOT APPROVED` — read as approved by every state guard                                                                            |

Plus: `GENERATION_ROOTS` is still a hand-maintained constant, so `packages/lab`,
`tools/` and `apps/` are unscanned and a new package is unscanned by default;
`SIGNING_MODULES` did not list `rotation.ts`, the signing module PH-15.2 added;
the publishing-key refusal is satisfied by a **string literal** stating the rule;
`traceability.test.ts` is satisfied by a nine-line file asserting `1 === 1`; and
the guardrail meta-audit has no mutation for either guard added in PH-14 or
PH-15 — the two that produced most of the above.

### CA5-12 — the risk and retention modules have no production callers

`grep` finds `ExposureBook`, `assessBookRisk`, `journalIsPruneable` and the rest
only in their own modules, their tests, and `tools/sim`. PH-13.3 is titled
"Enforcement in the venue" and the venue does not call it. This bounds the blast
radius of CA5-08 through CA5-10 to the evidence harness — and it means the first
time this code is wired up is the first time those defects bite.

## 7. A process finding, and it is the auditor's own

**CA5-13 — seven auditors were given one shared worktree.**

Three reported it independently. Plants appeared and vanished under one another;
one auditor had a restore clobbered mid-campaign; another's first batch was
invalidated by CPU starvation from a concurrent full suite run and had to be
redone in a private copy. All three re-verified their findings against a clean
tree, and every tree was confirmed byte-identical to `HEAD` at the end — but the
isolation the briefs promised did not hold.

This is B-006's hazard reconstituted: concurrent agents planting live defects in
one tree, with a `git status` that no longer distinguishes whose plant is whose.
That is exactly how a planted backdoor reached `main` in Cycle Audit 2.
`guardrailMetaAudit.stat.test.ts` already solved it for itself — _"Each mutation
runs against a fresh copy… the live repository is never written to"_ — and the
audit process did not follow its own rule.

**Cycle Audit 6 gives each auditor its own worktree.** Nothing in this audit is
discarded, because every finding was re-confirmed against a clean tree by the
auditor who reported it, but the results are weaker than they should have been
and the cost was real.

## 8. What this says about the phase gates

`npm run gate` exited 0 on the tree every one of these findings was made against.
That is not a failure of the gate — it is what the gate is: the tests that exist,
run. Cycle Audit 4 recorded the same thing about a production-only defect.

The pattern this cycle adds is sharper. **Three of the most serious findings are
tests that disabled the thing they were testing:** every failover test set the
catch-up bound to a day; the standing battery's "never reports clean" assertion
sits inside an `if` that never fires; the exposure simulation validates the model
against the model's own quantity. In each case a test existed, was cited as
evidence in an approval, and could not fail.

## 9. Found during remediation

**CA5-14 — the quality gate is not deterministic, and the cause is worse than
first diagnosed.**

The remediation tree produced `Test Files 103 passed (103)`, `Tests 1722 passed
(1722)`, and **`GATE_EXIT=1`**, with `Error: [vitest-worker]: Timeout calling
"onTaskUpdate"`. The same tree exited 0 an hour earlier.

Isolated: `calibration.stat.test.ts` runs 479 seconds, contains no `setImmediate`
anywhere, and **exits 0 when run alone**. It starves the worker's RPC channel
only when it runs beside `detectionPower.stat.test.ts`, which runs 478 seconds
and does yield. So B-010 — recorded as "documented, not fixable by a guard" — is
narrower than it was written: the hazard is not a long synchronous test, it is
two long tests overlapping, and which two overlap depends on scheduling.

That matters more than the diagnosis time B-010 accounts for. `npm run gate` is
the authority for an approval in this project. An authority that returns a
different answer on the same tree depending on which suites happen to overlap is
not one, and every `GATE_EXIT=0` in the repository was recorded from a single
run. Tracked as B-021.

The seventh auditor measured it properly, on an **idle** box in a clean clone:
`npx vitest run --project unit` failed **2 of 8 runs**, and
`packages/engine/src/rhythm.test.ts` alone failed **3 of 12**. Observed durations
for one co-varied solve: 1820 … 3155, then **5079, 5319, 6111 ms** against a
5,000 ms timeout.

So the RPC starvation recorded above is the rarer of two causes. The common one
is that **ten unit tests sit between 2.5s and 4.2s against a 5s timeout** —
deliberate deterministic computation with no headroom at all. `GOVERNANCE.md`
§40.1 says the gate "is deterministic and reproducible… anyone with the
repository can re-run it and get the same numbers". Every `GATE_EXIT=0` in
Cycle 5 was a single sample from a roughly 80%-pass distribution.

**Fixed.** The unit timeout is 20s. The timeout was doing two jobs and doing one
of them badly: catching _accidental_ cost is `testCost.test.ts`'s job, which it
does by reading the code rather than by timing it. Three consecutive unit runs
now pass.

## 10. The cold start

A fresh agent following `CLAUDE.md` §1 **can** determine the project, the
invariants, the active phase and the next legal action. It would also have been
misled about five things, all now fixed:

| Was                                                                                             | Now                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md` and `PROJECT_CONTEXT.md` said Node ≥ 22; `package.json` requires ≥ 24 since PH-15.1 | Both say 24. A fresh agent on Node 22 gets a repository whose coordinated store cannot run.                                                                                                                      |
| The verification tables recorded the **PH-14** gate — 66/1,312 and 27/202                       | The PH-15 gate: 73/1,495 and 29/204. Commit `b983727` was titled "phase gate recorded from the merged tree" and never touched either table.                                                                      |
| `PH-11-HORIZON-COVERAGE.md` claimed "2.5 billion ticks, roughly 62 asset-years"                 | 3.12 billion across three runs; 2.0 billion for the forty policed cells. Neither figure in the sentence was right, and the test that advertises itself as re-deriving the record never touched the summary line. |
| `PH-15.3` claimed twelve plants over an eleven-row table                                        | Eleven.                                                                                                                                                                                                          |
| `PH-14.1` contained `[[guard-not-finished-until-watched-failing]]`                              | A wiki-link into agent-local memory, inside a repository document. Removed.                                                                                                                                      |

**CA5-15 — the conformance battery specified six of thirteen members.**

`describeCoordinatedStore` contained **zero occurrences of "seam"** and never
called `appendTicks`, `recordSeam` or `readRecord`. PH-15.1 cited it as the
evidence that the deployment store is correct, and this audit cited its being
"unmodified" as the strength of that evidence.

Measured cost: three guards in `sqliteStore.ts` could be deleted with the entire
1,495-test suite green — including **the fence on `recordSeam`**. The in-memory
store's equivalents were covered, so PH-14.3's plant table fired honestly against
the store the venue does not run.

**Fixed.** The battery now covers the replication log, and the four plants that
were invisible each fail it.

## 11. Still open from the cold-start audit

- **`npm run test:cov` exits 1 and produces no coverage table at all** — B-003's
  closed state has regressed. Three throughput floors are not coverage-aware
  where `CLAUDE.md` says one is, two statistical tests time out at 900s, and the
  run emits ten `onTaskUpdate` timeouts.
- **`docs/architecture/` was never touched by Cycle 5.** Leader lease, followers,
  failover, the durable store, rotation, retention, ruin, exposure limits and the
  standing verdict are all absent, and `DOCS_INDEX.md` tells the reader in as many
  words that _"a missing architecture document means that layer does not exist
  yet"_. This is CA4-10 recurring at three times the scale.
- **ADR-0008 is superseded in part and says so nowhere.** Its title still reads
  "no hosted CI" and its status is APPROVED with no forward pointer to ADR-0009.
- **`GOVERNANCE.md` §40 states the pre-fix gate order** — "format, lint, build" —
  in the sentence that defines the verification authority, six lines below the
  section recording the fix. Governance is the Human Owner's to amend.
- **`docs/BACKLOG.md` says GitHub Issues are not enabled**; they are, on a public
  repository, and both documented migration triggers have fired.
- **PH-13's three subphases record no planted-defect evidence at all**, against
  the standing rule `SESSION_HANDOFF.md` states first.
- **The ROADMAP has a malformed Cycle 3 table** (two-column header over
  three-column rows, so three phases render with no state cell), a stale revision
  date, and a "Protected Human decisions on the horizon" section listing
  decisions ADR-0008 abolished.
- **`CURRENT_STATE.md`'s 0.562pp per-asset floor does not reproduce** — measured
  0.563 … 0.568, inherited from the pre-PH-10 catalogue.
- **"46 unresolved-type errors" is 44, across two files**, in four documents.
