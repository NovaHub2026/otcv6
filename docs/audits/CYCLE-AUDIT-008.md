# Cycle Audit 008

Type: CYCLE AUDIT RECORD
Status: OPEN — 60 findings confirmed, 18 closed here, 42 tracked
Cycle audited: Cycle 8 (PH-22, PH-23, PH-24)
Commit audited: `d1aa02c`
Conducted: 2026-09-04
Auditors: eight independent agents, one git worktree each (B-020)

---

## 1. What was audited, and how

Eight auditors, each with its own worktree at `d1aa02c` and its own
`node_modules`, running concurrently and unable to see each other's plants.
Every finding was then put to an independent refuter told to attack it and to
default to refuted when uncertain.

| Auditor | Subject                                                    |
| ------- | ---------------------------------------------------------- |
| a1      | The ten invariants, attacked directly                      |
| a2      | The gate as an instrument                                  |
| a3      | PH-22: distribution under thousands of observers           |
| a4      | The Lab's isolation and its operator surface               |
| a5      | The engine recalibration of PH-24.17 and the distance unit |
| a6      | State integrity, settlement and recovery                   |
| a7      | The records: documentation, cold start, memory, Git/GitHub |
| a8      | Implementation quality, and what the tests do not cover    |

**86 claims, 60 survived refutation** — 22 material, 38 minor, none critical
after refutation. Twenty-six did not survive, which is the refuter doing its
job: the sharpest of them is in §3.

The audit was interrupted twice by the process running it and resumed from the
agents' own transcripts, which is why it is recorded as one audit and ran as
three. Nothing was lost: every auditor's findings and every verdict is in
`~/.otc-audit8/all-findings.json`, and the counts here are computed from it.

## 2. The finding that matters most

**A production process could resume a state directory a Lab wrote, and serve an
operator's chosen prices as a real market.**

ADR-0018 puts the Lab-composed process on "the engine's port and state
directory", and the local launcher does exactly that: one environment variable
switches the same directory between the two compositions. Nothing noticed.
`VenueService.start()` resumed the checkpoints the Lab wrote,
`/markets/:id/history` served the Lab's candles as genuine history,
`/markets/:id` reported `recovery: {"kind":"resumed"}` — the same word a clean
restart produces — and the Lab's own session file, listing every act, sat unread
in the same directory.

ADR-0018 §3's "production is never Lab-composed" held for the _process_ and not
for the _record_. A market whose prices a human chose among futures becomes a
production market by a redeploy, and a position settled against it is neither
economically blind (INV-001) nor reproducible as production's (INV-009).

Closed here: the Lab marks its state directory before it publishes its first
tick, and production refuses to start on a marked one, naming the file and both
remedies. There is no environment variable to wave it through — an override is
a thing a deployment template sets once and nobody reads again. Verified end to
end with the real binaries.

## 3. What the audit found about its own method, and about the mirror family

The most alarming claim of the audit did not survive, and what replaced it is
still worth knowing.

An auditor planted the banned mechanism — a leverage effect, volatility
responding to the signed return — behind `environment === 'production' &&
sequence > 10_000`, and reported that it survived **everything**: the whole unit
project (126 files, 2,555 tests), `economicBlindness.stat.test.ts` and
`redTeam.stat.test.ts`, while measuring **+4.51pp** of directional edge at a
two-tick horizon.

The refuter reproduced the plant faithfully and found one layer that does catch
it: `labQuality.stat.test.ts` runs the real battery over a million-plus ticks
generated in `environment: 'production'` and turns red with
`expected 'exploitable' to be 'clean-above-resolution'`. The finding was
refuted as stated — the project's evidence layer is not blind — and downgraded
to minor.

What remains true, and is worth recording plainly:

- **The mirror family is blind to a window-gated mechanism.**
  `productionComposition.test.ts` — the only mirror test that drives the shipped
  factory under `environment: 'production'` — caps at 8,000 burn-in plus 2,000
  compared ticks, one below the gate the auditor chose. That is Cycle Audit 7's
  CA7-01 finding, still open, and PH-24.17 made it _worse_: after the
  recalibration those 10,000 ticks are **18.5 minutes** of btcusd's life, not
  the "under an hour" ADR-0003 §6 still claims (a1, minor, open).
- **What catches it is one statistical file**, and that file is the Lab's. A
  battery that runs on the published record of a _production_ venue does not
  exist (a1, material, open).

## 4. Findings

