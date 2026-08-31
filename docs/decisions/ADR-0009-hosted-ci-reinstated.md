# ADR-0009 — Hosted CI reinstated, and what it found in its first minute

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-08-31
Deciders: **Human Owner** (repository visibility, `GOVERNANCE.md` §5.1) and the Development Agent (everything else)
Amends: `GOVERNANCE.md` §40
Supersedes: the hosted-CI half of [ADR-0008](ADR-0008-full-delegation.md)

---

## Context

[ADR-0008](ADR-0008-full-delegation.md), recorded hours earlier, removed hosted
CI from the verification model. The reasoning was sound at the time: GitHub
Actions had refused **eleven consecutive runs** because the repository was
private and the account had no paid allowance, and carrying that as a blocker on
someone who could not clear it was dishonest.

That ADR recorded one standing option, unused: _"making the repository public
would restore free GitHub Actions immediately, at no cost… it needs one word from
the Human Owner."_

The Human Owner made the repository public.

## Decision

**Hosted CI returns as a required corroborating layer.** `npm run gate` remains
the verification authority — it is the thing an agent can run before recording an
approval — but a red CI on a green local gate is now a finding about the gate.

Before publishing, the consequences of a public repository were checked rather
than assumed:

- **No committed secrets.** No key material, no `.env` files tracked, no private
  keys anywhere in history.
- **The security model survives publication by design.** ADR-0002 uses ChaCha20
  with HKDF-derived per-label keys; secrecy lives in the key, not the algorithm.
  The service refuses to boot without `OTC_MASTER_SECRET` and explicitly declines
  to invent one, because inventing a secret would produce a different market on
  every boot and break INV-009.
- **ADR-0003 makes the stronger statement.** `P(up) = P(down)` holds exactly
  under _every public conditioning_ — which includes an attacker reading the
  entire engine. Publishing the code gives an adversary nothing the theorem did
  not already grant them.

## What CI found immediately

The first run that actually executed **failed**, on two jobs, with one root
cause.

`npm run gate` was ordered `format → lint → build → test`. The type-aware ESLint
rules resolve workspace types through each package's **emitted declarations**, so
on a clean checkout there are none and `lint` reports every cross-package type as
unresolved — 46 errors in `apps/web/src/app/Chart.tsx`. The statistical job failed
the same way, because the `apps/api` suites spawn the built service as a child
process and reported `service exited (1)`.

Reproduced deliberately in a fresh clone to be sure it was the environment and
not the code:

| Step on a clean clone  | Result     |
| ---------------------- | ---------- |
| `npm ci`               | exit 0     |
| `npm run lint`         | **exit 1** |
| `npm run build`        | exit 0     |
| `npm run lint` (after) | exit 0     |

**Every `GATE_EXIT=0` recorded in this project through PH-10 was conditional on
leftover build artefacts.** Not wrong — the code was fine, and building first
makes the same lint pass — but the claim "the gate passes" was true only in an
environment that had already built. Nobody inside the session could have known;
`dist/` is always there once you have built once.

The fix is ordering: the gate is now `format → build → lint → test`, and CI
builds before both jobs.

## Consequences

**The reinstatement paid for itself in under five minutes.** ADR-0008 argued that
local-only verification was survivable because the gate is deterministic and
seeded and evidence is executed rather than asserted. All of that was true and
none of it could catch this, because every mitigation ran inside the same
environment that carried the defect.

That is the general lesson worth keeping: **a verification claim that has only
ever been tested in the environment that produced it is not a verification
claim.** The project had already paid for this once — PH-4 lost a phase gate to a
failing `npm run lint` that two subphase approvals recorded as passing — and the
diagnosis then was "no independent check exists". This is the same finding with
the check finally present.

**No new guard was written for it, and none is needed.** CI _is_ the guard: a
clean checkout, built and linted by someone other than the author, on every push
to `main`. Adding a local test that shells out to a fresh clone would be slower,
flakier, and would still run in the same environment.

## Alternatives considered

**Make lint independent of build output** — point ESLint's type resolution at
sources through path mapping, as `vitest.config.ts` already does with aliases.
Rejected for now: it would make `lint` and `tsc -b` resolve types by different
mechanisms, and two type resolvers that can disagree is a worse failure mode than
an ordering constraint. Recorded in `DECISION-LOG.md` as the alternative if the
build ever becomes slow enough that linting first matters.

**Keep CI advisory rather than required.** Rejected: an advisory check that just
found a four-cycle-old defect in its first minute should not be advisory.
