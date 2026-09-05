# PH-27 — The Footprint Of A Lab Intervention

Type: EVIDENCE
Produced by: `npx vitest run --project statistical apps/api/src/lab/footprint.stat.test.ts`
Run: 2026-09-05, on `feature/ph-27-review` after `e1f2970`, exit 0 (the figures
below are the run's own `console.log`, copied verbatim)
Subject: `dogeusdt-otc` — the fastest tape of the thirty — on a Lab-composed
venue run for one simulated hour from genesis under the keyring
`footprint-spec`; median 1m range 175 lattice steps; horizon 5,000 ticks after
release

_"¿Has realizado tests para definir el impacto que tiene el Lab en un activo
cuando lo ejecuta, mueve algo en concreto, se desconfigura?"_

## Method

From the venue's current snapshot two forks are walked: one with the
intervention armed on its sign stream (`SelectableSigns`, exactly as the Lab
arms the live market), one bare. Both continue `controlled + 5,000` ticks and
are compared tick for tick (`footprintOf`, `apps/api/src/lab/footprint.ts`).
The comparison is possible because the keystream cursor advances the same way
whether or not a sign is substituted (`selectableSigns.test.ts`), so the bare
fork **is** the continuation the market would have produced.

Three interventions, as the Lab plays them: a push of ten ticks up; a close —
the sign vector `selectClose` chose to land the next forty natural magnitudes
six or seven steps up, rejection-sampled as the close route samples it; a
sustained direction (bias) up for two hundred ticks with runs of 2–6, ending
by its own deadline.

## Measured

| Intervention                    | Controlled ticks | Displacement (steps) | Displacement (1m candles) | Divergent increments | Instants identical | Decay (ticks) | Level offset after horizon |
| ------------------------------- | ---------------- | -------------------- | ------------------------- | -------------------- | ------------------ | ------------- | -------------------------- |
| push +10                        | 10               | 30                   | 0.17                      | 3 / 5010 (0.06%)     | yes                | 0             | 30                         |
| close (40-tick selected vector) | 40               | 2                    | 0.01                      | 18 / 5040 (0.36%)    | yes                | 0             | 2                          |
| bias up, 200 ticks              | 200              | 252                  | 1.44                      | 79 / 5200 (1.52%)    | yes                | 0             | 252                        |

## What the figures say

- **Displacement** is the whole cost, and it is permanent. A push of ten ticks
  moved the level thirty steps — about a sixth of a one-minute candle — against
  where the market would have been; the two-hundred-tick bias moved it a candle
  and a half. After release the two paths' increments are identical, so the
  offset never decays: a random walk carries it forever. That is the honest
  shape of a sign-only intervention on a driftless process — nothing pulls the
  price back, because nothing pulls it anywhere.
- **Detectability** is bounded by the controlled stretch. Only 3 of the push's
  10 increments differ (seven natural signs were already up), 18 of the close's
  40, 79 of the bias's 200; outside the stretch, zero of 5,000. An observer's
  instrument can see at most 0.06–1.5% of the record, inside the stretch alone.
- **Decay is zero, measured — not assumed.** `footprint.test.ts` runs the same
  comparison on a walker whose variance responds to the signed return (the
  `leverageEffect` recursion) and the figure there is non-zero: the magnitudes
  after a forced sign differ for the rest of the path. On this engine they do
  not, because the magnitude path cannot see a sign (ADR-0003); the
  measurement is what says so.
- **Not one instant moved.** The arrival process saw nothing: `instantsIdentical`
  on all three. (A push at a chosen _pace_ does move instants — through
  `SelectableArrival`, by design — and the push route's recorded footprint
  compares against a bare fork of the same tick count, so it carries that too.)

## Where an operator sees it

Every push now records `footprint: { displacementSteps, naturalLevel }` with
the act on the session record (`/lab/session`) and returns it; the session
screen's line for the act shows _"huella ±N pasos"_ (`lab-session-footprint`,
asserted in `lab.stat.test.ts`), and the `Empujar` card shows the full
sentence beside the landing.
