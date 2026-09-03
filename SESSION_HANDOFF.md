# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Last clean session | 2026-09-03                                                             |
| Branch             | `feature/ph-23-otc-market-lab` — PH-23 approved, **not yet merged**    |
| Remote             | `origin` → NovaHub2026/otcv6, public                                   |
| Active cycle       | Cycle 8, **2 of 3** phases approved (PH-22, PH-23)                     |
| Active phase       | none                                                                   |
| Active subphase    | none                                                                   |
| Cycle Audit        | **007 closed** 2026-09-03; the next is due after three approved phases |
| Blockers           | none, and none possible — no Human gate (ADR-0008)                     |

---

## Continuation point

`CURRENT_STATE.md` is authoritative for where the project stands; this file is
only what a fresh session needs first.

**PH-23.5 is approved** — the Lab has a screen in the panel behind a menu entry
marked `SIM` ([PH-23.5](docs/phases/PH-23.5-the-lab-in-the-panel.md)). It was
gated on this tree (`GATE_EXIT=0`, 2,347 + 268 tests) and the browser suite was
run separately with the library prefix (8 of 8), because the gate skips it
without one:

```
LD_LIBRARY_PATH=$HOME/.otc-local/browser-prefix/usr/lib/x86_64-linux-gnu npm run gate
```

**The next legal action is to fix the two defects the Lab specification audit
found**, then merge the branch and let hosted CI corroborate
([LAB-SPECIFICATION-AUDIT-001](docs/audits/LAB-SPECIFICATION-AUDIT-001.md)):

- **LA-01.** `INTERVENTIONS.shock(size)` does not depend on the signs: a
  single-tick displacement is `sign × step` and its absolute value is the step,
  so the criterion accepts the first draw or none. Executed: `shock(9)` accepts
  at attempt 1 under five seeds, `shock(10)` exhausts under five seeds. It is a
  detector, not an intervention, and its docstring says otherwise.
- **LA-02.** A tick on the boundary millisecond is the chart's next open
  (`bucketStart` floors it into the new bucket) and the settlement's expiry
  price (`priceAtOrBefore` is inclusive). Reproduced with a folded candle
  closing at 110 against a settlement of 120; measured on the shipped engine at
  one 1m candle in 1,163 (EUR/USD) and 471 (BTC/USD). No test relates the two
  rules. Candle Close Control must decide which one it guarantees before it is
  wired to a candle.

After those: the audit's LA-03 to LA-08 are the distance between mechanism and
product — nothing is ever applied to a hosted market, no candle/expiration
addressing, no presets, no simulated positions, seven scenario predicates
against sixteen named, no §70 diagnostic, no `NON-NATURAL TEST` mode. PH-23 §10
names most of them.

## Local services

`~/.otc-local/start.sh` starts the engine (7300), the **Lab** (7302, its own
state directory `~/.otc-local/lab-state`) and the panel (7301), and prints the
tree, branch and commit it served — after 2026-09-02, when it served a stale
worktree for a whole round of "the chart is still broken". The panel points at
the Lab through `OTC_LAB_BASE`; without it the Lab screen says no Lab is
configured, which is the correct state (ADR-0015 §3).

## What the audits say about how to audit

Read [`CYCLE-AUDIT-007.md`](docs/audits/CYCLE-AUDIT-007.md) §5 before the next
one: **guards written against a constant rather than against a behaviour are
the ones that fail.** PH-23.5 added a fourth instance of a second pattern — a
guard that forbids a word fires on the comment explaining its own rule — and
every "this file must not contain X" assertion in `labScreen.test.ts` now runs
on comment-stripped source. And the Lab audit added a third: **a verdict that
reads identically at two hypotheses and at 378.** Ask what a number rests on
before printing it.
