# SESSION HANDOFF

Type: SESSION HANDOFF
Status: Immediate continuity record
Purpose: what a fresh session needs to resume **right now**. Nothing else.

---

| Field              | Value                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Last clean session | 2026-09-02                                                                                                                                                                                                                                                                                 |
| Branch             | `main` — `feature/out-of-band-audit` merged 2026-09-02                                                                                                                                                                                                                                     |
| HEAD               | the merge commit of `feature/out-of-band-audit` (code tree `023f694`)                                                                                                                                                                                                                      |
| Remote             | `origin` → NovaHub2026/otcv6 — public; branch pushed; hosted CI `run 33671271767 — **success**, Quality Gate and Statistical Gate, 19:06–19:53 UTC; statistical 40 files, 271 tests (the six browser tests ran on the runner), worst RPC round trip 9.4 s, no orphaned process at cleanup` |
| Active cycle       | Cycle 7, **2 of 3** phases approved                                                                                                                                                                                                                                                        |
| Active phase       | PH-21 — the catalogue at scale (ACTIVE)                                                                                                                                                                                                                                                    |
| Active subphase    | PH-21.1 — a hundred assets (ACTIVE)                                                                                                                                                                                                                                                        |
| Cycle Audit        | **006 closed**; out-of-band audit 001 recorded 2026-09-02                                                                                                                                                                                                                                  |
| Blockers           | none, and none possible — no Human gate (ADR-0008)                                                                                                                                                                                                                                         |

## Continuation point

Read `CURRENT_STATE.md` for the authoritative position; this is the short form.

**Continue PH-21 from PH-21.2 on a branch rebased onto `main`, which carries
the out-of-band audit and its fixes since 2026-09-02.**

The Human Owner asked on 2026-09-02 for a complete audit with authority to fix
everything found. Seven independent auditors, one worktree each, at `36bbf89`;
83 findings, 6 critical; every material finding fixed on this branch and
watched failing first; the record is
[`docs/audits/OUT-OF-BAND-AUDIT-001.md`](docs/audits/OUT-OF-BAND-AUDIT-001.md).
Fourteen GitHub Issues carry what remains, two for the Human Owner (#13 the
licence, #14 the `GOVERNANCE.md` contradictions). `docs/BACKLOG.md` is an
archive now.

### Two sessions worked on this repository today

Another Claude session held the main working tree for PH-21.2 and PH-21.3 while
this one audited on a separate branch; the split was agreed in writing. Its
branch `feature/ph-21-catalogue-at-scale` is local only and carries PH-21.1
under a second hash (`36bbf89`, the same tree as `main`'s `3a5f0a5`) plus
PH-21.3 (`aefe1ee`) ahead of PH-21.2, with an uncommitted edit to the PH-21
document. Whoever continues PH-21: rebase that branch onto `main` after the
audit branch merges (the duplicate drops out), create PH-21.2's document, run
`venueScale.ts` on a quiet machine, and re-run `catalogueScale.ts` — the
recorded hundred-asset run predates the `alt-crypto` depth change (a3-05).

### What this branch changed, in one paragraph each

- **The gate.** Hosted CI was red on every push to `main` since the PH-18 merge
  with every test passing: one test ran 92 s of synchronous work while a task
  update was in flight, and Vitest's reply was read after its 60 s timer fired.
  Four causes had been recorded before this one. The test yields
  (`yieldToLoop()` from `@otc/core`, two chained immediates — one is not a full
  loop turn), and `vitest.setup.statistical.ts` now fails a file by name at a
  30 s round trip, watched failing on a planted 35 s block. Use
  `npm run test:stat`, never the bare vitest command.
- **The engine.** The mirror test reflected through the origin and passed a
  round-number support/resistance field; it reflects through an interior
  snapshot now (ADR-0003 §6 as written). Ids of 52–64 characters, refusals at
  the wrong stage, `alt-crypto` drawing below its band, and the retreat
  retrying what it cannot fix are all closed; a registration reports each
  stage as it enters it.
- **The guardrails.** One tokenizer, a corpus of every construct that has ever
  hidden code from the scanners, new bans, `tools/sim` scanned, the
  publishing-key refusal checked structurally, a loop detector that sees every
  shape, an exact status vocabulary, 33 meta-audit mutations over all ten guard
  files.
- **The laboratory.** The battery states two sensitivities per horizon —
  single-test 0.221pp and the gate's own 0.315pp at 30 s — and says which the
  0.2513pp claim refers to; the clock grid sweeps every phase; the standing
  verdict runs the learned family; the founding look-ahead bug has a unit guard.
- **The runtime.** No partial minute bar is ever stored (a restart leaves a
  visible hole); a leader retries unrecorded ticks and loses the lease after
  three failures; `fsync`; schema versions; the registry's race and id trust.
- **The surface.** Every write needs `OTC_ADMIN_TOKEN` as a bearer with a JSON
  body; the service binds `127.0.0.1` unless `OTC_BIND` says otherwise; a
  browserless host reports the panel suite as skipped, not passed; one
  shutdown path that exits 0; honest reconnection and `/health` in the panel.
- **The record.** PH-19's approval claimed a hosted CI result it did not have
  and is corrected in place; "40 of 46" has a 46-row closure table; the
  multi-node and operations architecture document exists (B-023, two cycles
  late) and says the service composes none of it (Issue #9); the roadmap,
  `PROJECT_CONTEXT.md`, `CLAUDE.md`'s commands and timings, ADR-0008 and the
  decision log are brought to the present.

## Last executed verification

`npm run gate` on `feature/out-of-band-audit` at `023f694`, 2026-09-02:
**exit 0** in 32 minutes (19:06–19:38 UTC) — unit 88 files, 2,165 tests; statistical 40 files, 265 tests, 6 browser tests skipped on this host; no unhandled errors; worst RPC round trip 6.6 s against the 30 s guard. Format,
build, both typechecks and lint exit 0, in that order — build before lint. The
browser suite reports `skipped` on this host (no Chromium libraries); hosted CI
requires it. Hosted CI on the same tree: `run 33671271767 — **success**, Quality Gate and Statistical Gate, 19:06–19:53 UTC; statistical 40 files, 271 tests (the six browser tests ran on the runner), worst RPC round trip 9.4 s, no orphaned process at cleanup`.

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
