# PH-1.1 — Canonical time model and deterministic entropy architecture

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-1.1
Parent phase: PH-1 — Deterministic Market Kernel
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Deliver the two lowest layers of the kernel:

1. a **canonical time model** — integer instants, injected clocks, and
   epoch-aligned timeframes whose durations form a strict divisibility chain;
2. a **deterministic entropy architecture** — a keyed, seekable, counter-based
   random stream that is exactly replayable, cryptographically unpredictable from
   public output, isolated per asset/purpose/environment, and safe across
   process restarts.

## 2. Scope

`packages/core/src/time/` and `packages/core/src/entropy/`, plus their tests.

### In scope

- Branded instant and duration types with integer-millisecond semantics.
- `Clock` abstraction and the system, fixed and steppable implementations.
- `Timeframe` catalogue, bucket alignment, and the divisibility-chain invariant.
- RFC 8439 ChaCha20 block function in portable TypeScript.
- HKDF-SHA256 stream-key derivation from a master secret.
- Canonical, validated stream labels carrying environment, asset, purpose and key
  epoch.
- `RandomStream`: buffered keystream with uniform primitives, seek and cursor
  snapshot.
- `CursorLease`: the pure state machine that makes restarts non-repeating.
- Test keyring that structurally cannot produce a production stream.

### Out of scope

- Distribution samplers beyond uniform integers, bytes and `float64` — Gaussian,
  exponential and heavy-tailed sampling need portable `exp`/`ln`, which is PH-1.2.
- Persistence of leases (the lease is a pure state machine here; storage arrives
  with the runtime).
- Market domain primitives and aggregation (PH-1.3).
- Anything trading-related.

## 3. Relevant architecture

`@otc/core` has no runtime dependencies. Node's `node:crypto` is used **only**
for HKDF, which is a standard, deterministic, platform-independent construction.
ChaCha20 is implemented in-repo rather than taken from `node:crypto` so that the
block function is byte-exact, seekable at an arbitrary index, and verifiable
against published test vectors — none of which the Node cipher API exposes
directly.

## 4. Contracts

### 4.1 Time

```ts
type EpochMillis = number & { readonly __brand: 'EpochMillis' };
type DurationMillis = number & { readonly __brand: 'DurationMillis' };

interface Clock {
  now(): EpochMillis;
}
```

- `SystemClock` — the only place in `@otc/core` permitted to read ambient time.
- `FixedClock(instant)` — constant.
- `SteppableClock(start)` — `advance(by)`, for deterministic tests.

```ts
type TimeframeId = '1s' | '5s' | '15s' | '30s' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

interface Timeframe {
  readonly id: TimeframeId;
  readonly durationMs: DurationMillis;
}

function bucketStart(t: EpochMillis, tf: Timeframe): EpochMillis; // t - (t mod duration)
function bucketEnd(t: EpochMillis, tf: Timeframe): EpochMillis; // exclusive
function isCoarserOrEqual(a: Timeframe, b: Timeframe): boolean;
```

**Divisibility chain.** Durations are
`1s | 5s | 15s | 30s | 1m | 5m | 15m | 30m | 1h | 4h | 1d`, each dividing the
next: 5, 3, 2, 2, 5, 3, 2, 2, 4, 6. Because every duration divides every coarser
duration and all buckets are aligned to the Unix epoch, a coarse bucket is
exactly the union of the fine buckets inside it. This is the structural
precondition for INV-004 and is asserted as a test over all ordered pairs.

Weekly and monthly timeframes are deliberately excluded: their lengths do not
divide evenly, so they would break exact nesting and reintroduce calendar logic
into a market that is continuous by definition (§22).

### 4.2 Entropy

```ts
type Environment = 'production' | 'staging' | 'simulation' | 'test';

interface StreamLabel {
  readonly env: Environment;
  readonly asset: string; // ^[a-z0-9][a-z0-9._-]{0,63}$
  readonly purpose: string; // ^[a-z0-9][a-z0-9._-]{0,63}$
  readonly keyEpoch: number; // non-negative safe integer
}

function canonicalLabel(l: StreamLabel): string;
// "otc1|env=<env>|asset=<asset>|purpose=<purpose>|epoch=<n>"
```

Components are validated against the pattern above, which excludes `|` and `=`,
so distinct labels can never canonicalise to the same string. An invalid
component is a programming error and throws `InvalidStreamLabelError`.

