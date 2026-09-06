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

**And a proof is served, not only written** (PH-29.1). `GET
/markets/:id/proof/:sequence` finds the window by streaming the commitments
file (`proveFromPublication`), reads its journal back with the same rules the
lab's reader applies, and answers with the signed commitment, the Merkle path
and the publisher's key; the open window is a `409` naming how far the chain
reaches. The archived tick is compared with the tick record on the way out. A
counterparty verifies with nothing but the response and the key it was told
out of band (`CATALOGUE_AND_PANEL.md` §5.3).

## Restarts, seams, and the interval a verifier sees

One chain per market is the aim, and the record (PH-28) makes it the common
case: a writer resumes at the tip of `commitments.ndjson`, the venue reads back
from the record the ticks published after that tip, folds them, and the chain a
broker verifies runs across the process boundary as if there had been none
(PH-28.3).

Two things interrupt the coverage, and neither is bridged:

- the record cannot reach the tip (a trim, a lost `record.db`), so the ticks
  between the tip and the first live one are unknown (PH-28.3);
- a **seam**: the market was resumed past its 15 s catch-up bound — every
  deploy-length restart — and its sequences jump by the lease (PH-30.4).

A bridged window — one whose `previousRoot` binds a tip its ticks do not follow
— would verify structurally and be a lie about continuity. What replaces it is
**seal, then resume**:

1. **Seal.** The open window is closed where the chain stops growing, however
   short: at a clean stop, at a retirement, and at the moment a seam is found.
   The chain then ends exactly where the record does.
2. **Resume.** The next window is a **resume link**: `previousRoot` binds the
   sealed head, `resumesAfter` states the sequence that head ended at, and
   `fromSequence` is beyond it. The hash chain is unbroken for the life of the
   market; what is discontinuous — and signed — is the coverage.

`verifyCommitmentsFile` and `IncrementalChainVerifier` report every interval in
`breaks` as `{ link, afterSequence, afterRoot, fromSequence, bound }`. `ok`
means every link verifies and the chain is sound, not that the coverage has no
holes; a reader that needs continuity checks `breaks` is empty. `summarise` and
`buildAnchor` carry the same list into an anchor, so a reader who pins an
anchor pins its holes, and `verifyAnchor` refuses an anchor that understates
them.

**`bound` is the whole point.** A bound break is evidence: the resume link's
root binds the sealed head and the declaration is inside that root, so deleting
a window from before the interval breaks the chain _where the cut is_, and
re-signing the resume to match the new tail changes its root and every root
after it. An **unbound** break — a second genesis link, bound to what precedes
it by nothing — is only a statement that this file commits nothing between two
sequences. Two shapes produce one:

- files written before Cycle Audit 10, which is every file the release run
  produced (thirty of thirty held two chains); they are read and reported, not
  refused;
- a market that resumes at a sequence the chain **already covers** — PH-28.3's
  lost-record case, where a checkpoint lies behind the chain's tip. One chain
  cannot hold two roots over one range, so the publisher restarts at an empty
  root rather than sign a declaration that is false about its predecessor.

**What is still lost, and it is bounded.** A `SIGKILL` is not asked to stop, so
it seals nothing: the ticks since its last window stay published and
uncommitted. The next process folds them back out of the record and commits
them — that is what PH-28.3's resume is for — and only where the record cannot
reach them (a trim, a seam at the same moment) are they permanently
uncommitted. `GET /markets/:id/proof/:sequence` distinguishes the three cases
in words: _not yet committed_ names how far the chain reaches, _in an interval
this venue committed nothing in_ names both its edges, and the bare refusal is
what is neither.

**A file cut mid-append is refused by name.** The chain is the one durable file
here that is never fsynced — a window is a single `appendFileSync` — so ENOSPC,
a power loss or an interrupted copy can leave a partial last line. Every window
is appended as one line ending in a newline, so a file that does not end in one
was cut: `chainTipOf` refuses at boot naming the asset, the file, the bytes
lost and the byte to truncate to, and repairs nothing itself; the streaming and
batch readers raise `CommitmentsFileError` naming the line, so
`verifyCommitmentsFile` returns the `{ok:false, error:{line, detail}}` its
verdict type promises instead of throwing, and `/proof` answers a named `503`
past the damage while proofs of earlier sequences are unaffected.

### What Cycle Audit 10 measured here

PH-30.4 restarted the chain at an empty root instead of sealing and resuming,
and both halves of that cost the record something permanent. The window open
when a process stopped went with it: **5,749 served ticks across the release
run's thirty markets**, in no committed window for ever, with `/proof`
answering `409` for them indefinitely (a6-03). And the two chains were bound to
each other by nothing, so a window deleted from the earlier chain's tail read
exactly like the honest gap — to the file verifier, the proof route, a rotation
and the anchor alike (a6-04) — while `buildAnchor` could not summarise a
two-chain file at all, which after one deploy was every file (a6-12). The three
bare `JSON.parse` calls on this file took the boot of all thirty markets down
with a `SyntaxError` naming no file and no asset (a2-04, a3-08, a8-06). Before
PH-30.4 the verifier refused the second genesis outright, so the restart
PH-28.3 promised produced a file the project's own verifier called invalid —
the test that established the restart read the links and never verified the
file.

## Where it lives, and why

`@otc/distribution`, not `@otc/lab` where the journal format is defined.
`@otc/api` cannot depend on `@otc/lab` — the allowlist forbids it, correctly,
since lab carries the planted-defect fixture corpus and a running venue has no
business with it.

The record-writing sits in `@otc/distribution` rather than in the NestJS service
for a reason worth keeping: `tools/sim` can then verify the emitted artefacts
with `@otc/lab`'s **real** journal reader. A writer living in the app could only
ever be checked against a reimplementation of that reader, which checks nothing.
