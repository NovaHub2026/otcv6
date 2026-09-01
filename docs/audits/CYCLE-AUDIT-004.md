# Cycle Audit 004

Type: CYCLE AUDIT
Status: ACTIVE
Cycle: 4 (PH-10, PH-11, PH-12)
Started: 2026-09-01
Method: **seven independent agents**, adversarial, working in isolated clones

---

## 1. Method, and why it changed

Cycle Audit 3 was conducted by the agent that wrote the code and found **one**
material finding. Cycle Audit 2 used ten independent agents and found **31**.
Nobody believed Cycle 3 was thirty times cleaner; B-008 recorded the difference
as method, and `GOVERNANCE.md` §28.1 made adversarial discipline a requirement
when ADR-0008 removed the three-phase Human gate.

The environment restriction that had made independent agents unavailable was
removed by the Human Owner on 2026-09-01, and ADR-0011 made their use mandatory
for a Cycle Audit. This is the first audit conducted under that rule.

Seven auditors, each instructed to **falsify rather than confirm**, to
**re-execute rather than read**, and to work read-only in the protected tree with
any mutation confined to a disposable clone (B-006):

| Auditor | Dimension                                                     |
| ------- | ------------------------------------------------------------- |
| 1       | PH-10 — is the differentiation result real or seed-specific?  |
| 2       | PH-11 — statistics: multiplicity, estimators, evidence        |
| 3       | PH-12 — forge a Merkle proof or a signature                   |
| 4       | Invariants and guardrails — plant defects against every guard |
| 5       | Documentation truth — find the claim that no longer holds     |
| 6       | Architecture and implementation quality                       |
| 7       | Cold start and reproducibility                                |

**The decision paid for itself.** The audit produced material findings against
code approved hours earlier, in three categories the authoring agent had checked
and passed: a cryptographic forgery, a statistical claim wrong by a factor of
five, and a class of defect the entire verification model could not observe.

## 2. The finding that matters most

**CA4-06 — nothing had ever built the engine in production.**

No test anywhere constructed the market with `environment: 'production'`. The one
reference to it asserted that it _throws_, because `MasterKeyring.forTesting`
correctly refuses to key a production stream from a public constant. The only
real caller is the venue service.

An auditor planted two defects gated on `environment === 'production'`: an
economic channel read through an alias table, and a leverage effect — volatility
responding to the signed return, the exact Cycle 1 mechanism worth 2.9 points of
edge. Both passed **220 guardrails, 1,060 unit tests, 190 statistical tests,
`tsc -b` and `eslint`**, all green.

Measured on the planted build: **+1.78 percentage points** of directional edge at
roughly ten standard errors, live only where the product runs.

| Configuration            | P(up)   | Edge     |
| ------------------------ | ------- | -------- |
| production, plant off    | 50.212% | +0.212pp |
| production, plant on     | 51.992% | +1.992pp |
| test environment, either | 50.227% | +0.227pp |

This is the seventh instance of the project's signature defect and it is worse
than the previous six. Those were guards untested against what they guarded.
**These guards were structurally unable to observe the configuration that
ships.** `packages/engine` is verified in `test` and `simulation`; it runs in
`production`.

Compounding it, `mirror.test.ts` — named first in `INVARIANTS.md` for INV-006 and
called the gate a statistical battery cannot replace — never calls
`createMarketEngine`. It hand-builds a replica. An _ungated_ leverage effect in
the factory passed it 12 of 12.

**Closed** by `packages/engine/src/productionComposition.test.ts`, which drives
the real factory under a real `fromSecret` keyring in the production environment
for every catalogue asset. Verified: with the plant in place and the new file
removed, 1,060 tests pass; with the file present, every asset fails.

## 3. Material findings

