# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Last clean session | 2026-09-02                                                             |
| Branch             | `main` — PH-21 merged at its close                                     |
| Remote             | `origin` → NovaHub2026/otcv6, public                                   |
| Active cycle       | Cycle 8, **1 of 3** phases approved (PH-22)                            |
| Active phase       | none                                                                   |
| Active subphase    | none                                                                   |
| Cycle Audit        | **007 closed** 2026-09-03; the next is due after three approved phases |
| Blockers           | none, and none possible — no Human gate (ADR-0008)                     |

---

## Continuation point

**PH-22 is open**, and its phase document states the five things nobody knows
([PH-22](docs/phases/PH-22-distribution-under-thousands-of-observers.md)).
Cycle Audit 7 is recorded and closed, so §28's boundary is behind us.

The next legal action is **PH-22.1 — an instrument that can hold thousands of
connections**, and it is an instrument, so it owes a planted defect of its own:
a harness that cannot detect a server refusing connections is not a harness. `CURRENT_STATE.md` is
authoritative for where the project stands; this file is only what a fresh
session needs first.

Cycle Audit 7 hands PH-22 two measurements it did not ask for, and they are the
best starting point in the repository:

- **CA7-04.** Replay ignored backpressure entirely, and a resume is the largest
  write this service makes: 50,000 frames and 3.46 MiB accumulated for a single
  client full from its first byte. Bounded at 1 MB now — a number that wants
  measuring against real reconnect fan-out, not defending.
- **CA7-33.** The feed retains 5.01 MB per asset, measured rather than
  estimated. A hundred assets is 501 MB of one heap; about 446 assets exhausts
  the default. Nothing configures a heap for the service anywhere.

Then Issues [#15](https://github.com/NovaHub2026/otcv6/issues/15) (every
subscriber re-serialises the same tick), [#16](https://github.com/NovaHub2026/otcv6/issues/16)
(six connections per origin) and [#22](https://github.com/NovaHub2026/otcv6/issues/22)
(the one audit finding carried, and it belongs inside the multiplexing work).

### What the audit says about how to audit

Read [`CYCLE-AUDIT-007.md`](docs/audits/CYCLE-AUDIT-007.md) §5 before the next
one. The pattern in what survived forty plants is sharper than any individual
finding: **guards written against a constant rather than against a behaviour
are the ones that fail.** `MINIMUM_TRAIT_DISTANCE` could be weakened a
hundredfold because every assertion referenced the constant itself; the seam
tests asserted `toBeDefined()`; three branches of the record check had no test.
In every case the code was right and nothing would have noticed it becoming
wrong.

### Running it locally

```bash
bash ~/.otc-local/start.sh
```

Panel on 7301, engine on 7300, both loopback-only (CA7-06). It serves
`~/Projects/otcv6` and prints the tree, branch and commit it served.

## Last executed verification

**`npm run gate` on `feature/ph-21-catalogue-at-scale` at `e451647`** —
`GATE_EXIT=0`, with `OTC_REQUIRE_BROWSER=1` and zero skips: 90 unit files /
2,203 tests, 40 statistical files / 273 tests, worst RPC round trip 11.6 s
against the 30 s guard.

**Hosted CI on the same tree:**
[run 33701581822](https://github.com/NovaHub2026/otcv6/actions/runs/33701581822)
— success, Quality Gate and Statistical Gate, 48 minutes, 273 statistical tests
with the eight browser tests run on the runner.

Both layers, one tree. `GOVERNANCE.md` §40.1 wants the second, and PH-21 is the
first phase in this cycle to close with it green on its own tree rather than on
an ancestor's.

## Process, in force

Governance changed on 2026-08-31 (ADR-0008) and 2026-09-01 (ADR-0011): no
three-phase Human gate, Cycle Audits automatic, every code and product decision
the Development Agent's and recorded (ADR or `DECISION-LOG.md`), subagents an
engineering decision and a Cycle Audit must use independent ones, hosted CI a
required corroborating layer (ADR-0009). Two things stay the Human Owner's:
amendments to Governance, and commitments that bind them outside the repository.

## Standing rules, all learned the hard way

- **A guard is not finished until it has been watched failing.** Every material
  finding of this audit was a guard that existed and had never been planted
  against — the mirror test, the lexer, the watchdog, the retention boundary.
- **A claim is only as true as the run behind it.** PH-19's "hosted CI green on
  the same tree" was written about a different tree. Record the run id.
- **A cause for the gate's RPC timeout is accepted only with a reproduction**
  (`DECISION-LOG.md`, 2026-09-02). Four were recorded without one.
- **Check for a peer session before committing or running anything heavy**
  (`ListAgents`); uncommitted changes may be another live session's work.
- **Never `git add -A` while subagents are running**; plants live in worktrees.
- **A statistical test must never run thirty seconds of synchronous work with a
  request in flight** — and one is in flight at the start of every test
  (`CLAUDE.md` §5).

Before changing anything in the engine, read the last section of `CLAUDE.md`.
