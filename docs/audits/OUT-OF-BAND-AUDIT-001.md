# Out-of-band Audit 001

Type: CYCLE AUDIT RECORD (out of band)
Status: IN PROGRESS — findings recorded; remediation on `feature/out-of-band-audit`
Trigger: the Human Owner, 2026-09-02 — "analyse the whole project, audit it for
errors, inconsistencies and improvements, and fix everything you find"
(`GOVERNANCE.md` §29 and §33 both name an explicit Human request as sufficient)
Commit audited: `36bbf89` (identical tree to `3a5f0a5` on `main`)
Conducted: 2026-09-02
Auditors: seven independent agents, one git worktree each (B-020)
Cycle position: Cycle 7, after PH-19 and PH-20, with PH-21 ACTIVE. This audit
does **not** reset the cycle counter; Cycle Audit 7 still runs after PH-21.

---

## 1. What was audited, and how

Seven auditors, each with its own worktree under `~/.otc-audit7/` at `36bbf89`
and a symlinked `node_modules`, running concurrently and unable to see each
other's plants. Every auditor was told to falsify rather than confirm, to
re-execute recorded claims rather than read them, to plant defects against every
guard in its subject, and to report findings about the audit's own limits
(§28.1). Reports were required to carry the command and its output for every
finding.

| Auditor | Subject                                                                   |
| ------- | ------------------------------------------------------------------------- |
| a1      | The gate as an instrument, and why hosted CI is red                       |
| a2      | Every guardrail watched failing, and the evasions one syntactic form wide |
| a3      | `packages/core` and `packages/engine`: determinism, sign-blindness, the pipeline |
| a4      | `packages/lab`, `packages/fixtures`, `tools/sim`, and the evidence         |
| a5      | `packages/runtime`, `packages/trading`, `packages/distribution`, `packages/chart` |
| a6      | `apps/api` and `apps/web`: the operator surface and its browser suite     |
| a7      | Documentation, process, Memory Audit, Cold Start Audit, Git/GitHub        |

The audit was interrupted twice — a host reboot and an API rate limit — and every
auditor resumed from its persisted transcript; every report states what was
re-executed after the interruptions. Another Claude session was working on
PH-21.2 and PH-21.3 in the main working tree throughout; the audit and its fixes
were kept on a separate branch in a separate worktree, and the two sessions
agreed a split in writing (`SESSION_HANDOFF.md`).

**Findings: 83**, of which 6 are critical. Every one carries the command that
produced it. Fixes are recorded per finding in §7.

## 2. The findings that matter most

**The structural gate for INV-006 reflects through the origin, not through an
interior price (a3-01).** ADR-0003 §6 specifies the mirror test as: run to an
interior index N, snapshot, continue two runs with the sign negated only after
N. `runMirrorTest` negates the sign from tick 1, so the mirrored path is exactly
`−p(t)` and any level dependence with `f(−p) = f(p)` — parity, distance to a
round number, support and resistance — leaves latent state bit-identical.
Planted: a 3× volatility field keyed to `price mod 1000`, in `engine.ts`, under
`environment: 'production'`, for all five catalogue assets. The shipped gate
passed it, 19 of 19 tests. The interior-snapshot harness caught it on every
asset. Every "mirror test: zero divergences" line since PH-3 is true of
reflection through zero only. The statistical battery's level-anchored families
remain as defence in depth, which is exactly the layer PH-2 showed a conventional
battery blind to.

**The shared lexer behind every guardrail can be blinded by idiomatic code
(a2-01, a2-02).** A regular expression after a keyword (`return /[/*]/`) is
read as division, its `/*` opens a spurious block comment, and everything to a
later `*/` in a string disappears from the scan — including a static
`@otc/engine` import in `follower.ts`, the exact outcome PH-16.2 recorded as
closed. A backtick inside `${}` desynchronises two of the three scanners the
same way. This is the third recurrence of the CA5-05/CA6-03 class.

**Hosted CI has been red on every push to `main` since the PH-18 merge, and the
cause was never the ones recorded (a1-01, a7-03).** Six pushes, five red, one
cancelled, always with every test passing and one
`Timeout calling "onTaskUpdate"`. Four causes were written down as settled. The
mechanism, from Vitest's source and a ten-line reproduction: the worker sends a
task update at each test boundary and reads the reply in the event loop's poll
phase; a test that runs sixty seconds of synchronous work from its first line
reads it after the timer has fired. The file is `sampledCatalogue.stat.test.ts`,
whose last test runs 55 s locally and 92–94 s hosted with no loop turn at all.
The watchdog added in PH-21.1 could not see it: `afterAll` is reached through
microtasks and the timer never got another turn (a1-02).

