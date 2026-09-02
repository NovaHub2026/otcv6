# Auditor a7 — documentation, process, memory and cold start

Worktree: `/home/alejo/.otc-audit7/a7`, detached at `36bbf89` (`feat(catalogue): PH-21.1 …`). Read-only; no plants (a2 has them); nothing under the main tree or any other worktree was touched. Times below are UTC unless a `-0300` suffix is shown (git author time).

## Method

1. Read, in full: `CLAUDE.md`, `GOVERNANCE.md` (§0–§72), `PROJECT_INTRODUCTION.md` (headings, §1, §29), `PROJECT_CONTEXT.md`, `CURRENT_STATE.md`, `SESSION_HANDOFF.md`, `DOCS_INDEX.md`, `docs/phases/ROADMAP.md`, PH-19/19.1–19.5, PH-20/20.1–20.3, PH-21/21.1, `CYCLE-AUDIT-006.md`, `CYCLE-AUDIT-005.md` §1–§2, `docs/BACKLOG.md`, all twelve ADRs plus `DECISION-LOG.md`, all ten `docs/architecture/*.md`, all seven `docs/evidence/*.md`, `vitest.config.ts`, `vitest.setup.statistical.ts`, `.github/workflows/ci.yml`, `package.json`, every workspace `package.json`, `apps/api/src/main.ts`, the guardrail tests (`documentation.test.ts`, `stateConsistency.test.ts`, `traceability.test.ts` header).
2. Re-executed rather than read where the rules allowed: `gh run list`/`gh run view` for every CI run since 2026-09-01 (job-level), `gh api` for repository settings and branch protection, `gh pr list`, `gh issue list`, `git branch -a --merged/--no-merged`, `git worktree list`, `git ls-remote`, `git log -S`, `git diff 36bbf89 3a5f0a5`, `npx vitest list` for both projects (collection only, no test bodies executed), a package-lock consistency script, `find`/`grep` for every constant, test file and backticked path the documents name.
3. Did **not** run `npm run gate`, `npm run lint`, `npm test`, coverage or any statistical file, per the brief.
4. Each finding below cites file:line or a command; a reader can reproduce every one from the worktree and `gh`.

## Cold-start reconstruction (what the repository says the state is)

From the repository alone, a fresh agent would write down:

| Question                       | What the canonical documents say                                                                                                                                                 | What reality says                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What the project is            | Continuous multi-asset synthetic OTC market engine for fixed-expiration binaries; plausible, unexploitable, economically blind (`PROJECT_INTRODUCTION.md` §1–§4, `CLAUDE.md` §2) | Consistent everywhere                                                                                                                                                                                                                                                                                                |
| Current cycle                  | Cycle 7 (`CURRENT_STATE.md:17`, `SESSION_HANDOFF.md:14`)                                                                                                                         | Consistent                                                                                                                                                                                                                                                                                                           |
| Approved phases in cycle       | **2 of 3** — PH-19, PH-20 (`CURRENT_STATE.md:18`, `ROADMAP.md:494–495`)                                                                                                          | Neither approval stands under `GOVERNANCE.md` §40.1: CI red on both approval trees (a7-01). `CURRENT_STATE.md:97–98` says so itself, six lines below the table that counts them                                                                                                                                      |
| Active phase / subphase        | PH-21 ACTIVE / PH-21.1 ACTIVE (`CURRENT_STATE.md:26–29`, `PH-21.1:6`)                                                                                                            | On the main tree's branch a PH-21.3 document (ACTIVE) already exists at `aefe1ee`, with PH-21.2 never created (a7-02)                                                                                                                                                                                                |
| Last approved phase / subphase | PH-20 / PH-20.3 (`CURRENT_STATE.md:30–31`)                                                                                                                                       | As recorded                                                                                                                                                                                                                                                                                                          |
| Cycle Audit pending?           | No — 006 closed; Cycle Audit 7 after PH-21; an out-of-band full audit is in progress (`CURRENT_STATE.md:19,182–190`)                                                             | Consistent                                                                                                                                                                                                                                                                                                           |
| Blockers                       | None possible (`CURRENT_STATE.md:50–53`)                                                                                                                                         | Consistent with ADR-0008                                                                                                                                                                                                                                                                                             |
| Pending Human decisions        | None (`CURRENT_STATE.md:63–65`) — but `ROADMAP.md:565–578` still lists two "on the horizon"                                                                                      | Both were decided/built (ADR-0007, PH-12) (a7-10)                                                                                                                                                                                                                                                                    |
| Exact next legal action        | Run the out-of-band audit, fix, make CI green, then continue PH-21.1 (`CURRENT_STATE.md:182–183`)                                                                                | Clear and specific                                                                                                                                                                                                                                                                                                   |
| Branch / HEAD                  | `feature/ph-21-catalogue-at-scale`, "from `main` at the PH-20 merge" (`CURRENT_STATE.md:176`, `SESSION_HANDOFF.md:12`); **no HEAD hash in either document**                      | `main` = `origin/main` = `3a5f0a5` (PH-21.1, pushed 08:17Z); the feature branch is **local only** (`git ls-remote` shows only `main` and `feature/ph-19-close-audit-six`) and carries `36bbf89` (same tree as `3a5f0a5`, different hash, same parent — `git diff 36bbf89 3a5f0a5` is empty) plus `aefe1ee` (PH-21.3) |
| Remote sync                    | "hosted CI red — three runs" (`SESSION_HANDOFF.md:13,28`; `CURRENT_STATE.md:92–95,193`)                                                                                          | Five failed pushes to `main` since `dda0d84` plus one cancelled; the fourth failure (`3a5f0a5`) was pushed by the session that wrote "three"                                                                                                                                                                         |

### Where documents disagree or are stale (file:line)

