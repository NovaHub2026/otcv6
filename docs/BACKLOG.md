# BACKLOG (interim)

Type: SUPPORTING DOCUMENTATION
Status: Living document — **interim substitute for GitHub Issues**

---

## Why this file exists

`GOVERNANCE.md` §42 makes GitHub Issues the canonical backlog for verified bugs,
technical debt, blockers, deferred work and non-critical audit findings, and
prohibits maintaining a competing `BACKLOG.md` **when Issues are available**.

A private remote is configured (`origin → https://github.com/NovaHub2026/otcv6`)
but the repository is empty and Issues have not been enabled or populated, so
Issues are not yet usable as the canonical backlog. This file is the single
interim backlog. It is deliberately minimal.

**Migration rule:** when Issues become available, every open entry below is filed
as a GitHub Issue, this file is reduced to a pointer, and `DOCS_INDEX.md` is
updated in the same commit.

---

## Open

| ID    | Type           | Title                                                                                     | Raised by                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | -------------- | ----------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-001 | infrastructure | Migrate this backlog to GitHub Issues                                                     | Bootstrap                | The remote `origin → NovaHub2026/otcv6` is configured and the private repository exists, but it is empty and Issues are not populated. **Raised in priority by PH-4:** hosted CI has never executed, and that is why a failing `npm run lint` survived two subphase approvals — a local gate is only as good as the operator's reading of it. Pushing is an outward-facing action and is offered rather than performed.                                                                                            |
| B-002 | technical debt | Policing horizons beyond 30 seconds to the promotional-payout threshold                   | Cycle Audit 001          | Independent samples at a horizon are fixed by simulated duration, so the 15-minute horizon needs roughly a hundred times the history to reach the same detection floor. Every verdict already states the floor it achieved, so this is a strengthening, not a gap in honesty.                                                                                                                                                                                                                                      |
| B-003 | technical debt | `tools/*` is excluded from coverage measurement                                           | Cycle Audit 001          | `vitest.config.ts` includes only `packages/*/src`. `tools/sim` carries the simulation runner and the phase acceptance suites; its coverage is unmeasured.                                                                                                                                                                                                                                                                                                                                                          |
| B-004 | product        | Personalise the volatility cascade so assets differ in rhythm, not only in pace and scale | Cycle Audit 001 / PH-4.3 | PH-4.3 measured scale-free shape differentiation at 26% against a 20% null. Observable volatility dynamics are dominated by the MSM cascade, which every asset shares; three levers (trait spread, regime tempo, cascade memory span) all moved it by less than the realisation noise. Personalising cascade component count and hazard ratio would fix it, and interacts directly with the kurtosis gate since the cascade's contribution is raised to the power of its component count. A phase's worth of work. |
| B-005 | infrastructure | `npm run gate` can exit non-zero with every test passing                                  | PH-4                     | Vitest raises `[vitest-worker]: Timeout calling "onTaskUpdate"` when a statistical test blocks the event loop for tens of seconds; the slowest single assertion runs 35.8s of uninterrupted CPU. Load-dependent. Candidate fixes: `pool: 'forks'` for the statistical project, or yielding periodically inside the longest loops. Not changed speculatively because the failure costs five minutes to reproduce. A gate that fails without a failing test trains its operator to ignore it.                        |

## Closed

_None._
