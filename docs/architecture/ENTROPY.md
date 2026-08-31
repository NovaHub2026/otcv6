# Architecture — Entropy

Type: SUPPORTING DOCUMENTATION (living)
Describes: what exists in `packages/core/src/entropy/` today
Decision record: [ADR-0002](../decisions/ADR-0002-deterministic-entropy-architecture.md)

---

## Shape

```
MasterKeyring(keyId, secret)          secret held in a #private field
        │
        │  HKDF-SHA256(secret, salt="otc-engine/entropy/v1", info=canonicalLabel)
        ▼
   streamKey (32 bytes)               one per {env, asset, purpose, keyEpoch}
        │
        ▼
   RandomStream                       ChaCha20 keystream, addressed by 64-bit block index
        │
        ├── nextUint32 / nextUint64 / nextFloat64 / nextBoundedUint32 / nextBytes
        ├── position() -> StreamCursor {blockIndex, byteOffset}
        └── seek(cursor)

   CursorLease                        pure state machine; makes restarts non-repeating
```

## Stream labels

A stream is named by four components, canonicalised to a single byte string that
is fed to key derivation:

```
otc1|env=<production|staging|simulation|test>|asset=<id>|purpose=<id>|epoch=<n>
```

Components must match `^[a-z0-9][a-z0-9._-]{0,63}$`, which excludes the `|` and
`=` separators. That exclusion is what guarantees two distinct labels can never
canonicalise to the same string, and therefore can never accidentally share a
key.

The label format is a **durable wire contract**. Changing it re-keys every stream
that has ever existed and invalidates replay of all recorded history, so a change
requires a new version prefix and a documented migration, never an edit.

`purpose` is how the market model gets independent randomness for independent
mechanisms — `magnitude`, `sign`, `arrival`, `regime` and so on are separate
streams, not separate draws from one stream. This matters for PH-2: a mechanism
whose draws are interleaved with another's cannot be changed without altering
every subsequent value in both.

## Properties and how they are established

| Property                            | Established by                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact replay from `(label, cursor)` | RFC 8439 vectors; re-derivation tests; `seek(position())` round-trip; far-index random access                                                     |
| Byte-exactness across platforms     | Integer-only implementation; differential test against OpenSSL on 400 triples and the counter boundaries                                          |
| Public unpredictability             | ChaCha20 keyed by a secret the public never sees; statistical suite covering uniformity, bit balance, pairwise bit independence, monobit and runs |
| Per-asset and per-purpose isolation | Distinct HKDF keys per label; correlation and collision tests between streams differing in one component                                          |
| Environment isolation               | `env` is a derivation input; a test keyring refuses to derive a `production` stream                                                               |
| Restart never repeats               | `CursorLease`, verified by crashing at every point in the consume/persist cycle                                                                   |
| Secrets do not leak                 | `#private` fields with redacting `toJSON`/`toString`/inspect; asserted against the raw key material                                               |

## Capacity and cost

- 2^64 blocks × 64 bytes = **2^70 bytes per stream**.
- Measured **26M `nextFloat64()`/second**; one asset at 10 ticks/s and ~10
  draws/tick needs about 100/second.

## Operational requirements this creates

These belong to the runtime phase and are recorded here so they are not lost:

1. **Master-secret custody.** Losing it makes history unreplayable; disclosing it
   makes the market predictable. It needs secure storage, backup, and an access
   path that never reaches a log.
2. **Rotation.** `keyEpoch` exists for deliberate re-keying. Rotating an asset's
   epoch starts a fresh stream while leaving prior history replayable under the
   previous epoch.
3. **Durable lease storage.** The high-water mark must be persisted before the
   blocks behind it are consumed. Lease size trades durable-write frequency
   against the size of the gap discarded per restart.
4. **Cursor-advance records.** Restarts move the cursor discontinuously; those
   jumps must be recorded, because replay of a history spanning a restart needs
   them.
