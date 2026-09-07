# PH-29 — The Integration Boundary: What A Broker's Settlement Needs

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-29
Status: APPROVED
Approved: 2026-09-06 — from the integrated phase verification in §9
Cycle: 10 (phase 2 of 3) — the closing cycle
Created: 2026-09-06
Branch: `feature/ph-29-integration-boundary`

---

## 1. What is actually unknown

Whether a broker can settle a binary option against this venue **without a
copy of the stream and without trusting the venue's word**. Today the venue
publishes prices and the integration guide's §5 tells the broker to keep its
own copy of the stream and re-derive entry and expiry prices from it; the
settlement rule — the last tick at or before an instant — lives in
`packages/trading`'s `settle()`, a library nothing on the venue exposes; and the
commitment chain that makes a price provable (INV-009) is written to a
directory on the venue's disk and served over nothing. A dispute between a
broker and its customer is therefore settled by whose copy was better, which
is the opposite of what a signed record is for.

Three more things are unknown for the same reason, that nobody outside this
repository has coded against the venue: whether the API is a contract (it is a
set of routes with tests), whether a broker can check its own deployment
conforms (the guide's checklist is prose), and what a client that resumes,
reads history, asks for a price and verifies a proof looks like when it is
written once, correctly (`packages/lab`'s observer is the closest thing and it
is an instrument, not a client).

## 2. Why this phase, and why now

Because PH-28 made the record durable and PH-29's query reads that record;
because the product is the engine and the broker is somebody else's
(`ROADMAP.md`, the Cycle 10 plan and its clarification); and because PH-30 is
the release, and a release without a contract is a snapshot.

## 3. What this phase may not do

- **It may not build the broker.** No accounts, positions, payout, money or
  risk on the venue; `packages/trading` stays a reference a broker may embed.
- **It may not put settlement on the price path.** A query reads the published
  record; nothing it does reaches an engine (INV-001), and the architecture
  tests say so.
- **It may not answer a price the record does not hold.** A query for an
  instant before the record's oldest tick, or for a sequence not yet published,
  is a refusal by name, never an interpolation.
- **It may not serve private state** — a proof carries a window's ticks and a
  Merkle path, never a cursor (INV-010).

## 4. Phase invariants

INV-009 is what is delivered — a broker can reproduce and prove a settlement
price from the venue's own signed record; INV-001, INV-002, INV-005 and INV-010
are what the delivery must not violate.

## 5. Subphases

| Subphase | Title                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| PH-29.1  | The settlement query: price at a sequence and at an instant, with its inclusion proof  |
| PH-29.2  | The API contract frozen: versioned, schema-described, breaking changes guarded         |
| PH-29.3  | The conformance suite: the integration checklist made executable against a live venue  |
| PH-29.4  | The reference client and settlement library: exercised by the release, #11 decided     |
| PH-29.5  | The standing verdict's figure decided (#10); the guide's §5 rewritten around the query |

## 6. The design, in one paragraph

Two read routes and one proof route on the venue, all from the tick record and
the publication directory, none from an engine: `GET /markets/:id/ticks/:sequence`
(the tick, or a refusal naming the record's bounds), `GET /markets/:id/price?at=`
(the last tick at or before the instant — the rule `settle()` uses and the
charts use — with the sequence it came from, or a refusal), and
`GET /markets/:id/proof/:sequence` (the signed commitment of the window holding
that sequence, the window's ticks, and the Merkle path, or `not yet committed`
while the window is open). The contract is a document and a machine-readable
schema the venue serves at `/contract`, with a version in `/health`, and a
guard that fails when a route or a response key changes without the version.
The conformance suite is `npm run conformance -- --base URL [--key HEX]`: every
route, the stream's resume and gap semantics, the price rule against the
stream, a proof verified against the publisher's key, one report and an exit
code.

> **Corrected 2026-09-06 (Cycle Audit 10, a4-03).** "Verified against the
> publisher's key" was, until this audit, verified against the key the venue
> sent in the same response — which any venue chooses freely, so it verified
> nothing about who published. `--key` is that key, told out of band; without
> it the suite still runs the check and names it _not independent_. The
> reference client is what the suite is written with. `packages/trading` takes
> money as integers in a named minor unit with an exact payout rational (#11).

## 7. What the phase leaves open, deliberately

Key rotation over HTTP, a proof for a range of sequences rather than one, and
anything the broker's side needs beyond a price and its proof.

## 8. What the phase found

1. **The production-responses guard was skipping routes that refused**
   (PH-29.1): its venue kept no record and published nothing, so a new route
   that threw was "not JSON or refused" and unseen. It answers now.
2. **The archetype's excess kurtosis is a band**, and the first draft of the
   contract said `number` (PH-29.2): the contract guard found it before a
   reader did.
3. **A publishing asset with no closed window answered `404 does not
publish`** where the contract says `409 not yet committed` (PH-29.3); the
   spawned-venue conformance run found it, and passed anyway because both are
   listed refusals — which is why the report carries the detail column.
4. **The floating-point settlement returned a fraction of a minor unit for
   95 000 of 100 000 cent stakes** (PH-29.4, Issue #11), a number no ledger
   can hold; money is an integer now and the fields kept their names.
5. **A live subscription cannot be built on a collecting read** (PH-29.4);
   the SSE reader became a generator.
6. **The sufficiency grading needed a guard that separates the two floors**
   (PH-29.5, Issue #10).
7. **The phase gate's first run failed the meta-audit**, eighty minutes in: a
   new test had tagged INV-005 as evidence, so the mutation that strips
   INV-005 from its only file was no longer a loss of evidence and the
   traceability guard rightly survived it. The weak tag is gone and the guard
   now holds INV-005 to that one file in a second, so the next such tag fails
   at `state:check` rather than at the end of a gate.

## 9. Integrated phase verification

| Check                                                                               | Result                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every subphase document APPROVED and the roadmap agrees                             | `documentation.test.ts`, `stateConsistency.test.ts` green                                                                                                                                                                                                                                                                                                  |
| The query reads the record and the archive, never an engine (INV-001, INV-010)      | `productionResponses.test.ts` by value over 9 routes; `labSurface.test.ts`; no diff under `packages/engine`                                                                                                                                                                                                                                                |
| The price rule is `settle()`'s, and a served proof verifies (INV-009)               | `settlementQuery.test.ts` (a thousand instants, `settle()`'s own prices); `journalFile.test.ts`                                                                                                                                                                                                                                                            |
| The contract holds the controller; a breaking change is a version                   | `contract.test.ts`, four plants                                                                                                                                                                                                                                                                                                                            |
| The conformance suite passes the shipped venue and fails each fault by name         | `conformance.stat.test.ts`; `conformance.test.ts` five faults                                                                                                                                                                                                                                                                                              |
| The client resumes exactly, never repeats, refuses an untold skip, verifies a proof | `venueClient.test.ts`                                                                                                                                                                                                                                                                                                                                      |
| Money is exact in the minor unit; the verdict grades on the gate's floor            | `settle.test.ts` (100 000 stakes), `standing.test.ts`                                                                                                                                                                                                                                                                                                      |
| Every guard watched failing                                                         | PH-29.1 three plants, PH-29.2 four, PH-29.3 one, PH-29.4 three, PH-29.5 one                                                                                                                                                                                                                                                                                |
| Phase quality gate `npm run gate` with the browser prefix                           | `GATE_EXIT=0` on the second run, on `5483cbc` — format, build, `typecheck:web`, `typecheck:config`, lint, unit 158 files / 3,209 tests, the coverage floors, statistical 47 files / 401 tests in 4,844 s (80.7 min), `GATE COMPLETE`; started 06:53:06Z, finished 08:17:03Z; the first run (85.9 min) failed only the meta-audit's INV-005 mutation (§8.7) |
| Hosted CI on the merge commit                                                       | _recorded in `CURRENT_STATE.md` § "Hosted CI, honestly" when it lands_                                                                                                                                                                                                                                                                                     |
