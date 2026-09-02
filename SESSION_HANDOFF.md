# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| Last clean session | 2026-09-02                                               |
| Branch             | `main` — PH-20 merged                                    |
| Remote             | `origin` → NovaHub2026/otcv6 — public, hosted CI running |
| Active cycle       | Cycle 7, **2 of 3** phases approved                      |
| Active phase       | none — PH-21 is the next legal action                    |
| Active subphase    | none                                                     |
| Cycle Audit        | **006 closed** — 40 of 46 findings closed in PH-19       |
| Blockers           | none, and none possible — no Human gate (ADR-0008)       |

## Continuation point

Read `CURRENT_STATE.md` for the authoritative position; this is the short form.

**Begin PH-21 — the catalogue at scale.** Five assets is not a catalogue. The
registration path exists and is exercised one asset at a time; what a hundred
assets cost in storage, in scheduling, in differentiation headroom and in a
sidebar that is a flat list is unmeasured. PH-19.4 measured a registration
failing on 36% of hundred-asset builds before the tail-weight clamp.

Then **Cycle Audit 7**, automatically and without asking. One worktree per
auditor (B-020), and plants against every guard this cycle added.

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
