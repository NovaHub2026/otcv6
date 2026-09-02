# PH-20 — The Operator Panel: Trusted, And Able To Administer

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-20
Status: APPROVED
Cycle: 7 (phase 2 of 3)
Created: 2026-09-02
Branch: `feature/ph-20-trusted-panel`

---

## 1. Why this phase, and why in this order

PH-17 made an asset a registration rather than a compiled constant. PH-18 put a
panel in front of it. Then the Human Owner opened that panel and found, in one
day, **three defects a green gate had not seen**: the engine sent no CORS
headers, the panel needed a second free port on the host, and the chart had no
height. Two more followed: the candles did not move, and switching an asset
carried the previous market's chart.

Five user-visible defects against 2,050 passing tests is not bad luck. Cycle
Audit 6 named the mechanism (CA6-10): **not one test in this repository
referenced `apps/web/src`.** Every check talks to the service with `fetch` from
Node, where there is no same-origin policy, no port mapping, no layout and no
canvas.

So the panel cannot be extended before it can be tested. The order is forced:

| Subphase | Title                                                 | State    |
| -------- | ----------------------------------------------------- | -------- |
| PH-20.1  | The panel under a real browser, against a real engine | APPROVED |
| PH-20.2  | Creating an asset from the panel                      | APPROVED |
| PH-20.3  | Editing and retiring, and what may never be edited    | APPROVED |

PH-20.1 comes first for the same reason PH-2 came before PH-3: an instrument
that cannot fail the thing it measures is not evidence.

## 2. What the phase may not do

**The panel administers; it never generates.** Registration is a job of order a
minute with six refusing stages (`docs/architecture/CATALOGUE_AND_PANEL.md` §1).
Exposing it through a browser must not turn it into an insert, must not let a
refusal become a silent success, and must not give the operator any way to
influence a price (INV-001).

**An id, a lattice, and a past are immutable.** PH-20.3 is where that becomes
tempting: the display name and the hosted flag are presentation, but the id
enters the key derivation (ADR-0002), the quantum defines the published integers
(ADR-0004), and the record is settled against. Editing any of the three would
make historical outcomes unreproducible (INV-009) and is refused rather than
guarded.

## 3. Phase invariants

INV-001 (the surface reads, never generates), INV-002 (every observer sees the
same market — a panel that draws a bar the record does not hold breaks it for
one viewer), INV-004 (the timeframe is an observer choice), INV-009 (the past is
not editable).

## 4. Phase gate

Executed 2026-09-02 on the integrated tree, with `OTC_REQUIRE_BROWSER=1` so a
missing Chromium is a failure rather than a skip.

```
npm run gate  ->  GATE_EXIT=0
  format:check     0
  build            0
  typecheck:web    0
  typecheck:config 0
  lint             0
  unit          86 files, 1,866 tests
  statistical   36 files,   238 tests
```

The statistical suite now includes what PH-20 added: six browser tests driving
the real panel against a real engine, and four end-to-end registration tests that
create, rename and retire an asset across a process boundary.

## 5. What the phase leaves open

**Scale.** Five assets is not a catalogue, the sidebar is a flat list, and a
hundred-asset build has never been run against this surface. That is PH-21.

**Retirement is one-way** — by decision, recorded in `DECISION-LOG.md`.

**B-030**, an unexplained unit run that failed seven files and has not
reproduced.
