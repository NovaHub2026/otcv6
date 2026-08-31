# PH-9 — Continuous Integrity Assurance and Independent Red-Team Hardening

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-9
Status: APPROVED
Cycle: 3 (phase 3 of 3)
Created: 2026-08-31
Branch: `feature/ph-9-assurance`
Depends on: PH-1 … PH-8 (all APPROVED)
Decisions applied: [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md)

---

## 1. Objective

Turn a one-time proof into a standing guarantee, and find out what the battery
cannot see.

## 2. Problem

### 2.1 The battery has been used to shape the engine, so it can no longer be surprised by it

Every attack family in `@otc/lab` was available while PH-3 tuned the market
process. That is exactly how it should have been used — the phase ran a
generate → attack → diagnose → correct loop — but it has a consequence nobody has
stated plainly: **a clean verdict from those families is no longer independent
evidence.** They are the families the engine was shaped to survive.

This is not hypothetical. PH-2 measured the failure mode directly: a
conventional battery, 354 hypotheses across translation-invariant and temporal
families, returned _clean_ on an engine whose volatility was keyed to the price
level. The families that would have caught it did not exist yet.

So PH-9's central requirement, fixed by the roadmap, is a red-team round using
**attack families deliberately withheld from all prior tuning**. Since nothing
was actually withheld, they have to be invented now — and their value is
precisely that no engine decision has ever been made with them in view.

### 2.2 The guardrail suite has never been a subject

Both Cycle Audits found the same class of defect, and it was never in the engine:
guards that existed, were documented as sufficient, and had never been tested
against what they guarded. The blindness demonstration missed settlement. The
loop-cost detector caught one shape in seven. The dependency check was bypassed
by a dynamic import. The rendering guard passed with interpolation planted.

Four for four. The guardrail suite is now a substantial piece of software that
nothing audits, and it is the thing every other claim rests on.

### 2.3 A proof is a snapshot; a venue runs continuously

Everything verified so far was verified once, on a tree. A market that runs for
months needs the verdict to be _re-derivable_ on demand from recorded history, by
someone who does not hold the key.

## 3. What the withheld families must be

To be genuinely independent they must condition on something no prior family used
and no tuning decision considered. Four qualify:

- **cross-asset** — does another asset's recent movement predict this one's
  direction? Structurally impossible (separate keys, separate streams), and never
  once attacked. This is the family that would catch a shared-state leak of the
  kind Cycle Audit 2 planted by hand.
- **arrival-gap** — does the interval since the previous tick predict direction?
  The temporal families condition on wall-clock _phase_; none has ever
  conditioned on inter-arrival time, which is the one quantity the Hawkes process
  directly controls.
- **sequence-parity** — does the parity or low-order residue of the tick sequence
  number predict direction? Trivially clean under the theorem, never checked, and
  exactly the sort of thing a counter-based generator could plausibly leak.
- **seam-proximity** — does nearness to a restart seam predict direction? Seams
  did not exist until PH-5 and have never been attacked at all.

A clean verdict from these means something the existing battery's verdict cannot
mean any more.

## 4. Scope

- The four withheld families, and a red-team verdict from them alone.
- A meta-audit of the guardrail suite: for each guard, does it fail on the defect
  it names?
- Re-derivable assurance: a verdict computable from a recorded tick journal by a
  party holding no key.
- The standing-guarantee record: what is checked, how often, and what a failure
  means.

## 5. Exclusions

- Retuning the engine. If a withheld family finds something, that is a finding
  for the record and a Cycle 4 problem — silently tuning against it would destroy
  the independence that makes it worth having.
- Live production monitoring infrastructure. The verdict must be _computable_;
  scheduling it is an operations concern.

## 6. Architectural direction

### 6.1 The withheld families live apart, and their independence is recorded

They go in their own module, marked as withheld, so a future phase cannot
casually tune against them without noticing what it is doing.

### 6.2 The meta-audit is mechanical, not editorial

