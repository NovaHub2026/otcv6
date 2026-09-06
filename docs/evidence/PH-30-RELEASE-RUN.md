# PH-30 — The Release Build On The Thirty: An Hour Whole, Then An Hour With A Deploy-Length Restart

Type: EVIDENCE
Recorded: 2026-09-06
Commits: run 1 on `0ff85aa`, run 2 on `e0c87cd` (branch `feature/ph-30-release`)
Composition: `apps/api` in production composition (`main.ts`), thirty assets, state directory with `record.db`, publication on, rate limit off (`OTC_RATE_LIMIT_PER_MINUTE=0`, the job reads thirty streams from one address)
Method: `~/.otc-local/ph304/run.sh` and `run2.sh`, scripts outside the repository that spawn the built service and read it over HTTP only; the generated records are stored beside this file verbatim

---

## 1. Run 1 — an hour whole (`0ff85aa`)

Boot on an empty state directory at 10:31:19Z; ready after 2 s; thirty
markets hosted, none stalled, for 3,611 s. Then, against the running venue:

- `servedAssuranceJob` (`npm run assurance:served`): thirty records read from
  sequence 1 over `GET /markets/:id/stream`, one resuming across the stream's
  1 MB replay cap; **thirty of thirty graded, none exploitable, none failed**;
  every row carries the sequences read and the digest of the ticks. Stored as
  [`PH-30-RELEASE-SERVED-VERDICT.md`](PH-30-RELEASE-SERVED-VERDICT.md).
- `conformanceTool` (`npm run conformance`): **27 checks, 27 pass**, contract
  `1.1.0` / digest `1f9fc7c84b19c58c` on both sides. Stored as
  [`PH-30-RELEASE-CONFORMANCE.md`](PH-30-RELEASE-CONFORMANCE.md).
- `stateTool verify` after a clean stop: thirty assets, checkpoint, record and
  history agreeing per asset; exit 0.

| Figure                               | Value                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Ticks published in the hour          | 438,549 (`otc_ticks_published_total`)                                         |
| Resident memory after the hour       | 279 MB (`otc_process_resident_bytes`)                                         |
| `record.db` after the hour           | 26 MB                                                                         |
| Publication directory after the hour | 14 MB                                                                         |
| Slowest asset in the hour            | tcx-idx-otc, 3,596 ticks; fastest ethusdt-otc, above the 50,000 the job reads |

**What an hour decides.** Nothing, and the record says so: every asset is
`undecided` with a 30 s detection floor between 19 and 30 percentage points
and no hypothesis tested — the battery's features want thirty minutes of
history before the first window, and an hour then holds forty windows of
30 s. The standing verdict is designed to accumulate over the venue's life
(PH-29.5 grades sufficiency on the gate's own floor), so what this run
establishes is the release build serving the thirty whole under the job and
the suite, not a margin. The margin claim rests on the theorem (ADR-0003),
the mirror test and the statistical suite's battery over long offline runs;
the served verdict will reach the product margin only with months of record.

## 2. What run 1 found when it was restarted (PH-30.4, §5)

The venue was stopped cleanly and restarted on the same directory 23 minutes
later. Every market seamed (the checkpoint was past the 15 s catch-up bound),
and the venue then published nothing: the feed had been primed with the
record's pre-seam tail and refused the first post-seam tick as a gap, on
every pass, for every asset, while the record kept filling. A prompt third
boot died priming the commitment chain across the recorded jump. And the
chain restart PH-28.3 promised produced a file the project's own verifier
refused at the second genesis link. Fixed in `e0c87cd` (`DECISION-LOG.md`,
2026-09-06): a seamed market's feed begins at the seam, the chain restarts at
the seam and at any jump the record holds, and `verifyCommitmentsFile` names
each restart in `breaks`. The guards — the three-boot test in
`venueRecord.test.ts` and the two-chain test in `commitmentsFile.test.ts` —
were watched failing first. Run 2 is the same hour with that restart inside
it.

## 3. Run 2 — an hour with a deploy-length restart (`e0c87cd`)

_Recorded below when the run ends._
