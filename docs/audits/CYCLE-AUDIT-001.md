# Cycle Audit 001 — PH-1, PH-2, PH-3

| Field         | Value                                                     |
| ------------- | --------------------------------------------------------- |
| Cycle         | 1 (phases PH-1, PH-2, PH-3)                               |
| Authorised by | Human Owner — `EJECUTA`, 2026-08-31                       |
| Scope         | `GOVERNANCE.md` §30.1–30.9, comprehensive                 |
| Status        | COMPLETE                                                  |
| Findings      | 14 (5 material, 9 minor) — all resolved within this audit |
| Verdict       | **APPROVED**                                              |

## 1. What was audited

The first three phases built a deterministic market substrate (PH-1), an
adversarial validation laboratory (PH-2) and the generative market process
(PH-3). Every subphase was approved from targeted evidence, and each phase from
integrated evidence. This audit asks the question those gates cannot: taken
together, is the system actually what its documentation says it is?

The audit was conducted against the repository, not against memory of building
it. Where a claim could be executed, it was executed rather than reviewed.

## 2. Product coherence (§30.1)

The product promise is a synthetic market that is realistic to trade and
structurally impossible to predict directionally. The architecture delivers this
through one decision, recorded in [ADR-0003](../decisions/ADR-0003-conditional-sign-symmetry.md):
every increment is `x_k = s_k · m_k`, where `s_k` is an independent fair coin
drawn from a dedicated stream and `m_k` is a magnitude structurally forbidden
from observing any sign.

This holds. `MagnitudeContext` and `ArrivalContext` expose only `intervalMs`,
`previousMagnitude` (an absolute size), `instant` and `sequence`. No signed
quantity reaches the magnitude path, so flipping every future sign is a
measure-preserving involution and `P(up) = P(down)` exactly, at every horizon,
under every public conditioning. The mirror test verifies this operationally: it
negates the sign stream from a randomised interior snapshot and requires every
latent variable to be bit-identical and every increment exactly negated.

Realism is carried entirely by magnitude and timing — the MSM cascade, the
semi-Markov regime, the structural phase model and the Hawkes arrival process —
which is why realism and unpredictability do not compete here.

**No product-level incoherence found.**

## 3. Architecture (§30.2)

Dependencies are acyclic and match the documented rules: `core` depends on
nothing, `engine` and `fixtures` on `core`, `lab` on `core` (with `fixtures` as a
dev dependency only, so the calibration corpus cannot leak into the battery's
runtime), and `sim` on all four. The sign boundary is enforced by the type system
rather than by convention.

**No architectural defect found.** The one structural weakness the audit did
surface was not in the design but in what had been verified of it: the composed
magnitude model's restore path — the seam between the layers — had never been
executed. See F-06.

## 4. Implementation quality (§30.3)

Reviewed the full source of `core`, `engine` and `lab`. The code is consistent in
idiom, comments explain why rather than what, and every non-obvious constant is
justified in prose at its definition. Error paths use `RangeError` with messages
naming the offending value. All pathological configurations tested during the
audit were rejected rather than silently clamped.

Two API-quality defects were found and fixed — see F-01 and F-02.

## 5. Integrated verification (§30.4)

Executed in full at the close of the audit, after every fix below had landed.
Results are recorded in [`docs/evidence/CYCLE-1-VERIFICATION.md`](../evidence/CYCLE-1-VERIFICATION.md).

That run found F-14, which none of the three phase gates had: running the suite
_with coverage_ is a different execution mode from running it plain, and a
wall-clock assertion that had passed every previous gate failed under
instrumentation. It is a small defect, but it is the same shape as the rest of
this cycle's findings — a check that had only ever been run one way, reported as
if it held generally.

## 6. Security and reliability (§30.5)

- **Key containment.** `MasterKeyring` holds its secret in an ECMAScript
  `#private` field and overrides `toJSON`, `toString` and the Node inspect hook.
  `JSON.stringify` of a keyring, an engine or a snapshot leaks no key material.
  This defect was real: TypeScript's `private` is compile-time only, and an
  earlier keyring serialised its entire 32-byte master secret.
- **Snapshot containment.** A full engine snapshot is 584 bytes at 1,000 ticks
  and contains latent model state and stream cursors only. Re-executed during
  this audit: `JSON.stringify` of the keyring, the engine and the snapshot, plus
  their `String()` and Node inspect forms, were each probed for hex runs of 32
  characters or more. All six surfaces clean.
