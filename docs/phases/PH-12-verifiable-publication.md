# PH-12 — Verifiable Publication and the Journal in the Running Service

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-12
Status: ACTIVE
Cycle: 4 (phase 3 of 3)
Created: 2026-09-01
Branch: `feature/ph-12-verifiable-publication`
Depends on: PH-1 … PH-11 (all APPROVED)
Decisions applied: [ADR-0002](../decisions/ADR-0002-deterministic-entropy-architecture.md),
[ADR-0004](../decisions/ADR-0004-canonical-price-representation.md),
[ADR-0008](../decisions/ADR-0008-full-delegation.md)

---

## 1. Objective

Make the published record **provably** the record — not merely reproducible — and
have the running service actually emit it.

## 2. Problem

PH-9.3 built a verdict a counterparty can recompute from a published journal with
no key, and then said plainly what it had not built:

> Deliberately not a cryptographic commitment: it proves agreement, not
> authenticity. A signed commitment is a genuine product question — it needs a
> publishing key and a policy for when roots are published — and inventing one
> here would be worse than naming the gap.

The gap is exact. `journalFingerprint` is FNV-1a over the published triples. If
two parties hold the same journal it tells them so. **Nothing stops an operator
publishing a different journal**, and nothing lets a trader show that the record
used to settle their contract is the record that existed when they opened it.

There is a second, blunter gap: **the service does not emit a journal at all.**
Everything PH-9.3 verifies is verified against journals written by tests.

## 3. The decision this phase makes

Publishing verifiable settlement proofs was a Protected Human Decision until
2026-08-31. [ADR-0008](../decisions/ADR-0008-full-delegation.md) delegated it, so
it is decided here and recorded rather than escalated.

**The product publishes a signed Merkle commitment over the tick journal, with
inclusion proofs on demand, and never discloses generator keys.**

### 3.1 Why a Merkle root and not a signed journal

A signature over the whole journal would work and would be simpler. It is
rejected because it forces an unpleasant choice at settlement time: either the
operator publishes the entire tick history — which is large, and which hands
every observer a complete record they have no need for — or a trader cannot check
anything at all.

A Merkle root is one 32-byte value per commitment window. A trader disputing one
contract needs an inclusion proof for two ticks — entry and expiry — which is
`O(log n)` hashes. The operator proves the specific claim without publishing
everything, and the trader verifies without trusting anything.

### 3.2 Why the generator key must not sign

`OTC_MASTER_SECRET` derives every stream in the market through HKDF (ADR-0002).
If it also signed commitments, then any process that can sign can derive
keystream, and a leaked signing key would hand an observer a latent-state
snapshot with hours of forward validity. That is **INV-010** — private generator
state is never exposed in a way that enables future-price reconstruction — and it
is the invariant most easily lost to a convenience.

So the publishing key is a **separate** key, generated independently, never
derived from the master secret and never in the same derivation tree. A service
that can sign must not be able to generate, and the separation is enforced by a
guardrail rather than by discipline.

### 3.3 What a commitment can and cannot prove

Worth stating precisely, because it is easy to oversell.

**It proves**: the journal a counterparty holds is the journal the operator
committed to; a specific tick was in the committed record; the record was not
retroactively altered after the root was published.

**It does not prove** that the operator generated the market fairly. That claim
rests on ADR-0003's theorem, the mirror test and the attack battery — all of
which the counterparty can re-run themselves, which is what PH-9.3 established.

Publication is about **integrity of the record**, not fairness of the process,
and the two are separate guarantees that support each other. The phase must not
let the cryptography imply the statistics.

### 3.4 The publication policy

A root published after the contracts it covers have settled proves nothing an
operator could not have manufactured. So:

- roots are committed on a **fixed cadence in market time**, not on demand;
- a root covers a closed, contiguous sequence range, and ranges tile without gaps
  or overlap — the same property the tick feed already guarantees;
- the chain of roots is **append-only and each root commits to its predecessor**,
  so an operator cannot rewrite history without invalidating every later root.

## 4. Scope

- A Merkle tree over journal entries, with inclusion proofs and a verifier.
- A publishing keypair, its separation from generation, and a signed root chain.
- The service emitting a journal and its commitments as it runs.
- The catch-up bound given an owner and a stated venue policy — carried as a
  limitation since PH-5.

## 5. Exclusions

- Key custody and rotation operations. The _mechanism_ must support rotation;
  running it is an operations concern, and the private key never enters the
  repository.
- Publishing to an external service. Where roots are published is a distribution
  decision; this phase makes them publishable.

## 6. Phase invariants

- **INV-010** is the invariant at risk and the reason for §3.2. The publishing
  key must be structurally incapable of deriving generator state.
- **INV-009** strengthened from "anyone holding the record can recompute the
  verdict" to "anyone can prove which record it was".
- **INV-002, INV-003** — a commitment over the published integers must commit to
  the same series every observer sees.

## 7. Initial decomposition strategy

- **PH-12.1** — the commitment: Merkle tree, inclusion proofs, verifier.
- **PH-12.2** — the publishing key and the signed root chain.
- **PH-12.3** — the service emits it; the venue gets its catch-up policy.

## 8. Acceptance intent

A counterparty holding a tick, a proof and a public key can establish that the
tick was in the operator's committed record — without the operator's cooperation
at verification time, without any private key, and without the whole journal.

## 9. Risks and unknowns

| Risk                                                     | Assessment                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The publishing key ends up derivable from the master key | The failure that would matter. Structural separation plus a guardrail; a signing path that can reach the keyring must fail the build.                   |
| Cryptography implying statistical fairness               | Real and rhetorical. Every claim about a commitment must say what it does _not_ cover (§3.3), including in the code comments and the verifier's output. |
| Commitment cost in the tick path                         | Hashing every tick on the publishing path adds work to a loop that runs continuously. Measured, not assumed.                                            |
| A root published too late to mean anything               | Addressed by cadence in market time (§3.4), and the property must be tested rather than documented.                                                     |
