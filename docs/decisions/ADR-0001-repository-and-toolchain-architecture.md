# ADR-0001 — Repository, toolchain and package architecture

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-08-31
Deciders: Autonomous Development Agent (delegated authority, `GOVERNANCE.md` §5, §65)
Supersedes: —

---

## Context

The repository began empty, containing only `GOVERNANCE.md` and
`PROJECT_INTRODUCTION.md`. The Project Introduction fixes the application stack
(NestJS + TypeScript backend, React/Next.js + TypeScript frontend) and states
that the backend is not yet scaffolded. Everything else — repository structure,
package organization, tooling, testing foundation, configuration model — is
delegated.

The project's defining technical characteristics shape this decision more than
ordinary web-application concerns do:

1. The core deliverable is a **numerical simulation kernel**, not a CRUD service.
   Most of the code is pure functions over latent state; most of the risk is
   statistical, not transactional.
2. **Determinism and replay** are product invariants (INV-008, INV-009, INV-010),
   so the build and test environment must not introduce ambient nondeterminism.
3. **Statistical validation is a release gate** (INV-006), so the test
   infrastructure must support long-running, seeded, CPU-bound suites separately
   from fast feedback suites.
4. **Economic blindness** (INV-001) is an architectural property that must be
   enforceable mechanically, which requires real module boundaries rather than
   folder conventions.

## Decision

### 1. Single repository, npm workspaces monorepo

One repository containing every package. Workspaces: `packages/*`, `apps/*`,
`tools/*`.

npm workspaces rather than pnpm or Yarn: npm ships with Node, so a fresh agent on
a new machine can reconstruct the project with `npm ci` and nothing else. This
directly serves the Governance cold-start requirement. The monorepo is small
enough that pnpm's disk and resolution advantages do not outweigh a zero-install
toolchain.

### 2. Package boundaries express the invariants

| Package       | Responsibility                                                                | Allowed dependencies       |
| ------------- | ----------------------------------------------------------------------------- | -------------------------- |
| `@otc/core`   | canonical time, entropy/random streams, market domain primitives, aggregation | none                       |
| `@otc/engine` | the generative market model                                                   | `@otc/core`                |
| `@otc/sim`    | offline simulation runner, statistical evidence generation                    | `@otc/core`, `@otc/engine` |
| `apps/api`    | NestJS runtime: hosting, streaming, trading, settlement, persistence          | `@otc/core`, `@otc/engine` |
| `apps/web`    | Next.js client                                                                | transport contracts only   |

The dependency graph is acyclic and points **away** from trading concerns. It is
structurally impossible for `@otc/engine` to import a position, a payout, or an
exposure figure, because the packages that define those concepts depend on the
engine and not the reverse. INV-001 therefore becomes a build-time property
rather than a review-time promise.

### 3. TypeScript: strict, ESM, NodeNext, composite

`strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
`isolatedModules`, `verbatimModuleSyntax`. Numeric simulation code indexes arrays
constantly; `noUncheckedIndexedAccess` converts a whole class of silent
`undefined`-propagates-to-`NaN` failures into compile errors, which matters far
more here than the ergonomic cost.

Native ESM with `module: NodeNext`. Node 24 runs ESM natively; NestJS 11 and
Next.js both support it. Choosing ESM once, at the root, avoids a dual-format
build for the lifetime of the project.

Composite project references, so `tsc -b` typechecks and builds the graph in
dependency order and gives incremental rebuilds. Each package's `tsconfig.json`
includes its co-located tests so that a single project graph serves the compiler,
the editor and ESLint's type-aware project service.

### 4. Vitest, with `unit` and `statistical` projects

Vitest rather than Jest — which is the NestJS default — because:

- it runs TypeScript ESM natively with no transform configuration;
- workspace packages can be aliased straight to their sources, so tests never
  depend on a prior build;
- its project mechanism cleanly separates a fast suite from a slow one.

Two projects are defined:

- `unit` — `packages/*/src/**/*.test.ts`, milliseconds, runs on every change and
  on every push.
- `statistical` — `packages/*/src/**/*.stat.test.ts`, long-running, CPU-bound,
  `fileParallelism: false` so that simulation timings stay meaningful.

Statistical tests must be **deterministically seeded**. A statistical assertion
that can fail randomly is a defect in the test, not a flake to be retried; this
project cannot distinguish a flaky statistical gate from a real integrity
regression, so it must not have one.

### 5. ESLint 9 flat config with type-aware rules; Prettier for formatting

Type-aware linting is enabled repository-wide. Root-level config files sit
outside every composite project and have type-aware rules disabled explicitly
rather than being excluded from linting.

Prettier owns formatting; `eslint-config-prettier` removes the overlap.
`GOVERNANCE.md` and `PROJECT_INTRODUCTION.md` are in `.prettierignore`: they are
authoritative documents whose content is governed, and tooling must never rewrite
them.

### 6. NestJS and Next.js are scaffolded by the phase that first needs them

Both remain the mandated stack. Neither is scaffolded during bootstrap. A NestJS
application scaffolded now would be an empty HTTP server with no domain to serve,
carrying dependency and configuration surface through several phases before its
first real use, and its module structure would be guessed before the domain it
must expose exists.

`apps/api` and `apps/web` are reserved names in `PROJECT_CONTEXT.md` and the
roadmap. This is a sequencing decision, not a stack change; it does not touch
protected intent.

### 7. Quality gate

`npm run gate` = `format:check` + `lint` + `build` (which is the full typecheck)

- `test`. GitHub Actions runs the quality gate on every push and pull request,
  and the statistical gate on pull requests and manual dispatch.

Per `GOVERNANCE.md` §21 a **subphase** gate is a justified subset of this; the
full gate is the **phase** level instrument.

## Consequences

**Positive**

- Cold start is `git clone && npm ci && npm run gate`.
- INV-001 is enforced by the package graph rather than by review vigilance.
- Fast feedback and heavy statistical validation coexist without one crowding out
  the other.
- Strict compiler settings catch the specific failure modes numeric code has.

**Negative / accepted costs**

- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` add friction in hot
  numeric loops; the mitigation is local, explicitly-justified narrowing rather
  than relaxing the flag.
- Vitest is not the NestJS default, so Nest testing utilities will need
  Vitest-compatible wiring when `apps/api` arrives. This is well-trodden and was
  judged cheaper than running two test runners.
- ESM with NestJS is less common than CJS. Accepted deliberately to avoid a
  dual-format build; revisit only if a required dependency proves CJS-only, which
  would be recorded as a superseding ADR.
- Compiled output currently includes test files, because each package's build
  project includes its co-located tests. These packages are private and never
  published, so the only cost is `dist` size.

## Alternatives considered

| Alternative                                     | Why not                                                                                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm workspaces                                 | Better at scale, but adds a required global install to cold start for a repository of this size.                                                                  |
| Nx / Turborepo                                  | Task orchestration value does not yet exist at three packages; adds configuration surface and a cache to reason about.                                            |
| Jest                                            | Requires transform configuration for TS ESM, is slower on numeric suites, and its project mechanism is clumsier for a slow/fast split.                            |
| Separate repositories per package               | Would make the acyclic dependency rule a cross-repo publishing problem and would break single-commit atomic changes across the engine and its validation harness. |
| Scaffolding NestJS and Next.js during bootstrap | Produces empty applications whose structure must be guessed before the domain exists, and carries unused dependency surface for several phases.                   |