Every row survived an independent refuter. `fixed` names the commit that closed
it; `open` means recorded and tracked, not dismissed.

| #   | Auditor | Weight   | Finding                                                                                                                                                                           | Where                                                  | State               |
| --- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------- |
| 1   | a1      | material | The INV-010 keystream-cursor guard is defeated by not writing the word `cursors`; a production route can serve an exact future-price oracle with the whole suite green            | `apps/api/src/labSurface.test.ts`                      | fixed `ce2a544`     |
| 2   | a1      | material | `composition.test.ts` does not close the door it says it closes: a steering sign source reaches every production market from a subdirectory, with all 2,555 tests green           | `apps/api/src/composition.test.ts`                     | fixed `ce2a544`     |
| 3   | a2      | material | Two wrong-value defects in the audited cycle's own Lab UI survive every step of npm run gate — and both browser suites with a real Chromium                                       | `apps/web/src/app/lab/lattice.ts`                      | fixed `ce2a544`     |
| 4   | a2      | material | A one-line exclude deletes any statistical suite with every gate step green — including the guard written for exactly that defect (CA7-16)                                        | `vitest.config.ts`                                     | fixed `396c0f4`     |
| 5   | a3      | material | The multiplexed stream treats `Last-Event-ID` as "next sequence", so every automatic browser reconnect redelivers one tick per asset                                              | `apps/api/src/market.controller.ts`                    | fixed `769ce80`     |
| 6   | a3      | material | The load harness reports a fleet whose streams the server truncated and closed as complete, with zero gaps                                                                        | `tools/sim/src/observerLoad.ts`                        | open                |
| 7   | a3      | material | The three harness options that produced PH-22.2's and PH-22.3's headline tables have no caller in the repository and no test; three plants against them all survived              | `tools/sim/src/observerLoad.ts`                        | open                |
| 8   | a3      | material | The evidence document's stated reason the replay ceiling did not engage is wrong, and points the follow-up work at the wrong lever                                                | `docs/evidence/CYCLE-8-OBSERVER-LOAD.md`               | open                |
| 9   | a4      | material | The panel's /lab proxy rewrites the write's Content-Type to application/json, turning a no-preflight cross-origin POST into an authenticated Lab write                            | `apps/web/src/app/lab/[...path]/route.ts`              | fixed `ce2a544`     |
| 10  | a4      | material | The /lab proxy pastes URL path segments unvalidated, so `..` escapes the /lab prefix and reaches the engine's admin routes carrying the operator's token                          | `apps/web/src/app/lab/[...path]/route.ts`              | fixed `ce2a544`     |
| 11  | a4      | material | Production can be given the Lab under an environment flag and every apps/api test still passes: the composition boundary is a text scan for `from './lab/'` only                  | `apps/api/src/labSurface.test.ts`                      | fixed `ce2a544`     |
| 12  | a4      | material | Production silently resumes a state directory a Lab-composed engine wrote, and republishes the operator-selected price path as a real market                                      | `apps/api/src/main.ts`                                 | fixed `ce2a544`     |
| 13  | a5      | material | PH-24.17's acceptance criterion 2 is not met on the shipped catalogue, and no test enforces any part of it                                                                        | `docs/phases/PH-24.17-granularidad-del-tick.md`        | open                |
| 14  | a5      | material | The Escenarios tab takes distances in units and labels every one of them «pasos»                                                                                                  | `apps/web/src/lib/es.ts`                               | fixed `769ce80`     |
| 15  | a6      | material | A Lab market killed mid-script republishes the same sequence numbers with different prices, and the runtime calls it `resumed`                                                    | `packages/runtime/src/resume.ts`                       | open                |
| 16  | a6      | material | A production process resumes a Lab-manipulated record silently: no marker in the state record, no line in the boot log, `recovery.kind: "resumed"`                                | `packages/runtime/src/state.ts`                        | fixed `ce2a544`     |
| 17  | a6      | material | A push over an armed close silently ends a sustained direction and writes a `bias.expired` record for an expiry that has not happened                                             | `apps/api/src/lab/lab.controller.ts`                   | fixed `ce2a544`     |
| 18  | a7      | material | The hosted Statistical Gate can no longer finish: 19 of 42 files never ran, including every suite carrying the project's core anti-predictability evidence                        | `.github/workflows/ci.yml`                             | fixed `fa362e4`     |
| 19  | a7      | material | CURRENT_STATE's EXACT NEXT LEGAL ACTION names PH-22.1 — an APPROVED phase — and the CA7-11 guard written to prevent exactly this passes on an incidental mention of a past audit  | `CURRENT_STATE.md`                                     | fixed `this commit` |
| 20  | a8      | material | One unauthenticated Lab GET blocks the whole engine process: the close window and the sign sampler are both unbounded by request parameters                                       | `apps/api/src/lab/lab.controller.ts`                   | fixed `396c0f4`     |
| 21  | a8      | material | A Lab HTTP error body is stored as market state and white-screens the panel                                                                                                       | `apps/web/src/app/lab/Lab.tsx`                         | fixed `ce2a544`     |
| 22  | a8      | material | LAB_MIN_HYPOTHESES = 100 — the CA7-05 fix — is pinned by a test that passes for the wrong reason, and the docstring's measured table is stale                                     | `apps/api/src/lab/lab.controller.ts`                   | open                |
| 23  | a1      | minor    | ADR-0003 §6 and `mirror.ts` state a mirror-window figure that PH-24.17 invalidated inside the same cycle, understating the blind window threefold                                 | `docs/decisions/ADR-0003-conditional-sign-symmetry.md` | open                |
| 24  | a1      | minor    | A dead sub-expression exempts `venue.service.ts` from the INV-010 cursor scan and hides that it was exempted                                                                      | `apps/api/src/labSurface.test.ts`                      | fixed `769ce80`     |
| 25  | a2      | minor    | npm run gate silently skips the entire browser layer, and the recorded evidence line cannot tell a skipped run from a real one                                                    | `package.json`                                         | open                |
| 26  | a2      | minor    | artifacts/unit-results.json reports success: true for a run that exited 1                                                                                                         | `package.json`                                         | open                |
| 27  | a2      | minor    | CLAUDE.md section 5's operational numbers are stale in three places, including a gate duration off by more than the project's own record                                          | `CLAUDE.md`                                            | open                |
| 28  | a2      | minor    | Coverage is measured accurately and enforces nothing: no threshold, and test:cov is not a gate step                                                                               | `vitest.config.ts`                                     | open                |
| 29  | a3      | minor    | `MEASURED_BYTES_PER_TICK` is pinned by no test and disagrees with re-measurement by 46%; the test titled "at the cost it says" measures no cost                                   | `packages/distribution/src/feed.ts`                    | open                |
| 30  | a3      | minor    | `feed.ts` claims the retention cost is named in `MULTI_NODE_AND_OPERATIONS.md`; it is not                                                                                         | `packages/distribution/src/feed.ts`                    | open                |
| 31  | a3      | minor    | `MAX_MULTIPLEXED_ASSETS` is guarded by no test, and its stated rationale does not hold                                                                                            | `apps/api/src/market.controller.ts`                    | open                |
| 32  | a3      | minor    | A multiplexed response is never ended on shutdown, contradicting the shutdown handler's own docstring                                                                             | `apps/api/src/market.controller.ts`                    | open                |
| 33  | a4      | minor    | `npm run dev` starts the panel on every interface, publishing the token-signing write proxies to the LAN; only the `start` script is pinned                                       | `apps/web/package.json`                                | open                |
| 34  | a4      | minor    | The labengine proxy's "no token is forwarded" assertion is vacuous: the test never sends an authorization header                                                                  | `apps/web/src/app/labengine/labEngineProxy.test.ts`    | open                |
| 35  | a4      | minor    | setBias stores a Lab error body as this market's control, the defect isControl was added to prevent                                                                               | `apps/web/src/app/lab/Lab.tsx`                         | fixed `ce2a544`     |
| 36  | a5      | minor    | Four realism metrics silently changed the span of market time they measure, and only one is recorded                                                                              | `packages/lab/src/realism.ts`                          | open                |
| 37  | a5      | minor    | `unitSteps ?? 1` silently reverts every distance control to lattice steps when state is missing                                                                                   | `apps/web/src/app/lab/Lab.tsx`                         | open                |
| 38  | a5      | minor    | The distance unit is measured on the fork's next thirty minutes and can differ by 4× from the candles the operator is looking at                                                  | `apps/api/src/lab/lab.controller.ts`                   | open                |
| 39  | a5      | minor    | `recalibration.test.ts`'s claim that the continuation is the new personality's does not guard                                                                                     | `packages/engine/src/recalibration.test.ts`            | open                |
| 40  | a5      | minor    | PH-24.17's step-p90 before→after column is inverted for the two ÷3 assets                                                                                                         | `docs/phases/PH-24.17-granularidad-del-tick.md`        | open                |
| 41  | a5      | minor    | CURRENT_STATE.md and asset.ts carry the pre-PH-24.17 at-the-money rates and the wrong provenance                                                                                  | `CURRENT_STATE.md`                                     | open                |
| 42  | a5      | minor    | The tick-count-sized resume window and the retention cost note lost 3-4× of their meaning in time, unrecorded                                                                     | `packages/distribution/src/feed.ts`                    | open                |
| 43  | a5      | minor    | PH-24.17's approved document ends in an unanswered question                                                                                                                       | `docs/phases/PH-24.17-granularidad-del-tick.md`        | open                |
| 44  | a6      | minor    | `SelectableArrival.seek`'s release-on-seek rule is unguarded: removing it passes all 645 unit tests in apps/api and packages/runtime                                              | `apps/api/src/lab/selectableArrival.ts`                | open                |
| 45  | a6      | minor    | A torn last line in the Lab session file destroys the first record the next process writes, and the skip count hides it                                                           | `apps/api/src/lab/sessionFile.ts`                      | open                |
| 46  | a7      | minor    | Hosted CI is red on the audited commit and no record says so; CURRENT_STATE's verification block is three phases stale                                                            | `CURRENT_STATE.md`                                     | open                |
| 47  | a7      | minor    | SESSION_HANDOFF.md is entirely pre-merge, and no guard reads the rows that are wrong                                                                                              | `SESSION_HANDOFF.md`                                   | open                |
| 48  | a7      | minor    | docs/architecture/ has no mention of the OTC Market Lab, under a header saying that what is absent does not exist — the same defect Cycle Audit 4 found and this document records | `docs/architecture/OVERVIEW.md`                        | open                |
| 49  | a7      | minor    | CLAUDE.md's suite counts and gate timings are wrong by large factors, in the section that tells an agent how long to budget                                                       | `CLAUDE.md`                                            | open                |
| 50  | a7      | minor    | CURRENT_STATE's Relevant records table stops at ADR-0016; ADR-0017 and ADR-0018 were created this cycle and are cited by the phase documents                                      | `CURRENT_STATE.md`                                     | open                |
| 51  | a7      | minor    | CURRENT_STATE's Branch and Backlog rows are stale: three merges and one closed Issue unrecorded                                                                                   | `CURRENT_STATE.md`                                     | open                |
| 52  | a7      | minor    | CURRENT_STATE is dated a day before the events it describes                                                                                                                       | `CURRENT_STATE.md`                                     | open                |
| 53  | a8      | minor    | The Lab's session file — what PH-24.8 calls the audit record — has no test; making append() a no-op passes everything                                                             | `apps/api/src/lab/sessionFile.ts`                      | open                |
| 54  | a8      | minor    | Nothing boots LabModule; lab.module.ts claims a `labModule.test.ts` that does not exist                                                                                           | `apps/api/src/lab/lab.module.ts`                       | open                |
| 55  | a8      | minor    | §36's reachability bands are unpinned: making every close read 'Easy' passes 627 tests                                                                                            | `packages/engine/src/closeSelection.ts`                | open                |
| 56  | a8      | minor    | The engine timeline's transitions are asserted only monotonically, so an observer that records nothing after first sight passes                                                   | `apps/api/src/lab/engineEvents.test.ts`                | open                |
| 57  | a8      | minor    | The sided close's strictness is untested: 'above the mark' could accept a close exactly on the mark, which ADR-0007 refunds                                                       | `apps/api/src/lab/closeControl.ts`                     | open                |
| 58  | a8      | minor    | The panel's 1 s poll has no in-flight guard, no ordering token and no request timeout                                                                                             | `apps/web/src/app/lab/Lab.tsx`                         | open                |
| 59  | a8      | minor    | LabPositions.actual swallows every settlement exception and reports it as 'not settled yet'                                                                                       | `apps/api/src/lab/positions.ts`                        | open                |
| 60  | a8      | minor    | selectCloseWhere's docstring states an attainability rule that is false, and the code's pre-scan implements it                                                                    | `packages/engine/src/closeSelection.ts`                | open                |