```ts
interface StreamCursor {
  readonly blockIndex: bigint; // 0 .. 2^64-1, 64-byte ChaCha20 blocks
  readonly byteOffset: number; // 0..63
}

interface RandomStream {
  nextUint32(): number;
  nextUint64(): bigint;
  nextFloat64(): number; // [0, 1), 53 significant bits
  nextBoundedUint32(bound: number): number; // [0, bound), unbiased
  nextBytes(n: number): Uint8Array;
  position(): StreamCursor;
  seek(cursor: StreamCursor): void;
  readonly label: string;
}

class MasterKeyring {
  static fromSecret(keyId: string, secret: Uint8Array): MasterKeyring; // >= 32 bytes
  static forTesting(tag: string): MasterKeyring; // env='production' forbidden
  derive(label: StreamLabel): RandomStream;
}
```

**Key derivation**

```
streamKey = HKDF-SHA256(
    ikm  = masterSecret,
    salt = utf8("otc-engine/entropy/v1"),
    info = utf8(canonicalLabel(label)),
    len  = 32)
```

**Block addressing.** ChaCha20 (RFC 8439) takes a 32-bit block counter and a
96-bit nonce. A 64-bit `blockIndex` is addressed as: counter = low 32 bits;
nonce = 12 bytes, zero except bytes 8..11 holding the high 32 bits
little-endian. The key is unique per label, so nonce reuse across labels is not a
concern; within a label every `blockIndex` maps to a distinct (counter, nonce)
pair. Capacity per stream is 2^64 blocks = 2^70 bytes.

**Uniform primitives.** `nextFloat64` consumes 8 bytes and forms
`(hi >>> 5) * 2^26 + (lo >>> 6)` over `2^53`, giving a uniform value on `[0, 1)`
with 53 significant bits using only exact integer and IEEE-754 operations.
`nextBoundedUint32` uses rejection sampling — deterministic and unbiased,
consuming a variable number of draws, which is fine because the cursor records
the exact position reached.

### 4.3 Cursor lease

```ts
interface LeaseState {
  readonly consumedTo: bigint; // next unconsumed block index
  readonly reservedTo: bigint; // durably persisted high-water mark
}

class CursorLease {
  static resume(persistedHighWater: bigint | null, leaseBlocks: bigint): CursorLease;
  startBlock(): bigint;
  note(consumedTo: bigint): { persist: bigint } | null;
  state(): LeaseState;
}
```

Rules:

1. On resume, generation starts at the persisted high-water mark, never below it.
2. `note()` returns a new high-water mark to persist whenever consumption
   approaches the reservation; the caller must persist it **before** consuming
   past `reservedTo`.
3. `reservedTo` is monotonically non-decreasing for the lifetime of a stream.

The consequence is the property §22 demands: after any crash, at any point, no
block index is ever consumed twice. The cost is a bounded gap of discarded
indices, which is harmless because the stream is i.i.d. — and recorded, because
exact replay of a history that spans a restart needs the jump.

## 5. Failure behaviour

| Condition                                                   | Behaviour                              |
| ----------------------------------------------------------- | -------------------------------------- |
| master secret shorter than 32 bytes                         | `TypeError` at construction            |
| `MasterKeyring.forTesting` used with `env: 'production'`    | `ProductionStreamFromTestKeyringError` |
| invalid label component                                     | `InvalidStreamLabelError`              |
| `blockIndex` outside `[0, 2^64)`                            | `RangeError` on `seek`                 |
| `nextBoundedUint32(bound)` with `bound <= 0` or non-integer | `RangeError`                           |
| `nextBytes(n)` with negative or non-integer `n`             | `RangeError`                           |

Errors are thrown, not returned: every one of these is a programming defect, and
a market engine that silently continues with a degraded random source is worse
than one that stops.

## 6. Observability

`RandomStream` exposes `position()`, which is the only state that matters and is
sufficient for snapshot, audit and replay. A `blocksGenerated` counter is exposed
for benchmarking. The kernel does no logging — it has no logger dependency and
must stay pure.

## 7. Acceptance criteria

| #   | Criterion                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | ChaCha20 block function reproduces every RFC 8439 §2.3.2 and §2.4.2 test vector byte-for-byte                                                       |
| A2  | A stream re-derived from the same keyring and label produces an identical byte sequence                                                             |
| A3  | `seek(position())` round-trips: draws after restore are identical to draws without interruption                                                     |
| A4  | Seeking to an arbitrary index yields the same bytes as consuming sequentially to that index                                                         |
| A5  | Streams differing in exactly one label component (env, asset, purpose, keyEpoch) share no output and show no cross-correlation                      |
| A6  | A test keyring cannot derive a `production` stream                                                                                                  |
| A7  | `nextFloat64` output lies in `[0, 1)` and passes uniformity and bit-independence checks over a large sample                                         |
| A8  | `nextBoundedUint32` is unbiased for bounds that are not powers of two                                                                               |
| A9  | `CursorLease` never returns a start block below the persisted high-water mark, across simulated crashes at every point in the consume/persist cycle |
| A10 | `bucketStart` is idempotent, and for every ordered timeframe pair `bucketStart(bucketStart(t, fine), coarse) === bucketStart(t, coarse)`            |
| A11 | Every timeframe duration divides every coarser timeframe duration                                                                                   |
| A12 | `SystemClock` is the only module in `@otc/core` that reads ambient time                                                                             |
| A13 | Keystream throughput is measured and recorded                                                                                                       |

