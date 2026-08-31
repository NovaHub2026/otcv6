# Cycle Audit 002 — PH-4, PH-5, PH-6

| Field         | Value                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Cycle         | 2 (phases PH-4, PH-5, PH-6)                                                                                                   |
| Authorised by | Human Owner — `EJECUTA`, 2026-08-31                                                                                           |
| Scope         | `GOVERNANCE.md` §30.1–30.9, comprehensive                                                                                     |
| Method        | 10 parallel audit agents executing rather than reviewing, each material finding adversarially refuted by an independent agent |
| Findings      | 31 confirmed material, 40 minor, 2 refuted, 103 claims re-executed and held                                                   |
| Verdict       | **APPROVED**, with the incident in §2 recorded as the cycle's defining failure                                                |

## 1. Method, and why it was different

Cycle Audit 1 concluded that the highest-value thing an audit does is **execute
claims that were only ever asserted**. Cycle Audit 2 was built entirely around
that: ten agents, one per §30 area, each instructed to run commands, write probe
scripts, and — where a guardrail claimed to catch something — plant the defect and
watch it fail. Every material finding was then handed to an independent agent
whose job was to _refute_ it.

That worked. 204 checks were executed, 103 recorded claims were re-run and held
up, and two findings were refuted and discarded. It also produced the incident
below, which no amount of reading would have found.

## 2. The incident: an audit backdoor reached `main`

**What happened.** The `blindness` agent was instructed to plant a deliberate
economic leak and confirm the demonstration fails on it — the single most
valuable check in the audit, and it did its job. While it held that plant in the
working tree, the orchestrating session ran `git add -A && git commit` for an
unrelated documentation fix and swept both halves of the backdoor into commit
`e710336` on `main`.

The committed code made price magnitude a function of a global operator-exposure
value, armed by an environment variable, with `settle()` accumulating every
contract's stake into that global **unconditionally**.

**How bad.** The commit reached local `main` only; `origin/main` was at `20b0001`
and the plant was never pushed. But `CLAUDE.md` §8 designates `main` as trusted
integrated state, and §71 has a fresh agent derive the project's state from the
repository — that is, from local `main`.

**Resolution.** `main` was reset to `20b0001`, the three legitimate files
restored from the discarded commit, and the work re-committed as `c0f9ace`. HEAD
now contains no trace of the plant; verified by `git show HEAD:… | grep`, by a
clean rebuild, and by a source-wide grep.

**Cause, stated plainly.** `git add -A` in a repository where concurrent agents
were actively modifying files. The agents behaved correctly and restored their
own changes; the orchestrator committed the window between plant and restore. The
agents were even instructed to verify `git status --porcelain` at the end — and
one of them reported the tree shifting under it, correctly attributing it to a
concurrent session.

**What follows.** Audit plants belong in an isolated clone, never in the working
repository — one agent did exactly that and reported it. And a session must not
`git add -A` while it has subagents running. This is recorded rather than
quietly fixed because it is the most serious process failure in the project's
history: an INV-001 backdoor was committed to the trusted branch by the very
process meant to protect it.

**A second finding rides on it.** That commit also failed `npm run lint` (6
errors) while passing all 137 guardrails — which is the B-001 argument in
miniature. No independent check has ever run against this repository.

## 3. Confirmed material findings, and what was done

### Persistence and recovery — the phase's own stated risks, all real

| ID         | Finding                                                                                                                                                                                                                              | Status    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| RC-01      | A record containing the JSON literal `null` parsed cleanly, read as "nothing ever ran", and restarted the market at genesis re-consuming keystream from block zero. Every other malformed shape threw.                               | **Fixed** |
| RC-02      | The seam rewound to the stale `lastPublished` and republished the observed window with **different** prices, restarting the sequence at 1. Measured: 146 republished ticks, one instant carrying two prices 935 lattice steps apart. | **Fixed** |
| RC-03      | `seamFrom` derived cursors from the record it had just declared untrustworthy. A foreign record re-issued 5,377 consumed blocks; a missing lease entry restarted the **sign** stream at cursor 0:0.                                  | **Fixed** |
| HOSTED-001 | The catch-up bound was inert until the first publication: 68,160 ticks published against a one-second bound.                                                                                                                         | **Fixed** |
| HOSTED-002 | `checkpointMarket` used the process-local getter, so a resumed market checkpointing before its first tick erased the durable history. PH-5.3 fixed the read path and left the write path.                                            | **Fixed** |

RC-02 is the one PH-5.2 §3 had itself named as the central risk. It was named,
documented, and never tested.

Its fix produced the audit's best moment of design: the seam now **leases
sequence numbers** exactly as the project already leased keystream positions. The
record is stale by construction after a crash, so resuming from the recorded
number reissues numbers already used — the same failure, one field over, and
nobody had noticed the idea applied there too.

### The venue

| ID         | Finding                                                                                                                                                                    | Status    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| HOSTED-003 | A throw from one asset discarded ticks earlier assets had already consumed and skipped every later asset — permanently, on every subsequent call.                          | **Fixed** |
| HOSTED-004 | Cross-asset independence — the property the venue's own docstring calls the obvious route for one asset's state to reach another's prices — had **zero** test enforcement. | **Fixed** |

### Blindness — the most important finding in the audit

**BLIND-001.** A settlement rule reading the trader's position and shaving small
wins into refunds passed **all 769 unit tests, all 137 guardrails, and the
economic-blindness demonstration itself**, while lifting the operator's margin
from 12.75% to 17.19%. Escalating the shave reached 23.52% and still passed.