| ID     | Finding                                                                                   | State      |
| ------ | ----------------------------------------------------------------------------------------- | ---------- |
| CA4-01 | The permutation null reports p ≤ 0.01 for five copies of ONE personality, in 3 of 8 seeds | Fixed      |
| CA4-02 | "The 40 cells are ~5 tests" is wrong by ×5; measured m_eff ≈ 26                           | Fixed      |
| CA4-03 | The evidence record was forgeable downward — `z` was never re-derived                     | Fixed      |
| CA4-04 | The root preimage could be re-partitioned: two field tuples, one root                     | Fixed      |
| CA4-05 | One Ed25519 signature attested two different commitments                                  | Fixed      |
| CA4-06 | Production-gated defects invisible to the entire verification model                       | Fixed      |
| CA4-07 | The dependency guard never inspected `apps/`                                              | Fixed      |
| CA4-08 | The design-effect estimator is blind to a run-wide common component                       | Documented |
| CA4-09 | PH-11.1's acceptance band had ~30% power against the deff that breaks the headline        | Fixed      |
| CA4-10 | `OVERVIEW.md` listed 5 of 9 workspaces; PH-12 absent from all architecture docs           | Fixed      |
| CA4-11 | `CLAUDE.md` stated the wrong gate order, no CI, and a private repository                  | Fixed      |
| CA4-12 | `VALIDATION.md` and `CURRENT_STATE.md` said only 30s is policed — the inverse of PH-11    | Fixed      |

### CA4-01 — the null that was not a null

The identical-personality control is five copies of one personality. Across eight
stream families the permutation test declared **significant differentiation
between them in three**, and the committed seed's assertions (`< 0.32`,
`p > 0.01`) fail on two and three of eight respectively. **The test passed on
luck.**

The cause is exchangeability, and it is Cycle Audit 2's finding one level in.
That audit replaced a binomial _because_ it reported p = 4.1e-3 for identical
personalities. The replacement inherits the defect: each asset's windows are
contiguous slices of **one continuous realisation**, so they share slow state and
are genuinely more alike than windows from different runs — **under the null**.
Shuffling destroys a structure the null actually has.

The conclusion survives; the evidence did not. Measured across seeds:

| Signature        | Real catalogue | Identical control |
| ---------------- | -------------- | ----------------- |
| Full             | 51.5–60.5%     | 18.5–33.5%        |
| Scale-free shape | 32.5–41.0%     | 14.5–25.0%        |

The distributions do not overlap. The claim is now a **separation of two
distributions** rather than a p-value, which is both honest and stronger.

### CA4-02 — arguing from a mechanism, then guessing its size

PH-11.2 identified a real mechanism — non-overlapping window returns telescope to
the same terminal displacement — and concluded the eight horizons were "closer to
one test than eight". An auditor measured it: horizons correlate at **ρ ≈ 0.66**,
not 1, and path displacement explains only 30–40% of it. Most of the rest comes
from nesting, which the argument never named: a 30-second window and a
one-minute window **share increments**.

Effective independent tests: **≈ 26 of 40**, not 5. So Benjamini–Hochberg over 40
is very nearly correct, not the over-correction the document apologised for.

**Acting on the withdrawn claim would have manufactured a false positive.** At
m = 5, btcusd 10m is _rejected_ — undoing, with arithmetic, the finding PH-11.2
spent a subphase establishing.

### CA4-03 — a guard that was asymmetric in the direction that matters

The evidence record's self-derivation caught an _inflated_ z, because BH would
fire. It did not catch a _suppressed_ one. An auditor lowered four btcusd z
values from 2.64 to 0.10 and the file reported "worst |z| 1.74, 0 rejections",
passing 8 of 8. A second tamper replaced an entire asset's table with an invented
run and falsified its header from 4,375 simulated days to 87.5 — a fiftyfold
arithmetic impossibility — and also passed.

Suppression is the failure mode a self-approving autonomous loop actually
produces. Both attacks now fail the build.

### CA4-04 and CA4-05 — delimiter framing over fields nobody validated