## 8. Verification requirements

Targeted gate for this subphase (`GOVERNANCE.md` §21):

- unit suite for `time` and `entropy`;
- RFC 8439 known-answer vectors;
- property tests for bucket alignment across all timeframe pairs;
- a seeded statistical suite (`*.stat.test.ts`) covering uniformity,
  bit-independence, bounded-sampling bias, and cross-stream independence;
- an exhaustive crash-point test for `CursorLease`;
- `npm run build`, `npm run lint`, `npm run format:check`;
- a recorded throughput measurement.

The statistical suite must be deterministically seeded: a randomly-failing
entropy test cannot be distinguished from a real entropy defect.

## 9. Dependencies

None. This is the root of the implementation graph.

## 10. Expected result

`@otc/core` exports a time model and an entropy architecture that PH-1.2 can
build portable distribution samplers on, and that PH-1.3 can build snapshot and
replay on, with reproducibility already guaranteed and tested.

---

## 11. Approval record

Status: **APPROVED** — 2026-08-31, from executed evidence.

### Acceptance criteria

| #   | Criterion                               | Evidence                                                                                      |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| A1  | RFC 8439 vectors                        | `chacha20.test.ts` — §2.3.2, §2.4.2 and both all-zero vectors reproduce byte-for-byte         |
| A2  | Re-derivation is identical              | `stream.test.ts` "produces an identical sequence when re-derived"                             |
| A3  | `seek(position())` round-trips          | `stream.test.ts` "is a pure function of position"                                             |
| A4  | Seek equals sequential consumption      | `stream.test.ts` "seeking to an index matches consuming sequentially to it"                   |
| A5  | Label components isolate streams        | `keyring.test.ts` isolation suite; `entropy.stat.test.ts` correlation and collision tests     |
| A6  | Test keyring cannot reach production    | `keyring.test.ts` production-safety suite                                                     |
| A7  | `nextFloat64` uniform and well-behaved  | `entropy.stat.test.ts` — 1024-bin chi-square, serial correlation to lag 64, 53-bit resolution |
| A8  | `nextBoundedUint32` unbiased            | `entropy.stat.test.ts` — bounds 3, 7, 10, 100, 1000, 3e9                                      |
| A9  | No cursor consumed twice across crashes | `lease.test.ts` — crash at every step of the consume/persist cycle, four lease sizes          |
| A10 | Bucket alignment nests exactly          | `timeframe.test.ts` — all ordered pairs across 410 instants                                   |
| A11 | Divisibility chain holds                | `timeframe.test.ts` — all ordered pairs                                                       |
| A12 | Ambient time confined to `SystemClock`  | `guardrails.test.ts` — asserts the reader set equals the allowlist                            |
| A13 | Throughput measured                     | 26M `nextFloat64`/s locally; 14M/s under the instrumented statistical run                     |

### Beyond the stated criteria

Two additions were made during implementation because the work revealed the need:

- **Secret containment.** A test showed TypeScript's `private` left the master
  secret reachable through `JSON.stringify`. Key material moved to ECMAScript
  `#private` fields with redacting serialisation hooks. This was a genuine
  INV-010 defect in code that read as correct; see ADR-0002 §5.
- **Guardrails.** Ambient time, ambient randomness, non-portable maths, economic
  vocabulary and dependency direction are now build failures under both ESLint
  and a test suite, verified by planting a deliberate violation and observing
  five distinct failures.

### Verification executed

| Check                            | Result                              |
| -------------------------------- | ----------------------------------- |
| `npm run format:check`           | PASSED                              |
| `npm run lint`                   | PASSED                              |
| `npm run build` (full typecheck) | PASSED                              |
| `npx vitest run`                 | PASSED — 138 tests, 10 files        |
| Hosted CI                        | NOT EXECUTED — no remote configured |

### Deferred to PH-1.2

Distribution samplers beyond uniform, which require portable `exp`/`ln`.
