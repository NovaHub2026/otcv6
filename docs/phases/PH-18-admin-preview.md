# PH-18 — The Admin Panel: Preview

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-18
Status: APPROVED
Cycle: 6 (phase 3 of 3)
Created: 2026-09-01
Branch: `feature/ph-18-admin-preview`

---

## 1. What this is, and what it is not

The broker is built. This project is the **engine** it will integrate, and the
only surface the engine needs of its own is the one an operator uses to run it.

PH-18 builds the first submenu of that panel: **Preview**. Look at any asset in
the catalogue, at any timeframe it offers, with the history it already has, and
watch it move.

Deliberately not in this phase: creating an asset from the panel, editing one,
retiring one. Those are the next submenus, and each needs Preview to exist first
— an operator who cannot see an asset has no way to judge one they just made.

## 2. Why the chart engine is TradingView Lightweight Charts

The Human Owner named TradingView. There are two products under that name and
the difference is a Protected Human Decision:

- **Lightweight Charts** is Apache-2.0 and needs no agreement. That is what this
  phase uses.
- **The Charting Library** is free but requires signing a licence, which binds
  the Human Owner outside the repository (`GOVERNANCE.md` §5.1). Not this
  agent's to accept.

`packages/chart` stays. It is the _reduction contract_ — extreme-preserving
reduction of ticks to columns — and it is what guarantees a spike is never lost
between the record and the screen. Lightweight Charts draws what it is given;
what it is given is still decided here.

## 3. The two halves

**Server.** The venue can host markets and stream ticks. It cannot yet answer
"what did this asset do last month", because until PH-17.3 there was nothing to
answer from. PH-18.1 exposes the candle history and the catalogue metadata an
operator picks from, and provisions a market that has no record.

**Client.** `apps/web` is a single hard-coded chart. PH-18.2 makes it a panel: a
shell with one submenu, an asset list, a timeframe switcher, and a chart that
joins ninety days of stored history to the live tick stream without a seam the
viewer can see.

## 4. Subphases

| Subphase | Title                                                   | State    |
| -------- | ------------------------------------------------------- | -------- |
| PH-18.1  | The engine's administrative surface                     | APPROVED |
| PH-18.2  | TradingView against PH-8's rendering contract           | APPROVED |
| PH-18.3  | Live preview: selection, streaming, timeframe switching | APPROVED |

## 5. Phase invariants

- **INV-002** — every observer sees the same price at the same moment, so the
  history endpoint and the tick stream must agree where they overlap.
- **INV-004** — changing the displayed timeframe never changes the market. The
  panel switches timeframes by re-reading a view, never by re-generating.
- **INV-001** — the panel is an operator surface, and nothing on it may reach
  the price path. Two things keep that true, and **Cycle Audit 6 (CA6-11) found
  this line naming one of them wrongly**: the guardrail scan's roots stopped at
  `packages/`, so it never opened the directory this sentence cited it for. The
  scan now covers `apps/api/src`; the browser bundle is protected instead by the
  dependency guard, which may not import the engine, the laboratory or the
  planted-defect corpus — and which CA6-12 fixed to read `.tsx` at all.

## 6. Integrated phase verification

`apps/api/src/panelSurface.stat.test.ts` boots the real service with
`OTC_BACKFILL_DAYS=2`, waits for it to provision five markets, and drives the
real client-side conversion over HTTP. Seven checks, listed in
[PH-18.3](PH-18.3-live-preview.md), covering the catalogue, the provisioned
history, timeframe agreement, the refusal of a timeframe that cannot be served,
the bar conversion, continuous recording, and the join to the live stream.

The two halves of what the Human Owner asked for are both measured there:
history that exists on day one, and everything from then on — the latter at
**60 seconds of stored history in 65 seconds of wall clock**.

## 7. What the phase gate found

Two defects that no subphase's own tests could see, both in how the whole thing
starts and runs rather than in what it computes.

**A missing directory killed the service at boot.** `SqliteCandleHistory`
defaulted to `./.otc-state/history.db` and SQLite reports a missing parent
directory as `unable to open database file` — which reads as a permissions
problem and is not one, and which happens during dependency injection, so the
process dies with no context. Three API suites that set a temporary state
directory and let the history path default went from booting to not. The
history now defaults _inside_ `OTC_STATE_DIR` and creates its directory.

**The gate was oversubscribing a 7 GB box across sixteen cores.** `npm run
test` exited 1 with all 2,014 tests passing, twice, on
`Timeout calling "onTaskUpdate"` — the failure this repository knows best. It
was neither a long synchronous block nor a slow test: the statistical project
alone was clean, and the two projects together were not. Two changes, and the
run got _faster_: the projects run one after the other (`sequence.groupOrder`),
and the unit project uses half the cores (`maxWorkers: 8`). 392 seconds to 303.

A third, smaller: `calibration.stat.test.ts`'s throughput floor of 200,000
ticks a second failed at 171,968 under gate load. Nothing regressed — the same
code measures 324,000 to 504,000 on an idle box — and a wall-clock floor
measures the machine as much as the code. Lowered to 100,000, which is still
three hundred times faster than the market it simulates.

## 8. Approval

**APPROVED** 2026-09-01, from executed evidence.

`npm run gate` — **exit 0**, 116 test files, 2,014 tests, 303 seconds.

| Check                       | Command                 | Exit |
| --------------------------- | ----------------------- | ---- |
| Formatting                  | `npm run format:check`  | 0    |
| Build and typecheck         | `npm run build`         | 0    |
| Web typecheck               | `npm run typecheck:web` | 0    |
| Lint (type-aware)           | `npm run lint`          | 0    |
| Unit and statistical suites | `npm test`              | 0    |

## 9. What Preview does not do

Create an asset, edit one, or retire one. Those are the next submenus and each
needs Preview first — an operator who cannot see an asset has no way to judge
one they just made. The pipeline they will drive already exists and refuses for
named reasons (PH-17.1); what is missing is only the surface.

Deployment and any TradingView Charting Library licence remain the Human
Owner's (`GOVERNANCE.md` §5.1).
