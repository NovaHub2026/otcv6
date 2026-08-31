# PH-9.1 — The withheld red-team families

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-9.1
Parent phase: PH-9 — Continuous Integrity Assurance and Independent Red-Team Hardening
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Attack the engine with families that never shaped it.

## 2. Why a clean verdict from the existing battery no longer means what it did

Every family in the main registry was available while PH-3 tuned the market
process. That is how it should have been used — the phase ran a generate → attack
→ diagnose → correct loop — but the consequence has never been stated: those are
the families the engine was shaped to survive, so their clean verdict is no
longer _independent_ evidence of anything.

PH-2 measured this exact failure. A conventional battery — 354 hypotheses across
translation-invariant and temporal families — returned **clean** on an engine
whose volatility was keyed to the price level. The family that would have caught
it did not exist yet.

## 3. The four families, and why each is independent

| Family                | Conditions on                               | Never used because                                                                                                                                                     |
| --------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wh-arrival-gap`      | Milliseconds since the previous tick        | Temporal families condition on wall-clock _phase_; none has conditioned on inter-arrival time, which is the one quantity the Hawkes process sets directly.             |
| `wh-sequence-residue` | Tick sequence modulo 7                      | Trivially clean under the theorem and never checked — and the sign stream is counter-addressed, so a residue class is exactly where a leak of that index would appear. |
| `wh-seam-proximity`   | Signed tick distance from a restart seam    | Seams did not exist until PH-5 and have never been attacked at all.                                                                                                    |
| `wh-cross-asset`      | A second asset's move over the previous 30s | Assets hold separate keys and separate streams; this is the family that would catch a shared-state leak of the kind Cycle Audit 2 planted by hand.                     |

## 4. Calibration found the failure it exists to prevent — in itself

A family nobody has calibrated is worse than no family: it returns clean on
everything, and the clean verdict gets read as evidence.

**The first seam corpus produced zero hypotheses.** A ±3,000-tick plant looked
reasonable, but the battery evaluates non-overlapping contracts, so 260,000 ticks
yield only a few thousand entries and every bucket fell below the 500-sample
floor. The family reported clean while testing _nothing_. That is precisely the
defect this corpus exists to catch, caught in the corpus itself.

**Widening it exposed a second layer.** The finding came back `significant: true`
at z = 20.4 and `material: true`, but **`confirmed: false`** on 99 confirmation
samples against a threshold of 125 — PH-2's held-out confirmation split working
exactly as designed.

The response was to record a property rather than tune it away:
**`wh-seam-proximity` needs more history than the others before its findings can
be acted on.** Its calibration runs at a lower bucket floor for that reason, and
the reason is written where the next reader will find it.

The other planted edges also had to be made _horizon-persistent_: a bias keyed to
a single tick's gap is averaged away over a 30-second contract, so the first
arrival-gap plant was one no family could have found. That would have been read
as the family being weak rather than the plant being wrong.

## 5. The verdict

Against the real engine, 3,000,000 ticks:

```
red team:      91 hypotheses across 3 withheld families, CLEAN,
               worst |z| 2.91, detection floor 0.577pp
red team seam: 107 hypotheses, CLEAN, real seam at tick 900,000
```

The cross-asset family ran against a genuinely independent second catalogue asset
— separate key derivation, separate streams, sharing only a clock. The seam test
built a real seam: run, checkpoint, restart beyond every consumed cursor, and
attack the joined series.

A worst |z| of 2.91 across 91 hypotheses is unremarkable under the null; the
battery's FDR control is what turns that into a verdict rather than a number.

## 6. What this does and does not establish

**Does:** the engine survives four attack angles that had no influence on its
design, including one that would catch cross-market state sharing and one that
attacks a restart seam for the first time.

**Does not:** prove there is no edge. No battery can. The structural argument in
ADR-0003 is what carries that claim; these families exist to catch a _break_ in
it, and their independence is what makes a clean result informative rather than
circular.

**Forbidden:** tuning the engine against these families. PH-9 §5 says so
explicitly, and the reason is that doing it once converts them into exactly the
kind of evidence the main battery has already become.

## 7. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                   | Result                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| `npm run format:check`  | PASSED (exit 0)                                                    |
| `npm run lint`          | PASSED (exit 0)                                                    |
| `npm run build`         | PASSED (exit 0)                                                    |
| `withheld.stat.test.ts` | PASSED — 5 tests: control clean, each family detects its own plant |
| `redTeam.stat.test.ts`  | PASSED — 2 tests, 198 hypotheses, clean                            |

### Known limitations carried forward

- `wh-seam-proximity` requires more history than the others to reach
  confirmation. Recorded, not tuned away.
- The families are calibrated against edges of roughly 12–18 percentage points.
  A far subtler edge in the same conditioning would need more data to detect;
  the reported detection floor (0.577pp here) is what bounds that claim.