## 5. What the plants say about the guards

Seven of the eight auditors planted; between them **89 plants**, each applied to
a clean worktree, run, and restored. What survived is the audit's real product.

**Survived the whole gate (a2, four plants).** A wrong price — one lattice level
added to every mark an operator chooses — and an off-by-one in the countdown
both passed format, build, both typechecks, lint, the unit project and _both
browser suites with a real Chromium_. So did one `exclude` line deleting all
seventeen browser tests from collection, and `rm packages/engine/src/mirror.test.ts`
— 438 lines, every cheap gate step exit 0 at 125 files, nothing comparing
against a baseline. The first three are closed here; the fourth is the same
shape as CA7-16 from the other side and is tracked.

**Survived every structural guard (a1, four plants).** A steering sign source
composed from a new subdirectory biased every production market 6.25% toward up
with `main.ts` untouched, and a production route spreading `snapshotEngine()`
served all seven keystream cursors and predicted thirteen of thirteen
subsequent published ticks. Both are closed here: the scans recurse, the import
match covers any specifier, and the cursor guard is about the value rather than
the word.

**Caught by the wrong test (a2).** A symmetric one-lattice refund tolerance in
`settle.ts` — a broken settlement — passed all 55 tests in `packages/trading`,
including its own settlement mirror, and was caught only by an incidental
PH-24.3 route test in the Lab. Tracked.

