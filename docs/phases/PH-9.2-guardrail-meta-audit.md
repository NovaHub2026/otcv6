# PH-9.2 — The guardrail meta-audit

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-9.2
Parent phase: PH-9 — Continuous Integrity Assurance and Independent Red-Team Hardening
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Audit the thing every other claim rests on.

## 2. Five for five

Both Cycle Audits found the same class of defect, and it was never in the engine:
guards that existed, were documented as sufficient, and had never been tested
against what they guarded.

| Guard                            | What it missed                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Economic blindness demonstration | Settlement entirely — a rule shaving wins into refunds passed 769 tests, 137 guardrails and the demonstration itself, at +4.4pp of operator margin |
| Loop-cost detector               | Six loop shapes of seven, including `i++`, measured at 4,214ms against a 5s timeout                                                                |
| Dependency direction             | Dynamic `import()`, and relative paths into another package's `dist/`                                                                              |
| Rendering contract               | Interpolation — the exact defect it was written for                                                                                                |
| Withheld seam family (PH-9.1)    | Reported clean while testing **zero** hypotheses                                                                                                   |

The guardrail suite is now substantial software that nothing audits. So it gets
the engine's treatment: **mutate the thing a guard protects and require the guard
to fail.**

## 3. Why it runs in an isolated copy

Cycle Audit 2 recorded the project's worst process failure: an audit agent's
deliberately planted backdoor swept onto `main` by a concurrent `git add -A`.
Mutation testing that edits the working tree is the same hazard with a scheduler
in place of an agent.

Each mutation gets a fresh 3 MB copy with `node_modules` symlinked, and every
case asserts afterwards that the live file is byte-identical.

## 4. What getting to green cost, and why that is the finding

The suite reached 10/10, and each correction on the way is worth more than the
final number.

**It caught a live regression it had just caused.** The mutation payloads
contained literal `import('@nestjs/common')` strings. The dependency scanner
strips comments but not string literals — correctly, since a specifier _is_ a
string literal — so a file carrying import expressions as data reads as a file
performing them. `@otc/sim` was failing the dependency guard in the working tree.
Fixed by assembling payloads at runtime rather than adding an exclusion: an
exclusion is how a guard acquires a hole.

**Two mutations were silent no-ops.** The anchor `export class MarketEngine {`
does not exist; the declaration is `implements TickSource`. The meta-audit's own
anchor assertion caught it and said so — _"the mutation would be a no-op, which is
exactly how a meta-audit becomes a formality"_. Without that assertion, two guards
would have been recorded as verified having tested nothing.

**One mutation was not the defect it named.** Stripping INV-002's tag from one
file lost nothing, because INV-002 has nine evidence files, and the guard
correctly did not care. That read as toothlessness when the plant was wrong.
Retargeted to INV-005 — the only invariant with exactly one evidence file.

Same shape as PH-8.1's spike landing on a sampling boundary. **The plant needs the
same scrutiny as the guard.**

## 5. The ten guards, all confirmed

Economic vocabulary in the price path; contract vocabulary in the price path;
ambient mutable state (`globalThis` — the Cycle Audit 2 backdoor channel);
ambient time; non-portable numerics; a framework acquired by dynamic import; a
relative path escaping a package; an assertion inside a large loop; an enforced
invariant losing its only evidence; canonical state disagreeing with the roadmap.

Each fails its guard. Each guard passes on the clean tree first, so a red result
is attributable to the mutation.

## 6. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                             | Result                          |
| --------------------------------- | ------------------------------- |
| `npm run format:check`            | PASSED (exit 0)                 |
| `npm run lint`                    | PASSED (exit 0)                 |
| `npm run build`                   | PASSED (exit 0)                 |
| `guardrailMetaAudit.stat.test.ts` | PASSED — 10/10 mutations caught |
| Full unit project                 | PASSED — 867 tests              |

### Known limitations carried forward

- Ten mutations, not an exhaustive mutation space. Each targets a defect the
  project has actually suffered, which is a better selection criterion than
  coverage but is not the same as completeness.
- The meta-audit itself is now a guard, and nothing audits _it_. That regress
  stops being useful somewhere, and this is a reasonable place: its failure mode
  is visible (a mutation that finds no anchor fails loudly).
