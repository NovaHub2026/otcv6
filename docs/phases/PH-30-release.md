# PH-30 — Release 1.0: The Engine As A Broker Integrates It

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-30
Status: APPROVED
Approved: 2026-09-06 — on the integrated phase verification in §9 (`GATE_EXIT=0` on `6f1efa9`)
Cycle: 10 (phase 3 of 3) — the closing cycle
Created: 2026-09-06
Branch: `feature/ph-30-release`

---

## 1. What is actually unknown

Whether a broker's operator can run this venue without this repository's
authors in the room. The engine is durable (PH-28) and its boundary is a
contract with a client and a conformance suite (PH-29); what is not yet true
is that the venue says when it is ready and when it is alive, exposes what an
operator watches, refuses a client that floods it, ships the unit files a
deployment needs, holds the stated target of observers from more than one
harness process, has been measured whole on the build that ships, and carries
no open Issue that nobody decided.

## 2. Why this phase, and why now

Because it is the last phase of the closing cycle (`ROADMAP.md`, the Cycle
10 plan): the Human Owner asked for a venue a binary-options broker can
integrate, and a release is what turns fifteen approved subphases into a thing
with a version. Cycle Audit 10 follows it; nothing here shortens the audit.

## 3. What this phase may not do

- **It may not touch the price path.** A release does not recalibrate.
- **It may not build the broker** — no accounts, no money on the venue.
- **It may not close an Issue by deleting it**: every open Issue is fixed, or
  decided with the reason in the decision log and the Issue closed with it.
- **It may not tag what the gate did not pass.** `v1.0.0` is the commit the
  phase gate passed and hosted CI corroborated, or it is not tagged.

## 4. Phase invariants

INV-002 and INV-009 at scale (the same record for ten thousand observers,
provable); INV-001 and INV-010 untouched by an operator's surface.

## 5. Subphases