Confirmed on the hosted runner itself: a probe wrapping the worker's RPC
channel, pushed on the audit branch before any fix (run 33633223386), recorded
`onTaskUpdate answered after 57.5s (sent 13:06:41 during sampledCatalogue.stat.test.ts)`
— that run went green by two and a half seconds on a faster runner, which is
what "one run in five" and "8 % of headroom" look like from the inside.

**PH-19's approval says "hosted CI green on the same tree"; it was green on a
different tree and red on the approval tree (a7-01).** The green run was a
dispatch on PH-19.1's commit before the other four subphases existed. PH-20 was
approved with CI pending. Neither approval stands under `GOVERNANCE.md` §40.1
until a hosted run is green on a tree that contains them.

**The operator surface has no authentication, and CORS does not protect a
retire (a6-01).** `POST /assets/:id/retire` carries no body and no custom
header, so it is a CORS simple request: a browser sends it without a preflight
and the server executes it. Demonstrated from `Origin: http://evil.example`:
`201 Created`, market retired — irreversibly, by the 2026-09-02 decision. The
service also binds every interface.

**Every recorder handoff stores a partial minute bar labelled whole (a5-01).**
Restart, failover and the backfill→live join each start a fresh
`HistoryRecorder` mid-minute, and the bar it closes carries a wrong open, a wrong
high or low and a wrong tick count into the permanent base tier. Cycle Audit 6
found and fixed this one tier up (CA6-06); the minute tier inherited it.

## 3. Critical

| ID    | Finding                                                                                          | Auditor |
| ----- | ------------------------------------------------------------------------------------------------ | ------- |
| a3-01 | The mirror test reflects through the origin; an origin-symmetric level leak passes it unchanged  | a3      |
| a2-01 | A regex after a keyword blinds all three `sourceScan` scanners, the follower guard included      | a2      |
| a2-02 | A backtick inside `${}` blinds two of the three scanners                                         | a2      |
| a1-01 | Hosted CI is red because one test runs 92 s without a loop turn with a request in flight         | a1      |
| a7-01 | PH-19's approval claims a hosted CI result it did not have; PH-20's was pending                  | a7      |
| a7-02 | PH-21.1 reached `main` unapproved; the feature branch duplicates it and carries PH-21.3 out of order | a7   |

## 4. Material

### The instrument

| ID    | Finding                                                                                              | Auditor |
| ----- | ---------------------------------------------------------------------------------------------------- | ------- |
| a1-02 | The watchdog never measures a file's tail; a 65 s block reported nothing                             | a1      |
| a1-03 | `disableConsoleIntercept` never applied to either project; the CA6-02 remedy was inert               | a1      |
| a1-04 | Two unit tests of 25–31 s are synchronous and pass a 20 s timeout that cannot see them              | a1      |
| a1-05 | The panel suite orphans a `next-server` for the rest of the CI job                                   | a1      |
| a1-06 | `npm run gate` and `ci.yml` differ in five ways (browser requirement, heap, cancellation)             | a1      |
| a4-01 | The quoted MDE is a single-test figure; the gate's 50%-power point at 30 s is ≈ 0.45–0.5 pp          | a4      |
| a4-02 | Temporal families alias against the clock grid: one phase in six tested at every horizon ≥ 1 m       | a4      |
| a4-03 | The founding look-ahead bug class has no unit guard                                                  | a4      |
| a4-04 | The standing verdict never runs the learned family                                                   | a4      |
| a4-05 | B-029's evidence is inside the realised estimator's own noise                                        | a4      |
| a4-06 | "Targets fixed before the model existed" is not supported by the record                              | a4      |

### The guards

| ID    | Finding                                                                                              | Auditor |
| ----- | ---------------------------------------------------------------------------------------------------- | ------- |
| a2-03 | `guardrails.test.ts` scans `.ts` only; `.mts`/`.tsx`/`.js` in the generation path are invisible      | a2      |
| a2-04 | `tools/sim/src` is in neither enforcement layer                                                      | a2      |
| a2-05 | Computed access, unicode escapes and indirection defeat every textual scan                           | a2      |
| a2-06 | `publishingKey.test.ts`'s refusal check is a substring a dead string satisfies                       | a2      |
| a2-07 | `testCost.test.ts` recognises one loop shape                                                         | a2      |
| a2-08 | Subphase pointers, the lifecycle row, the handoff and a "reverted" status are unguarded              | a2      |
| a2-09 | `traceability.test.ts` compares the status cell as an exact string                                   | a2      |
| a2-11 | Three guard files have no meta-audit mutation                                                        | a2      |
| a3-02 | The mirror test's own level-leak self-check is vacuous                                               | a3      |

