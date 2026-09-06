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

Boot on an empty state directory at 11:32:42Z; 25 minutes hosted; a clean
stop (`SIGTERM`, exit 0) at 11:57:43Z; **61 s down**; restart at 11:58:44Z,
ready after 2 s. Every one of the thirty resumed with a **seam** — "the
checkpoint is 61s old, past the 15s catch-up bound" — and every one
published: `tick failed` appears **zero** times in the second process's log,
against thirty times a pass in run 1's restart. Then 35 minutes more, and
against the seamed venue:

- `servedAssuranceJob`: **thirty of thirty graded, none exploitable, none
  failed**; each record read from the seam onward — the feed begins there —
  e.g. eurusd-otc `103552–108971`; the ticks before the seam stay in the
  record. Stored as [`PH-30-RELEASE-SERVED-VERDICT-RESTART.md`](PH-30-RELEASE-SERVED-VERDICT-RESTART.md).
- `conformanceTool`: **27 checks, 27 pass** on the seamed venue. Stored as
  [`PH-30-RELEASE-CONFORMANCE-RESTART.md`](PH-30-RELEASE-CONFORMANCE-RESTART.md).
- `verifyCommitmentsFile` on every asset's `commitments.ndjson` with the
  publishing key: **30 of 30 verify, 839 links, one break per asset at its
  seam** — for eurusd-otc `{ link: 8, afterSequence: 4000, fromSequence: 103552 }`
  read as: the first chain committed through sequence 4,000; the process
  stopped with ticks 4,001–4,197 published and uncommitted; the second chain
  begins where the seam began. The verifier accepted the file and named the
  break, as `e0c87cd` made it do.
- `stateTool verify` after the final stop: thirty assets, checkpoint, record
  and history agreeing per asset; exit 0.

What a client sees across the seam, read from the live venue during the
second half:

| Request                                                      | Answer                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `GET /markets/eurusd-otc/stream?from=3500` (before the seam) | `400` — "Sequence 3500 for eurusd-otc is older than the retained window, which starts at 103552" |
| the same with `onGap=live`                                   | `event: gap` with `resumesAt: 103552`, then the live ticks from 103552                           |
| `GET /markets/eurusd-otc/ticks/3500`                         | `200`, the pre-seam tick from the record                                                         |
| `GET /markets/eurusd-otc/price?at=<its instant>`             | `200`, rule `last-tick-at-or-before`, sequence 3500                                              |
| `/health/ready`, `otc_markets_stalled`                       | `ready: true`, `0`                                                                               |

| Figure                                | Value                                                        |
| ------------------------------------- | ------------------------------------------------------------ |
| Ticks published by the second process | 252,609 in 2,105 s (`otc_ticks_published_total`)             |
| Resident memory at the end            | 206 MB                                                       |
| `record.db`, both sides of the seam   | 26 MB                                                        |
| Chains                                | 30 verify, 839 links, 30 breaks (one per asset, at the seam) |

## 4. What the two runs establish

The release build hosts the thirty whole under the standing job and the
conformance suite, on a fresh directory and across the restart every deploy
is; the record keeps both sides of a seam and serves them by sequence and by
instant; the commitment chain restarts at the seam and the file verifies
with the break named. The margin is not decided by an hour and the records
say so; it accrues with the venue's life. The defect the first restart
exposed — a durable venue that served nothing after a deploy-length restart
and died on the boot after — was found by this run and not by any suite,
which is why the release run includes the restart.
