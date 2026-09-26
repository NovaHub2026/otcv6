# Cycle Audit 013

Type: CYCLE AUDIT RECORD
Verified: `GATE_EXIT=0` on the fix branch — 177 unit files / 3,618 tests in 93 s, the same under coverage with the floors enforced, 47 statistical files / 411 tests in 3,340 s with a real browser (third attempt; see §7)
Status: CLOSED — 41 findings recorded; the two criticals, seven of the nine materials and twelve minors fixed here with a guard watched failing for each, and everything else carried by name (§6)
Cycle audited: Cycle 13 (PH-37 the staircase, PH-38 the frame a stored price counts in, PH-39 the reopening that holds)
Commit audited: `4e86136` — `main`, the commit whose full gate and hosted CI are both green
Conducted: 2026-09-25
Auditors: eight independent agents, one detached git worktree each, all eight built from the audited commit; every area's findings then put to one of three independent refuters working in a worktree that was **not** the finding's own, briefed to refute and to default to refuted when uncertain

---

## 1. What this audit is, and the one number that describes it

**Forty-one findings.** Two critical, twelve material, twenty-seven minor, before
refutation; one material was refuted outright and three had their severity moved.
For scale: Cycle Audit 2 — ten agents, adversarial — found 31; Cycle Audit 3, run
by the agent that wrote the code, found one. This one was run by the agent that
wrote all three phases, with eight independent auditors and three refuters, and
**the two criticals, both materials that reached a live venue, and the false claim
in a phase document were all found by agents rather than by me.**

That is the argument for the method, and it is worth stating plainly because the
alternative was available: I could have written "the cycle is sound" and gated it.

## 2. The findings that matter most

**a6-01 and a6-02 — the operator's acceptance check bricks the deployment it
checks, and the scheduled backup carries it into the copy.** `verifyStateDirectory`
opened the tick record read-write while opening the candle history three lines
below it read-only, with a comment on the read-only one explaining exactly why:
"verification must not upgrade the file it inspects, and this path is pointed at
directories a live venue is writing". The fix had been applied to one of the two
stores. So `npm run state:verify` against a v2.4.0 deployment created the
`lattice` table, ran the v2→v3 seam backfill and stamped `user_version = 3`, then
printed **"Consistent: every file agrees"** and exited 0 — and the service holding
that file refuses it on its next boot, into `Restart=always` with `RestartSec=2`.
A refuter reproduced it end to end on a record written by v2.4.0's own build, and
found the worse trigger: `deploy/backup.sh` runs `state:backup` **on a schedule**,
and `backupStateDirectory` verifies the copy on the way out. A deployment whose
checkout is ahead of its running service therefore produces an **unrestorable
backup on every scheduled run**, exit 0, manifest declaring it consistent, with a
healthy source signalling nothing. Discovery happens at restore time, during an
incident, with the recovery path already gone.

**It is not hypothetical.** The backup taken of this venue's live record at 01:51Z
on 2026-09-25 is on disk at schema **3 with zero declared epochs**, while its
`history.db` is still at **1** — the signature of a migration the backup performed
on itself, at an hour when the serving build understood version 2 and would have
refused it. The first real backup this project ever took of the Human Owner's
market was unrestorable for fifteen hours and nothing said so.

**a8-01 — a candle that straddles the relattice boundary is dated by its close
alone.** `dateCandlesAgainstRecord` asked for the frame at the bar's _last_
sequence. A bar folded from minutes either side of a lattice change has its open
in one unit and its close in the other, so dating it by the close declared the
whole bar — open, high and low included — on the close's frame, and then anchored
the epoch at the bar's _first_ sequence, below the true boundary, so the reader's
own crossing test could not see a crossing either: the span sat inside one
declared epoch. Measured on the live venue: **17 of 30 assets served a 1m bar with
a wick no tick ever printed**, from 2.3% to **73.0%** (`aix-idx-otc` 1060.30
rendered as 1834.71). It is the exact shape the PH-38 refuters caught in the
reader, recurring in the writer, and `frameOfSpan` — the helper written to refuse
a crossing — was already in the file.

