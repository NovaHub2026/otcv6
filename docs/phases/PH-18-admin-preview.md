# PH-18 — The Admin Panel: Preview

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-18
Status: ACTIVE
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

| Subphase | Title                                                   | State       |
| -------- | ------------------------------------------------------- | ----------- |
| PH-18.1  | The engine's administrative surface                     | APPROVED    |
| PH-18.2  | TradingView against PH-8's rendering contract           | ACTIVE      |
| PH-18.3  | Live preview: selection, streaming, timeframe switching | not started |

## 5. Phase invariants

- **INV-002** — every observer sees the same price at the same moment, so the
  history endpoint and the tick stream must agree where they overlap.
- **INV-004** — changing the displayed timeframe never changes the market. The
  panel switches timeframes by re-reading a view, never by re-generating.
- **INV-001** — the panel is an operator surface, and nothing on it may reach
  the price path. The guardrail scan is what keeps that true.