- **Restart safety.** Cursor leasing reserves keystream positions ahead of use,
  so a crash cannot cause a redraw of consumed values. Verified across a seam.
- **Stability.** A 200,000-tick continuous run completed in 245 ms with no
  drift, no unbounded growth and no clamp pinning.

No security finding. One reliability gap in test coverage — see F-06.

## 7. Performance (§30.6)

Tick generation sustains roughly 800,000 ticks per second single-threaded
(200,000 ticks in 245 ms). A hosted market ticks about once per second per asset,
so a single core covers any catalogue this product will plausibly carry, and
performance constrains no design choice in this cycle. The
battery's O(n) feature frame keeps its detection floor below the 0.2513pp
materiality threshold it polices. The earlier per-family recomputation capped that
floor at 0.26pp — worse than the threshold — and was fixed in PH-2.

## 8. Technical debt

Scanned by execution rather than impression:

- **No `TODO`, `FIXME`, `HACK` or `XXX` markers** anywhere in `packages` or `tools`.
- **One `eslint-disable`** in the entire codebase — `clock.ts:23`, the single
  sanctioned ambient time read, annotated with its justification inline.
- **No `any` types and no `@ts-ignore`/`@ts-expect-error`** in production source.
- **No skipped, `.only` or `.todo` tests.** This one matters more than it looks:
  a stray `.only` silently disables every other test in its file, and the suite
  still reports green.

There is no meaningful accumulated debt to record. The two items carried forward
are limits on evidence rather than defects, and are tracked as B-002 and B-003 in
[`docs/BACKLOG.md`](../BACKLOG.md).

## 9. Documentation and memory (§30.7, §30.8)

This is where the audit found the most: four findings, three of them material,
all concerning the gap between what the repository asserts and what is true.

The pattern connecting them: **claims asserted without execution.** Every one of
these would have been caught by running a single command.

## 10. Cold start (§30.9)

Verified that a fresh agent can reconstruct the project from the repository
alone. `npm run typecheck`, `npm run clean`, `npm run build` and `npm test` all
behave as documented. Two documentation defects that would have misled a fresh
agent were found and fixed — see F-09 and F-10.

## 11. Git integrity

Verified by execution, not by recollection: 14 commits, no WIP, fixup or squash
commits, and every single commit carrying the required `Co-Authored-By` trailer.

Both Cycle 1 feature branches were confirmed fully merged into `main` and then
deleted (F-11). `main` had been showing `[origin/main: gone]` because the
configured remote is empty — see F-13.

## Findings