The root preimage separated `assetId` from the fields after it with a single
`0x00` byte and no length. The 25 bytes of `0x00 || from || to || count` could
sit on either side of that boundary, so two different `(assetId, previousRoot)`
tuples produced **the same root** — accepted by this project's own verifiers,
directly refuting the docstring claiming two records can never share one.

The signing encoding joined six fields with `\n` over two free strings. **One
Ed25519 signature verified against two different commitments**: a published
window over 100..109, and a never-signed reframing as a different asset over
900..909. That defeats PH-12.2's whole guarantee — "an operator cannot present a
different history without producing a second signature, which is itself the
evidence." With an ambiguous encoding there is no second signature.

The 89 tests that existed all passed because every one mutated a **single**
field, and any single-field change alters the concatenation. The attack is a
coordinated multi-field change that preserves it.

Both closed by length-prefixing every variable field, plus `assetId` validation
with the pattern `fileStore.ts` already required — which also closed a path
traversal where an id of `../../escape` wrote journals outside the publication
directory. Verified that the framing alone closes it with validation bypassed:
the auditor's exact collision no longer collides, and a 33-way boundary-shift
sweep finds none.

## 4. Guards that were empty, and who wrote them

| Guard                                           | Hole                                                 | Author       |
| ----------------------------------------------- | ---------------------------------------------------- | ------------ |
| `publishingKey.test.ts` — "keeps the refusal"   | Satisfied by a _comment_ about the refusal           | This session |
| `publishingKey.test.ts` — module list           | Hardcoded pair; the composition root unscanned       | This session |
| `testCost.test.ts` — synchronous drivers        | Bypassed by namespace and dynamic imports            | This session |
| `horizonCoverage.stat.test.ts` — path-bias sign | **Vacuous by construction** — could never fail       | This session |
| `dependencies.test.ts` — no cycle               | Walked a constant in its own file, not the manifests | Earlier      |
| `dependencies.test.ts` — workspaces             | Never enumerated `apps/`                             | Earlier      |
| `guardrails.test.ts` — generation roots         | `runtime`, `trading`, `distribution` unscanned       | Earlier      |

**Four of the seven were written in the session that this audit examined**, by
the agent conducting it, hours before. One — the path-bias sign check — could not
have failed under any input: `netDisplacement` is one scalar per asset and every
other term is non-negative, so the sign is identical across all eight rows by
construction.

Every one of them has now been watched failing against a plant.

## 5. Refuted — what the auditors could not break

Recorded because a closed line of attack is worth as much as an open one.

- **Domain separation between leaf, node and root holds.** 2×10⁶ leaf preimages
  searched against node hashes: 0 collisions. A node-as-leaf proof is rejected.
- **CVE-2012-2459 does not apply.** 64 leaf counts, 64 distinct roots; the
  duplicate-tail construction produces no collision at any size.
- **Ed25519 malleability fails.** All 512 single-bit signature flips rejected;
  the non-canonical `S + L` variant rejected.
- **Cross-window proof replay fails.** 0 acceptances; 4,160 count-reframed proofs
  rejected.
- **The direction design effect really is 1** — confirmed at ten times the
  project's own resolution (400 independent realisations, 0.944–1.014). Every
  one of the forty floors stands.
- **The `pathBiasZ` derivation is correct**, and the "0.8×–3.3×" limitation the
  project recorded was a misreading of noise as bias: the regression slope is
  **1.04 ± 0.07**.
- **Cycle Audit 2's observed-mean bias is not repeated** — measured at 1e-6.
- **`benjaminiHochberg` and `minimumDetectableEffect` are textbook-correct.**
- **The loop-cost detector caught all five shapes** thrown at it. Cycle Audit 2's
  fix held.
- **`MEASURED_LATTICE_TIE_RATES` is now genuinely live** — PH-10's fix held, and
  the values reproduce.
- **All 129 relative markdown links resolve.** Zero broken.
- **No TODO, FIXME, XXX or HACK anywhere** in `packages`, `apps` or `tools`.
