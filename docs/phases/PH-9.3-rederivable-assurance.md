# PH-9.3 — Assurance a counterparty can recompute

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-9.3
Parent phase: PH-9 — Continuous Integrity Assurance and Independent Red-Team Hardening
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Make the verdict re-derivable by someone who holds no key.

## 2. The weakness in every verification so far

INV-009 requires a historical outcome to be explainable and reproducible from
records. Everything verified up to now satisfied that in a weak sense: it ran
inside a process that also held the master key, so "reproducible" meant
"reproducible by the operator".

That is precisely the reproducibility a sceptical counterparty has no reason to
accept. A venue that says _trust our recomputation_ has not made a verifiable
claim.

## 3. The journal is deliberately impoverished

It carries instants, prices and sequence numbers — the three things that were
published — and nothing else. No key, no cursor, no latent state, no
configuration. Anyone watching the stream could have recorded it themselves,
which is the only kind of assurance that survives a dispute.

## 4. It refuses rather than repairs

A journal is the artefact a counterparty checks a settlement against, so
tolerance is the wrong instinct at every level:

- **a gap** is refused, because filling it would invent prices and tolerating it
  would let a dispute be resolved against a record that never happened;
- **a truncated line** is refused rather than skipped;
- **a header disagreeing with the body** is refused;
- **a fingerprint** lets two parties establish they hold the same record before
  arguing about what it means.

The fingerprint is explicitly _not_ a cryptographic commitment. It proves
agreement, not authenticity. A signed commitment is a real product question — it
needs a publishing key and a policy for when roots are published — and inventing
one here would be worse than naming the gap.

## 5. What was demonstrated

From a 400,000-tick journal, with no engine and no key in the process:

- entry and expiry prices for sampled contracts match the operator's settlement
  exactly, across 30+ contracts;
- the battery re-derives a verdict: **24 hypotheses, CLEAN**, fingerprint
  `a6c075b7`;
- gaps, truncation, header mismatch and non-journals are all refused.

## 6. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                    | Result           |
| ------------------------ | ---------------- |
| `npm run format:check`   | PASSED (exit 0)  |
| `npm run lint`           | PASSED (exit 0)  |
| `npm run build`          | PASSED (exit 0)  |
| `assurance.stat.test.ts` | PASSED — 8 tests |

### Known limitations carried forward

- The fingerprint is not a commitment. Signed publication is unscoped, and it is
  the natural next step for a venue that wants its record independently trusted.
- The journal is not yet emitted by the running service. The format and the
  derivation are proven; wiring an export endpoint is small and unclaimed.