| ID   | Severity     | Area          | Finding                                                                                                                                                                                                              | Resolution                                                                                                                                                  |
| ---- | ------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | Minor        | API           | `lastCompletedMinute` exported twice from `@otc/lab`; the natural name resolved to the slow reference implementation, not the one the families run                                                                   | Renamed: the frame implementation takes the natural name, the reference becomes `lastCompletedMinuteReference`                                              |
| F-02 | Minor        | Documentation | `features.ts` header claimed the functions were "shared by the attack families" — untrue since PH-2 moved the families onto `FeatureFrame`                                                                           | Header rewritten to describe its real role: the readable specification the fast path is tested against                                                      |
| F-03 | **Material** | Invariants    | **INV-005 had no enforcement.** Planting `selectedExpirationMs` into `MagnitudeContext` left all 18 guardrail tests passing                                                                                          | New `no-contract-inputs` rule; verified to catch the planted violation                                                                                      |
| F-04 | **Material** | Memory        | `PROJECT_CONTEXT.md` and `CLAUDE.md` omitted `@otc/fixtures` and `@otc/lab` — two of five packages, the entire validation laboratory                                                                                 | Both package tables corrected; new guardrail asserts every workspace package is documented                                                                  |
| F-05 | **Material** | Traceability  | No invariant→evidence map existed anywhere. This is _why_ F-03 survived three phases: a gap in an unwritten map is invisible                                                                                         | [`docs/architecture/INVARIANTS.md`](../architecture/INVARIANTS.md) plus `traceability.test.ts`, which fails if an enforced invariant has no tagged evidence |
| F-06 | **Material** | Testing       | `ModulatedMagnitudeModel.restore()` — the composed path the hosted runtime will call on every deploy — was never exercised. Components were tested only in isolation                                                 | Three tests on the canonical engine, including one verifying the assertion has teeth and one verifying latent volatility survives restore                   |
| F-07 | Minor        | Testing       | INV-002 (shared market) had no direct test                                                                                                                                                                           | `sharedMarket.test.ts`: independently constructed processes produce identical streams; observers at different cadences agree on price                       |
| F-08 | Minor        | Measurement   | Coverage was measured on the `unit` project only, so files exercised solely by statistical tests read as 0%                                                                                                          | Documented in `CLAUDE.md`; cycle coverage measured across both projects                                                                                     |
| F-09 | Minor        | Cold start    | `CLAUDE.md` listed `docs/evidence/` with no "future" caveat for a directory that did not exist                                                                                                                       | Directory created and populated; new guardrail rejects any documented path that neither exists nor is marked as future work                                 |
| F-10 | Minor        | Cold start    | `CLAUDE.md` did not warn that `npm run gate` takes ~13 minutes; a fresh agent would read it as hung                                                                                                                  | Durations documented for every test command                                                                                                                 |
| F-11 | Minor        | Hygiene       | Two merged feature branches retained; `main` showed `[origin/main: gone]`                                                                                                                                            | Branches deleted after confirming both were fully merged                                                                                                    |
| F-12 | Minor        | Backlog       | Deferred items surfaced during the cycle lived only in phase documents, not the canonical backlog                                                                                                                    | Consolidated into `docs/BACKLOG.md`                                                                                                                         |
| F-13 | **Material** | Memory        | **The remote was misdescribed.** See below.                                                                                                                                                                          | Living documents corrected; correction of record below                                                                                                      |
| F-14 | Minor        | Testing       | A throughput assertion hard-coded `> 200_000` ticks/s. It failed at 116k under v8 coverage instrumentation while the engine sustains ~800k uninstrumented — a test whose result depends on how the suite was invoked | Floor rewritten to encode the product requirement (20,000x real time) rather than a machine speed; verified passing under coverage                          |

## F-13, in full

`CURRENT_STATE.md`, `SESSION_HANDOFF.md`, `docs/BACKLOG.md` B-001 and all twelve
PH-1/PH-2/PH-3 approval records stated that **no GitHub remote exists**.

The truth, established by running `git remote -v` for the first time during this
audit:

- `origin → https://github.com/NovaHub2026/otcv6` **is** configured;
- `branch.main.remote = origin`, `branch.main.merge = refs/heads/main`;
- the private repository exists and is reachable;
- it is **empty** — nothing has ever been pushed.

The remote existed throughout all three phases. The claim was false when written,
and was repeated across twelve documents without once being checked.

The _verdict_ those records reached — "Hosted CI: NOT EXECUTED" — was correct,
because nothing had been pushed. Only the stated reason was false. Per §47,
historical approval records are therefore **left intact**; this section is the
correction of record. Living documents (`CURRENT_STATE.md`, `docs/BACKLOG.md`)
have been corrected in place.

## The lesson of this cycle

Eight of fourteen findings are one failure wearing different clothes: **a claim
recorded as verified that had never been executed.** F-03, F-04, F-05, F-06,
F-07, F-08, F-09 and F-13 are all that.

None of them was a hard problem. F-13 needed `git remote -v`. F-03 needed one
planted field. F-06 needed one call to a method that was already public. The
difficulty was never in the checking; it was that nothing ever asked for it.

The subphase and phase gates could not catch these, because both check _what was
built against what was specified_ — and these are failures of the specification
itself asserting something about the world.

Two structural defences were added, chosen because they fail loudly rather than
requiring diligence:

1. `traceability.test.ts` — an enforced invariant with no evidence fails the
   build. The map cannot silently develop holes.
2. The layout guardrail — a documented path that does not exist fails the build,
   and an undocumented package fails the build.

Both were verified to have teeth: each was made to fail deliberately before being
accepted.

## Verdict

**APPROVED.** The three phases deliver what they claim. The central theorem is
sound and structurally enforced, the entropy architecture is correct, and the
validation laboratory is calibrated against known-planted edges rather than
assumed effective.

The cycle's real weakness was not in the code. It was that the repository — the
project's only durable memory — had drifted from the truth in ways no gate was
looking for. That is now enforced rather than trusted.

Cycle counter resets. Development continues at PH-4.
