# Cycle Audit 010

Type: CYCLE AUDIT RECORD
Status: CLOSED — 98 claims, 86 confirmed, 12 partial, 0 refuted; fixed on `audit/ca10-fixes`, gated green (`GATE_EXIT=0`, 970f54b)
Cycle audited: Cycle 10 (PH-28, PH-29, PH-30) — the closing cycle
Commit audited: `353f101` (the PH-30 merge, tagged `v1.0.0`)
Conducted: 2026-09-06
Auditors: eight independent agents, one detached git worktree each (B-020, ADR-0011); every finding put to an independent refuter working in a worktree that is not the finding's own

---

## 1. What was audited, and how

Three phases were approved in Cycle 10 and the third was the release, so this
audit is the last thing standing between the engine and a broker's money. Eight
auditors were briefed on disjoint subjects — the ten invariants attacked
directly on the release build; state integrity, settlement and recovery; PH-28;
PH-29; PH-30; implementation quality and what the tests do not cover; the
records, the decisions and the state documents; and the gate as an instrument.
Each worked in its own worktree at `353f101` with dependencies installed and
built, planted the defect every guard it relied on is named for, and recorded
whether the guard caught it.

Every finding was then handed to an **independent refuter** in a different
auditor's worktree, briefed to refute and to default to refuted when uncertain,
and required to re-execute the scenario from scratch rather than read the
auditor's evidence.

## 2. The finding that matters most

**One record, one contract, two settlements.**

A restart that takes longer than fifteen seconds seams a market: the runtime
refuses to invent the interval it did not generate, resumes forward, and leaves
a hole in the record. Every deploy is longer than fifteen seconds, so this is
not an exceptional path — it is the ordinary one.

`settle()` in `packages/trading` knows what to do with a hole: given the seams,
it refuses to settle a contract whose window crosses one, because a price
nobody published cannot decide who was right. That refusal is the whole reason
Cycle Audit 5 was survivable.

`GET /markets/:id/price?at=` did not know. Asked for an instant inside the
hole, it answered `200` with the last tick before the seam and named the rule
it had used — `last-tick-at-or-before` — which is exactly the rule the guide
tells a broker is "la misma regla que usa `settle()`". Auditor a6 executed both
against the `record.db` the release build itself wrote across a real
twenty-two-second seam: **broker A settles a loss and takes the stake; broker B
is refused.** Both are reading the same record through the same published
contract, and both are behaving correctly.

The refusal was unreachable in practice, and that is the part that turns a
sharp edge into a defect. Nothing in the repository ever constructs a
`RecordSeam`; no endpoint publishes the seams; the record's schema had nowhere
to keep them. `INTEGRATION.md` told the broker to fill `settle()`'s `seams`
from the stream's `gap` frames — but a `gap` frame is an eviction notice
carrying sequences, and `seams` needs instants. So every broker is broker A.

This is the shape of this audit's worst findings, and it is worth naming
because it is not the shape the project has been guarding against. Nothing here
computed a wrong number. Two parts of one system, each individually defensible
and each individually tested, gave different answers to the same question, and
no test asked them the question at the same time.

## 3. What the audit found about the cycle's own approvals

Three things, and none of them is comfortable.

**The release tag does not satisfy the release phase's own rule.** PH-30 §3
says `v1.0.0` is the commit the phase gate passed and hosted CI corroborated,
or it is not tagged. The tag was pushed at 15:54Z, six seconds after the CI run
on that push was created; the run finished two hours later, **red**. Two
auditors found the record claiming a corroboration it did not have (a5-06,
a7-02) before the result was in, and the refuter for a5 upgraded its own
finding when the run completed against it. The claim is corrected in
`RELEASE-1.0.0.md` §7 and in `CURRENT_STATE.md`, and the tag is re-cut from a
commit hosted CI has actually corroborated.