1. `docs/phases/ROADMAP.md:7` `Last revised: 2026-08-31` — the file contains PH-20 and PH-21 sections created 2026-09-02 (`ROADMAP.md:492–541`).
2. `ROADMAP.md:23–25` "the first Cycle Audit — the project's first and most valuable **Human gate**" and `GOVERNANCE.md:571` "If no Human Gate is pending" — the Human gate was removed 2026-08-31 (ADR-0008).
3. `ROADMAP.md:565–578` "Protected Human decisions on the horizon … Neither blocks current work": at-the-money settlement (decided, ADR-0007) and fairness proofs (built, PH-12).
4. `ROADMAP.md:188–233`: the PH-9, PH-8 and PH-7 sections sit under the **Cycle 2** heading (line 141) and before the **Cycle 3** heading (line 249). `ROADMAP.md:251–256`: the Cycle 3 table has a two-column header and three-column rows (malformed Markdown — the state column renders outside the table).
5. `ROADMAP.md:543–553` "Major dependencies" diagram ends at PH-9; twelve later phases absent.
6. `ROADMAP.md:446` and `docs/phases/PH-20-the-operator-panel.md:40–41` still say a registration is "of order a minute", while `PH-20.2:81–82` says "Every 'of order a minute' in the tree was corrected to what was measured."
7. `CURRENT_STATE.md:174` "`docs/BACKLOG.md` — B-012 … B-020 **open** (Cycle Audit 5); B-001…B-011 closed": B-012–B-017 are CLOSED (`BACKLOG.md:30–35`), B-021–B-026 and B-029–B-030 exist (`BACKLOG.md:39–44,53,86`).
8. `CURRENT_STATE.md:132–136` "no such backend exists yet … choosing one is PH-15's" — PH-15.1 delivered the SQLite `CoordinatedStore` (APPROVED, `ROADMAP.md:409`); `packages/runtime/src/sqliteConcurrency.test.ts` exists. `CURRENT_STATE.md:154–156` "Nothing runs continuously … That is PH-15's whole subject" — PH-15.3 and PH-16.1 are APPROVED (`ROADMAP.md:411,438`).
9. `CURRENT_STATE.md:130–131` "Per-asset battery floors (0.562pp) sit above the 0.2513pp product margin" vs `docs/architecture/VALIDATION.md:122–123` "All forty asset/horizon cells sit below 0.2513pp". Different instruments, but a cold reader gets two opposite sentences with no cross-reference.
10. `CURRENT_STATE.md:176` "from `main` at the PH-20 merge" — `main` is now one commit past that merge (`3a5f0a5`), with the same content the branch holds.
11. `SESSION_HANDOFF.md` has no HEAD hash; `GOVERNANCE.md:1640` requires "relevant HEAD" and `DOCS_INDEX.md:24` says the document is canonical for "branch, HEAD".
12. `SESSION_HANDOFF.md:28` / `CURRENT_STATE.md:92–93` / `PH-21.1:66` "three runs" — five failures now (`gh run list`).
13. `SESSION_HANDOFF.md:77–78`, `docs/architecture/CATALOGUE_AND_PANEL.md:161–162`, `apps/api/src/registration.service.ts:21` "0.5s to 19.3s" — the newer evidence `docs/evidence/CYCLE-7-CATALOGUE-SCALE.md:25,35–37` measures 0.6 s to **20.5 s**.
14. `PROJECT_CONTEXT.md:45` "statistical gate on PR/dispatch" — `ci.yml:90–92,135–138` runs it on every push to `main` since ADR-0009.
15. `PROJECT_CONTEXT.md:39` "TypeScript 5.8" — `npx tsc -v` → 5.9.3 (range `^5.8.3`).
16. `PROJECT_CONTEXT.md:62` `apps/api` may depend on core, engine, runtime, distribution — `apps/api/package.json` also declares `@otc/chart` (dev) and `dependencies.test.ts:35` allows it. `PROJECT_CONTEXT.md:61` `@otc/sim` "every package" — its manifest omits `@otc/chart` though the guard allows it (`dependencies.test.ts:39–47`). `PROJECT_CONTEXT.md:97–102` still narrates CA4's "four rows out of four" as if current.
17. `CLAUDE.md:106–110` "~90s / ~10min / ~12min / ~13min" vs `PH-19.1:63` "a 20-minute gate" vs hosted Statistical Gate 38–45 min on every run since `2707f27` (CI table). `CLAUDE.md:110` describes the gate as "format:check + build + lint + both suites"; `package.json:32` also runs `typecheck:web` and `typecheck:config`. `CLAUDE.md:138` "Coverage measures `packages/*/src` and `tools/*/src`" — `vitest.config.ts:181` also includes `apps/*/src`.
18. `DOCS_INDEX.md:36` "Six have run" — six files on disk; correct today, but this seventh (out-of-band) record will not be a "three-phase Cycle Audit" as the row describes.
19. `DOCS_INDEX.md:37` evidence row: "including [A], [B], [C] and [D]: [E], [F], [G]" — a colon inside a list; no file is described.
20. `DOCS_INDEX.md:43` BACKLOG "used only until a GitHub remote exists" — the remote has existed and been public since 2026-08-31; `BACKLOG.md:15` restates the trigger as "Issues … not been enabled", and `gh api repos/NovaHub2026/otcv6 --jq .has_issues` → **true**.
21. `DOCS_INDEX.md:62–64` "Documents listed above are created by the phase that first makes them true. A missing architecture document means that layer does not exist yet" — `RUNTIME_AND_TRADING.md:5` and `CATALOGUE_AND_PANEL.md:6` were created by Cycle Audits 2 and 6, and the PH-13/14/15 layers have no document at all (a7-08), so the corollary is false for three approved phases.
22. `DOCS_INDEX.md:77` ADR-0008 titled "… no hosted CI", status APPROVED, no supersession marker; `DOCS_INDEX.md:35` lists SUPERSEDED as a state no ADR uses.
23. `docs/decisions/ADR-0008-full-delegation.md:126` cites `docs/DECISION-LOG.md` — no such path (`docs/decisions/DECISION-LOG.md`).
24. `docs/decisions/DECISION-LOG.md:28` "Newest first" — entries run oldest to newest (`:34…205`).
25. `GOVERNANCE.md:1110` cites "`docs/BACKLOG.md` B-008" — B-008 is in the Closed table (`BACKLOG.md:62`).
26. `docs/audits/CYCLE-AUDIT-006.md:194–195` "Findings not closed in PH-19 are carried in `docs/BACKLOG.md` with the reason" — `grep -o 'CA6-[0-9]*' docs/BACKLOG.md` returns only CA6-17; `CURRENT_STATE.md:213` "CA6-07 | Open from Cycle Audit 6" points at nothing.

## CI table (run, commit, trigger, result, duration)

Source: `gh run list --repo NovaHub2026/otcv6 --limit 30` and `gh run view <id> --json jobs`. QG = Quality Gate job, SG = Statistical Gate job. Every SG failure below failed at the step named `Statistical tests`.

| Run id      | Commit    | What                                                   | Trigger                                 | Result                                                                                                                                         | QG       | SG          | Wall clock |
| ----------- | --------- | ------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ---------- |
| 33607930939 | `3a5f0a5` | PH-21.1 pushed straight to `main`                      | push main, 2026-09-02 08:17             | **FAILURE**                                                                                                                                    | ok 1m49s | fail 44m34s | 44m39s     |
| 33601281019 | `ac4c3cf` | merge: PH-20 (APPROVED)                                | push main, 06:58                        | **FAILURE**                                                                                                                                    | ok 1m42s | fail 37m44s | 37m48s     |
| 33589821548 | `093fe28` | docs: PH-20 and PH-21 chosen                           | push main, 04:11                        | **FAILURE**                                                                                                                                    | ok 1m28s | fail 38m38s | 38m59s     |
| 33589754971 | `c736707` | fix: the meta-audit blocked its own worker             | push main, 04:10                        | **CANCELLED** at 1m10s (both jobs) — superseded by the `093fe28` push 58 s later under `concurrency.cancel-in-progress: true` (`ci.yml:96–98`) | —        | —           | 1m15s      |
| 33587082478 | `2707f27` | merge: PH-19 (APPROVED)                                | push main, 03:27                        | **FAILURE**                                                                                                                                    | ok 1m54s | fail 37m56s | 38m01s     |
| 33571388945 | `ca68b1e` | PH-19.1 commit, branch `feature/ph-19-close-audit-six` | **workflow_dispatch**, 2026-09-01 23:31 | success                                                                                                                                        | ok 1m32s | ok 25m17s   | 25m22s     |
| 33567995259 | `51eb22c` | fix: the four CA6 findings                             | push main, 22:47                        | **FAILURE**                                                                                                                                    | ok 1m10s | fail 12m18s | 12m22s     |
| 33562585323 | `dda0d84` | merge: PH-18 (APPROVED) (CA6-02)                       | push main, 21:43                        | **FAILURE**                                                                                                                                    | ok 1m23s | fail 13m26s | 13m30s     |
| 33554355975 | `673658a` | merge: PH-17                                           | push main, 20:16                        | success                                                                                                                                        | ok       | ok          | 13m45s     |
| 33542279509 | `0d443f1` | docs: PH-16 merged                                     | push main, 18:12                        | success                                                                                                                                        | ok       | ok          | 11m19s     |
| 33522166534 | `8d6d63d` | fix: the gate is reproducible again                    | push main, 14:52                        | success                                                                                                                                        | ok       | ok          | 11m46s     |
| 33513391982 | `b983727` | PH-15 gate recorded                                    | push main, 13:26                        | success                                                                                                                                        | ok       | ok          | 10m58s     |
| 33509067339 | `e54ef17` | PH-14 gate recorded                                    | push main, 12:41                        | success                                                                                                                                        | ok       | ok          | 11m40s     |
| 33473088404 | `3191947` | merge: PH-13                                           | push main, 05:18                        | success                                                                                                                                        | ok       | ok          | 11m18s     |
| 33471087489 | `ed1cf8c` | Cycle Audit 004 APPROVED                               | push main, 04:46                        | success                                                                                                                                        | ok       | ok          | 11m36s     |
| 33458939965 | `7955d95` | merge: PH-12                                           | push main, 01:29                        | success                                                                                                                                        | ok       | ok          | 8m14s      |
| 33454858895 | `8988b2f` | merge: PH-11                                           | push main, 00:28                        | success                                                                                                                                        | ok       | ok          | 8m42s      |

