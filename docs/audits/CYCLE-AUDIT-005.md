# Cycle Audit 005

Type: CYCLE AUDIT
Status: ACTIVE
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

## 3. State of the audit

**IN PROGRESS.** Findings are recorded below as auditors report. The baseline is
`b983727` on `main`, at which `npm run gate` exits 0 with 102 files and 1,699
tests.

## 4. Findings

_Pending._