**The red run was a real defect, not a flake, and the local gate could not have
found it.** The Lab read the clock, the feed, and the market's drawn-but-not-yet
-published tick as three independent reads outside the venue's critical
section, and stored an entry price that `settle()` later recomputed against a
record that had grown behind the entry instant. The row displayed one lattice
level while settlement read the next, so a position armed to win _by the
minimum lattice distance_ — which is exactly one level — settled as a tie. The
window widens with publication latency, which is why a slower hosted runner saw
it and a local run did not. `settle()` was right throughout.

**The state documents were stale below their guarded rows.** The rows a guard
reads were correct; the verification block underneath was PH-27's gate on a
branch two cycles old, the branch row named `audit/ca9-fixes`, and the
next-action body was Cycle 9's (a7-04). A planted paragraph saying
"PH-31.1 is ACTIVE, do not run the audit" passed both state guards. This is the
third consecutive audit to find that the parts of these documents nobody
guards drift, and the second to find it with a plant.

## 4. Findings

**98 claims: 86 confirmed, 12 partial, 0 refuted.** Every one was put to an
independent refuter working in a worktree that was not the finding's own,
briefed to refute and to default to refuted when uncertain, and required to
re-execute the scenario rather than read the auditor's evidence. Not one claim
failed to reproduce — which is a fact about how the reports were written, and
also a warning: an audit whose refuters never refute anything is one bad brief
away from a rubber stamp. Twelve were narrowed, and several came back
**stronger** than reported, including the one that measured a client returning
a forged tick as verified.

The severity column is the refuter's where it differs from the auditor's, and
the difference is noted. Verdicts are generated from `refutations/*.json` by
`tools/table.py` rather than transcribed, because ninety-eight rows is more
than a careful reader copies correctly.

