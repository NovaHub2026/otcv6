# ADR-0018 — One engine per deployment; a Lab-composed engine is the engine in simulation mode

Status: ACCEPTED
Date: 2026-09-03
Phase: PH-24.12
Amends: ADR-0015 §3 (clarifies; relaxes nothing)

## Context

The Lab was built as a composition of the engine (ADR-0015 §3): the same
`AppModule`, registered with a selectable sign source, plus the `/lab` routes.
Its browser suite has always run one Lab-composed process with the panel
pointed at it for both the engine and the Lab. The local deployment, written
when the Lab was a day old, ran two processes instead — a production-composed
engine the panel's Vista showed, and a Lab-composed engine the Lab controlled,
each with its own state — so that no Lab act could touch "the" market.

On 2026-09-03 the Human Owner found what that costs: the Lab's EUR/USD and
Vista's EUR/USD had different prices. The Lab is for seeing what an act does to
the chart; two engines make that impossible.

## Decision

1. **One engine per deployment.** A deployment runs a single engine process.
   It is either the production composition — no sign source, no `/lab` routes,
   asserted by `composition.test.ts` and `labSurface.test.ts` — or the Lab
   composition, which is the **whole engine** in simulation mode: every engine
   route, plus `/lab/*`, plus the selectable sign source on every hosted market.
2. **A Lab-composed engine declares itself everywhere.** Its process banner,
   every `/lab` response and the panel — on every screen when the panel's engine
   base is the Lab base — carry `OTC LAB — SIMULATION ENVIRONMENT`. Positions
   opened against it are simulations; the label is what says so.
3. **Production is never Lab-composed.** Unchanged, and the architecture tests
   that say so are the boundary (ADR-0015 §3). A real deployment with real
   positions cannot acquire a push button by configuration, because the route
   and the sign source are not in its program.
4. **The Lab's chart reads the Lab's engine**, never `OTC_API_BASE`, so that in
   any deployment shape the candles under the Lab's controls are the market the
   controls act on.

## Consequences

- The local launcher starts one Lab-composed process on the engine's port and
  state directory; Vista, the chart and the Lab show one market.
- ADR-0015 §3's "where it can never enter a published record" still governs
  §37's synthetic tick, which stays refused (DECISION-LOG 2026-09-03): a
  Lab-composed engine publishes a record, so the tick has nowhere to go here
  either.
- ADR-0012's single writer holds trivially: one process, one store.

## Alternatives rejected

- **Keep two processes and mirror the Lab's acts into production's engine.**
  That is a steering channel into a production-composed engine — INV-001 by
  another door.
- **A flag on the production engine.** ADR-0015 §3: the boundary is composition,
  not configuration.