### The engine and the catalogue

| ID    | Finding                                                                                              | Auditor |
| ----- | ---------------------------------------------------------------------------------------------------- | ------- |
| a3-03 | `clustering: 0` is inside `TRAIT_BOUNDS` and no engine can be built from it                          | a3      |
| a3-04 | Ids of 52–64 characters pass identity and fail at `safety` with a stream-label error                 | a3      |
| a3-05 | The clamp and the retreat author a tail weight below the family's band, unrecorded                   | a3      |
| a3-06 | Three refusals name the wrong stage; one after paying for the whole calibration                      | a3      |

### Runtime, persistence and the surface

| ID    | Finding                                                                                              | Auditor |
| ----- | ---------------------------------------------------------------------------------------------------- | ------- |
| a5-01 | The minute tier stores a partial bar at every recorder handoff                                       | a5      |
| a5-02 | The retention boundary B-017 closed is untested; `>=` passes all 24 tests                            | a5      |
| a5-03 | One transient `appendTicks` failure wedges a `LeaderSession` for ever, with no seam                  | a5      |
| a6-01 | The write surface is unauthenticated; CORS does not protect a simple-request retire                  | a6      |
| a6-02 | Concurrent overlay writes lose updates and return 500; a rename can un-retire at the next boot       | a6, a5  |
| a6-03 | Chromium cannot launch on this host; the recorded gate evidence says the browser layer ran            | a6      |
| a6-04 | The stream answers 500 for a future sequence; an `EventSource` then never reconnects                 | a6      |
| a6-05 | The stall log's dedup key contains the number that changes; a stalled venue floods                   | a6      |

### The record

| ID    | Finding                                                                                              | Auditor |
| ----- | ---------------------------------------------------------------------------------------------------- | ------- |
| a7-03 | CI red on six pushes; the documents say three and record four settled causes                         | a7      |
| a7-04 | GitHub Issues are enabled; the backlog says they are not (Cycle Audit 4 recurrence)                  | a7      |
| a7-05 | "40 of 46" Cycle Audit 6 findings closed is not reconstructible; CA6-39 tracked nowhere              | a7      |
| a7-06 | The backlog's Open table is mostly closed items; B-027/B-028 never existed                           | a7      |
| a7-07 | `CLAUDE.md` recommends the bare command Cycle Audit 6 found runs files in parallel                   | a7      |
| a7-08 | B-023 still true: PH-13/14/15's layers appear in no architecture document                            | a7      |
| a7-09 | `CURRENT_STATE.md`'s limitations carry Cycle-5 statements as current                                 | a7      |
| a7-10 | The roadmap is stale in header, structure and "pending Human decisions"                              | a7      |
| a7-11 | Three of PH-19's five subphases record no plants; the phase document asserts one each                | a7      |
| a7-12 | `CLAUDE.md`'s timings and gate description no longer describe the gate                               | a7      |
| a7-13 | `PROJECT_CONTEXT.md` is stale against the guard it calls canonical                                   | a7      |
| a7-14 | B-022 and the closure of CA6-09 contradict; no coverage measured since 2026-08-31                    | a7      |
| a7-15 | ADR-0008 unannotated (B-024); a phantom path; the decision log's rule not followed                   | a7      |
| a7-16 | `GOVERNANCE.md` internal contradictions — thirteen, for the Human Owner (§5.1)                       | a7      |

## 5. Minor