Three things the table shows that no document records:

- **Every push to `main` since `dda0d84` (PH-18 merge) has failed the Statistical Gate** — six pushes, five failures, one cancelled. The only green since is a manual dispatch on a feature branch.
- The Statistical Gate's wall clock jumped from ~12–13 min (through `dda0d84`) to **38–45 min** from `2707f27` on — the serial statistical run plus the browser layer. No document carries that number; `CLAUDE.md:107` still says "~10min".
- The `2707f27` result (fail, 04:05Z) arrived **39 minutes after** PH-19 was approved and merged (`8b68b13`/`2707f27` at 03:26Z). PH-19 was approved before CI had run on its tree.

Limit: `gh run view <id> --log-failed` returned zero lines for all three newest failures, so the `Timeout calling "onTaskUpdate"` text the documents quote is not independently confirmed here — only the failing step name is.

## Findings

### a7-01 — PH-19's approval claims "hosted CI green on the same tree"; it was green on a different tree, and red on the approval tree

**Severity:** critical (process — the same class as CA6-02, now on both Cycle 7 approvals)

**Where:** `docs/phases/PH-19-close-what-audit-six-falsified.md:95–98`; `CURRENT_STATE.md:18,92–98`; `docs/phases/ROADMAP.md:494–495`; `packages/core/src/guardrails/stateConsistency.test.ts:101–118`.

**Claim:** PH-19 §7: "**APPROVED** 2026-09-01, from executed evidence. `npm run gate` — **exit 0**, and **hosted CI green on the same tree**, which `GOVERNANCE.md` §40.1 requires and CA6-02 found missing from PH-18's approval."

**Evidence:**

