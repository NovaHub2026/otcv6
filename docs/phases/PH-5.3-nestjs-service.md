# PH-5.3 — The NestJS service and a real process-boundary restart

Type: SUBPHASE TECHNICAL DOCUMENT
Identifier: PH-5.3
Parent phase: PH-5 — Continuous Runtime, Sealed State Persistence and Restart Continuity
Status: APPROVED
Created: 2026-08-31

---

## 1. Objective

Host the catalogue in a real process, and prove the phase's central claim across
a boundary that in-process tests cannot reach.

## 2. Why in-process restart tests were not enough

Everything before this subphase proved continuity by constructing a new object in
the same heap. That is a materially weaker claim than it appears. It cannot catch:

- state that survives in a module-level variable rather than in the snapshot;
- a snapshot that does not round-trip through JSON;
- a store whose writes never actually reached the disk;
- a service that reads its state directory at the wrong time, or not at all.

Each of those passes an in-process test and fails in production. So the
acceptance test spawns the service, lets it publish, kills it with **SIGKILL** —
no shutdown hook, no final checkpoint, the worst case the design has to survive —
and boots it again on the same state directory.

## 3. Scope

- `apps/api`: NestJS, hosting the PH-4 catalogue.
- `VenueService` — lifecycle, deadline-driven scheduling, checkpoint cadence.
- `MarketController` — read-only observation: `/health`, `/markets`,
  `/markets/:id`.
- The process-boundary restart test.

Everything market-related stays below the service, in `@otc/runtime` and
`@otc/engine`, both framework-free. NestJS contributes exactly three things it is
actually needed for here: a lifecycle, a scheduler, and somewhere to put the
checkpoint cadence. `dependencies.test.ts` fails the build if anything under
`packages/` imports a framework, so that division is enforced rather than
intended.

## 4. What the acceptance test found

**A market with a known price reported none.** After a restart the API returned
`sequence: null` and `price: null` until the new process happened to publish its
own first tick — up to several seconds on the slower assets, every deploy. The
price was known; it simply had not been produced _here_. `HostedMarket` now
carries `lastPublishedState` across a restart and the service prefers a tick it
published, falling back to the inherited checkpoint.

This is a defect an in-process test could not have found, and a user-visible one:
a chart would have shown an empty market immediately after every deploy.

## 5. Two things the service refuses to do

**Invent a secret.** With no `OTC_MASTER_SECRET` the process exits non-zero and
says why. Generating one would produce a different market on every boot and make
settlement irreproducible (INV-009). Tested.

**Start from a corrupt record.** Inherited from PH-5.2: a corrupt record means
something ran and its lease marks are gone, so there is no safe automatic
recovery.

## 6. Acceptance criteria

1. The service boots, resumes or starts every catalogue asset, and serves.
2. Killed with SIGKILL and restarted on the same directory, every market reports
   `resumed` and no market's sequence goes backwards.
3. A market's price is available immediately after a restart.
4. The service refuses to start without a master secret.
5. Nothing under `packages/` imports a framework.

## 7. Approval record

**APPROVED** from executed evidence, 2026-08-31.

| Check                         | Result                          |
| ----------------------------- | ------------------------------- |
| `npm run format:check`        | PASSED (exit 0)                 |
| `npm run lint`                | PASSED (exit 0)                 |
| `npm run build`               | PASSED (exit 0)                 |
| `packages/runtime` unit tests | PASSED — 26 tests               |
| `restart.stat.test.ts`        | PASSED — 2 tests, SIGKILL cycle |
| Guardrails                    | PASSED — 118 tests              |

### Known limitations carried forward

- Observation is read-only and single-node. Public distribution, fan-out and
  multi-user consistency are PH-7.
- The catch-up bound is still a default, not a decided venue policy.
- No streaming: clients poll. A tick feed belongs with PH-7's distribution
  semantics rather than bolted onto a health endpoint.
