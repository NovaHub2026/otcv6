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

| ID    | Type           | Title                                                                   | Raised by       | Notes                                                                                                                                                                                                                                                                         |
| ----- | -------------- | ----------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-001 | infrastructure | Migrate this backlog to GitHub Issues                                   | Bootstrap       | The remote `origin → NovaHub2026/otcv6` is configured and the private repository exists, but it is empty and Issues are not populated. When Issues become available this file is reduced to a pointer.                                                                        |
| B-002 | technical debt | Policing horizons beyond 30 seconds to the promotional-payout threshold | Cycle Audit 001 | Independent samples at a horizon are fixed by simulated duration, so the 15-minute horizon needs roughly a hundred times the history to reach the same detection floor. Every verdict already states the floor it achieved, so this is a strengthening, not a gap in honesty. |
| B-003 | technical debt | `tools/*` is excluded from coverage measurement                         | Cycle Audit 001 | `vitest.config.ts` includes only `packages/*/src`. `tools/sim` carries the simulation runner and the phase acceptance suites; its coverage is unmeasured.                                                                                                                     |

## Closed

_None._
