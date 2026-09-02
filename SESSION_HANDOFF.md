# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| Last clean session | 2026-09-02                                               |
| Branch             | `feature/ph-21-catalogue-at-scale`                       |
| Remote             | `origin` → NovaHub2026/otcv6 — public, hosted CI **red** |
| Active cycle       | Cycle 7, **2 of 3** phases approved                      |
| Active phase       | PH-21 — the catalogue at scale (ACTIVE)                  |
| Active subphase    | PH-21.1 — a hundred assets (ACTIVE)                      |
| Cycle Audit        | **006 closed** — 40 of 46 findings closed in PH-19       |
| Blockers           | none, and none possible — no Human gate (ADR-0008)       |

## Continuation point

Read `CURRENT_STATE.md` for the authoritative position; this is the short form.

**An out-of-band full audit is in progress**, requested by the Human Owner on
2026-09-02 with authority to fix everything it finds (`GOVERNANCE.md` §29, §33).
Independent agents, one worktree each. Its record goes under `docs/audits/`.

**Hosted CI is red on `main`** — three runs, 238 statistical tests passing, one
`Timeout calling "onTaskUpdate"`, exit 1. PH-20 was approved without that
corroboration (CA6-02 repeated). The event-loop watchdog in
`vitest.setup.statistical.ts` exists to name the file; the local statistical run
with it is the first measurement to read.

**PH-21.1 is ACTIVE**: the hundred-asset runner, the brief's tail-weight retreat
and the guard test are in the tree and the evidence is recorded; the gate on
this tree and the CI run that corroborates it are still owed.

Then PH-21.2 and PH-21.3, then **Cycle Audit 7**, automatically and without
asking. One worktree per auditor (B-020), and plants against every guard this
cycle added.

### The thing worth knowing before touching the panel

PH-20.2 found that PH-20.1's browser suite **was not testing the engine it
booted**. `next.config.mjs` carried `env: { OTC_API_BASE }`, which Next inlines
at _build_ time, so the panel proxied to the baked-in default — a stale, stalled
engine on port 3000 that answered the catalogue and the history from stored
state and published no ticks. The suite was green on a lie for part of its life,
and the test that was supposed to guard the proxy read the config file rather
than exercising the behaviour.

The general form of that, which the audit should look for everywhere: **a test
of a configuration value is not a test of the behaviour that value was chosen
for.**

### Open, carried forward

**B-029** (`xauusd`'s realised spread exceeds its calibrated one by 20–33%,
cause unknown), **B-030** (one unit run in seven failed seven files, one test per
file, not reproduced in six further attempts including one under load),
**CA6-07**, **CA6-17** (partly closed), **B-018**.

The audit's own standard, for whoever continues: falsify rather than confirm,
re-execute rather than read, and plant a defect against every guard. Six of the
things Cycle Audit 6 found were things a previous phase had recorded as fixed.

## What Cycle 7 has established so far

- **PH-19 APPROVED** — closed 40 of Cycle Audit 6's 46 findings, starting with
  the instrument: `vitest.config.ts` was in no TypeScript program and two options
  that do not exist had been silently ignored for a cycle.
- **PH-20 APPROVED** — the operator panel. Three subphases: the panel under a
  real browser against a real engine (PH-20.1), creating an asset as a job that
  reports each of its six stages (PH-20.2), and editing and retiring with the
  editable surface reduced to one field (PH-20.3).

  Two measurements from it worth carrying: a registration costs **0.5s to 19.3s**
  across the eight archetypes, not the "order of a minute" the documents claimed;
  and a Next **rewrite to an external destination does not stream**, which is why
  the engine is proxied by a route handler that hands the upstream body to the
  response unread.

Earlier phases and audits are summarised in `docs/phases/ROADMAP.md` and the
records under `docs/audits/`. This document is not the place for them.

## Last executed verification

`npm run gate` on the PH-20 tree, 2026-09-02: **exit 0**, with
`OTC_REQUIRE_BROWSER=1` — a missing Chromium is a failure in that run, not a
skip. Unit 1,866 tests; the statistical suite includes the browser layer
(`apps/web/src/panel.stat.test.ts`, six tests) and the end-to-end registration
acceptance (`apps/api/src/registration.stat.test.ts`, four tests).

Format, build and lint all exit 0, in that order — build before lint, because the
type-aware rules resolve workspace types through emitted declarations.

**B-030 is open against this suite**: one unit run in seven failed seven files,
one test per file, and has not reproduced in six further attempts. On the next
occurrence, capture the whole output to a file before anything else.

## Process, in force

Governance changed on 2026-08-31
([ADR-0008](docs/decisions/ADR-0008-full-delegation.md)) and again on 2026-09-01
([ADR-0011](docs/decisions/ADR-0011-subagent-authority.md)):

- **There is no three-phase Human gate.** Cycle Audits run automatically. Stop
  normal development at the boundary, run the audit, continue. Never wait for
  `EJECUTA` and never report a cycle as blocked pending it.
- **Every code and product decision is yours** — purpose, business model, payout
  and settlement rules, architecture, roadmap, what does not get built. Decide,
  then record it: an ADR for something durable,
  [`DECISION-LOG.md`](docs/decisions/DECISION-LOG.md) for everything else.
- **Two things are still the Human Owner's**: amendments to Governance itself,
  and commitments that bind them outside the repository (legal, contractual,
  real-money, custody, paid services).
- **Subagents are an engineering decision**, and a Cycle Audit must use
  independent ones.
- **Hosted CI runs.** The repository is public, so Actions is free, and
  `.github/workflows/ci.yml` runs the quality gate and the statistical gate on
  every push to `main` (ADR-0009). It corroborates `npm run gate`; it does not
  replace it. A red CI on a green local gate is a finding about the gate.

## Standing rules, all learned the hard way

- **A guard is not finished until it has been watched failing.** Every material
  finding in Cycle Audit 2 was a guard that existed, was documented as
  sufficient, and had never been tested against the thing it guarded against.
  PH-14 found two more of these in its own new tests.
- **A claim is only as true as the run behind it.** Never write PASSED from a
  command whose exit code you did not see — `| tail -1` discards it.
- **A recorded number that nothing reads is a comment.**
- **Never `git add -A` while subagents are running**, and keep audit plants in an
  isolated clone.
- **A long test body must yield to the event loop** (`CLAUDE.md` §5). The gate
  otherwise exits 1 with every test reported as passing. It has happened twice.

Before changing anything in the engine, read the last section of `CLAUDE.md`.