**a3-01 with a8-02 — the venue is honest about a candle it cannot date and the
only client the project ships throws that honesty away.** A bar with a null frame
is skipped and **nothing reports it**, at any layer: the library returns an array,
the panel renders a bar count. Measured live, with two refuters agreeing: **24 of
30 assets rendered an entirely empty 1d chart**, `btcusdt-otc` dropped 1,247 of
3,231 one-minute bars, 52.1% of 1h bars over nineteen days are undated. A refuter
then measured _why_, and it is worse than a one-off: the datable past is budgeted
in **ticks** (a bar can only be dated while the tick record's retention window
still reaches it) while the chart is retained in **days**, so the reach is monotone
in each asset's tick rate — dogeusdt 1.53 d, btcusdt 2.00 d, eurgbp 18.30 d — and
**every further day of uptime empties the 1d chart further**.

**a7-02 with a4-01 — a phase document of this cycle credits a guard that cannot
catch the defect it names, and the code's docstring states the opposite of the
code.** PH-39.1's plant table claimed "a re-arming returns `true`, so the stall is
skipped → 3 tests, led by _is not reported healthy while it is publishing
nothing_". Two auditors re-planted it independently: **one** test goes red, and
not that one — the named leader drives one pass and never enters the re-arming
branch. The docstring said a re-arming returns `false`; it returns `true`, and must.
Both were written by me, in the phase this audit follows, under the heading "each
watched failing".

## 3. What held under attack, which is evidence too

- **PH-39's mechanism survived everything.** 50 starved passes inside one outage:
  `otc_market_reopenings_total 1`, `otc_market_rearms_total 49`, `/health`
  `degraded` and `ready:false` on **every one of the 50**, recovery in 30 healthy
  passes with no operator, and the record holding **one** sequence jump, **one**
  seam, no duplicate and no decreasing sequence. Two outages with a publication
  between: exactly 2 seams. `OTC_AUTO_REOPEN=0`: nothing reopens. `retire()`
  mid-run leaves nothing behind. Six of the eight plants in PH-39.1's own table
  reproduce exactly or better.
- **PH-37.1's lattice invariance is exact, not approximate.** On a stream family
  the project had never used: EUR/USD's mean interval is **920.45 ms at ×1, ×8 and
  ×32** — identical to the last printed digit over 120,000 ticks — and BNB's
  357.21 ms likewise. The whole interval sequence survives a 32× coarsening.
- **The anti-predictability apparatus is intact.** The mirror test catches a
  planted leverage effect (4 files red, naming `stepIndependence` and `mirror`);
  the economic-blindness architecture test catches a planted `@otc/trading` import
  into the price path; `packages/trading` caught six planted defects out of six.
- **The meta-audit's own anchors are clean.** All **36 mutations / 38 edits** in
  `guardrailMetaAudit.stat.test.ts` still find their targets — Cycle Audit 8's
  silent no-op does not recur — and the build-freshness guard caught both the
  direct and the upstream case.
- **INV-004 holds for everything written since the relattice.** At one hour,
  1m (60 bars), 5m (12) and 1h (1) fold identically — `open -850 / high -813 /
low -1250 / close -1188` over 10,982 ticks. The damage in §2 is the one-off hand
  conversion and the dating of it, not the fold.
- **INV-010 on the cycle's new surfaces.** A planted keystream cursor added to
  `/markets/:id/lattices` was caught by the value-walker under a key no regex
  names. The engine snapshot is reachable only through the Lab composition.
- **Refund rates reproduce on fresh streams.** Six assets, three replicates each,
  mean difference **−0.21pp** against the recorded constants; none of the thirty
  exceeds the Human Owner's 5% ceiling.

## 4. Findings

Severity is the verdict **after** refutation where a refuter ran. `R1`, `R2` and
`R3` name which refuter, and three columns of this table say "unrefuted" — that is
a limit of this audit, recorded rather than smoothed over (§7).

