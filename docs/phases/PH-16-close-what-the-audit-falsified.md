# PH-16 — Close What the Audit Falsified

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-16
Status: APPROVED
Cycle: 6 (phase 1 of 3)
Created: 2026-09-01
Branch: `feature/ph-16-audit-remediation`

---

## 1. Objective

Make the engine's stated guarantees true.

## 2. Why this is a phase and not a chore

Cycle Audit 5 produced roughly seventy material findings against a tree whose
`npm run gate` exited 0, and three of them falsify the stated objective of a
phase rather than a detail of it. The engine **claims** a standing guarantee it
does not compute, and **claims** a follower cannot generate when an auditor gave
one a real engine and measured 120 of 120 sampled instants disagreeing.

Everything Cycle 6 builds afterwards — a hundred assets, an admin panel — rests
on those claims. A hundred assets on a broken INV-002 are a hundred assets with
the same broken promise.

## 3. Subphases

| Subphase | Title                                                     | State    |
| -------- | --------------------------------------------------------- | -------- |
| PH-16.1  | The standing verdict runs the battery it names            | APPROVED |
| PH-16.2  | A follower cannot generate, and settlement sees the seam  | ACTIVE   |
| PH-16.3  | Operator risk, retention, and the guardrails' blind spots | ACTIVE   |

## 4. Phase invariants

- **INV-002** — broken today by B-013, and the product's most visible promise.
- **INV-006** — the standing verdict is what says it still holds.
- **INV-009** — retention deletes entry ticks of disputable settlements (B-017).
- **INV-010** — the follower guard omits `@otc/core`'s entropy primitives.

## 5. Acceptance intent

Every finding in `docs/BACKLOG.md` from B-012 to B-021 either closed, or
deferred with a recorded reason a future auditor can argue with.

---

## 6. Phase quality gate

`npm run gate` on a clean tree. **Exit 0** — 103 files, 1,801 tests.

Three runs before it exited 1, and each was worth the time:

1. The integrated operations test still asserted that _only_ the withheld
   families run. PH-16.1 made the registry run too, and the assertion had to
   catch up — a test encoding the old contract, caught by the new one.
2. `apps/api`'s reconstruction test reported `service exited (1)` and threw the
   reason away. It now keeps the child's output, which diagnosed the next
   failure in a single run.
3. That failure was `EADDRINUSE` on a hard-coded port, reproducible on a clean
   tree while the port showed free between runs. A test that fails because a
   number was taken is testing the machine; `boot` now walks forward until a
   port binds.

## 7. What this phase closed

| Finding | Was                                                                                 |
| ------- | ----------------------------------------------------------------------------------- |
| B-012   | The standing verdict compared four strings and ran no attack family                 |
| B-013   | A follower could be given a real engine; INV-002 broken at 120 of 120 instants      |
| B-014   | A profitable leak reported `undecided`, its floor inflated 27× by its own structure |
| B-015   | The operator's headline spread was understated by `(1+r)/r` — 2.01×                 |
| B-016   | The limiter was defeated 39.6× by one millisecond of entry jitter                   |
| B-017   | Retention deleted the entry ticks of settlements still under dispute                |

B-018 is deferred with a reason recorded in PH-16.3 §4: two of the guardrail
blind spots need a parser and an allowlist rather than another pattern, and they
deserve their own subphase.

## 8. Approval

**APPROVED** 2026-09-01, from executed evidence. All three subphases approved,
phase gate exit 0.
