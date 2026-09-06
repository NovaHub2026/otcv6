# PH-30 — Release 1.0: The Engine As A Broker Integrates It

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-30
Status: ACTIVE
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