For each guardrail, mutate the thing it protects and assert the guardrail fails.
A guard that survives its own mutation is reported, not excused.

## 7. Phase invariants

- **INV-006** re-established against families that never informed the design.
- All ten invariants must remain demonstrated; the meta-audit's job is to check
  that the _evidence_ is real, not to re-derive it.

## 8. Dependencies

PH-2's battery machinery and PH-3's engine. Both approved.

## 9. Initial decomposition strategy

- **PH-9.1** — the withheld red-team families and their verdict.
- **PH-9.2** — the guardrail meta-audit.
- **PH-9.3** — re-derivable assurance and phase integration.

## 10. Acceptance intent

A clean verdict from families that never shaped the engine, a guardrail suite
each of whose members has been shown to fail on its own defect, and a verdict any
holder of the published record can recompute.

## 11. Risks and unknowns

| Risk                                                | Assessment                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A withheld family finds a real edge                 | The point of the exercise. It would be the most valuable finding in the project, and §5 forbids quietly tuning it away. |
| The withheld families are too weak to find anything | Real. Each must be calibrated against the planted-edge fixture corpus, exactly as PH-2 calibrated the originals.        |
| The meta-audit becoming a formality                 | Guarded by requiring a _mutation_ per guard, not a reading.                                                             |

---

## 12. Phase approval record

**APPROVED** from executed evidence, 2026-08-31.

### The result the phase existed to produce

Three things that did not exist before it:

1. **A verdict from families that never shaped the engine.** 91 hypotheses,
   CLEAN, worst |z| 2.91; and 107 hypotheses CLEAN across a real restart seam.
2. **A guardrail suite that has been audited.** Ten mutations, ten guards fail on
   the defect they name, run in isolated copies that never touch the working
   tree.
3. **Assurance a counterparty can recompute.** A verdict and settlements derived
   from a published journal alone — no key, no engine, no configuration.

| Subphase | Title                                  | State    |
| -------- | -------------------------------------- | -------- |
| PH-9.1   | The withheld red-team families         | APPROVED |
| PH-9.2   | The guardrail meta-audit               | APPROVED |
| PH-9.3   | Assurance a counterparty can recompute | APPROVED |

### Phase invariants

- **INV-006** re-established against conditioning that had no influence on the
  design — which is a materially stronger statement than the main battery can now
  make about itself.
- **INV-009** strengthened from "the operator can recompute it" to "anyone
  holding the published record can".
- All ten invariants remain demonstrated, and for the first time the _evidence_
  has been audited rather than trusted.

### What the phase learned

**A clean verdict decays.** Every family in the battery was available while PH-3
tuned the engine, so their clean result stopped being independent evidence the
moment it was used to steer design. Nobody had said so. That is not a defect in
the battery — it is a property of using a test as a target, and it means
independence has to be manufactured deliberately and then protected. PH-9 §5
forbids tuning against the withheld families for exactly that reason: doing it
once would convert them into what the main battery already is.

**The plant needs the same scrutiny as the guard.** This phase produced three
more instances of a pattern that has now appeared six times: a mutation whose
anchor did not exist, a mutation that removed one of nine pieces of evidence, and
a planted edge averaged away by the contract horizon. In each case the guard
looked toothless and was fine. A meta-audit is only worth having if it fails
loudly when its own plant misses, which is why the anchor assertion exists.

**Auditing the auditor terminates somewhere, and saying where is the honest
move.** The meta-audit is itself a guard that nothing audits. That regress stops
here, deliberately, because its failure mode is visible: a mutation that finds no
anchor fails loudly rather than passing quietly.

### Known limitations carried forward

- The withheld families are calibrated against edges of roughly 12–18 percentage
  points; subtler structure in the same conditioning would need more history.
- `wh-seam-proximity` needs more data than the others to reach confirmation.
- Ten mutations is not an exhaustive mutation space.
- The journal fingerprint proves agreement, not authenticity. Signed publication
  is unscoped and is the natural next step.
- The journal is not yet emitted by the running service.
