# ADR-0002 — Deterministic entropy architecture

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-08-31
Deciders: Autonomous Development Agent (delegated authority, `GOVERNANCE.md` §41, §65)
Phase: PH-1.1
Supersedes: —

---

## Context

The engine's random source has to satisfy four requirements that ordinarily pull
against each other:

| #   | Requirement                                                                                                                       | Source            |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| R1  | **Exact replay.** A settled contract must be reconstructable from records, years later.                                           | INV-009, §21      |
| R2  | **Public unpredictability.** Nobody holding the full public price history may infer future random state.                          | INV-010, §23, §25 |
| R3  | **Isolation.** Assets must not share a random stream; production must not share one with test, simulation or staging.             | INV-007, §23      |
| R4  | **Restart safety.** After a crash the market must continue without repeating a previously generated sequence and without jumping. | INV-008, §22      |

A conventional seeded PRNG — Mersenne Twister, xoshiro, PCG — gives R1 and can be
made to give R3, but fails R2 outright: their internal state is recoverable from
a modest run of output, and once recovered the entire future is known. For a
product where the output _is_ the thing people bet against, that is not a
theoretical weakness.

A cryptographic RNG (`crypto.randomBytes`) gives R2 and fails R1 completely:
there is no seed and no way to replay.

R4 is a separate problem that neither addresses, and it is the one most likely to
be discovered in production rather than in review.

## Decision

### 1. A keyed, counter-based stream cipher as the random source

```
streamKey = HKDF-SHA256(
    ikm  = masterSecret,
    salt = "otc-engine/entropy/v1",
    info = canonicalLabel({env, asset, purpose, keyEpoch}),
    len  = 32)

bytes(i)  = ChaCha20-keystream(streamKey, blockIndex = i)
```

This resolves the apparent contradiction between R1 and R2. Output is a _pure
function_ of `(key, index)`, so replay is exact — and, because the function is
indexed rather than sequential, replay is also random-access: any point in
history can be regenerated without recomputing everything before it. At the same
time, predicting future keystream from observed output without the key is the
ChaCha20 distinguishing problem. Reproducibility and unpredictability are not in
tension; they are separated by possession of the key.

R3 follows from key derivation: distinct labels produce independent keys, so
assets, purposes and environments are cryptographically separated rather than
merely conventionally separated. Because `env` is part of the derivation input, a
simulation cannot reproduce a production stream even with identical asset and
purpose — and a test keyring, whose secret comes from a public constant, refuses
to derive a `production` label at all.

R1 also constrains _state size_: a stream's entire position is a 64-bit counter,
so a market snapshot carries a number rather than a serialised generator.

### 2. ChaCha20 implemented in-repo

`node:crypto` exposes ChaCha20 only as a cipher over a stream. The engine needs
an indexed block function, so the block function is implemented in TypeScript
using only integer operations that ECMAScript specifies exactly. It is verified
two ways: against RFC 8439 known-answer vectors, and differentially against
OpenSSL's implementation over 400 pseudo-random `(key, nonce, counter)` triples
plus the counter boundaries `0, 1, 2^31, 2^32-1`.

Measured throughput is **26M `nextFloat64()` per second** on the development
machine. At a realistic 10 ticks/second and ~10 draws/tick, one asset consumes
about 100 draws/second, so the cipher is roughly five orders of magnitude away
from being a constraint. The reduced-round variant that was held in reserve is
not needed.

`node:crypto` is still used for HKDF, which is a standard, deterministic,
platform-independent construction.

### 3. Block addressing widened to 64 bits

RFC 8439 ChaCha20 has a 32-bit block counter, giving 256 GiB per key. A 64-bit
`blockIndex` is addressed instead: the low 32 bits go in the counter and the
high 32 bits occupy the last nonce word, with the rest of the nonce fixed at
zero. The key is unique per label, so the nonce carries no entropy and exists
only to widen the address space — to 2^70 bytes per stream.

### 4. Reserve-ahead cursor leasing for restart safety

A crash between emitting a tick and persisting the cursor would, on restart,
redraw values already used and replay a price sequence observers have already
seen. §22 forbids exactly that, and it is not hypothetical: any crash, eviction
or power loss produces it.

Cursor positions are therefore **leased**: the high-water mark is persisted
_before_ the blocks behind it are consumed, and on restart the engine resumes at
the persisted mark, discarding the unused remainder. Discarding is free — the
keystream is i.i.d., so a gap is statistically invisible — and it converts an
unbounded correctness hazard into a bounded, recorded gap.

The gap is _recorded_ rather than merely tolerated, because exact replay of a
history spanning a restart needs to know where the cursor jumped. A replayable
history is therefore `snapshot + ordered cursor-advance records`, which is also
the artefact INV-009 requires for dispute resolution.

The lease is a pure state machine; persistence belongs to the runtime, because
the kernel has no I/O. Its correctness is established by a test that crashes at
every point in the consume/persist cycle across repeated restarts and asserts
that no block index is ever consumed twice.

### 5. Secrets are private at runtime, not merely at compile time

Key material is held in ECMAScript `#private` fields with redacting `toJSON`,
`toString` and inspect hooks.

This was not the original implementation, and the change was forced by a test.
TypeScript's `private` modifier is erased at compile time, so the first version
leaked the entire master secret through `JSON.stringify`. That is a realistic
path: a logger that serialises its arguments, an error reporter, a structured
clone, or a snapshot written carelessly. Possession of the key makes the whole
future of every derived stream computable, so this was a direct INV-010 defect
in code that looked correct.

## Consequences

**Positive**

- Replay is exact, random-access, and cheap in state.
- Public unpredictability rests on a standard primitive rather than on obscurity.
- Isolation is cryptographic, and environment separation is structural.
- Restart repetition is impossible by construction, not by convention.
- The audit artefact required by INV-009 falls out of the design.

**Negative / accepted costs**

- The master secret becomes operationally critical: losing it makes history
  unreplayable, and disclosing it makes the market predictable. Key custody,
  rotation via `keyEpoch`, and backup are real operational requirements that the
  runtime phase must address.
- A restart discards up to one lease of indices. Bounded, recorded, and tunable.
- An in-repo cipher is code the project owns and must keep correct; the RFC
  vectors and the differential test against OpenSSL are the mitigation.

## Alternatives considered

| Alternative                                               | Why not                                                                                                                                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seeded non-cryptographic PRNG (xoshiro, PCG, Mersenne)    | State is recoverable from public output; fails R2, which is the point of the product.                                                                                             |
| `crypto.randomBytes`                                      | No seed, no replay; fails R1 outright.                                                                                                                                            |
| Cryptographic PRNG with a persisted state blob            | Replay works but is strictly sequential, snapshots grow, and the blob is itself a secret that must never leak. Counter addressing is smaller and safer.                           |
| AES-CTR via `node:crypto`                                 | Comparable security and hardware-accelerated, but the Node API does not expose an indexed block function, and a JS fallback for AES is slower and more error-prone than ChaCha20. |
| Persisting the cursor after every draw instead of leasing | One durable write per tick per asset; the write amplification is prohibitive and it still leaves a window between the draw and the write.                                         |

## Follow-up

- PH-1.2 adds portable `exp`/`ln` and the distribution samplers built on this
  layer. `Math.log`/`Math.exp` are non-portable and are already banned in
  generation code by both lint and the guardrail suite.
- The runtime phase must define master-secret custody, rotation and backup, and
  the durable store behind the cursor lease.
