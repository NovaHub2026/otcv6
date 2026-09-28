# Release conformance — v3.0.0

Type: EVIDENCE (a recorded verification)
Recorded: 2026-09-28
Subject: **the tagged release build**, `a8fc427` / `v3.0.0`, built from a clean
`main` and run as a production composition with publication configured
Command: `npm run conformance -- --base http://127.0.0.1:7500 --key <publisher.json publicKey>`

---

## 1. The verdict

**39 checks, 0 failures, exit 0** — and the two checks that are usually reported
"NOT PROVEN" on a fresh venue were made provable first, deliberately, because a
checklist whose hardest rows did not run is a checklist that proved nothing:

- **The proof leg.** A young venue has committed no window, so the row reads
  `not yet committed (409)` and the engine's own signature is never checked. The
  venue was left running until the commitment chain passed the sequence the suite
  asks about. The row then read: **signature true, inclusion true, agrees with the
  stream true, names the key it was signed with true** — checked against the 88-hex
  key from `publisher.json`, which is the key an operator actually has.
- **The seam leg.** A fresh venue lists no seam, so the row that verifies ADR-0021
  — the release's headline — cannot run. The process was stopped for 25 s, past the
  fifteen-second catch-up bound, and restarted on the same state directory. **One
  restart wrote exactly one seam** (PH-40.5, issue #23), `reframes: false`. The row
  then read: `at 1790591574797: sequence 533, seam 533..100535` — an instant
  **inside** the discontinuity answered with the price in force and named the seam
  beside it, which is the whole of ADR-0021 working on live data.

One row remains NOT PROVEN and is structural: `a recorded price states the frame it
counts in` has a leg that does not trust the venue's own frame log, and it needs a
declared lattice boundary in range. A venue with one frame has none.

## 2. The check that had to fail, and did

`the venue is the production composition, not a simulation` is only a check if it
refuses a Lab. The same suite was run against a Lab composition of the **same
build**:

```
CONFORMANCE EXIT=1
| the venue is the production composition, not a simulation | **fail** |
  /health says lab; GET /lab/markets answers 200 — this is the Lab composition
  (ADR-0018): its prices can be steered from /lab, and nothing settled against it
  is a market
```

That is finding 12 of the readiness audit closed in both directions: a broker's
own pre-production gate passed 37 of 37 against a Lab before this existed.

## 3. What the venue reported

```
GET /health  →  {"status":"ok","assets":30,"stalled":[],"bootNonce":null,
                 "apiVersion":"3.8.0","ready":true,"composition":"production"}
publisher.json publicKey → 302a300506032b6570032100f95c… (88 hex, DER SPKI)
```

## 4. The report, as the suite wrote it

# Conformance — PASS

Venue: `http://127.0.0.1:7500` (contract 3.8.0; this client 3.8.0)
Assets hosted: 30
Publisher key: told to this run, so a served proof was checked against it.

| Check                                                                                      | Result | Detail                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| health answers                                                                             | pass   | status ok                                                                                                                                    |
| contract version                                                                           | pass   | venue 3.8.0, this client 3.8.0                                                                                                               |
| contract digest                                                                            | pass   | venue 77e60212e2388b93, this client 77e60212e2388b93                                                                                         |
| ready                                                                                      | pass   | GET /health/ready answered 200: {"ready":true}                                                                                               |
| metrics                                                                                    | pass   | GET /metrics answered 200 with 49 samples                                                                                                    |
| a market is hosted                                                                         | pass   | 30 hosted                                                                                                                                    |
| GET /health                                                                                | pass   | keys and types as contracted                                                                                                                 |
| GET /health/live                                                                           | pass   | keys and types as contracted                                                                                                                 |
| GET /health/ready                                                                          | pass   | keys and types as contracted                                                                                                                 |
| GET /contract                                                                              | pass   | keys and types as contracted                                                                                                                 |
| GET /markets                                                                               | pass   | keys and types as contracted                                                                                                                 |
| GET /markets/:id                                                                           | pass   | keys and types as contracted                                                                                                                 |
| GET /catalogue                                                                             | pass   | keys and types as contracted                                                                                                                 |
| GET /archetypes                                                                            | pass   | keys and types as contracted                                                                                                                 |
| GET /markets/:id/history                                                                   | pass   | keys and types as contracted                                                                                                                 |
| GET /markets/:id/ticks/:sequence                                                           | pass   | keys and types as contracted                                                                                                                 |
| GET /markets/:id/price                                                                     | pass   | keys and types as contracted                                                                                                                 |
| GET /markets/:id/seams                                                                     | pass   | keys and types as contracted                                                                                                                 |
| GET /markets/:id/lattices                                                                  | pass   | keys and types as contracted                                                                                                                 |
| GET /markets/:id/proof/:sequence                                                           | pass   | keys and types as contracted                                                                                                                 |
| GET /registrations                                                                         | pass   | keys and types as contracted                                                                                                                 |
| GET /registrations/:id                                                                     | pass   | refused 404, a refusal the contract lists: {"message":"Unknown registration job eurusd-otc.","error":"Not Found","statusCode":404}           |
| the venue is the production composition, not a simulation                                  | pass   | /health says production; GET /lab/markets answers 404                                                                                        |
| stream delivers contiguous, non-decreasing ticks                                           | pass   | 200 ticks read (status 200)                                                                                                                  |
| stream resumes exactly from M+1                                                            | pass   | asked 100735, got [100735, 100736, 100737, 100738, 100739], 0 gaps                                                                           |
| stream refuses a sequence never published                                                  | pass   | status 400                                                                                                                                   |
| a gap, when told, names where the record resumes                                           | pass   | gap resumesAt 100535, first tick 100535                                                                                                      |
| the record answers the ticks the stream delivered                                          | pass   | 3 sampled ticks agree                                                                                                                        |
| a recorded price states the frame it counts in                                             | pass   | 1 declared frame(s), NOT PROVEN: no declared boundary was in range, so the one leg that does not trust the venue’s own frame log did not run |
| the market is not behind the ticks it streamed                                             | pass   | the market reports sequence 101072, the stream delivered through 100734                                                                      |
| price at an instant is the last tick at or before it                                       | pass   | 101 instants agree                                                                                                                           |
| price refuses an instant after the newest published                                        | pass   | status 400                                                                                                                                   |
| a price inside a seam is the price in force, and the seam is named                         | pass   | at 1790591574797: sequence 533, seam 533..100535                                                                                             |
| a heartbeat names the price in force, final through an instant the price route agrees with | pass   | heartbeat: sequence 101075 as of 1790591860673; price at that instant: 200 sequence 101075                                                   |
| a stored candle is the ticks it was folded from                                            | pass   | 2 bar(s) refolded from the stream and equal                                                                                                  |
| the price the market reports is one the record already carries                             | pass   | 5 rounds agree                                                                                                                               |
| proof verifies against the publisher key and agrees with the stream                        | pass   | signature true, inclusion true, agrees with the stream true, names the key it was signed with true                                           |
