# PH-16 — Close What the Audit Falsified

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-16
Status: ACTIVE
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

| Subphase | Title                                                     | State       |
| -------- | --------------------------------------------------------- | ----------- |
| PH-16.1  | The standing verdict runs the battery it names            | APPROVED    |
| PH-16.2  | A follower cannot generate, and settlement sees the seam  | ACTIVE      |
| PH-16.3  | Operator risk, retention, and the guardrails' blind spots | not started |

## 4. Phase invariants

- **INV-002** — broken today by B-013, and the product's most visible promise.
- **INV-006** — the standing verdict is what says it still holds.
- **INV-009** — retention deletes entry ticks of disputable settlements (B-017).
- **INV-010** — the follower guard omits `@otc/core`'s entropy primitives.

## 5. Acceptance intent

Every finding in `docs/BACKLOG.md` from B-012 to B-021 either closed, or
deferred with a recorded reason a future auditor can argue with.