| ID    | Severity | Verdict   | Finding                                                                                                                                                                                                                                                                                                      |
| ----- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a3-06 | critical | confirmed | A throw inside VenueService.tick()'s publish loop is swallowed: the stream dies permanently, /health stays ok, stalled stays empty, and the recorded ticks can never be published again                                                                                                                      |
| a4-01 | critical | confirmed | /price answers a price inside a restart seam with no seam named; the tick record holds no seams, so settle()'s seam refusal is unreachable through the API and the guide's instruction to fill `seams` from `gap` events cannot be followed                                                                  |
| a6-05 | critical | confirmed | A feed refusal inside tick() is invisible to /health, /health/ready and /metrics: the venue serves nothing and reports ok, ready, 0 stalled and a rising tick counter; nothing fences a second process on one state directory                                                                                |
| a8-01 | critical | confirmed | The rate limit keys on the socket address and ignores the forwarded one: behind the shipped nginx or compose, the whole world is one bucket of 600 requests a minute                                                                                                                                         |
| a1-01 | material | partial   | The settlement query answers an instant inside a seam with the pre-seam price and the rule name; settle() refuses the same window, and a broker following the guide re-creates Cycle Audit 5’s real-money defect _(claimed critical)_                                                                        |
| a1-02 | material | confirmed | The rate limit is keyed on the socket address and the service never trusts a proxy: behind the shipped nginx (and any front door) every client shares one 600/min bucket, and the guard that says the proxy "forwards the client address" checks the words in nginx.conf                                     |
| a1-03 | material | confirmed | A one-tick future price — HostedMarket.pending, drawn but not yet due — is reachable from VenueService with no guard naming it; served inside /markets/:id’s existing keys it passed every unit guard, the guardrails, the contract-shape guard and the broker’s conformance suite                           |
| a1-04 | material | confirmed | The by-value INV-010 guard cannot see /metrics, error bodies or the two JSON routes it composes no service for, and checkpointMarket(...).snapshot is a path to the whole snapshot that no source guard names                                                                                                |
| a2-01 | material | confirmed | The conformance suite's fault table exercises five checks; eight more can be deleted with every test green                                                                                                                                                                                                   |
| a2-02 | material | confirmed | The reference client can lose its commitment-signature check and its proof-sequence check with every test green                                                                                                                                                                                              |
| a2-03 | material | confirmed | Behind the shipped nginx the rate limit is one global bucket: `trust proxy` is never set, so every client is 127.0.0.1                                                                                                                                                                                       |
| a2-04 | material | confirmed | A torn last line in commitments.ndjson kills the boot with a bare SyntaxError, and the operator's file verifier throws instead of returning a verdict                                                                                                                                                        |
| a3-01 | material | confirmed | The documented restore does not work: a backup written by state:backup refuses to boot, because its own manifest is read as a checkpoint for an asset called "backup"                                                                                                                                        |
| a3-02 | material | confirmed | state:verify exits 0 on a state directory that does not exist                                                                                                                                                                                                                                                |
| a3-03 | material | confirmed | A deleted record.db produces neither a problem nor the warning its own docstring promises                                                                                                                                                                                                                    |
| a3-04 | material | confirmed | verify compares head sequence numbers only: a record from a different run of the same asset verifies clean                                                                                                                                                                                                   |
| a3-07 | material | confirmed | Nothing prevents two venue processes from sharing one state directory                                                                                                                                                                                                                                        |
| a3-08 | material | confirmed | A torn line in a commitments file takes the whole venue down with a raw SyntaxError, and makes every chain verifier throw instead of returning a verdict                                                                                                                                                     |
| a3-10 | material | confirmed | Nothing backs up the publication directory: the signed commitment chain is outside every backup path the release ships                                                                                                                                                                                       |
| a4-02 | material | confirmed | VenueClient.subscribe throws ContractViolation on a gap the venue told it after a reconnect — the path a restart or a long outage produces                                                                                                                                                                   |
| a4-03 | material | confirmed | The conformance proof check is self-certifying — it verifies the signature against the key in the same response — and the reference client does the same unless told a key; PH-29.3 records it as 'against /health's publisher key', which /health does not carry                                            |
| a4-04 | material | confirmed | The conformance suite passes a venue whose /ticks/:sequence and /markets/:id answer the wrong ticks: content is never compared with the stream, only keys and types                                                                                                                                          |
| a4-05 | material | confirmed | The proof route serves a 200 proof that does not verify when a journal line other than the requested tick was edited (or when the tick is outside the record's retention): the archive is never checked against its own signed root before serving                                                           |
| a4-06 | material | confirmed | /price on a retired asset is a 500 (bare RangeError from Venue.marketFor) while the contract lists 400/404 only and says a retired asset's record stays readable                                                                                                                                             |
| a4-07 | material | confirmed | The contract's stream frame shapes are unguarded: an uncontracted key added to the venue's `gap` frame survives the contract, production-responses and admin-surface guards                                                                                                                                  |
| a4-08 | material | confirmed | The 'hundred thousand cent stakes agree with exact rational arithmetic' guard is ratio-blind: floored floating-point payout passes it, because at 0.85 floor(stake×0.85) equals the exact value for every stake ≤ 100 000; at other four-place ratios the two disagree                                       |
| a5-01 | material | confirmed | The rate limit keys on the socket address; the shipped proxy forwards X-Forwarded-For but the venue never reads it, so behind deploy/nginx.conf every client shares one bucket and the monitor's own routes are refused with it                                                                              |
| a5-02 | material | confirmed | /health/live is not served while the venue boots: main.ts resumes every market and runs the backfill before it listens, so liveness and readiness first answer at the same instant                                                                                                                           |
| a5-03 | material | confirmed | The multiplexed panel stream cannot recover from an asset retired while the page is disconnected: every reconnect names the retired asset, the venue answers 404 for the whole set, and all eight charts stay 'reconnecting' for ever                                                                        |
| a5-04 | material | confirmed | deploy/docker-compose.yml: the backup service runs the host's checkout inside a bare node image and never works from the image the compose builds; there is no panel service though the header and PH-30.1 say there is; and criterion 5 ('the compose file builds and the service comes up ready') was neve |
| a5-06 | material | confirmed | The release record names no commit hash, claims hosted CI corroborated a tag that was pushed before CI had run, and the package regenerated from v1.0.0 stamps the tag object's id as its commit; the whole-catalogue records are of 0ff85aa and e0c87cd, not of the release commit                          |
| a6-01 | material | confirmed | GET /markets/:id/price?at= answers inside a recorded seam with the pre-seam price; the same window through settle() with the seam declared is refused, and the venue's own replication follower returns null for that instant. One record, one contract, two settlements _(claimed critical)_                |
| a6-03 | material | confirmed | Every seam abandons the published-but-uncommitted tail for ever: 5,749 ticks served in the release's own run 2 are in no chain, and /proof answers 409 'not in any committed window' for them indefinitely                                                                                                   |
| a6-04 | material | confirmed | A break-tolerant verifier's ok:true, the proof route, the anchor and a rotation all read a window cut from the earlier chain's tail exactly like a seam's honest loss, and no consumer in the repository reads `breaks`                                                                                      |
| a6-06 | material | confirmed | A SIGKILL before the first checkpoint of a fresh market makes the next boot fork every such asset at sequence 1, unhost it and go 503, while state:verify calls the directory consistent and names no asset at all                                                                                           |
| a6-07 | material | confirmed | Restoring an older backup after the venue served past it rewrites the published record: served ticks vanish, /price?at= answers a price observers never saw, and keystream positions the old process already published from are drawn again — measured, 3,389 cascade blocks on one asset after 3.5 minutes  |
| a6-08 | material | confirmed | GET /markets/:id/price?at= answers 500 Internal server error for a retired asset, before and after a restart, although retirement promises the settlements stay readable                                                                                                                                     |
| a6-11 | material | confirmed | A backup made by `state:backup` cannot be restored: its own manifest is read as an asset checkpoint, so `state:verify` exits 1 and the venue refuses to boot — and the guard calls verifyStateDirectory on the backup and never looks at `problems`                                                          |
| a6-13 | material | confirmed | A corrupted page in record.db passes `state:verify` with 'Consistent: every file agrees' and then kills the venue at boot with an unhandled ERR_SQLITE_ERROR — after it has already seamed and hosted part of the catalogue; systemd Restart=always makes that a two-second crash loop                       |
| a7-01 | material | confirmed | A restore from `state:backup` refuses to boot: the manifest is read as a checkpoint, and the test that verified the copy never read its problems                                                                                                                                                             |
| a7-02 | material | confirmed | The release record says hosted CI corroborated the tag; the tag was pushed the minute the CI run started, and the record never names the commit                                                                                                                                                              |
| a7-03 | material | confirmed | The record's on-disk cost doubled at PH-29.1 (32.6 -> 61.2 bytes per tick) and every document, the sizing docstring and the release still say 32.6                                                                                                                                                           |
| a7-04 | material | confirmed | CURRENT_STATE.md and SESSION_HANDOFF.md are stale below the guarded rows: the verification block, the branch, the next-action body and the backlog still describe Cycle 9                                                                                                                                    |
| a7-05 | material | confirmed | The integration guide shipped as the package's front page is stale in what it says it verified and omits the durable record's and the rate limit's configuration                                                                                                                                             |
| a8-02 | material | confirmed | The reference client throws a ContractViolation on a gap the venue told after a reconnect — the loop the integration guide prints crashes on the case it exists for                                                                                                                                          |
| a8-03 | material | confirmed | The fleet driver drops the truncation counters Cycle Audit 8 (a3) added: ten thousand observers cut off mid-hold would read as 'complete, 0 gaps' — and observerFleet.ts has no test at all                                                                                                                  |
| a8-04 | material | confirmed | The board's card prints the lattice index under the word price, and the browser guard asserts the integer — the PH-23.5 defect class, back in PH-30.2                                                                                                                                                        |
| a8-06 | material | partial   | A commitments file with a cut last line makes the venue refuse to boot with a raw SyntaxError, turns every /proof into a 500, and makes the streaming verifier throw instead of naming the line                                                                                                              |
| a8-07 | material | confirmed | The conformance suite never exercises /markets/stream, and the venue departs from that route's own contract row: an unknown asset answers 404 where the contract lists only 400                                                                                                                              |
| a1-05 | minor    | confirmed | The economic-vocabulary scan does not reach apps/api/src or packages/runtime/src — the venue, the record, the rate limit and the readiness flag all accepted payout/exposure vocabulary — while market.controller.ts claims the scan keeps that vocabulary out of apps/api/src _(claimed material)_          |
| a1-06 | minor    | confirmed | Between a seamed boot and its first live tick, a client resuming from a genuinely published sequence is told it "has never been published; the newest is 0" and, with onGap=live, given resumesAt null                                                                                                       |
| a1-07 | minor    | confirmed | The record’s 404 for a sequence inside a seam hole says the record "holds oldest–newest", a range it does not hold                                                                                                                                                                                           |
| a2-05 | minor    | confirmed | The stale-build guard is red on a clean tree after any checkout or touch — the PH-28.1 fix does not hold                                                                                                                                                                                                     |
| a2-06 | minor    | confirmed | Seven apps/api statistical suites spawn apps/api/dist with no stale-build guard: a regressed source passes the suite that names it until someone builds                                                                                                                                                      |
| a2-07 | minor    | confirmed | The record's fork check is guarded on its price half only: a fork that keeps the price and moves the instant is invisible to the whole unit suite                                                                                                                                                            |
| a2-08 | minor    | confirmed | Metrics are asserted on a healthy venue only: `otc_markets_stalled` and `otc_ready` can be hardcoded                                                                                                                                                                                                         |
| a2-09 | minor    | confirmed | Backup: the report may verify the source instead of the copy, the registry check may vanish, and backup.sh's retention is held by a grep — keep=0 deletes every backup including the one just taken                                                                                                          |
| a2-10 | minor    | partial   | The chain verifier's epoch check at a restart, and its finish() verdict at file level, are unguarded                                                                                                                                                                                                         |
| a2-11 | minor    | partial   | The PH-30.2 proxy-leak fix has no unit guard; its only guard is a browser test that needs a library path documented nowhere the gate instructions are                                                                                                                                                        |
| a2-12 | minor    | confirmed | The records call the coverage leg the unit suite: the plain unit leg is 45 s, not ~110 s                                                                                                                                                                                                                     |
| a2-13 | minor    | confirmed | MemoryTickRecord loses ticks when one asset appears twice in a pass; SqliteTickRecord keeps them                                                                                                                                                                                                             |
| a2-14 | minor    | confirmed | contract.test exercises 12 of the 14 contracted response shapes in-process; only the shipped-venue statistical suite holds the other two                                                                                                                                                                     |
| a2-15 | minor    | confirmed | Clean: the meta-audit, the INV-005 traceability guard and the record's fork refusal all fail on the defects they name — with one recorded limit                                                                                                                                                              |
| a2-16 | minor    | confirmed | Six of the seven apps/api statistical suites bind fixed ports, so a second run on the same machine fails with a wall of Nest logs and a buried EADDRINUSE                                                                                                                                                    |
| a3-05 | minor    | partial   | state:backup against a running venue produces a backup that refuses to boot: the record is snapshotted before the history _(claimed material)_                                                                                                                                                               |
| a3-09 | minor    | confirmed | CLEAN: the streaming verifier and the batch verifier return identical verdicts on every adversarial file                                                                                                                                                                                                     |
| a3-11 | minor    | confirmed | deploy/backup.sh counts failed backups against its retention, so repeated failures delete the good copies                                                                                                                                                                                                    |
| a3-12 | minor    | confirmed | CLEAN: the resume contract is exact in every sequence class, including across a real seam                                                                                                                                                                                                                    |
| a3-13 | minor    | confirmed | CLEAN: a backup taken after a SIGKILL captures every committed tick from the hot WAL                                                                                                                                                                                                                         |
| a3-14 | minor    | partial   | Audit conduct: this auditor swept processes with a pattern its own command contained                                                                                                                                                                                                                         |
| a4-09 | minor    | confirmed | A proof request for a sequence never published is refused as 'published but not yet committed … Ask again when the window closes'; sequences orphaned by a seam are 'not in any committed window' with nothing saying they never will be                                                                     |
| a4-10 | minor    | confirmed | exposure and the limiter accept fractional stakes that settle() refuses, and count their obligation as zero                                                                                                                                                                                                  |
| a4-11 | minor    | confirmed | VenueClient.proof and the conformance proof check never compare the answered asset with the requested one: another asset's valid proof is accepted                                                                                                                                                           |
| a4-12 | minor    | partial   | The release-level conformance run has never verified a served proof: it passes on a 409 after 45 s, and the publication window is not configurable from the environment                                                                                                                                      |
| a4-13 | minor    | confirmed | Clean areas, with the plants and re-executions that showed it                                                                                                                                                                                                                                                |
| a5-05 | minor    | confirmed | The /metrics-agrees-with-/health guard is blind: constant samples for otc_markets_stalled and otc_ready pass every unit guard, because the metrics test only reads a healthy venue                                                                                                                           |
| a5-07 | minor    | confirmed | The integration package ships process material its script says it removes — the audit worktree script, the backlog mirror, the delegation and subagent ADRs — and one shipped document links a file the script deletes                                                                                       |
| a5-08 | minor    | partial   | The rate limit's bucket map is swept in full on every admitted request once it holds ten thousand entries, and a sweep forgets nothing while the clients are recent                                                                                                                                          |
| a5-09 | minor    | partial   | The fleet driver stamps `git rev-parse HEAD` on a record it made from a dirty tree, so the sweep behind PH-30-TEN-THOUSAND-OBSERVERS.md names 8f38c28, a commit that does not contain the driver                                                                                                             |
| a5-10 | minor    | confirmed | docs/BACKLOG.md still carries B-029 as 'Open — unresolved within estimator noise' after Issue #4 was closed as superseded                                                                                                                                                                                    |
| a5-11 | minor    | confirmed | Every row of both served-verdict records prints 'gate Infinitypp' for every horizon — a JavaScript Infinity where the record means 'no gate bucket reached at this size'                                                                                                                                     |
| a6-02 | minor    | confirmed | In the window between a seamed boot and its first tick, an honest resume is refused as 'holding a record this feed did not produce', onGap=live tells an unbounded gap, and from=1 is accepted and silently starts at the seam _(claimed material)_                                                          |
| a6-09 | minor    | confirmed | After a seam the panel is told a bounded hole of 100,001 sequences that were never ticks, and inside the boot window an interruption whose stated reason is false                                                                                                                                            |
| a6-10 | minor    | confirmed | Clean areas, the plants that showed them, and this audit's own limits                                                                                                                                                                                                                                        |
| a6-12 | minor    | partial   | No anchor can be built for any asset after its first deploy: buildAnchor, summarise and verifyAnchor throw on a chain file that holds a seam, which after PH-30.4 is every file _(claimed material)_                                                                                                         |
| a7-06 | minor    | confirmed | Served-verdict records print `gate Infinitypp` for every horizon the gate could not test — sixty rows of it in the release's evidence                                                                                                                                                                        |
| a7-07 | minor    | confirmed | The release run's records grade a venue with no boot nonce, so neither can be tied to the process it read                                                                                                                                                                                                    |
| a7-08 | minor    | confirmed | The integration package's README names the tag object, not the commit, and the deliverable regenerated from the tag was never validated                                                                                                                                                                      |
| a7-09 | minor    | partial   | The hosted-CI table omits one red run on main and nothing guards the table                                                                                                                                                                                                                                   |
| a7-10 | minor    | confirmed | BACKLOG.md still carries B-029 as Open after Issue #4 was closed as superseded                                                                                                                                                                                                                               |
| a7-11 | minor    | confirmed | The evidence records are unguarded copies: a changed release number and a flipped generated verdict pass every guard                                                                                                                                                                                         |
| a8-05 | minor    | partial   | `npm run state:verify` on a directory that does not exist prints 'Consistent: every file agrees.' and exits 0 _(claimed material)_                                                                                                                                                                           |
| a8-08 | minor    | confirmed | The multiplexed client (streamMarkets) retries a refused resume for ever with the same query — the a6-11 fix in streamMarket was not carried over — and allocates a window for any asset a gap frame names                                                                                                   |
| a8-09 | minor    | confirmed | The two journal readers are not equal: the lab's accepts a fractional, null or unsafe instant that the venue's refuses                                                                                                                                                                                       |
| a8-10 | minor    | confirmed | Operations guards: `otc_stream_connections` is asserted by no unit test, and the rate-limit key path is never executed                                                                                                                                                                                       |
| a8-11 | minor    | confirmed | engineAccess.ts builds the same fork four times and carries an orphaned docblock; labStepsAhead is exercised by no unit test                                                                                                                                                                                 |
| a8-12 | minor    | confirmed | Each /proof request streams the asset's whole commitments file from the top; with the shared bucket of a8-01 one client can make the venue read the chain 600 times a minute                                                                                                                                 |
| a1-08 | clean    | confirmed | Clean, with the plants that showed it: the three PH-28.2 guards, the by-value guard on JSON routes, the record’s dedup, the feed’s priming and the chain resumption all caught the defect they name; /proof and /contract carry nothing private                                                              |

The fixes are grouped by what they are about rather than by who found them,
because several findings are one defect seen from different directions: the
rate limit was found independently by four auditors, and the seam was found by
three.

## 5. What the plants say about the guards

**Forty-five plants; twenty-two caught, twenty-three survived.** A little over
half of the defects this project's guards are named for walked past them.

That number is the audit's most useful output, and it is worth being precise
about what it does and does not mean. The auditors planted where they expected
weakness, so this is not a sample of the suite — a plant chosen at random would
be caught far more often. What it measures is the shape of the blind spots, and
they fall into three kinds:

- **The guard reads the source, and the defect is in the value.** The INV-010
  economic-blindness scan looks for identifiers; a plant that spelled its key
  differently, or emitted the same numbers as Prometheus text on `/metrics`,
  passed everything. The fix was to make the guard walk the responses by value
  and hold `/metrics` to a closed list of samples, so a counter added without a
  line in that list is a red suite — which is the moment somebody decides the
  number is publishable.
- **The guard reads a string that nobody consumes.** `deploy.test.ts` asserted
  that `nginx.conf` contains `X-Forwarded-For`, and it did; nothing read it,
  because the engine was never told to trust a proxy. A test that checks one
  end of a contract and not the other is the most comfortable kind of green.
- **The check exists and has no fault to fail on.** The conformance suite's
  resume check could have its whole predicate replaced by `true` with the
  fault matrix still green, and eight of its thirteen checks could be deleted
  outright. The reference client's signature verification could be removed
  entirely and all fifteen of its tests passed — a client that would accept a
  forged commitment as long as the venue named the expected key.

The third kind is the one this project keeps rediscovering, and the rule it has
had since Cycle Audit 2 — _a guard is not finished until it has been watched
failing_ — is exactly the rule that would have prevented all of it. Every guard
written in this audit's fixes was watched failing on the unfixed code, and the
words it printed are in the fix rationales under `~/.otc-audit10/findings/`.

## 6. What the audit could not check

Named, so the next audit knows where it did not look.

- **The browser suites depend on a library path that is not in the gate's
  instructions.** Two auditors could not launch Chromium at all
  (`libnspr4.so` missing) until they found the `LD_LIBRARY_PATH` prefix; one
  refuter established that `SESSION_HANDOFF.md` does carry it, so the claim
  that it is documented nowhere is wrong, but `CLAUDE.md` §5 — the file an
  agent is told to read for how to run the gate — does not.
- **The statistical suite was not run by any auditor**, by instruction: at
  eighty minutes serial it would have cost more than the audit. The findings
  about it are from its logs and its sources, not from executing it.
- **Long-horizon anti-predictability was not re-measured.** The battery's own
  verdict needs months of record; this audit re-executed the machinery, not
  the claim.
- **Multi-node** is deferred by the Cycle 10 plan (Issue #9) and composes
  nothing in the shipped service, so its code was read but not exercised.

## 7. Verification

The fixes are on `audit/ca10-fixes`, integrated one at a time with the unit
suite green after each.

```
npm run gate  ->  GATE_EXIT=0        (970f54b, 2026-09-06, 21:27–22:51Z)
  format:check     0
  build            0
  typecheck:web    0
  typecheck:config 0
  lint             0
  unit         163 files, 3,348 tests          33.2s
  coverage     163 files, 3,348 tests         113.5s   (floors enforced)
  statistical   47 files,   402 tests       4,838.5s
```

**The first run of that gate was red, and it was right to be.** A statistical
test booted a second venue on a state directory a live venue still held, and
the new one-writer lock refused it before the module was constructed, so the
token refusal it was asserting was never reached. The lock was correct and the
test was sharing a directory. The assertion moved to a directory nothing holds,
and the lock's own refusal is now asserted where the sharing was — in two real
processes, which is the end-to-end form of the a6-05 fix. That is the audit's
own rule applied to itself: the gate found a fix's consequence that no unit
test could, which is what the statistical layer is for.

Hosted CI on the merge is recorded in `CURRENT_STATE.md` § "Hosted CI,
honestly". A green hosted run is not optional here: the release tag was cut on
a red one, and that is one of this audit's findings.

## 8. Closing

Cycle Audit 10 audited the cycle that was meant to close the project, and found
that the release it was closing on could not be defended: a settlement query
that answered inside a hole nobody published, a venue that could stop serving
while reporting itself healthy, a chain that stopped covering what it served at
the first deploy, a backup nobody could restore, a rate limit that put the
whole Internet in one bucket, and a release record claiming a corroboration it
did not have — on a tag whose hosted run went red two hours after it was
pushed.

None of that is a reason to distrust the engine's core. The price path was not
touched by a single finding: the sign is still an independent fair coin, the
magnitude engine still cannot observe one, and the mirror test and the battery
still hold. **What the audit found was a boundary problem**, over and over: two
parts of one system, each individually correct and individually tested, giving
different answers to the same question — and no test that asked them both.

Three things are worth carrying forward.

1. **The most dangerous defect of this cycle was not a wrong number.** It was
   `/price?at=` and `settle()` disagreeing about a window, with the guide
   telling a broker to reconcile them from a frame that carries the wrong
   quantity. A project that guards invariants one file at a time will keep
   producing this shape.
2. **Twenty-three of forty-five plants survived.** The rule that would have
   caught almost all of them — _a guard is not finished until it has been
   watched failing_ — is not new here; it has been in the repository since
   Cycle Audit 2. It was applied to every guard written in this audit's fixes,
   and the words each one printed are recorded.
3. **The release tag stands as a scar.** `v1.0.0` was cut on a commit hosted CI
   did not corroborate, and it is superseded rather than moved
   (`DECISION-LOG.md`, 2026-09-06). The repository's history will always show
   that the project shipped once before it was ready. That is the honest
   record, and it is cheaper than the alternative.

The cycle closes with the engine measurably better than the release it was
supposed to close on, and with the release record saying so.
