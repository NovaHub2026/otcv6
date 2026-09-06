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

## 2. What the audit found first, and what it cost

Hosted CI on the release merge went **red** while the audit was running, on one
browser test of the Lab, with the local phase gate green on the same code. Two
auditors had already found the release record claiming a corroboration it did
not have. The cause was a real defect, not a flake: the Lab read the clock, the
feed and the market's drawn-but-unpublished tick as three independent reads
outside the venue's critical section, so a position's entry price could be one
lattice step stale — and "win by minimum distance" _is_ one lattice step, so an
armed win settled as a tie. `settle()` was right throughout.

That is the shape of this audit's most serious findings: not a wrong
calculation, but **two answers to one question**, given by two parts of the
system that were each individually defensible.

## 3. Findings

_The table is completed as the fixes land; the counts and the per-finding
verdicts are written here from the refutations, not from the reports._

## 4. What the plants say about the guards

_Filled at closing._

## 5. Verification

_Filled at closing: the full gate on `audit/ca10-fixes`, and hosted CI on the
merge._

## 6. Closing

_Filled at closing._