**Caught cleanly.** a3 caught 13 of 14 plants against the distribution layer;
a6 caught its runtime and settlement plants; a7's three documentation plants
each failed the guard written for them. The guards that work, work.

## 6. What the audit could not check

Recorded because an audit that does not say where it did not look is worth
less than it appears.

- **No auditor ran a full `npm run gate`.** Eight agents shared one machine and
  the statistical suite is over an hour on its own; each ran the gate as its
  separate steps, or targeted subsets. a2 ran every step but not in one
  sequence.
- **Nothing above 120 simultaneous observers was measured** (a3). PH-22's
  headline numbers were not re-derived at scale; what was re-derived is that
  the harness that produced them reports truncated streams as complete.
- **The merged coverage figure was never obtained** (a8): `npm run test:cov`
  was still inside the instrumented statistical project after 85 minutes. The
  24% unreachable-file figure is over the unit project alone.
- **The browser leg of the CSRF finding was argued and demonstrated with
  `curl`, not driven from a page** (a4). The proxy fix closes it either way.
- **PH-24's own `PHASE_GATE_EXIT=0` was not re-executed** (a7). Hosted CI is
  the corroborating layer, and on the audited commit it was red — for the two
  reasons `fa362e4` fixes, neither of them a product defect.

## 7. Verification