The demonstration compares tick streams, and a settlement leak leaves ticks
untouched. The vocabulary scan excludes `packages/trading` — and could not help
anyway, since settlement legitimately reads `direction`.

**Fixed** by the settlement mirror: flipping the trade direction must exchange
wins and losses exactly and leave ties untouched, because a tie belongs to the
prices and not to the bet. Added as unit tests and over real engine data.
Verified both ways — the mirror fails on the audit's plant, the old
demonstration passes it.

### Guardrail evasion

| ID                      | Finding                                                                                                                                                         | Status                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-02 / SEC-02        | `globalThis` and `process.env` were open channels into the price core, named by no rule and imported by nothing — the exact route the incident's backdoor used. | **Fixed**                                                                                                                                                               |
| ARCH-04 / SEC-03        | Dynamic `await import(...)` bypassed the dependency guardrail entirely.                                                                                         | **Fixed**                                                                                                                                                               |
| ARCH-03                 | So did a relative path into another package's `dist/`.                                                                                                          | **Fixed**                                                                                                                                                               |
| CA2-IV-003              | `testCost.test.ts` caught one loop shape in seven, missing `i++` — measured at 4,214ms against a 5s timeout, the identical failure that broke two phase gates.  | **Fixed**                                                                                                                                                               |
| CA2-INV-03 / CA2-IV-002 | The blindness scan is an identifier allowlist that missed three of the five field names of the repo's own `Contract` type.                                      | **Partly fixed** — contract vocabulary added; the deeper point that it matches names rather than structure is answered by the behavioural checks, not by a longer list. |

### Evidence integrity

**CA2-INV-04.** The p-values quoted as INV-007's evidence came from a binomial
tail assuming 200 independent classifications. They are contiguous slices of a
few realisations, each classified against a centroid built from its own asset's
other windows. The audit ran the identical-personality control on ten independent
id-sets: accuracies 18.5%–28.0%, and the binomial reported the 28.0% draw as
p = 4.1e-3 — "highly significant differentiation" between five copies of one
personality.

**Fixed** by a permutation null. Re-measured, INV-007 stands at 53.0% observed
against a best relabelling of 30.5% over 199 shuffles: **p = 0.005**, not
5.1e-25. The finding survives; the significance was overstated by twenty-two
orders of magnitude.

**BLIND-003.** PH-6.2's explanation of the tie-rate gap was a plausible story
that measurement did not support. Reproducing PH-4.2's own sampling scheme on the
real lattice gives 0.47% against a recorded 0.98% — 5.5 standard errors apart,
and staleness accounts for only the smaller step. The real cause: calibration
measures a **continuous** return against the quantum, while a tie is an
**integer** event. **Fixed** in the documentation and recorded as
`MEASURED_LATTICE_TIE_RATES`; economically neutral under ADR-0007 and in the safe
direction.

### Documentation and state

**CA2-IV-004 / D-01 / D-03.** At the audited commit, `CURRENT_STATE.md` said
Cycle 2 had "0 of 3" phases approved and that PH-5 was next to be created, with
PH-4, PH-5 and PH-6 all approved and merged. The verification table presented
Cycle-1 numbers as current, and both re-checkable rows were false.

Found independently by the orchestrator immediately before the audit ran, fixed
in `c0f9ace`, and closed structurally by `stateConsistency.test.ts`, which derives
the truth from the roadmap. The cause — Prettier re-padding Markdown tables so
exact-string replacements silently match nothing — is the third recurrence of a
mechanism Cycle Audit 1 recorded twice.

**D-02.** `@otc/runtime` and `@otc/trading` appeared in **no** architecture
document, while `OVERVIEW.md` — whose header states "layers that do not appear
here do not exist yet" — still marked `apps/api` "(not yet built)". **Fixed** by
`docs/architecture/RUNTIME_AND_TRADING.md`.

## 4. What held up

103 recorded claims were re-executed and reproduced, including:

- the mirror test on all five assets, zero divergences;
- ACCEPTABLE verdicts with 15/15 realism on all five assets;
- `traceability.test.ts` having teeth in **both** directions;
- the identical-personality control being a genuinely well-designed null;
- PH-6.2's ledger numbers reproducing exactly (4,000 contracts, 15 refunded,
  46.68% win rate, 12.75% margin);
- the shape signal being real rather than noise, against an empirical
  identical-personality band of 17.5%–24.0%;
- INV-002, INV-003, INV-004, INV-009 and INV-010's cited tests genuinely
  asserting what the map claims.

Two findings were **refuted** by adversarial verification and discarded: a claim
that the tick-identity assertion is satisfied by plain determinism, and a claim
that the vocabulary scan's exclusion of `packages/runtime` was itself a defect.

## 5. Verdict

**APPROVED.**

The three phases deliver what they claim, and the claims are now considerably
better evidenced than they were. But this audit found more real defects than the
first — including one that would have let an operator quietly take an extra 4.4
points of margin, and one that would have republished different prices for
instants observers had already seen.

The pattern across both audits is now unmistakable. Cycle 1's finding was _claims
asserted without execution_. Cycle 2's is narrower and worse: **guards that
existed, were documented as sufficient, and had never been tested against the
thing they were guarding against.** The blindness demonstration, the loop-cost
detector, the dependency direction check, the corrupt-record refusal, the seam's
lease discipline — each was real, each was believed, and each had a hole that one
planted defect exposed in minutes.

The response in every case was the same and should be the standing rule: **a
guard is not finished until it has been watched failing.**

Cycle counter resets. Development continues at PH-7.