| Subphase | Title                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- |
| PH-30.1  | Operations: readiness, liveness, metrics, admin credential, rate limits, unit files         |
| PH-30.2  | The stream at scale: one multiplexed stream (#16); the operator's panel with holes, retired |
| PH-30.3  | Ten thousand observers held, from several processes, memory measured at the target          |
| PH-30.4  | The whole catalogue measured on the release build; the per-asset evidence complete          |
| PH-30.5  | Every open Issue closed or decided; the package regenerated; `v1.0.0` tagged and recorded   |

## 6. The design, in one paragraph

`/health` splits into what an orchestrator asks — `/health/live` (the process
answers) and `/health/ready` (every market resumed, the record primed, the
listener up; `503` with the reason until then) — and stays as it is for
humans; `/metrics` serves the counters an operator graphs in the Prometheus
text format (markets, ticks published, subscribers, replay bytes, stalls,
record heads) from the same values `/health` reports; a per-client rate limit
on the read routes refuses a flood with `429` and a `Retry-After`, and the
stream's per-process replay budget is already there. `deploy/` holds the
systemd unit, a Docker image and a reverse-proxy example, and the guide's §8
points at them. The panel opens one multiplexed stream per page rather than
one per chart, shows a told hole as a hole and a retired market as retired.
The observer harness runs from several processes against one venue at ten
thousand observers with resident memory measured. The standing job and the
conformance suite run against the release build over all thirty, and their
records are the release's evidence. Every open Issue ends closed or decided,
the integration package is regenerated from the tag, and `v1.0.0` is the
commit the phase gate passed.

## 7. What the phase leaves open, deliberately

Multi-node hosting (Issue #9), the engine's next stylised facts and jumps and
volume — the three the Cycle 10 plan deferred by name — and the two
Governance amendments (Issues #3, #14), which are the Human Owner's.

## 8. What the phase found

1. **Readiness is not the absence of a crash** (PH-30.1): ready means every
   market resumed, primed and unstalled; a stalled market is alive and not
   ready, which is the difference an orchestrator acts on.
2. **Every chart the panel ever opened stayed subscribed on the engine**
   (PH-30.2): the proxy did not pass the browser's abort to its upstream
   fetch; the new `otc_stream_connections` metric read sixteen for a board of
   eight. One line, and observable since.
3. **Ten thousand observers are refused by one event loop, not by memory**
   (PH-30.3): five thousand held whole at p99 211 ms and 355 MB; 7,700–8,750
   established at the larger target with the rest denied a first byte. The
   ceiling is a number a broker plans against, and its cause is named.
4. **A deploy-length restart left the durable venue serving nothing, and the
   boot after it died** (PH-30.4): the feed primed with the record's pre-seam
   tail refused every post-seam tick; the chain writer folded the record
   across the seam's jump and the publisher refused it; and the chain restart
   PH-28.3 promised produced a file the project's own verifier refused. Found
   by the release run's restart, not by any suite; fixed in `e0c87cd` with a
   three-boot guard and a two-chain guard, both watched failing first; the
   hour re-run with the restart inside it (`PH-30-RELEASE-RUN.md`).
5. **The standing job died on the stream's 1 MB replay cap** (PH-30.4): ten of
   thirty records on the first hour; it resumes across the cap now, with a
   test that closes the replay on a fake cap.
6. **An hour decides nothing about the margin, and the record says so**
   (PH-30.4): thirty `undecided` with floors around twenty points; the verdict
   accrues with the venue's life, which is what PH-29.5's grading is for.
7. **Every open Issue is closed with a fix, closed with a recorded decision,
   or open by name with its owner** (PH-30.5): #4, #7, #8, #12 by decision;
   #10, #11, #19, #20 fixed; #16 at this merge; #9 deferred by the Cycle 10
   plan; #3 and #14 the Human Owner's.

## 9. Integrated phase verification

| Check                                                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every subphase document APPROVED and the roadmap agrees                                       | `documentation.test.ts`, `stateConsistency.test.ts` green at `state:check` before the approval commit                                                                                                                                                                                                                                                                                                                                                                  |
| The venue's operational surface holds its contract (PH-30.1)                                  | `operations.test.ts`, `rateLimit.guard.test.ts`, `deploy.test.ts`, `contract.test.ts`                                                                                                                                                                                                                                                                                                                                                                                  |
| One connection carries a page's charts, and the engine counts what it holds (PH-30.2)         | `panelSurface.stat.test.ts` (one connection, eight subscriptions; the bounded hole across a lost record), `marketStream.test.ts`                                                                                                                                                                                                                                                                                                                                       |
| The observer ceiling measured from several processes (PH-30.3)                                | `PH-30-TEN-THOUSAND-OBSERVERS.md`; the single-process driver's `observerLoad.test.ts`; the fleet driver has no unit test and is held by its recorded runs                                                                                                                                                                                                                                                                                                              |
| The release build serves the thirty whole, fresh and across a deploy-length restart (PH-30.4) | `PH-30-RELEASE-RUN.md`; the served verdict and the conformance record, twice each; thirty chains verified with the break named                                                                                                                                                                                                                                                                                                                                         |
| A seam restarts the feed and the chain, never the venue's silence (INV-002, INV-009)          | `venueRecord.test.ts` three boots; `commitmentsFile.test.ts` two chains; both watched failing                                                                                                                                                                                                                                                                                                                                                                          |
| Money and sufficiency as PH-29 left them; the price core untouched (INV-001)                  | no diff under `packages/engine` in the phase; `guardrails.test.ts`, `dependencies.test.ts`                                                                                                                                                                                                                                                                                                                                                                             |
| Every guard watched failing                                                                   | PH-30.1 two plants, PH-30.2 two, PH-30.3 one, PH-30.4 two, PH-30.5 none (documents and a script)                                                                                                                                                                                                                                                                                                                                                                       |
| Phase quality gate `npm run gate` with the browser prefix                                     | `GATE_EXIT=0` on the closing tree `6f1efa9`, 14:27–15:50Z (83 min): format, build, `typecheck:web`, `typecheck:config`, lint, unit (161 files, 3,244 tests), the coverage leg, statistical (47 files, 402 tests, 4,798 s serial). Three earlier trees were refused before any test ran — a document Prettier had not seen, the guide's examples under lint, a file name in a finding — and a machine reboot killed one run at the 85th minute; PH-30.5 §5 records them |
| Hosted CI on the merge commit                                                                 | _recorded in `CURRENT_STATE.md` § "Hosted CI, honestly" when it lands_                                                                                                                                                                                                                                                                                                                                                                                                 |
