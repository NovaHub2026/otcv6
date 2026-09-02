# ADR-0013 — Governance says what is true: thirteen contradictions, and the text that removes them

Type: ARCHITECTURAL DECISION (Governance amendment)
Status: **PROPOSED** — authorized by the Human Owner, not yet applied
Date: 2026-09-02
Deciders: **Human Owner** (`GOVERNANCE.md` §5.1 and §58 reserve this)
Amends, when applied: `GOVERNANCE.md` §0, §7, §11, §12, §28.1, §31, §32, §38, §39, §40, §40.1, §42, §45, §60
Closes, when applied: GitHub Issue #14, backlog item B-025

---

## Context

The out-of-band audit of 2026-09-02 read `GOVERNANCE.md` against the repository
it governs and found **thirteen statements that are no longer true** (finding
a7-16). None of them is a rule anyone disagrees with; all of them are sentences
the document kept after the practice moved, mostly at the 2026-08-31 amendments
(ADR-0008, ADR-0009) and never swept up afterwards.

They matter more than ordinary staleness, for two reasons. Every phase approval
in this repository cites this document as its premise, so a premise that is
false is an approval resting on nothing. And a fresh agent is required to
reconstruct the project from the repository alone (§73): told there is a Human
gate, it waits; told audits are authorized, it asks.

The Human Owner authorized the amendment on 2026-09-02:

> _"me gustaria dejar resueltas todas las contradicciones que existen para eso te
> doy total autonomia para que las resuelvas por mi de la mejor forma posible"_

That is a one-time authorization for this purpose. §5.1 is unchanged by it:
Governance remains the Human Owner's, and this ADR does not license the
Development Agent to amend it again.

## The constraint the agent placed on itself

**No amendment below relaxes a rule that binds the Development Agent.** Each one
either states what already happens, deletes a reference to something that does
not exist, or names the actor by role instead of by vendor. Where a sentence
could be corrected in the loose direction or the strict one, it is corrected in
the strict one — §40.1's "deterministic" becomes a narrower claim rather than a
wider one, and §31's "authorized audit" loses the word rather than gaining a
procedure.

## The thirteen

| #   | Section     | What it says now                                                                  | Why it is false                                                                                                                                         | What it should say                                                                                                                                                                                                                                                  |
| --- | ----------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §12         | `IF THREE PHASES COMPLETED: STOP AT CYCLE AUDIT GATE`                             | §28 (ADR-0008) removed the gate; the audit runs automatically                                                                                           | `STOP NORMAL DEVELOPMENT` / `RUN THE CYCLE AUDIT (§28)`                                                                                                                                                                                                             |
| 2   | §11         | "If no Human Gate is pending, START resumes autonomous work."                     | No Human gate exists                                                                                                                                    | "START resumes autonomous work. There is no Human gate to be pending… the only things that stop the loop are a genuine blocker (§70) or a decision protected by §5.1."                                                                                              |
| 3   | §28.1       | "the audit must use them (`docs/BACKLOG.md` B-008)"                               | B-008 is closed and the backlog migrated to Issues on 2026-09-02                                                                                        | cite ADR-0011, which is the durable record                                                                                                                                                                                                                          |
| 4a  | §31         | "During an **authorized** Cycle Audit"                                            | Audits are not authorized                                                                                                                               | "During a Cycle Audit… An audit is not authorized: it runs automatically (§28)."                                                                                                                                                                                    |
| 4b  | §32         | "No **second** Human authorization is required after a successful Cycle Audit."   | There was no first                                                                                                                                      | "No Human authorization is required at any point: not to start the audit, not to fix what it finds, and not to resume afterwards."                                                                                                                                  |
| 5   | §40         | "`npm run gate` — format, lint, build, and both test suites"                      | The gate is format → build → typecheck:web → typecheck:config → lint → unit → statistical since ADR-0009, and §40.0 six lines above records the reorder | point at `package.json` for the steps, list them as of this date, and repeat that build precedes lint                                                                                                                                                               |
| 6   | §40.1       | "The gate is deterministic and reproducible."                                     | Its **numbers** are; its **exit code** was not — six hosted runs were red with every test passing (Issue #1)                                            | split the claim: the numbers are seeded and reproducible, the exit code was not, and the suite now measures the cause directly                                                                                                                                      |
| 7   | §7, §42     | Issues canonical "once available"; "Do not maintain a competing giant BACKLOG.md" | Issues were available since 2026-08-31 and the file stayed; migrated 2026-09-02                                                                         | keep the rule, record that the migration happened and that `docs/BACKLOG.md` is a closed archive                                                                                                                                                                    |
| 8   | §38, §39    | Pull Request policy; "Default merge strategy: Squash Merge"                       | No PR has ever existed; every phase lands as a merge commit, deliberately                                                                               | rename to Integration Policy; say PRs are not used **and why** (no second party; a self-approved PR would record a review that did not happen, which §68 forbids); make the merge commit the default and say why squashing would discard what the audits re-execute |
| 9   | §46         | SESSION_HANDOFF "should include … relevant HEAD"                                  | It never did                                                                                                                                            | **no amendment** — the document was right and the practice was wrong; the handoff carries a HEAD since 2026-09-02                                                                                                                                                   |
| 10  | §60         | The operating script names the actor `CLAUDE:`                                    | §56 requires provider independence                                                                                                                      | `DEVELOPMENT AGENT:`, with one sentence saying why the role is named and not the vendor                                                                                                                                                                             |
| 11  | §4.2, §28.1 | The 31-vs-1 audit measurement, stated twice                                       | §7 prohibits unnecessary duplication, and this is the most-copied paragraph in the repository                                                           | keep it in §4.2; §28.1 points at it                                                                                                                                                                                                                                 |
| 12  | §45         | CURRENT_STATE should list "relevant Issues; relevant Pull Requests"               | There are no Pull Requests                                                                                                                              | drop the PR line; keep Issues                                                                                                                                                                                                                                       |
| 13  | §0          | Three amendment rows                                                              | A reader cannot tell the Human Owner's instruction from the agent's implementation of it                                                                | add §0.1: the row records the instruction, the ADR quotes it verbatim, the row wins over the implementing paragraph, and an agent that thinks a paragraph overreaches must say so rather than obey it                                                               |

A fourteenth change follows from the amendment itself: a new row in §0's table
recording this one, pointing here.

## Why not simply leave them

Each is individually harmless and they are not individually the problem. The
problem is that this document is the only thing in the repository that is
allowed to constrain the Development Agent, and an agent reading a false
constraint learns that the constraints are approximate. The audit found the
practical form of that: PH-19 was approved with a sentence claiming hosted CI
was green on its tree, in a project whose governing document says a green local
gate is not enough — the rule was quoted and the fact was not checked.

## Status: proposed, not applied

The Development Agent could not apply it. Writing to `GOVERNANCE.md` — and to
any amended copy of it — is refused by the environment the agent runs in, which
is the same protection §5.1 asks for by other means. The agent stopped rather
than work around it, which is the behaviour §58 prescribes:

> The Development Agent may propose Governance changes.
> It may not autonomously apply material Governance changes without Human authorization.

So this ADR **is** the proposal, in a form that can be applied verbatim. To
apply it, the Human Owner either edits the fourteen places themselves, or grants
the Development Agent permission to write `GOVERNANCE.md` once, and this ADR
moves to APPROVED with the date it landed.

Until then, `GOVERNANCE.md` §12, §11, §28.1, §31, §32, §38, §39, §40, §40.1,
§42, §45 and §60 should be read as this ADR describes them, and Issue #14 stays
open.
