# ADR-0014 — The chart is TradingView Lightweight Charts and only that; the repository is source-available, all rights reserved

Type: ARCHITECTURAL / PRODUCT DECISION
Status: APPROVED
Date: 2026-09-02
Deciders: **Human Owner** (both halves are commitments outside the repository, `GOVERNANCE.md` §5.1)
Supersedes: —
Closes: the open item in `docs/phases/ROADMAP.md` and PH-18 §7 ("any TradingView
licence remains the Human Owner's"), and GitHub Issue #13

---

## Context

Two questions had been deferred to the Human Owner since PH-18, and an
out-of-band audit found both still open on 2026-09-02:

1. **Which TradingView.** There are two products under that name. _Lightweight
   Charts_ is a free, Apache-2.0 npm package, 45 kB, and it is what PH-18.2
   built against. The _Charting Library_ is a separate commercial product with
   a licence agreement, distributed through a private repository, and it is
   what most people mean by "the TradingView chart". PH-18 chose the free one
   provisionally and recorded that the licence decision was not the agent's.
2. **Under what licence this repository is published.** It was made public on
   2026-08-31 to restore free GitHub Actions, with `license: UNLICENSED` in the
   manifest and no `LICENSE` file. A public repository with no licence grants a
   reader no rights at all — which may be exactly what is intended, but a
   reader cannot tell that from an omission, and neither can a court.

The Human Owner decided both on 2026-09-02, in one sentence: _"con respecto al
repositorio vamos a usar unicamente el actual de tradingview que es gratuito"_ —
we use only the current TradingView one, the free one — together with a general
instruction to resolve the outstanding contradictions in the best way available.

## Decision

**1. The chart component is TradingView Lightweight Charts, under Apache-2.0,
and the paid Charting Library is not used.** Not now and not later without a new
ADR: the constraint is enforced rather than remembered. A guardrail refuses any
dependency, import or vendored path naming the Charting Library, so the day
someone wants a feature only it offers, the build says so before the licence
does.

**2. The repository is source-available with all rights reserved.** `LICENSE`
says it in full and `NOTICE` carries TradingView's attribution;
`package.json` declares `SEE LICENSE IN LICENSE`. Publication exists so the
verification can be reproduced by anyone — that was the reason the repository
was made public, and it is the reason stated in the licence.

## Why

**On the library.** Lightweight Charts is enough for what the panel does, and
what the panel does is bounded by something stronger than taste: PH-8's
rendering contract says the chart may invent no price, hide no extreme and
synthesise no empty bar, and `packages/chart` reduces the record to columns
before any library sees it. The chart engine is downstream of that contract, so
choosing the free one costs the product nothing it has promised. The paid
library would add drawing tools, saved layouts and a symbol search — an
operator panel needs none of them, and a trading front end that one day does can
be argued for on its merits, in its own ADR, against a real price.

The negative half matters more than the positive half. "Use the free one" is a
sentence that decays: it is true until someone needs a feature, and then it is
renegotiated by whoever is closest to the deadline. A guardrail turns it into a
build failure with the ADR's name on it.

**On the licence.** Three options were real:

- **A permissive licence (MIT, Apache-2.0).** Rejected. This is a market engine
  whose value is precisely the part that is hard to reproduce — the calibrated
  anti-predictability argument and the evidence behind it. Granting everyone the
  right to run it commercially is a business decision with no way back, and
  nobody asked for it.
- **No licence at all, as today.** Rejected as a _statement_, not as an outcome.
  The outcome it produces — no rights granted — is the one chosen. But leaving
  it implicit means the repository's most legally consequential fact is an
  omission, and an omission cannot be distinguished from an oversight. The
  audit found it as an oversight, which is the point.
- **Source-available, all rights reserved, with the reason written down.**
  Taken. It grants nothing, so it commits the Human Owner to nothing and
  forecloses nothing: every future choice, including going open, remains
  available. And it explains why a proprietary engine is readable in public,
  which is otherwise a genuinely confusing thing to encounter.

Reading and re-running the verification is explicitly permitted, because that is
what publication is for and a licence that forbade it would make the repository's
own argument unrepeatable.

## Consequences

- `LICENSE` and `NOTICE` exist at the repository root; GitHub will show
  "All rights reserved" rather than an empty licence field.
- `packages/core/src/guardrails/dependencies.test.ts` refuses the Charting
  Library by name, in dependencies and in imports, and the refusal names this
  ADR.
- PH-18 §7 and `docs/phases/ROADMAP.md` no longer carry an open Human decision;
  Issue #13 closes.
- Every dependency keeps its own licence, and Apache-2.0 attribution is
  preserved in `NOTICE` as that licence requires.

## Revisit when

A trading front end is actually built and a measured need for the Charting
Library exists — then a new ADR with the licence cost in it, not an edit to this
one. Or when the Human Owner wants the engine used by someone else, in which
case the licence is the first thing to change and the guardrail the second.
