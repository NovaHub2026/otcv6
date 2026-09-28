# Release 3.0.1 — What a broker receives, and a failure that can name itself

Type: EVIDENCE (the release record)
Recorded: 2026-09-28
Tag: `v3.0.1` — the commit that adds this record, on top of `ff80354`
Supersedes: [`RELEASE-3.0.0.md`](RELEASE-3.0.0.md) **for packaging only**; everything
substantive about this release is in that record and still stands
API contract: **3.8.0** (`77e60212e2388b93`) — unchanged
Package: `tools/sim/scripts/integration-package.sh v3.0.1 <dir>`

---

## 1. Why a patch release exists at all

**No engine code changed.** `git diff v3.0.0..v3.0.1` touches the packaging script,
the broker's guide, one npm script, one reporter, one guard and the records. The
contract, the catalogue, the settlement kernel and the runtime are byte-identical, so
this release cannot move a price, a refund or a seam.

Two things in `v3.0.0` were worth a tag rather than a note.

**The package did not include its own release notes.** The packaging script keeps
every `docs/evidence` record that a delivered document cites, and `INTEGRATION.md`
cites `RELEASE-2.4.0`, which cites `RELEASE-2.3.1`, and so on down the chain. The
result: a broker opening the `v3.0.0` package found the notes for 2.4.0 and every
release before it, and **nothing for the release in their hands** — including the
section listing the six things they see on upgrade. The record for the packaged tag
is now a root of the citation closure, so it ships and so does everything it cites
(20 records where there were 17), the guide points a reader at it, and packaging a
version tag with no release record is refused by name.

That fix was wrong on the first attempt in a way worth recording: the record was
copied in _after_ the closure ran, so it shipped and the three documents **it** cites
did not. The link check added earlier the same day caught it and failed the build. A
guard written in the morning caught a defect introduced in the afternoon.

**The gate's coverage step could fail without saying anything.** See §3.

## 2. What a broker should do

Nothing, unless they want the release notes in their package — in which case take the
`v3.0.1` package instead of the `v3.0.0` one. **A venue running `v3.0.0` does not
need to be restarted**: the binary is unchanged, the contract is unchanged, and the
conformance suite is version-locked to the same 3.8.0.

## 3. The two hosted failures in this release, and what each one was

`v3.0.0`'s **Statistical Gate passed** on the hosted runner (47 files, 411 tests) and
its **Quality Gate failed** at the `Coverage floors` step — `npm run test:cov:unit` —
with every test passing and the run exiting 1 on
`Error: [vitest-worker]: Timeout calling "onTaskUpdate"`, printed immediately before
the v8 coverage report.

It is intermittent and it is not the engine:

| Commit                 | Quality Gate            | Statistical Gate  |
| ---------------------- | ----------------------- | ----------------- |
| `22fada5` (2026-09-26) | **failure**, same step  | success           |
| `a8fc427` (`v3.0.0`)   | **failure**, same step  | **success**       |
| `a8fc427`, re-run      | **success**             | success           |
| `06b9ba3`              | success, probe attached | success           |
| `3e9a8c7` (`v3.0.1`)   | success, probe attached | **failure** → §3b |

Both failures named nothing. The worker-side detector fails a _test_ that blocks its
own event loop and did not fire either time, so the block was not in a test body; the
main thread is the other half of that channel, only a reporter can measure it, and
the step attached none.

**What was done, and what deliberately was not.** The step now carries the
main-thread probe, which reports event-loop blocks and — under `OTC_COVERAGE=1` —
the wall-clock end of every module rather than only the statistical ones; a guard
fails the build if that reporter is ever dropped again. **No claim is made that the
cause is fixed**, because it has not been identified. One theory was killed by
execution rather than argument: spawned children do not inherit `NODE_V8_COVERAGE`
and so cannot be adding coverage dumps for the main thread to parse, verified by a
test that printed the variable as unset under `--coverage`. And it does not reproduce
on the release machine, which runs the same command with zero main-thread blocks
above two seconds where the hosted four-core runner ran one unit test for 178
seconds.

### 3b. A browser test that demanded a statistical search succeed — and was wrong about the engine

`3e9a8c7`'s Statistical Gate failed on one test: `lab.stat.test.ts > applies a
scenario from the panel and the control row reads ARMED`. The **same test** failed on
`48244ae` (2026-09-25) and `f9b8d14` (2026-09-27) — three times in four days, never
locally, on commits that touch no `apps/web` code.

A previous session had instrumented it after the second occurrence so the next one
would report the screen instead of a bare timeout. This was that occurrence, and the
instrumentation settled it:

```
intentos 20000 · tasa de aceptación 0 · armado no
"Ninguna continuación natural cumplió el criterio en los sorteos: este mercado
 no hace eso en esta ventana. Esa es la respuesta, no un esfuerzo insuficiente."
```

**The Lab was right and the test was wrong.** Arming a scenario is the outcome of a
search over drawn continuations of the market _as it stands_, and this test inherits a
market the flows before it have spent pushing. Whether twenty thousand draws contain a
qualifying continuation in a 119-tick window is a property of that market, not of the
screen — so the test was asserting a coin flip, and the refusal is the behaviour the
Lab exists for: it never fabricates a continuation the market does not offer. Three
red CI runs over four days were the suite accusing the engine of doing its job.

It now waits for the apply's **own timeline row**, written either way, and holds each
outcome to what it must say: armed, and the plan says so; refused, and the plan must
state that the search ran, how far, and why in words an operator can act on. A blank
refusal still fails, because that is indistinguishable from a broken screen. The test
beside it has always been written this way — "or says none is coming".

Watched both ways: forced to a distance the market cannot cover, the test passes
through the refusal branch in 1.1 s where CI timed out at 32 s; with a string that
cannot appear planted inside that branch, it fails there by name — which is the proof
the branch runs rather than being dead code.

The next occurrence will name the module that ended last and the block that caused
it. That is the whole of the fix, and it is the same fix that closed this class for
the statistical project after it stayed anonymous for six pushes
([`DECISION-LOG.md`](../decisions/DECISION-LOG.md), 2026-09-28).

## 4. What was verified

| Measure                          | Result                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine change since `v3.0.0`     | **none** — no file under `packages/`, `apps/api/src` or the contract differs                                                                                                                                                             |
| The package, built from this tag | built and verified from the tag with `OTC_PACKAGE_VERIFY=1`; the package states its own measured counts in its `INTEGRATION.md` header, and the script refuses to build on an unresolved link or a script naming a file it does not ship |
| The package's links and commands | every target resolves, every script names a file it ships                                                                                                                                                                                |
| Local verification               | format:check, build, both typechecks, lint, unit and the coverage leg green                                                                                                                                                              |
| `v3.0.0`'s live conformance      | still the release's evidence — [`RELEASE-CONFORMANCE-3.0.0.md`](RELEASE-CONFORMANCE-3.0.0.md)                                                                                                                                            |
