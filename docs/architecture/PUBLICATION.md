# Architecture — Verifiable publication

Type: SUPPORTING DOCUMENTATION (living)
Describes: how the published record is made provable
Decisions: [ADR-0002](../decisions/ADR-0002-deterministic-entropy-architecture.md),
[ADR-0004](../decisions/ADR-0004-canonical-price-representation.md)

---

## What it is for

PH-9.3 gave a counterparty everything needed to **recompute** a verdict from a
published journal, and named what it had not built: the journal's fingerprint
proves agreement, not authenticity. Nothing stopped an operator publishing a
different journal, and nothing let a trader show that the record used to settle
their contract was the record that existed when they opened it.

PH-12 closes that. The operator publishes a **signed Merkle commitment chain**
over the record, and a counterparty holding one tick, one proof and a public key
can establish that the tick was in the operator's committed history — without the
operator's cooperation at verification time, without any private key, and without
the whole journal.

## What it does not prove

**Nothing about whether the market was generated fairly.** A commitment over a
rigged market is a perfectly valid commitment.

Fairness rests on ADR-0003's theorem, the mirror test and the attack battery, all
of which the counterparty re-runs themselves. Integrity of the record and
fairness of the process are separate guarantees that support each other, and the
cryptography must never be allowed to imply the statistics.

## The construction

```
leaf = SHA256( 0x00 || u64 sequence || u64 instant || i64 price )
node = SHA256( 0x01 || left(32) || right(32) )
root = SHA256( 0x02 || framed(assetId) || u64 from || u64 to || u64 count
                    || framed(previousRoot) || merkle )
```

`framed(x)` is a 32-bit big-endian length followed by the bytes.

Every element closes a specific, named attack:

| Element                                                      | Closes                                               |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| Distinct leaf / node / root tags                             | Second preimage — an internal node offered as a leaf |
| Odd nodes promoted, not duplicated, with `count` in the root | CVE-2012-2459                                        |
| Length prefixes on every variable field                      | Preimage re-partitioning (Cycle Audit 4, F-1)        |
| Asset, range, count, predecessor in the root                 | Cross-market and cross-range replay                  |

### Length prefixes are not decoration

Cycle Audit 4 found the first version separating `assetId` from the fields after
it with a single `0x00` byte. The 25 bytes of `0x00 || from || to || count` could
sit on **either side** of that boundary, so two different
`(assetId, previousRoot)` tuples produced **the same root** — and both were
accepted by this project's own verifiers.

The signing encoding had the same shape: fields joined with `\n`, over two free
strings. One Ed25519 signature verified against two different commitments.

A delimiter marks a boundary only if the field cannot contain the delimiter. A
length prefix marks it unconditionally. Both preimages are length-prefixed now,
and `assetId` is additionally constrained to `/^[a-z0-9][a-z0-9._-]{0,63}$/` —
the shape `fileStore.ts` already required, which also stops an id escaping the
publication directory as a path component.

## Two keys, and why they can never be one

`OTC_MASTER_SECRET` derives every stream in the market through HKDF (ADR-0002).
`OTC_PUBLISHING_KEY` is an independent Ed25519 seed.

The convenient design is one secret: fewer things to deploy, one thing to rotate.
It would break **INV-010**. A signing key lives in every publishing process, is
handled by operators, and appears in deployment configuration. If it also derived
the market, anyone obtaining it would obtain the keystream — and a keystream
snapshot is a **forward** leak worth hours of future prices, not a historical
one.

The separation is enforced three ways, because stating it is worth nothing:

- `publishingKey.test.ts` fails if anything on the signing path — including the
  composition root in `apps/api` — references the keyring, HKDF or ChaCha.
- `publishingKeyFromEnvironment` refuses a publishing key **equal to** the
  generation secret, and the guard asserts that refusal still exists in code
  rather than in a comment about it.
- Different algorithms and different shapes: an Ed25519 seed is not ChaCha20 key
  material, so the two are not interchangeable by accident.

## What the venue emits

Publication is opt-in: off unless `OTC_PUBLICATION_DIR` is set, and when it is
set `OTC_PUBLISHING_KEY` becomes required. A venue that published under an
ephemeral identity would produce signatures nobody could check.

Per asset, per commitment window:

```
<dir>/publisher.json                     the public key to verify against
<dir>/<assetId>/<from>-<to>.journal      the ticks, in @otc/lab's journal format
<dir>/<assetId>/commitments.ndjson       one signed commitment per line
```

**One journal file per window**, because the journal header carries its tick
count and cannot be appended to without rewriting that header — and a record
whose header is rewritten as it grows is one an operator can quietly reshape. A
window is complete when it is committed, so the archival unit and the
verification unit are the same thing.

Ticks in the open window are **published but not archived**. That is a real third
state, the chain reports it, and the feed still delivers them live.

## Where it lives, and why

`@otc/distribution`, not `@otc/lab` where the journal format is defined.
`@otc/api` cannot depend on `@otc/lab` — the allowlist forbids it, correctly,
since lab carries the planted-defect fixture corpus and a running venue has no
business with it.

The record-writing sits in `@otc/distribution` rather than in the NestJS service
for a reason worth keeping: `tools/sim` can then verify the emitted artefacts
with `@otc/lab`'s **real** journal reader. A writer living in the app could only
ever be checked against a reimplementation of that reader, which checks nothing.