- The only green CI run in the window is `33571388945`, a `workflow_dispatch` on `feature/ph-19-close-audit-six` at head `ca68b1e` (PH-19.1's commit, authored 20:30:46 -0300 = 23:30Z), created 23:31:17Z.
- PH-19.2–19.5's commits all post-date that run: `6ac858c` 23:42Z, `6f5a38c` 23:58Z, `b817521` 00:52Z, `c13c89f` 00:58Z, `e772597` 01:05Z, `c26dd53` 01:40Z, `f195a3c` 02:20Z, `b59ebd7` 03:26Z, `8b68b13` 03:26Z (`git log --format='%h %ci %s' main`).
- The PH-19 approval tree (`8b68b13`, merged as `2707f27`) ran on push at 03:27Z and **failed** the Statistical Gate at 04:05Z (`gh run view 33587082478`).
- PH-20 is admitted in `CURRENT_STATE.md:95–98` to have been "approved on a green local gate with that corroboration outstanding, which is CA6-02 repeated". PH-19 is not admitted anywhere; its document asserts the opposite.
- `CURRENT_STATE.md:18` counts "**2 of 3**" approved while `CURRENT_STATE.md:97–98` says "Nothing below is a phase approval under §40.1 until CI is green on the same tree." `stateConsistency.test.ts:101–118` forces the count to equal the roadmap's APPROVED rows, so the guard **requires** the contradiction to persist: the document cannot record "0 of 3 under §40.1" without failing the gate.

**Impact:** Both Cycle 7 phase approvals rest on evidence that does not satisfy `GOVERNANCE.md` §40.1 ("A green local gate is not enough for a phase approval if CI is red"). The PH-19 record says the requirement was met when it was not, which is worse than PH-18's omission (CA6-02): a reader checking the approval finds a false positive rather than a gap. Cycle 7's phase count, and therefore the timing of Cycle Audit 7, is built on it.

**Recommended fix:** In PH-19 §7 replace the sentence with the truth: "hosted CI: run 33571388945 green on `ca68b1e` (PH-19.1 only, by dispatch); run 33587082478 **red** on the approval tree `2707f27`." Add a "CI corroboration" row (run id, head SHA, result) to every phase approval, and make `documentation.test.ts` require the run id in any approval that says "CI". Decide, and record in `CURRENT_STATE.md`, whether PH-19 and PH-20 are "APPROVED (local gate; CI corroboration outstanding)" — and if so, give `stateConsistency.test.ts` a way to count that state honestly instead of forcing "2 of 3".

### a7-02 — PH-21.1, an ACTIVE subphase whose own document says verification is pending, was pushed straight to `main`; the feature branch is local-only, duplicates that commit, and already carries an out-of-order PH-21.3

**Severity:** critical (Git integrity, §36 "main represents trusted integrated project state")

**Where:** `git log main` (`3a5f0a5`, 08:17Z), `git ls-remote --heads origin`, `git log main..feature/ph-21-catalogue-at-scale`, `docs/phases/PH-21.1-a-hundred-assets.md:101–105`, `CURRENT_STATE.md:176,196–200`, `aefe1ee:docs/phases/PH-21.3-a-panel-at-scale.md`, `aefe1ee:docs/phases/ROADMAP.md:539–541`.

**Claim:** `CURRENT_STATE.md:176` "Branch `feature/ph-21-catalogue-at-scale`, from `main` at the PH-20 merge"; PH-21.1 §6 "Pending. … the gate on this tree, and the CI run that corroborates it, have not yet been executed by the session that approves this subphase."

**Evidence:**

- `origin` holds only `main` and `feature/ph-19-close-audit-six`; `feature/ph-21-catalogue-at-scale` has never been pushed.
- `main` tip `3a5f0a5` and branch commit `36bbf89` have the same parent (`ac4c3cf`), the same message, and `git diff 36bbf89 3a5f0a5` is empty — the PH-21.1 work was re-committed onto `main` and pushed, while the branch keeps its own copy. Merging the branch later reproduces the change under a second hash.
- CI on `3a5f0a5` failed (run 33607930939) — so `main` now carries an unapproved, unverified subphase whose acceptance criterion 3 (`PH-21.1:98–99`, "hosted CI is green on the same tree") is failed.
- On the branch, `aefe1ee` (05:23 -0300, six minutes after `36bbf89`) adds `PH-21.3-a-panel-at-scale.md` with `Status: ACTIVE` and marks it ACTIVE in the roadmap, while PH-21.1 is still ACTIVE and no PH-21.2 document exists. `GOVERNANCE.md` §18/§23 make a subphase ACTIVE after the previous one is approved; two ACTIVE subphases with the middle one skipped is outside the lifecycle.
- The main worktree also holds an uncommitted edit to `docs/phases/PH-21-catalogue-at-scale.md` (`git -C /home/alejo/Projects/otcv6 status`), a §53 Recovery-Mode signal for whoever starts next.

**Impact:** A fresh agent following `CURRENT_STATE.md` would check out a branch that does not exist on the remote, find `main` one commit ahead of where the document says it is, and be unable to tell whether PH-21.1 is integrated or not. `main` is red and contains work its own document calls unverified.

**Recommended fix:** Push the branch (or delete the local copy and rebase `aefe1ee` onto `3a5f0a5`), record in `CURRENT_STATE.md` that PH-21.1 is on `main` at `3a5f0a5` with CI red, and either create PH-21.2 or record in the roadmap why PH-21.3 runs before it. Do not merge more ACTIVE work to `main` until its subphase is approved.

### a7-03 — Hosted CI has failed the Statistical Gate on every push to `main` since the PH-18 merge; the documents say "three", and each of four successive fixes was recorded as the cause

**Severity:** material

**Where:** CI table above; `SESSION_HANDOFF.md:28–32`; `CURRENT_STATE.md:92–95`; `PH-21.1:66–72`; `vitest.config.ts:63–122`; `vitest.setup.statistical.ts:1–29`; commit `c736707` message; `docs/BACKLOG.md:39` (B-021).

**Claim:** "Hosted CI is red on `main` — three runs" (`SESSION_HANDOFF.md:28`).

**Evidence:** Six pushes since `dda0d84`: five Statistical Gate failures (`dda0d84`, `51eb22c`, `2707f27`, `093fe28`, `ac4c3cf`, `3a5f0a5` — the last four after PH-19) and one cancellation. The attributed cause changed four times, each recorded as settled: CA6-01/C-2 (file parallelism, `vitest.config.ts:67–83`), the console-intercept/reporter traffic (`vitest.config.ts:91–122`, commit `b59ebd7`), the meta-audit's `execFileSync` (`c736707`: "It was never machine load"), and PH-21.1's watchdog ("the failure this project knows best"). `3a5f0a5` — the first push carrying the watchdog — still failed. `CLAUDE.md:150–161` still teaches only the original yield convention.

**Impact:** `GOVERNANCE.md:1517` "The gate is deterministic and reproducible" is the premise every approval cites, and the hosted instance of the gate has not passed on `main` in five attempts with every test passing. The count in the state documents is stale by two, and the record reads as a series of closures rather than one open defect.

**Recommended fix:** Record the run ids and the count in `CURRENT_STATE.md`; consolidate the four attributions into B-021 as one open item with a table of attempts; obtain the failing job's log (it was not retrievable by `gh run view --log-failed` here — download the artifact through the Actions UI) and record the watchdog's per-file output, which is the first evidence that names a file.

### a7-04 — GitHub Issues are enabled; `docs/BACKLOG.md` says they are not, and `GOVERNANCE.md` §42's migration trigger has fired (Cycle Audit 4 recurrence)

**Severity:** material

**Where:** `docs/BACKLOG.md:14–22`; `DOCS_INDEX.md:43`; `GOVERNANCE.md:413–414,1560–1572`.

**Claim:** `BACKLOG.md:15` "GitHub Issues have still not been enabled or populated, so this file remains the single interim backlog."

**Evidence:** `gh api repos/NovaHub2026/otcv6 --jq .has_issues` → `true`; `gh issue list --state all` → empty. `GOVERNANCE.md:1572` "Do not maintain a competing giant BACKLOG.md when Issues are available." `BACKLOG.md:16–18` itself records that Cycle Audit 4 found this paragraph stale in the same way.

**Impact:** The canonical backlog per §7 is Issues; the repository's backlog lives in a 126-line file whose own migration rule has been triggered and missed for the second time.

**Recommended fix:** File B-018, B-019, B-020, B-021 (open half), B-022–B-026, B-029, B-030 and the carried CA6 items as Issues; reduce `BACKLOG.md` to a pointer; update `DOCS_INDEX.md:43` in the same commit, as `BACKLOG.md:20–22` prescribes. If the Development Agent decides Issues are not wanted, that is a decision to record and a §42 amendment to propose to the Human Owner — not a sentence to leave false.

### a7-05 — The six Cycle Audit 6 findings "not closed in PH-19" cannot be identified from the record; CA6-39 is tracked nowhere

**Severity:** material

**Where:** `docs/audits/CYCLE-AUDIT-006.md:4,194–195`; `docs/phases/PH-19-close-what-audit-six-falsified.md:59–91`; `docs/BACKLOG.md`; `CURRENT_STATE.md:209–215`.

**Claim:** CA6 §6 "Nothing here is waived. Findings not closed in PH-19 are carried in `docs/BACKLOG.md` with the reason." PH-19 §6 "Closed: 40 of the 46 findings. Each is named in the subphase document that closed it."

**Evidence:**

- `grep -oh 'CA6-[0-9]*' docs/phases/PH-19*.md | sort -u` → 17 ids (01–08, 10–14, 17, 29, 30, 45). Commit messages `51eb22c..2707f27` name 33. The union is 40 — but that union includes the three PH-19 §6 says were _not_ closed (07, 10, 17), so at most 37 closures are attributable by id.
- PH-19 §6 names as not closed: CA6-07, CA6-10, CA6-17 (partly) and **B-018** — three CA6 ids for "six".
- Never named by id after the audit: CA6-19 and CA6-35 (described without id in `PH-19.3:66–70` and `PH-19.5:83–88`), CA6-37 (annotated only inside `PH-17-assets-become-data.md:93`), CA6-44 (annotated only inside `PH-18.3-live-preview.md:44`), and **CA6-39** ("The reconciliation table in `CYCLE-6-DRIFT.md` does not reproduce") — `git log -S'CA6-39'` finds only the audit record and the approval commit; `CYCLE-6-DRIFT.md:8–14` annotates CA6-36 and CA6-38 but not CA6-39.
- `grep -o 'CA6-[0-9]*' docs/BACKLOG.md` → `CA6-17` only. CA6-07 and CA6-10 are "carried" in PH-19 §6 prose, not in the backlog. `CURRENT_STATE.md:213` lists "CA6-07 | Open from Cycle Audit 6" with no pointer.

**Impact:** "40 of 46" is not reconstructible; at least one finding has no owner, and the carried ones are in a phase document rather than the backlog the audit record points to.

**Recommended fix:** Add a closure table to `CYCLE-AUDIT-006.md` (or PH-19): 46 rows, each with closed-by (subphase/commit) or carried-as (backlog id). Give CA6-07, CA6-10 and CA6-39 backlog entries.

### a7-06 — `docs/BACKLOG.md`'s "Open" table is mostly closed items; the state document's summary of it is two audits stale; B-020 should be closed; B-027/B-028 never existed

**Severity:** material

**Where:** `docs/BACKLOG.md:26–44,53,86`; `CURRENT_STATE.md:174`; `docs/audits/CYCLE-AUDIT-006.md:8,17–18`.

**Evidence:**

- Under "## Open" (`BACKLOG.md:26`): B-012, B-013, B-014, B-015, B-016, B-017 are marked **CLOSED**, B-018 **DEFERRED**, B-021 **PARTLY CLOSED** — 8 of the 15 rows. A reader counting open items from the heading is wrong by half.
- (a) Spot-check of eight CLOSED notes against code: B-011 gate order → `package.json:32` builds before lint ✓; B-005/B-021 (unit timeout 20 s) → `vitest.config.ts:58` `20_000` ✓; B-013 (follower cannot generate) → `packages/runtime/src/follower.ts:12–22` imports only `@otc/core`, `singleWriter.test.ts` exists ✓; B-016 (`EntryResolver` threaded) → `limiter.test.ts` exists and PH-19.2 §5 closed the remaining gap ✓; B-003 (`tools/*` in coverage) → `vitest.config.ts:181` ✓; B-009 (signed commitments) → `packages/distribution/src/commitment.ts` ✓; B-002 (forty cells) → `PH-11-HORIZON-COVERAGE.md:168` ✓; B-017 (retention reaches back) → not verified (constant values not read; see Limits).
- (b) Open entries: **B-018** accurately described (guardrail blind spots; `PH-19:91` confirms unchanged). **B-019** — no document since Cycle Audit 5 mentions it (`grep B-019 docs/phases/PH-1[6-9]*.md docs/phases/PH-20*.md docs/audits/CYCLE-AUDIT-006.md` → nothing); still open, not re-verified by me. **B-020** — CA6 §1 says the one-worktree rule was adopted and held ("no auditor reported interference"); the entry has no closing note. **B-021** — accurate; the open half is what a7-03 measures. **B-022** — see a7-14. **B-023** — see a7-08. **B-024** — still accurate: `ADR-0008:1` title "no hosted CI", `:4` APPROVED, `:9` `Supersedes: —`, `:123–127` "Not taken here"; no "Superseded by". **B-025** — still accurate: `GOVERNANCE.md:1499–1500` "format, lint, build". **B-026** — still accurate: `grep -ci 'plant\|watched failing'` → 0 in all three PH-13.x documents.
- (c) See a7-05.
- (d) `git log --all -S'B-027' -- docs/BACKLOG.md` and `-S'B-028'` return nothing; no file in the tree mentions either. The ids were skipped, not lost.
- (e) `BACKLOG.md:20–22` migration rule is stated; its stated reason ("not been enabled") is false — a7-04.
- B-029 and B-030 are `##` sections (`BACKLOG.md:53,86`), not rows, so any tooling or reader that counts the table misses them.

**Recommended fix:** Move CLOSED rows to the Closed table; retitle the tables; close B-020 with the CA6 sentence as its note; renumber nothing but add a one-line note that B-027/B-028 were never assigned; fold B-029/B-030 into the table with the detail below it; fix `CURRENT_STATE.md:174`.

### a7-07 — `CLAUDE.md` and `OVERVIEW.md` tell an agent to run the statistical suite with the bare command that Cycle Audit 6 found runs files in parallel

**Severity:** material

**Where:** `CLAUDE.md:107,261`; `docs/architecture/OVERVIEW.md:106`; `package.json:26`; `.github/workflows/ci.yml:178–184`; `vitest.config.ts:67–89`.

**Claim:** `CLAUDE.md:107` `npx vitest run --project statistical   # slow statistical suite (~10min)`; `CLAUDE.md:261` "npx vitest run --project statistical # includes the full battery".

**Evidence:** `ci.yml:178–181`: "`npm run test:stat`, not a bare vitest invocation. The script carries `--no-file-parallelism`, and Cycle Audit 6 (CA6-01) found that the setting could not live in the config: Vitest 3 drops it inside a project block." `grep fileParallelism vitest.config.ts` finds only the comment; the flag lives only in `package.json:25–26`. The bare command therefore runs the statistical files concurrently — the exact oversubscription CA6-01 diagnosed as the source of `onTaskUpdate` failures and of every invalid wall-clock assertion.

**Impact:** The operational entrypoint recommends the configuration the project's own headline audit finding removed. An agent following it reproduces CA6-01 locally and attributes the result to something else.

**Recommended fix:** Replace both `CLAUDE.md` lines and the `OVERVIEW.md` table cell with `npm run test:stat`, and add a sentence saying why the flag cannot live in the config.

### a7-08 — B-023 is still true: the leader lease, followers, failover, the durable store, rotation, retention, ruin, exposure limits and the standing verdict appear in no architecture document, and `DOCS_INDEX.md` says a missing document means the layer does not exist

**Severity:** material

**Where:** `docs/BACKLOG.md:41` (B-023); `DOCS_INDEX.md:62–64`; `docs/architecture/*.md`; `CYCLE-AUDIT-006.md:144` (CA6-43).

**Evidence:** `grep -il` over `docs/architecture/*.md`: `follower` 0 files, `failover` 0, `retention` 0, `ruin` 0, `standing` 0; `rotation` only `ENTROPY.md` (keystream `keyEpoch`, not the PH-15.2 publishing-key rotation); `lease` hits are the keystream cursor lease, not PH-14.1's leader lease; `limiter` only as a word in `PUBLICATION.md`. ADR-0012 (single writer) is the only durable description of the multi-node design and it is a decision record, not the "current architecture" `GOVERNANCE.md:398–399` names. CA6-43 added `CATALOGUE_AND_PANEL.md` for Cycle 6 only.

**Impact:** For three approved phases (PH-13, PH-14, PH-15) plus PH-16's fixes, the canonical architecture says nothing, and the index's rule tells a cold reader they do not exist. B-023 has now survived two cycles and two audits that named it.

**Recommended fix:** One document, `docs/architecture/MULTI_NODE_AND_OPERATIONS.md` (lease, follower, seam marker, `CoordinatedStore` + SQLite, rotation, retention, limiter, standing verdict), each section pointing at its test. Close B-023 with it.

### a7-09 — `CURRENT_STATE.md`'s "Known limitations" carries Cycle-5-era statements as current

**Severity:** material (cold start)

**Where:** `CURRENT_STATE.md:118–156`.

**Evidence:** Items 8 and 9 in the cold-start list above: lines 132–136 say no store backend exists and "choosing one is PH-15's"; lines 154–156 say "Nothing runs continuously … That is PH-15's whole subject". PH-15.1, PH-15.3 and PH-16.1 are APPROVED (`ROADMAP.md:409,411,438`). Lines 130–131 contradict `VALIDATION.md:122–123` without a cross-reference.

**Impact:** A fresh agent is told two capabilities the venue has are still missing, in the one document `GOVERNANCE.md` §45 makes authoritative for "current objective" and "blockers".

**Recommended fix:** Rewrite the section from the PH-16–PH-20 approvals; state the battery-floor sentence as "per-asset _battery_ floors are 0.562pp; horizon coverage is policed separately below 0.2513pp (PH-11)".

### a7-10 — `docs/phases/ROADMAP.md` is stale in its header, its structure and its "pending Human decisions"

**Severity:** material (cold start)

**Where:** `ROADMAP.md:7,23–25,141–256,446,543–553,565–578`.

**Evidence:** Items 1–6 in the cold-start list. In particular `:565–578` tells a fresh agent two protected decisions are outstanding when one was decided on 2026-08-31 (ADR-0007) and the other was built in PH-12; `:188–233` files PH-7/8/9 under Cycle 2; `:251–256` is a malformed table; `:446` contradicts `PH-20.2:81–82`. `documentation.test.ts` checks only that identifiers and statuses appear, so none of this fails the gate.

**Recommended fix:** Set `Last revised`, delete the "Human gate" phrase, replace §"Protected Human decisions on the horizon" with pointers to ADR-0007 and PH-12, move the three sections under Cycle 3, fix the table, extend the dependency diagram to PH-21, correct `:446`.

### a7-11 — Three of PH-19's five subphases record no planted-defect evidence, while the phase document asserts one for each; no subphase records its own executed verification

**Severity:** material (B-026 class recurring inside the phase that closed a B-026-class audit)

**Where:** `PH-19:70–72`; `PH-19.3`, `PH-19.4`, `PH-19.5` (whole documents); `PH-19.1:97–100`, `PH-19.2:89–92`, `PH-19.3:77–80`, `PH-19.4:87–90`, `PH-19.5:90–93`; `GOVERNANCE.md:899–947` (§21–§22).

**Evidence:** `grep -ci 'plant\|watched failing'` → `PH-19.3` 0, `PH-19.4` 0, `PH-19.5` 0 (and `PH-21.1` 0, still ACTIVE). PH-19 §6: "Each is named in the subphase document that closed it, with the measurement that found it **and the plant that watched the fix fail**." Every PH-19.x approval reads "See the phase gate recorded in PH-19" — no targeted gate, exit code, test count or timestamp of its own, which §21 ("Only actually executed checks may be reported as passed") and §22 ("required targeted verification executed") require at subphase level. PH-19's own gate table (`PH-19:100–107`) records `npm test` exit 0 with no counts, no date-time and no run id.

**Recommended fix:** Add plant tables to PH-19.3/19.4/19.5 from the commits that carried them, or state that no plants were run and why. Make each subphase approval carry its own executed command and exit code.

### a7-12 — The timings and the gate description in `CLAUDE.md` §5 no longer describe the gate

**Severity:** material (an agent budgets by them)

**Where:** `CLAUDE.md:106–117,138`; `PH-19.1:63`; `package.json:32`; `vitest.config.ts:181`; CI table.

**Evidence:** Item 17 in the cold-start list. Hosted Statistical Gate: 38–45 min on every run since `2707f27`; local: "20-minute gate" per PH-19.1. `CLAUDE.md:114–115` "takes roughly thirteen minutes — it has not hung" is the sentence an agent uses to decide whether a run is stuck.

**Recommended fix:** Re-time locally once, record "unit ≈ N min, statistical ≈ M min serial, gate ≈ K min; hosted ≈ 40 min", list all seven gate steps, and add `apps/*/src` to the coverage sentence.

### a7-13 — `PROJECT_CONTEXT.md` §3 and §4 are stale against the guardrail they call canonical

**Severity:** material (the file says "the guardrail is canonical; where they disagree this file is stale")

**Where:** `PROJECT_CONTEXT.md:39,43–45,61–62,95–102`; `packages/core/src/guardrails/dependencies.test.ts:34–47`; workspace manifests.

**Evidence:** Items 14–16 in the cold-start list. Row by row against manifests: core ✓, engine ✓, fixtures ✓, lab ✓ (`@otc/fixtures` is a devDependency — the table does not distinguish), runtime ✓, trading ✓, distribution ✓, chart ✓, **sim ✗** ("every package" — manifest declares 7 of 8, no `@otc/chart`), **api ✗** (manifest and guard include `@otc/chart`), web ✓. Two rows of eleven, plus the CI row and the TypeScript version, plus a note (`:97–102`) written in Cycle Audit 4's present tense.

**Recommended fix:** Replace §4's "May depend on" column with a pointer to `ALLOWED` in `dependencies.test.ts`; fix the CI row; drop the minor version from the TypeScript cell.

### a7-14 — B-022 ("`npm run test:cov` exits 1") and PH-19's closure of CA6-09 contradict each other, and no coverage measurement has been recorded since 2026-08-31

**Severity:** material

**Where:** `docs/BACKLOG.md:40` (B-022); `CYCLE-AUDIT-006.md:90` (CA6-09); `PH-19.1:89–95`; `docs/evidence/PH-11-COVERAGE.md:5`; commits `51eb22c..2707f27` (CA6-09 named only there).

**Evidence:** CA6-09 is not named in any PH-19 document (`grep CA6-09 docs/phases/PH-19*.md` → nothing); it is named in a commit message and therefore counted among the "40 closed". B-022 remains an open row with the same content. PH-19.1 §5 "`apps/*` is measured now" is a statement about `vitest.config.ts:181`, not about a run: the newest coverage evidence on disk is dated 2026-08-31 and covers `packages` and `tools` only. I did not run `test:cov` (rule).

**Recommended fix:** Run `npm run test:cov` once, record exit code and the table in a new `docs/evidence/CYCLE-7-COVERAGE.md`, and close or re-open B-022 and CA6-09 together on that evidence.

### a7-15 — ADR-0008 is unannotated (B-024), cites a path that does not exist, and the decision log's own ordering rule is not followed

**Severity:** material (durable decisions are the one place §5.2 promises a reader can find the truth)

**Where:** `docs/decisions/ADR-0008-full-delegation.md:1,4,9,53–54,123–127`; `docs/decisions/ADR-0009-hosted-ci-reinstated.md:8`; `DOCS_INDEX.md:77`; `docs/decisions/DECISION-LOG.md:28,34–224`.

**Evidence:** ADR-0008: title "… no hosted CI", `Status: APPROVED`, `Supersedes: —`, Decision 3 "Hosted CI is out of the verification model", Alternatives "Make the repository public … Not taken here" — all still live text, while ADR-0009 `:8` declares "Supersedes: the hosted-CI half of ADR-0008". `ADR-0008:126` "recorded in `docs/DECISION-LOG.md`" — `ls docs/DECISION-LOG.md` → no such file. `DOCS_INDEX.md:77` shows APPROVED. `DECISION-LOG.md:28` "Newest first" — entries run 2026-08-31 … 2026-09-02 (`:34,55,76,96,126,143,162,183,205`); the 2026-09-02 entry lacks the `---` separator and the "Decided / Alternative / Revisit when" template every other entry uses. All other ADR statuses and DOCS_INDEX cells agree (all APPROVED). ADR-0010's 15 s matches `hosted.ts:73`; ADR-0012's single writer matches `follower.ts:12–22`; the 2026-09-02 retire entry matches `registry.ts:59,63`, `venue.service.ts:202,248`, `market.controller.ts:228` (409). The 2026-08-31 "Hosted CI is not replaced" entry carries a "Revisited 2026-09-01" note — the right pattern, applied once.

**Recommended fix:** Add `Status: APPROVED — hosted-CI half SUPERSEDED by ADR-0009 (2026-08-31)` and a one-line note under Decision 3 and under the Alternatives paragraph; fix the path; set DOCS_INDEX's cell; reverse the log or change the rule; give the retire entry the template.

### a7-16 — `GOVERNANCE.md` internal contradictions and stale statements (for the Human Owner, who alone may amend it — §5.1)

**Severity:** material (the document is cited as the premise of every approval)

**Where / claim / evidence:**

| #   | Where                                  | Text                                                                                       | Why it is wrong now                                                                                                                                                                                                                                                   |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `:618–619` §12                         | "IF THREE PHASES COMPLETED: STOP AT CYCLE AUDIT GATE"                                      | §28 (`:1073–1090`, ADR-0008): the audit is automatic; there is no gate                                                                                                                                                                                                |
| 2   | `:571` §11                             | "If no Human Gate is pending, START resumes autonomous work"                               | No Human gate exists (ADR-0008)                                                                                                                                                                                                                                       |
| 3   | `:1110` §28.1                          | "(`docs/BACKLOG.md` B-008)"                                                                | B-008 is closed (`BACKLOG.md:62`); ADR-0011 is the durable record                                                                                                                                                                                                     |
| 4   | `:1251` §31, `:1306` §32               | "During an **authorized** Cycle Audit"; "No **second** Human authorization is required"    | Audits are neither authorized nor first-authorized                                                                                                                                                                                                                    |
| 5   | `:1499–1501` §40                       | "`npm run gate` — format, lint, build, and both test suites"                               | B-025: the gate is format → build → typecheck:web → typecheck:config → lint → unit → statistical (`package.json:32`); §40.0 six lines above records the reorder                                                                                                       |
| 6   | `:1517` §40.1                          | "The gate is deterministic and reproducible"                                               | B-021 (open half) and five consecutive red hosted runs with all tests passing (a7-03)                                                                                                                                                                                 |
| 7   | `:413–414` §7, `:1572` §42             | Issues canonical; "Do not maintain a competing giant BACKLOG.md when Issues are available" | Issues are enabled (a7-04) and the file is the backlog                                                                                                                                                                                                                |
| 8   | `:1426–1462` §38–§39                   | PR-based integration; default squash merge                                                 | `gh pr list --state all` → none, ever; every phase is a true merge commit with subphase history (`ac4c3cf`, `2707f27`, `dda0d84`, `673658a`, `adbf4d8` all have two parents); no justification recorded; `gh api …/branches/main/protection` → "Branch not protected" |
| 9   | `:1640` §46                            | SESSION_HANDOFF "should include … relevant HEAD"                                           | It never has (a7-18)                                                                                                                                                                                                                                                  |
| 10  | `:1994–2026` §60                       | The operating script names the actor "CLAUDE:"                                             | §56 (`:1880–1888`) requires provider independence; the script hard-codes a provider                                                                                                                                                                                   |
| 11  | `:244–259` §4.2 and `:1092–1112` §28.1 | The 31-vs-1 measurement stated twice                                                       | §7 (`:425–427`) "One concept should have one canonical living source. Unnecessary duplication is prohibited" — also in CLAUDE.md §7, ADR-0008, ADR-0011, DECISION-LOG, ROADMAP, BACKLOG B-008, CA5 §1 (a7-23)                                                         |
| 12  | `:1624–1626` §45                       | CURRENT_STATE should list "relevant Issues; relevant Pull Requests"                        | Neither exists to list                                                                                                                                                                                                                                                |
| 13  | `:16–20` §0                            | Three amendment rows                                                                       | Which sentences of §4, §5, §28, §29, §40, §58, §59 are Human-authored and which are the agent's implementation of them is not recorded; a reader cannot tell the amendment from its paraphrase                                                                        |

**Recommended fix (for the Human Owner):** one amendment commit that (1) replaces §12's last line with "RUN THE CYCLE AUDIT (§28)", (2) fixes §11/§31/§32 wording, (3) rewrites §40's sentence to name the seven steps or point at `package.json`, (4) qualifies §40.1's "deterministic" with "seeded; wall-clock behaviour on a shared runner is not, see B-021", (5) either enables the Issues migration or amends §42, (6) either adopts PRs with branch protection or amends §38–§39 to describe the merge-commit practice, (7) removes one of the two 31-vs-1 passages, (8) replaces "CLAUDE:" with "AGENT:", (9) records in §0 which text is amendment and which is implementation.

### a7-17 — No Pull Request has ever existed; `DOCS_INDEX.md` and §7 name "Git + Pull Requests" as canonical for integration history

**Severity:** minor (process/record mismatch; folded into a7-16 #8 for the Governance half)

**Where:** `DOCS_INDEX.md:44`; `GOVERNANCE.md:416–417`; `gh pr list --repo NovaHub2026/otcv6 --state all --limit 20` → empty.

**Recommended fix:** Change the row to "Git history (merge commits); no PRs are used" — or start using PRs, which would also give CI a place to run _before_ merge instead of after.

### a7-18 — `SESSION_HANDOFF.md` carries no HEAD, and `DOCS_INDEX.md` says it is canonical for one

**Severity:** minor

**Where:** `SESSION_HANDOFF.md:9–18`; `DOCS_INDEX.md:24`; `GOVERNANCE.md:1640`.

**Evidence:** The table has Branch and Remote rows and no commit hash; "Last executed verification" (`:88`) names "the PH-20 tree" without a SHA. With `main` and the branch diverged on identical content (a7-02), the hash is the only thing that disambiguates.

**Recommended fix:** Add `| HEAD | 36bbf89 |` and a SHA to the verification paragraph; make `documentation.test.ts` require a 7–40-hex token in the handoff table.

### a7-19 — `DOCS_INDEX.md` prose defects

**Severity:** minor

**Where:** `DOCS_INDEX.md:36,37,43,62–64,77`.

**Evidence:** Items 18–22 in the cold-start list. `docs/BACKLOG.md` _is_ classified (`:43`, SUPPORTING via the table); the row's text is what is stale.

**Recommended fix:** Split the evidence row into one line per file with a five-word description; reword `:62–64` to "created by the phase — or the audit — that first makes them true; a layer with no document is a documentation defect, see B-023"; fix `:43` and `:77`.

### a7-20 — Git housekeeping: merged branches not deleted, a stale remote branch, six worktrees from a closed audit, no tags

**Severity:** minor

**Evidence:** `git branch -a --merged main` → `feature/ph-17-assets-as-data`, `feature/ph-18-admin-preview`, `feature/ph-19-close-audit-six`, `feature/ph-20-trusted-panel`, `remotes/origin/feature/ph-19-close-audit-six`. `git worktree list` → `/home/alejo/.otc-audit6/a1…a6` at `dda0d84`, all still registered. `git tag` → none (no phase or audit has ever been tagged, so "the PH-20 tree" is not addressable by name). `git ls-files | grep -E 'tsbuildinfo|\.next|coverage|dist/|artifacts/'` → only `docs/phases/PH-11.3-coverage-and-integration.md` (a filename match) — **no generated artefact is tracked**, and `.gitignore:53–66` covers all five patterns. `package-lock.json` (v3) carries every manifest range for the root and all eleven workspaces (script in Method). Commit subjects: 40 of the last 40 carry a type prefix (`feat`, `fix`, `docs`, `chore`, `test`, `merge`); `merge:` is not a Conventional Commits type but is used consistently.

**Recommended fix:** `git branch -d` the four, `git push origin --delete feature/ph-19-close-audit-six`, `git worktree remove` the six audit-6 trees (after confirming a2's plants are not there), tag each phase approval (`ph-20`, `ph-19`) and each audit.

### a7-21 — `@types/node` 22 against Node 24; public repository with `license: UNLICENSED`

**Severity:** minor (the second is a Human Owner decision, not a fix)

**Evidence:** `package.json:9` `"node": ">=24.0.0"`, `.nvmrc` `24`, `ci.yml:108,155` `node-version-file: .nvmrc` — consistent. `package.json:36` `"@types/node": "^22.15.3"`, installed 22.20.1 (`node -e "require('@types/node/package.json').version"`), runtime `v24.19.0`: the type surface is one major behind the engine the project requires. `package.json:7` `"license": "UNLICENSED"`; `gh api repos/NovaHub2026/otcv6 --jq .license` → `null`; `.visibility` → `public`. A public repository with no licence grants readers no rights; whether that is intended is a commitment about positioning (`GOVERNANCE.md` §5.1) — for the Human Owner.

**Recommended fix:** Bump to `@types/node@^24` in an ordinary commit; ask the Human Owner whether "all rights reserved, public source" is the intent and record the answer in the decision log.

### a7-22 — Numbers quoted without a runner, and one measurement already superseded by its successor

**Severity:** minor (CA6-36/37 class)

**Where:** `PH-19.4:15–16,27–28,46–49,68–73`; `PH-19.5:71–73`; `PH-20.2:67–78`; `packages/engine/src/differentiation.ts:94–98`; `apps/api/src/registration.service.ts:21`; `docs/evidence/CYCLE-7-CATALOGUE-SCALE.md:25–38`.

**Evidence:** PH-19.4's "3.64% of briefs", "36%", "0 in 500 / 0 in 960", "26 of 120 seed triples", "forty independent 96-asset catalogues 0.0157–0.0245" — `grep -rn '960\|forty\|0\.0157\|26 of 120' packages tools` finds the forty-catalogue numbers only as a **docstring** in `differentiation.ts:94–98`; no runner in `tools/sim/src` produces any of them. PH-19.5's 20.5 MB / 1,496 ms / 1.86 GB / 5,070 rows are the auditor's measurements with no runner (the bound itself, `MAX_CANDLES_PER_REQUEST = 20_000`, `market.controller.ts:481`, is real). PH-20.2's eight-archetype timing table has no runner file; it lives as a docstring in `registration.service.ts:21`, and the runner that _does_ exist (`tools/sim/src/catalogueScale.ts`) already reports a different band — 0.6 s to 20.5 s — while three documents still say "0.5s to 19.3s". `CONSISTENCY_CONTRACT.md:53` "334 ms" vs `catalogue.ts:217` `332.957 ms` after PH-19.3's re-measurement (rounding drift, harmless).

**Recommended fix:** Either name the runner (with seed) beside each number or mark the number "measured once, not reproducible"; replace "0.5s to 19.3s" with a pointer to `CYCLE-7-CATALOGUE-SCALE.md`.

### a7-23 — Knowledge stated in three or more places (§7 "one canonical living source")

**Severity:** minor individually; material in aggregate (each copy has drifted at least once in this audit)

| Knowledge                                                                     | Copies found                                                                                                                                                                                                                                   | Recommended canonical source                                              | Copies to become pointers                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace/package table                                                       | `CLAUDE.md:65–91`, `PROJECT_CONTEXT.md:51–63`, `OVERVIEW.md:12–44`, `RUNTIME_AND_TRADING.md:20–28`                                                                                                                                             | `dependencies.test.ts` `ALLOWED` (executable) with `OVERVIEW.md` as prose | `PROJECT_CONTEXT.md` §4 (already stale twice); `RUNTIME_AND_TRADING.md` layers block. `CLAUDE.md` §4 may stay because `documentation.test.ts:211–250` checks it against disk |
| The ten invariants                                                            | `PROJECT_INTRODUCTION.md:720–762`, `CLAUDE.md:45–56`, `INVARIANTS.md:37–48`, partial in `PROJECT_CONTEXT.md:72–81` and `OVERVIEW.md:75–81`                                                                                                     | `PROJECT_INTRODUCTION.md` §29                                             | `CLAUDE.md` §3 is read by `traceability.test.ts:44` — repoint the test at §29 and make CLAUDE.md a pointer                                                                   |
| Build-before-lint / "46 unresolved types" / "every GATE_EXIT=0 through PH-10" | `CLAUDE.md:119–124`, `CURRENT_STATE.md:85–88`, `SESSION_HANDOFF.md:94–95`, `GOVERNANCE.md:1480–1497`, `ADR-0009:47–76`, `DECISION-LOG.md:34–51`, `ci.yml:113–118`, `BACKLOG.md` B-011                                                          | ADR-0009                                                                  | All others one sentence + link (GOVERNANCE's copy needs the Human Owner)                                                                                                     |
| `Timeout calling "onTaskUpdate"`                                              | `CLAUDE.md:156–161`, `CURRENT_STATE.md:92–95`, `SESSION_HANDOFF.md:28–32,135–136`, `PH-19.1:50–53`, `PH-21.1:66–79`, `BACKLOG.md` B-005/B-010/B-021, `vitest.config.ts:63–122`, `vitest.setup.statistical.ts:1–29`, `CYCLE-AUDIT-006.md:36–49` | `BACKLOG.md` B-021 (the open item) + the two config files (the mechanism) | State documents keep one line ("CI red, see B-021"); CLAUDE.md keeps the convention only                                                                                     |
| "0.5s to 19.3s"                                                               | `SESSION_HANDOFF.md:77`, `PH-20.2:78`, `CATALOGUE_AND_PANEL.md:161–162`, `registration.service.ts:21`                                                                                                                                          | `docs/evidence/CYCLE-7-CATALOGUE-SCALE.md` (already newer)                | All four                                                                                                                                                                     |
| The 31-vs-1 audit-method measurement                                          | `GOVERNANCE.md:249–254` and `:1096–1099`, `CLAUDE.md:211–216`, `ADR-0008:75–80`, `ADR-0011:19–32`, `DECISION-LOG.md:132–136`, `ROADMAP.md:285–289`, `BACKLOG.md` B-008, `CYCLE-AUDIT-005.md:31–35,59–64`                                       | ADR-0011                                                                  | GOVERNANCE keeps one (§4.2); the rest link                                                                                                                                   |
| Asset-id regex `^[a-z0-9][a-z0-9._-]{0,63}$`                                  | code: `registration.ts:147`, `instrument.ts:47`, `label.ts:30`, `commitment.ts:127`; docs: `ENTROPY.md:37`, `PUBLICATION.md:67`, `PH-20.3:44`                                                                                                  | one exported constant in `@otc/core`                                      | the three other code copies (a drift here would silently split the id space between publication and generation)                                                              |

### a7-24 — `concurrency.cancel-in-progress` on `main` cancelled the CI run of a fix commit; the fix has no CI result at all

**Severity:** minor

**Where:** `.github/workflows/ci.yml:96–98`; run 33589754971 (`c736707`, cancelled at 1m10s by the `093fe28` docs push 58 s later).

**Evidence:** CI table. `GOVERNANCE.md:1508` "Never report CI as passing if it did not run": `c736707` ("that was the gate failure") never ran; the docs push that cancelled it then failed. The commit message's claim is untested on a hosted runner.

**Recommended fix:** Set `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` so pushes to `main` queue instead of cancelling, or push docs with `[skip ci]`.

## What survived

Attacked or re-executed and held:

- **Every constant the documents quote that I checked matches code:** `DISPERSION_FIT_TURNOVERS = 16` (`dispersion.ts:85`), `MINIMUM_TRAIT_DISTANCE = 0.01` (`differentiation.ts:104`), `DEFAULT_MAX_CATCH_UP_MS = 15_000` (`hosted.ts:73`), `DEFAULT_LEASE_TERM_MS = 15_000` (`lease.ts:25`) with the equality **asserted** at `lease.test.ts:28` as the decision log claims, `CALIBRATION_REPLICATES = 3` (`asset.ts:189`), `AUTHORING_ATTEMPTS = 6` (`brief.ts:25`), unit timeout `20_000` / `60_000` under coverage (`vitest.config.ts:58`), watchdog 250 ms / 2 s / 60 s (`vitest.setup.statistical.ts:32,35,49`), `DEFAULT_CHECKPOINT_INTERVAL_MS = 5_000`, `PAYOUT_TYPICAL = 0.85` / `PAYOUT_PROMOTIONAL = 0.99` (thresholds 4.05pp / 0.2513pp by arithmetic), `MAX_CANDLES_PER_REQUEST = 20_000`, `PORT` default 3000 and CORS wildcard = GET/HEAD only (`main.ts:39–44,52`), eight archetypes (`families.ts:317–463`), 131,759 = 129,599 + 2,160 (`CYCLE-6-BACKFILL-SCALE.md:29–33`), checkpoint = `(snapshot, pending, lastPublished)` (`state.ts:40–42`), HKDF salt `otc-engine/entropy/v1` (`keyring.ts:13`).
- **Every test file `INVARIANTS.md`, `PUBLICATION.md`, `RUNTIME_AND_TRADING.md`, `CATALOGUE_AND_PANEL.md` and the PH-19/20 documents name exists** (29 names checked with `find`), and the specific assertions claimed are present: `AMBIENT_TIME_ALLOWLIST = ['packages/core/src/time/clock.ts']` (`guardrails.test.ts:113`); `apps/api/src` in the scan roots (`:80`); `globalThis`/`process.env` rules (`:173–174`); `.tsx/.mts/.cts` in `dependencies.test.ts:121`; `@otc/web` policy exactly core+chart (`:38`); `publishingKey.test.ts` scans `publication.service.ts`, bans `hkdf`/`chacha`, and requires the literal refusal `equal to OTC_MASTER_SECRET` (`:43,56–58,77`); `catalogue.test.ts:199,207–208` pins amplitude to 15 decimals and kurtosis to 0.94–1.06; 78 files carry an `// Invariant evidence:` tag and every INV-001…010 has at least one (INV-005 exactly one).
- **The 2026-09-02 retire decision matches code:** `AssetOverlay.retiredAt` and the closed `OVERLAY_FIELDS` (`registry.ts:59,63`), overlays applied before `start()` (`main.ts:49`), `VenueService.retire` (`venue.service.ts:248`), 409 on a second retire (`market.controller.ts:228`).
- **ADR-0012 vs `follower.ts`:** the follower imports only `@otc/core` and `./replication.js` (`follower.ts:1–7`), as the ADR and the decision log say.
- **Phase-document statuses agree with the roadmap** for every PH-19/20/21 document (and `documentation.test.ts` enforces it); every backticked path in those documents resolves to a real file or is explicitly described as absent; no CA6-40-class phantom file.
- **Test counts are consistent across trees:** `vitest list` at `36bbf89` collects 1,870 unit tests in 86 files and 241 statistical tests in 37 files (6 in `panel.stat.test.ts`, 4 in `registration.stat.test.ts`), one commit after PH-20's "1,866 / 86; 238 / 36".
- **`main` = `origin/main`** (`rev-list --left-right --count` → `0 0`); no generated artefact tracked; lockfile complete; `.nvmrc`/`engines`/CI agree on Node 24; 40/40 commit subjects prefixed.
- The cancelled run has a mechanical explanation (concurrency group), not a hidden failure.
- `CURRENT_STATE.md` does name the exact next legal action, specifically and truthfully, including the fact that the two approvals do not stand under §40.1 — the honesty is there; the arithmetic above it is what contradicts it.

## Limits of this audit

- **Read-only, no plants** (a2's instrument). Nothing here tests whether a guard fails when attacked; it tests whether the documents describe what exists.
- **CI logs were not retrievable**: `gh run view <id> --log-failed` returned zero lines for runs 33607930939, 33601281019 and 33587082478, so the failing step is confirmed (`Statistical tests`) but the `onTaskUpdate` text and the watchdog's per-file output are not. The CI table is otherwise from the API, not from documents.
- **Not executed, by rule:** `npm run gate`, `npm run lint`, `npm test`, `npm run test:cov`, any statistical file. So a7-14's "no coverage evidence since 2026-08-31" is a statement about the record, not a measurement; the "~90s" unit timing was not re-timed; test counts come from `vitest list` (collection), not from a run.
- **Not verified:** the retention constants behind B-017's "15 minutes" (`DEFAULT_RETENTION` in `packages/distribution/src/retention.ts:67` was located, its values not read); `MARKET_MODEL.md:52` "4–18 components" against the personality bounds (the cascade itself accepts `[1, 24]`, `cascade.ts:64–66`); "twelve traits"; B-019's SQLite store defects (no document has touched it since Cycle Audit 5, and neither did I).
- `npm ls` is unusable in this worktree because `node_modules` is a symlink to the main tree (every workspace reads as "invalid"); lockfile consistency was checked by script instead.
- The worktree is pinned at `36bbf89`; `main` moved to `3a5f0a5` (identical content) and the branch to `aefe1ee` during the audit. Findings about `aefe1ee` were read with `git show`, not from a checkout.
- The session was interrupted twice (harness restart, then a rate limit). Everything in this report was re-read from persisted tool output or re-executed after the restarts; nothing is reconstructed from memory.
- Seven auditors share the machine; timings I might have measured would have been contended, which is why none were.