a1-07 (causes recorded without reproduction), a1-08 (B-030 mechanism candidate;
the gate captures no identities), a2-10 (`publicSurface` sees top-level `.ts`
only), a2-12 (undeclared and aliased imports unpoliced), a3-07 (display precision
negative or infinite), a3-08 (mirror-gate resolution), a3-09 (parity-keyed
volatility is not a leak), a3-10 (magic numbers), a3-11 (unused exports), a3-12
(retreat retries every error), a3-13 (trailing dot in ids), a3-14 (no watchdog
in the unit project), a4-07 (three realism ratios ill-posed near zero), a4-08
(two realism bands are integrity constraints), a4-09 (VALIDATION.md counts
stale), a4-10 (evidence numbers no test asserts), a4-11 (a tie counts as
separation), a4-12 (equal instants at a boundary), a5-04 (leading-edge rule
depends on the window), a5-05 (B-019 confirmed: 138/400 seeds diverge on
batch duplicates), a5-06 (synchronous throw on `SQLITE_BUSY`), a5-07 (the
registry's temp-path race and id trust), a5-08 (settlement money is floating
point), a5-09 (feed accepts an unpublished sequence on empty history), a5-10
(no `fsync`; the WAL race reintroduced in the history database), a5-11 (schema
versioning), a5-12 (key re-attribution after rotation), a6-06 (a job never
reports its stage), a6-07 (`dispersion: null` silently unset), a6-08 (409 for a
malformed id), a6-09 (shutdown runs twice; history never closed), a6-10 (job
history in memory only), a6-11 (evicted resume loops or stops), a6-12 (`parseInt`
on history bounds), a6-13 (`displayName` unbounded), a6-14 (service tests accept
any healthy service on their port), a6-15 (`OTC_BACKFILL_DAYS=1e3`), a6-16 (doc
drift on the surface), a6-17 (duplicate JSON keys), a6-18 (the panel has no view
of `/health`), a7-17 (no PR has ever existed), a7-18 (no HEAD in the handoff),
a7-19 (index prose), a7-20 (git housekeeping), a7-21 (`@types/node` 22 on Node
24; `UNLICENSED` on a public repository — for the Human Owner), a7-22 (numbers
without a runner), a7-23 (knowledge in three or more places), a7-24
(`cancel-in-progress` on `main`).

## 6. Also recorded: what survived

An audit that reports only failures is not measuring. Attacked and held:

- **Determinism, INV-008/009/010.** All five assets continue bit-identically
  after `snapshot → JSON → restore` into fresh objects and a fresh keyring; two
  resumes from the same leased cursors across a seam are identical; the
  serialised snapshot carries no key material (a3).
- **Sign-blindness against sign leaks.** Fifteen leverage plants across every
  shipped layer were caught by the mirror test, including one gated on
  `env=production` (a3). The failure is level leaks (a3-01), not sign leaks.
- **Portability.** Only exactly-specified `Math.*` on the price path; every
  sort carries a comparator; doubles survive JSON exactly (a3).
- **Numerical stability.** 25 personalities at both bounds × 200,000 ticks: no
  NaN, no zero interval, all prices safe integers (a3).
- **Look-ahead and ties in the battery.** Entry is the last tick at or before,
  expiry strictly later, ties counted apart and never a win or loss; the
  confirmation split reuses nothing; BH's worst z on the control is what the
  null predicts (a4).
- **Calibration.** Every planted fixture is caught by the family whose purpose
  matches; the conventional battery is clean on the level-anchored fixture and
  the full one finds it (a4).
- **Differentiation.** The PH-21.1 centroid optimisation is bit-identical to
  the previous code on 384 distances and every argmin (a4).
- **Stale-leader fencing** on both stores; **seam markers** (gap refused,
  `priceAt` null inside, `spansSeam` true across); **backfill** tick-identical
  to a market run live, step-independent, refusing to run twice on both stores
  (a5).
- **Settlement policy** documented and matched by code; ATM refund on lattice
  integers; **Merkle** inclusion, tamper and domain separation; **Ed25519**
  signature over asset, range, count and roots; rotation forward-secrecy (a5).
- **The rendering contract**: 3,000 random windows, zero violations; the join
  never draws a bar the record does not hold (a5).
- **Input handling on the surface**: path traversal, prototype keys, `NaN`,
  20-digit integers, 10 MB bodies — all refused by name, no 500 in the id
  battery; CA6-34's amplification is bounded (142 MB peak against 1.86 GB); 300
  connect/abort cycles leak nothing (a6).
- **Guards that held**: every plain plant against every guard was caught; the
  meta-audit fails a weakened guard; ESLint reads `.tsx` with type-aware rules
  (a1, a2).
- **Every constant the documents quote and every test file they name exists
  and asserts what is claimed** — 29 files, 20 constants (a7).

## 7. Remediation

Findings are fixed on `feature/out-of-band-audit`, one commit per area, each
fix watched failing before it was recorded as closed. Anything not closed
there is filed as a GitHub Issue (the migration `GOVERNANCE.md` §42 requires,
a7-04) and named in `CURRENT_STATE.md`. `GOVERNANCE.md` findings (a7-16) and
the licence question (a7-21) are for the Human Owner.

_The closure table is appended when the branch merges._