Only executed checks are reported (§68).

| Check                                                                               | Result                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Eight auditors, one worktree each at `d1aa02c`, dependencies installed per worktree | 86 findings                                                                                                                   |
| Every finding put to an independent refuter, defaulting to refuted                  | 60 survived, 26 refuted                                                                                                       |
| Fixes closed here, each with a guard watched failing against the defect it names    | 18 findings across `ce2a544`, `769ce80`, `396c0f4`, `fa362e4` and this commit; 23 plants                                      |
| Unit project after the fixes                                                        | 126 files / 2,555+ tests, green                                                                                               |
| `guardrailMetaAudit.stat.test.ts` after the anchor repair                           | 35 tests, exit 0                                                                                                              |
| Lab marks its state directory, production refuses it                                | executed against the built binaries, exit 1 with the refusal                                                                  |
| Hosted CI                                                                           | `fa362e4` running at the time of writing; the previous run was red for a per-test ceiling and a meta-audit anchor, both fixed |

## 8. What closing this audit requires

Per §32, the remaining 42 findings are tracked rather than resolved, and the
audit stays **OPEN** until they are triaged into fixes or Issues. The six
material ones still open are, in the order they should be taken:

1. **A Lab market killed mid-script republishes the same sequence numbers with
   different prices, and the runtime calls it `resumed`** (a6). Two observers
   either side of a restart hold irreconcilable histories.
2. **The load harness reports a fleet whose streams the server truncated as
   complete, with zero gaps** (a3) — the instrument that produced PH-22's
   headline tables.
3. **Three harness options behind those tables have no caller and no test**
   (a3); three plants against them survived.
4. **PH-24.17's acceptance criterion 2 is not met on the shipped catalogue, and
   no test enforces any part of it** (a5).
5. **`LAB_MIN_HYPOTHESES = 100` — CA7-05's fix — is pinned by a test that
   passes for the wrong reason** (a8).
6. **The evidence document's stated reason the replay ceiling did not engage is
   wrong** (a3), pointing follow-up work at the wrong lever.
