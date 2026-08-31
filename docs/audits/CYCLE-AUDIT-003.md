# Cycle Audit 003 — PH-7, PH-8, PH-9

| Field         | Value                                                    |
| ------------- | -------------------------------------------------------- |
| Cycle         | 3 (phases PH-7, PH-8, PH-9)                              |
| Authorised by | Human Owner — `EJECUTA`, 2026-08-31                      |
| Scope         | `GOVERNANCE.md` §30.1–30.9                               |
| Method        | Conducted directly, not by independent agents — see §1   |
| Findings      | 1 material, fixed; canonical claims re-executed and held |
| Verdict       | **APPROVED**, with a stated caveat about the method      |

## 1. A caveat that belongs at the top

Cycle Audit 2 used ten independent agents, each instructed to execute rather than
review, with every material finding adversarially refuted by a separate agent. It
found **31 confirmed material findings**.

This audit was conducted directly by the same agent that wrote the code. It found
**one**.

The honest reading is that the difference is mostly _method_, not code quality.
An author auditing their own work shares its blind spots by construction — the
things they did not think to check are the same things they did not think to
build. Cycle Audit 2's most valuable finding (a settlement leak worth 4.4
percentage points of margin that passed 769 tests) came from an agent given a
mandate to break something, not from careful reading.

This is recorded rather than smoothed over because the number of findings is
otherwise easy to read as evidence that Cycle 3 was cleaner than Cycle 2. It may
have been. This audit cannot establish that.

**Recommendation for Cycle 4: run the audit with independent agents again.** The
method is the finding.

## 2. What PH-9 already did that an audit would have

Unusually, the phase under audit contains two things that do an auditor's job.

**The guardrail meta-audit (PH-9.2)** mutates the thing each guard protects and
requires the guard to fail. Ten mutations, ten caught. That is the check Cycle
Audits 1 and 2 kept discovering the need for, made mechanical — and it found a
live regression while being built: mutation payloads containing literal
`import('@nestjs/common')` strings made the dependency guard fail on `@otc/sim`,
because the scanner strips comments but not string literals.

**The withheld red-team families (PH-9.1)** attack the engine with conditioning
that never shaped it. 91 hypotheses clean, plus 107 across a real restart seam.
That is independent evidence in a way the main battery's verdict can no longer be.

## 3. The finding

**CA3-01 — the feed refused a lost past but accepted an impossible future.**

`TickFeed.since()` raised `EvictedError` for history it no longer retained, and
returned `[]` for a sequence it had _never published_. Executed: with 100 ticks
published, `since('a', 600)` returned an empty array — indistinguishable from
"you are up to date".

A client asking for sequence 600 when 100 exist is not behind. It holds ticks the
feed never produced: a different market, a different asset id, or a corrupted
local record. Silence lets it sit there indefinitely believing it is current,
which is the same class of defect as the fast-forward the phase was built to
prevent — a client left holding something nobody else has, with no way to notice.

**Fixed.** `newest + 1` remains legitimate ("I have everything, send the next").
Anything beyond raises `UnknownSequenceError`. Verified to fail without the fix.

The asymmetry is worth naming: refusing lost history was obvious because it is
the case that _loses_ data. The case that _invents_ data was not, and it is the
worse of the two.

## 4. Claims re-executed

| Claim                                              | Result                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Withheld families excluded from the main registry  | **Verified** — 19 main families, zero overlap. Independence intact.                                       |
| `@otc/core/browser` excludes the entropy subsystem | **Verified** — 14 modules in the transitive closure, zero from `entropy/`, zero importing `node:crypto`.  |
| Guardrail meta-audit catches all ten mutations     | **Verified** — 10/10, live tree byte-identical after each.                                                |
| Reduction is numerically safe at long spans        | **Verified** — 11.5-day span at 5,000 columns, all ticks accounted, extremes exact.                       |
| Git integrity                                      | **Verified** — 39 commits, every one carrying the required trailer, no WIP or fixup commits.              |
| `CLAUDE.md` package list matches disk              | **Verified** — exact match.                                                                               |
| All ten invariants carry executed evidence         | **Verified** — `INVARIANTS.md` has no pending row; `traceability.test.ts` enforces it in both directions. |

## 5. The standing Human item, again

GitHub Actions has now refused **eleven** consecutive runs on account billing. No
independent check has ever executed against this repository.

That matters more after PH-9 than before it. The phase's whole subject is
assurance that does not rest on the operator's word — withheld families, a
mutation-audited guardrail suite, a verdict a counterparty can recompute — and
every one of those results is currently attested only by the operator running
them locally. The repository now argues, at length, for exactly the thing it
cannot demonstrate.

## 6. Verdict

**APPROVED.**

Cycle 3 delivered distribution with a stated consistency contract, a frontend
that renders only what happened, and an assurance layer that is independent of
the party making the claim. One material finding, fixed, with a regression test
verified to fail without it.

The caveat in §1 stands: this audit was weaker than the last one by construction,
and its low finding count should not be read as a strong result.

Cycle counter resets. Development continues at PH-10.
