# The restore drill, 2026-09-28 — an operator loses the host and comes back from a copy

Type: EVIDENCE (a recorded verification)
Recorded: 2026-09-28
Subject: `1a2ee59`, the release build, run as a production composition with
publication configured
Why: `INTEGRATION.md` documents this path in more detail than any other operational
procedure, and **nothing had ever executed it end to end.** The repository tested
each piece — the backup's manifest, the boot check that recognises an untouched
copy, `state:verify` — and never the sequence.

---

## 1. What was run

```
boot a venue (30 assets, publication + publishing key, no backfill)
  → let it publish  → record a price, its instant, and a committed proof
  → npm run state:backup -- --dir <state> --out <copy>
  → stop the process
  → mv <state> <state-live> ; cp -a <copy> <state>
  → npm run state:verify -- --dir <state>
  → boot from the copy
  → ask it the four things the guide promises
```

## 2. What held

| The guide says                                                 | What happened                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The copy verifies and says what starting it costs              | `Consistent: every file agrees`, preceded by the rollback warning naming the instant the copy was taken at (1790584111395)                                                    |
| A chain outside the state directory is **not** copied, loudly  | `Commitment chain: none in this state directory — if OTC_PUBLICATION_DIR points outside it, back that directory up separately or this copy can prove nothing about its past.` |
| The boot says out loud that it is starting from a backup       | one `WARN` at bootstrap, naming the instant, the 404s, the changed settlement, the fresh key epoch, and "if a newer backup exists, stop now"                                  |
| Every market reopens past the restored record, on a new epoch  | 30 markets, **one recorded seam each** ("the checkpoint is 68s old, past the 15s catch-up bound"), sequences leased past the record's end                                     |
| `/health` is `ok` and `ready`, and says which composition      | `{"status":"ok","assets":30,"stalled":[],"apiVersion":"3.7.0","ready":true,"composition":"production"}`                                                                       |
| A proof committed before the backup still verifies afterwards  | the proof of `eurusd-otc` sequence 500 was **byte-identical** before and after the restore, from the chain kept separately                                                    |
| The rolled-back instant settles at the restored record's price | `?at=1790584115000` answered sequence 2,399 / `1.159465` before the restore and sequence 2,386 / `1.159479` after, **with the seam named beside it**                          |
| The venue keeps trading                                        | publishing again within seconds, sequence 102,455 at the next check                                                                                                           |

That seventh row is ADR-0021 working on the worst input there is: the instant is
inside a discontinuity and the answer is still the price in force, not a refusal.

## 3. What did not hold, and is fixed

Asked for **sequence 2,399** — served before the backup, absent after it — the
record answered `404`, _"not in the record, which holds 1–102446"_. The sequence is
**inside** the range the refusal names. The restored record holds 1–2,386 and then
102,446 onward, because the reopening leased fresh sequences; the bounds span the
gap, and nothing in the answer said so.

A broker reconciling a statement across a restart is the one client guaranteed to
ask about a gap, and it was being told the sequence should have been there. Fixed
in `187dab5`: a sequence inside the bounds says it fell in a gap, why gaps exist,
and that `/markets/:id/seams` records every one; a sequence genuinely past the
record still gets the bounds. Contract **3.7.0**.

## 4. What this drill does not cover

It restored onto the same host, with the chain still on disk beside it. It did not
restore onto a different machine, did not exercise a chain restored from a separate
copy, and did not settle a contract through the `@otc/trading` kernel across the
restore — it compared the settlement query's answer, which is the input settlement
uses. A multi-host restore is an operator procedure this repository cannot rehearse
for the operator.