| id    | finding                                                                                        | verdict                                                                                                  | severity     |
| ----- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| a6-01 | `state:verify` upgrades the record it inspects; the running release then refuses it            | CONFIRMED (R1, executed on v2.4.0's own build)                                                           | **critical** |
| a6-02 | `state:backup` carries that upgrade into the copy an operator would restore, on a schedule     | CONFIRMED, trigger worse than claimed (R1)                                                               | **critical** |
| a8-01 | a candle straddling the boundary is dated by its close; 17 of 30 live assets show a false wick | CONFIRMED by execution (conducting agent)                                                                | **critical** |
| a2-01 | the whole PH-38.3 defect can be restored and the fast gate stays green — no two-frame fixture  | CONFIRMED by execution (conducting agent)                                                                | material     |
| a2-02 | a bar the declaration refused to date is covered by the epoch below it                         | unrefuted                                                                                                | material     |
| a2-03 | `sqliteHistory`'s stated downgrade behaviour is false; a rollback cannot boot                  | CONFIRMED; escalation REFUTED (R1)                                                                       | minor        |
| a3-01 | the chart drops undatable bars silently; 24 of 30 assets show an empty 1d chart                | CONFIRMED, worse than claimed (R2)                                                                       | material     |
| a3-02 | the conformance frame check passes a venue whose frame log agrees with its own misrendering    | CONFIRMED, plant reproduced (R2)                                                                         | material     |
| a3-03 | the candle item has no contract shape, no version and no exported type; the digest cannot move | CONFIRMED in all clauses, plus one more (R2)                                                             | material     |
| a6-06 | `state:verify` is blind to a hole in the record; a native v3 record derives no seam from one   | CONFIRMED, halves inverted (R1)                                                                          | material     |
| a7-01 | the catalogue-wide sync-`it.each` guard is one identifier deep; two files already evade it     | unrefuted, reproduced by the auditor                                                                     | material     |
| a7-02 | PH-39.1 credits a guard that cannot catch its plant; the docstring contradicts the code        | unrefuted, found twice independently (a4-01)                                                             | material     |
| a8-02 | the chart’s undated block: **63.1%** of 1h bars over 20 days, 81% on `dogeusdt-otc`            | CONFIRMED, number raised and cause re-attributed (R3)                                                    | material     |
| a8-03 | `/lattices` mis-describes the integers `/history` returns for the same sequences               | **REFUTED** (R3): the candle store’s own frame is the correct one, and the guide warns against that join | minor        |
| a8-05 | 18.66% of a day inside a discontinuity — and **35.3% at the 15-minute horizon**                | CONFIRMED to the decimal, attribution REFUTED (R3): host capacity, not PH-39                             | minor        |
| a5-01 | `settle()` cannot express a frame; nothing asserts a frame boundary is a seam                  | **REFUTED as live** (R3): four mechanisms keep it true and none is tested _as_ a protection              | minor        |
| a1-1  | PH-37.1's central line has no _named_ guard                                                    | REFUTED as material (R2): the statistical gate catches it                                                | minor        |
| a1-2  | the staircase is not one at the displayed resolution; PH-37 §4 forbids what 30/30 assets do    | CONFIRMED, severity cut (R2): the rule is unsatisfiable as written                                       | minor        |
| a6-03 | nothing tells an operator that an upgraded record's past is undeclared                         | CONFIRMED, consequence false (R1)                                                                        | minor        |
| a6-04 | the candle history's version note states the opposite of what the code does                    | CONFIRMED (R1)                                                                                           | minor        |
| a6-05 | `{ readOnly: true }` is not a read-only SQLite handle; its own warning was wrong               | CONFIRMED; warning REFUTED (R1)                                                                          | minor        |
| a1-3  | PH-37.2's headline refund range does not reproduce from its own evidence                       | unrefuted, arithmetic re-executed                                                                        | minor        |
| a1-4  | the tie-rate docstring's uncertainty is ~4× too small at today's rates                         | unrefuted                                                                                                | minor        |
| a2-04 | the per-tick response carries two of the three frame fields (`displayPrecision` absent)        | unrefuted                                                                                                | minor        |
| a2-05 | the v2→v3 migration re-derives the whole seam table on the upgrading boot                      | unrefuted                                                                                                | minor        |
| a2-06 | "an epoch row can never exist without a tick at it" is false after a trim                      | unrefuted                                                                                                | minor        |
| a3-04 | the integration guide promises a broker that the frame never changes                           | unrefuted                                                                                                | minor        |
| a3-05 | PH-38.4 describes the ends-comparison its own code rejects                                     | unrefuted                                                                                                | minor        |
| a4-02 | the declaration check's disagreement case is unreachable; its fixture skips the unhost         | unrefuted                                                                                                | minor        |
| a4-03 | the venue's check compares a proxy for the property its comment states                         | unrefuted                                                                                                | minor        |
| a4-04 | `otc_seconds_since_last_pass`'s "only a completed pass" is unguarded                           | unrefuted                                                                                                | minor        |
| a5-02 | `Settlement.entryIndex`/`expiryIndex` are array indices, not record sequences                  | unrefuted                                                                                                | minor        |
| a5-03 | CA12 finding 7's +1.91pp is worth 2.0% of the margin, not the margin                           | severity cut by its own author                                                                           | minor        |
| a5-04 | `exposure.ts` understates the operator's edge per thousand stakes by 1.99×                     | unrefuted                                                                                                | minor        |
| a7-03 | the roadmap header named an approved phase as active for six phases                            | unrefuted, plant survived                                                                                | minor        |
| a7-04 | `gate.test.ts`'s spawning list names 9 of the 12 files it defends                              | unrefuted                                                                                                | minor        |
| a7-05 | `CLAUDE.md` §5's unit-suite budget is 3.5× low                                                 | unrefuted, re-measured                                                                                   | minor        |
| a7-06 | PH-39.1's live numbers are recorded nowhere re-executable                                      | unrefuted                                                                                                | minor        |
| a7-07 | `DOCS_INDEX` skips Cycle Audit 011; `CURRENT_STATE` duplicates a sentence                      | unrefuted                                                                                                | minor        |
| a8-04 | `/history` and `/price` disagree in the last displayed digit, by the continuity band's design  | unrefuted                                                                                                | minor        |

## 5. Fixed in this audit, each with a guard watched failing

| finding                                                                         | fix                                                                                                             | plant, and what went red                                                 |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| a6-01, a6-02                                                                    | the record is opened `{ readOnly: true }` in `verifyStateDirectory`                                             | the flag removed, then removed from the history open too: 2 red each     |
| a8-01                                                                           | `frameOfSpan` decides a bar's frame, so a straddling bar is undatable                                           | dated by its close again: 2 red, incl. the pre-existing anchoring test   |
| a2-01                                                                           | `apps/api/src/renderedFrame.test.ts` — a controller, a record with **two** frames, four assertions              | `frameOf` answering with the live instrument: exactly 1 red, the new one |
| a1-1                                                                            | `packages/engine/src/latticeInvariance.test.ts` — same arrivals at ×4, ×8, ×12, ×16, ×32, exactly               | the pre-PH-37.1 line restored: 2 red                                     |
| a6-06 (a), a6-03                                                                | `state:verify --deep` scans for a hole no seam declares; an undeclared past is a warning naming the repair      | a tick deleted: the deep scan names it, the boot path stays silent       |
| a3-02                                                                           | a third leg with teeth on a single-epoch venue, a `NOT PROVEN` detail, and two new faults in the matrix         | a venue rendering below its oldest declared frame: the named check fails |
| a3-01 (the silence)                                                             | `toSeries` returns `{ bars, undatable }`; the panel says how many it could not date                             | the count dropped: 1 red                                                 |
| a7-01                                                                           | the guard reads the expression `it.each` iterates, by any name, not one adjacent identifier                     | `async` dropped from a file already in the tree: red, naming the file    |
| a4-03                                                                           | the venue re-declares the feed's resume point when the reservation moved                                        | defensive; unreachable in a healthy tree, and said so here               |
| a7-02, a4-01                                                                    | the docstring and PH-39.1 §4 and §7 corrected, with why the credited guard cannot fire                          | n/a — a documentation defect                                             |
| a4-04                                                                           | a guard that a pass which **threw** does not refresh `otc_seconds_since_last_pass`                              | the assignment moved before the `try`: 1 red                             |
| a7-04                                                                           | the spawning-suite list names all twelve files that spawn a build, not nine                                     | the list is itself the assertion                                         |
| a1-2, a1-3, a1-4, a2-03, a2-06, a3-04, a3-05, a5-04, a6-04, a7-03, a7-05, a7-07 | every false or overstated claim corrected where it is written, with the measurement that contradicted it        | n/a                                                                      |
| a7-06                                                                           | [`PH-39-LIVE-2026-09-25.md`](../evidence/PH-39-LIVE-2026-09-25.md) — the measurements, and what they do not say | n/a                                                                      |

## 6. Carried, and as what

- **A lattice change must be declared inside a tick-budgeted window, and that
  belongs on the release checklist** (a8-02, and the part of a3-01 that is not the
  silence). A refuter took this apart and the finding it leaves is sharper than the
  one filed: a bar can only be dated while the tick record's retention window still
  reaches it, so the declaration tool has **hours** on `dogeusdt-otc` and **days**
  on `eurgbp-otc` after a relattice. PH-38.2's tool ran too late, and the block it
  could not date is a clean run below one fixed sequence — 63.1% of 1h bars
  catalogue-wide, 81% on the fastest asset. It does **not** degrade with uptime for
  a fixed release, and PH-38.4 already stamps the frame at fold time, so the block
  is finite and shrinks as the chart's day-based retention prunes it. What is owed
  is the step, with the budget in ticks per asset, and a release that recalibrates
  lattices without it earns another permanent block.
- **The contract must type what a chart consumes** (a3-03, a2-04): the candle item
  with a shape, a `3.1.0` entry, an exported type instead of `unknown[]`, and a
  conformance check that requests `/markets/:id/history` at all.
- **A native v3 record should refuse a contract across a hole it can detect**
  (a6-06 c). `state:verify --deep` now finds one; `settle()` still cannot see it,
  because the record it is handed carries no sequences. That is money, and it is
  `packages/trading`. (a5-01's half is closed here instead: the broker's checklist
  now asserts that every declared frame begins where a seam resumes, which turns
  four emergent protections into one named one — a refuter's own recommendation,
  and it explicitly advised against putting a frame into the settlement kernel.)
- **A lattice snapped to the decimal grid** (a1-2) is what would make the last
  digit move by one, which is what the Human Owner asked for in PH-37.
- **The boot that outruns its own bound** ([#23](https://github.com/NovaHub2026/otcv6/issues/23)),
  the reopening that writes before the lease renewal
  ([#24](https://github.com/NovaHub2026/otcv6/issues/24)) and the silent exhausted
  market ([#25](https://github.com/NovaHub2026/otcv6/issues/25)) stay open.
- **Cycle Audit 12's finding 7** — the calibration that simulates a market the
  engine does not run, +1.91pp of refund bias, worth 2.0% of the margin (a5-03) —
  is Cycle 14's first phase.
- Minor and named, not fixed here: a2-05 (the migration re-derives the seam
  table — a refuter advised explicitly **not** to bound it, because suppressing
  an implausible seam converts a fail-closed case into the fail-open one above),
  a4-02 (a guard whose fixture production cannot reach), a5-02
  (`entryIndex`/`expiryIndex` are array indices, so INV-009’s citation is not
  portable between two brokers holding different windows), a6-05 (the read-only
  flag is not a read-only handle, so no claim of byte-identity after an
  inspection can be true), a8-04.

### What a refuter added that no auditor filed

**One starved event loop is thirty recorded discontinuities.** Of the 1,762 seams
this venue wrote in a day, 45 of 51 stalls seamed **all thirty markets within
sixty seconds**, because the catch-up bound is per process. Every availability
number this project reads — `otc_market_reopenings_total`, the seam count, a8-05's
19% — therefore multiplies one event by thirty, and the next reader of those
numbers will reach for the engine when the answer is the host. An availability
metric should count stall _events_; this one counts their shadows.

## 7. Findings about this audit

- **Three refuters covered five auditors' areas.** a4's, a5's, a7's and a8's
  findings were dispatched to a refuter late, and the table above says
  "unrefuted" for twenty of the forty-one. Every critical and all but four
  materials were refuted; the minors largely were not.
- **One auditor reproduced the defect it was sent to look for.** a1 wrote
  `(npx vitest … | tail); echo EXIT=${PIPESTATUS[0]}`, captured the subshell's exit
  and printed `EXIT=0` over a run with two red files — the `| tail` defect
  `CLAUDE.md` §5 exists to warn about. Its verdicts rest on the printed
  `N failed / N passed` lines instead, and it said so itself.
- **The RAM budget shaped the audit.** This host has 7 GB and eight auditors
  shared it, so no auditor ran the statistical suite or the gate. Two findings
  (a1-1's severity, and whether the 36 mutations still go red) turned on exactly
  that, and one of them was refuted the moment a refuter ran a single statistical
  file.
- **The conducting agent wrote all three phases audited here.** Everything in §2
  was found by somebody else.
- **The host decided three gates in one day, for three different reasons, and the
  third was the audit itself.** A live venue publishing beside the gate cost the
  PH-39 tree three statistical failures; eight auditors sharing 7 GB kept every
  auditor off the statistical suite; and then **2.6 GB of this session's own copies
  of the live state directory, sitting in `/tmp` — which is a tmpfs on this box, so
  they were resident RAM — exhausted the 2 GB of swap** and cost two more gates,
  each losing one of the two heaviest statistical files at the 30-minute ceiling
  while both passed alone at their normal 84 s and 262 s. Freeing that footprint,
  and the 3.8 GB of dependencies the eight worktrees held, took the statistical
  suite from **5,461 s to 3,340 s** and the gate went green on the same tree,
  unchanged. Two lessons, and the second is the uncomfortable one: a red gate here
  is a claim about the host until proved otherwise, **and an audit that materialises
  eight worktrees and copies a 520 MB state directory is itself the load that makes
  the gate unmeasurable.** Clean up before gating.
