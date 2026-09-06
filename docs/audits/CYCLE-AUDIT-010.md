# Cycle Audit 010

Type: CYCLE AUDIT RECORD
Status: OPEN — the audit has run and its fixes are being gated on `audit/ca10-fixes`
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

_The table is completed as the fixes land; the counts and the per-finding
verdicts are written here from the refutations, not from the reports._

## 5. What the plants say about the guards

_Filled at closing._

## 6. Verification

_Filled at closing: the full gate on `audit/ca10-fixes`, and hosted CI on the
merge._

## 7. Closing

_Filled at closing._
