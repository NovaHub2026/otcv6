# ADR-0015 — The Lab may amend the rules that describe the system; it may not amend the system's guarantees

Type: PROCESS / ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-09-03
Deciders: **Human Owner** (the authorisation), Development Agent (the boundary it is read against)
Supersedes: —
Relates to: the OTC Market Lab specification of 2026-09-03; `GOVERNANCE.md` §5.1

---

## Context

The Human Owner specified an OTC Market Lab — a testing, validation and
diagnostics environment in the admin panel — and, anticipating that it would
collide with rules written before it existed, granted in their own words:

> pueden haber algunas reglas de documentacion que prohiben hacer algunas cosas
> en el lab, te doy totalmente autorizacion para romperlas para construir el lab
> siempre que lo necesites, estas autorizado

The grant is real and it is theirs to make. `GOVERNANCE.md` §5.1 reserves
amendments to Governance itself to the Human Owner, so an authorisation to amend
it is exactly the thing only they can give. It is recorded here rather than
carried in a conversation, because conversations are temporary and the
repository is permanent.

What it does **not** do is settle what should be amended, and that is a question
of engineering rather than of permission.

## Decision

**Three tiers, and they are not the same thing.**

### 1. Rules that describe the system — amendable, with the reason recorded

Architectural conventions, dependency allowances, documentation structure,
process. These exist to keep the system coherent, and a rule that a new,
legitimate subsystem cannot satisfy is a rule that has met a case its author did
not foresee. Amend it, in place, with the reason written beside it.

One is already known. `dependencies.test.ts` allows `@otc/api` five workspace
packages and `@otc/lab` is not among them, so the service cannot serve a realism
metric or an attack verdict. That allowance widens when the Lab needs it.

The neighbouring prohibition **stays**: `@otc/web` may never reach `@otc/lab` or
`@otc/fixtures`. Shipping the attack battery and the planted-defect corpus into
a browser bundle would be both enormous and wrong. The Lab's analysis runs on
the server and the browser receives results — which is a design the rule
improves rather than obstructs.

### 2. The ten invariants — not amended, because the Lab does not need it

INV-001 (economic independence) and INV-006 (no exploitable directional rules)
are the product. ADR-0003 makes anti-predictability a _theorem_ rather than a
calibration, and the theorem holds because the magnitude engine is structurally
**unable** to observe a sign. A code path that steers price toward a desired
outcome would make that false of the codebase, and the guarantee would degrade
from a property of the code to a claim about which flag is off. Cycle Audit 7
measured what claims about flags are worth.

The Lab does not require it. **Candle Close Control is built by selection, not
by steering**: fork the engine state, run many natural continuations, and keep
one that already closes on the requested price. Every path shown is an
unmodified engine path with an untouched sign coin, so a valid OHLC, free wicks,
overshoots, and the absence of any terminal-convergence signature are properties
of the construction rather than things the implementation must remember to
preserve. Measured against the catalogue's own constants, an exact
lattice-precise close on a one-minute candle costs 0.04–0.81 s of search at the
throughput PH-21.2 measured, and stays under ten seconds out to roughly three
standard deviations.

That this authorisation turns out to be unnecessary here is the strongest
argument for the design, and the reason it is recorded rather than used.

### 3. Isolation — a new rule, not a relaxed one

The Lab exposes things production must never expose: latent magnitude state,
keystream cursors, and the ability to select among futures. INV-010 forbids
exposing private generator state in a way that enables future-price
reconstruction, and a keystream cursor is exactly that.

**The boundary is composition, not configuration.** The Lab's endpoints must not
exist in the production composition — not be present and disabled. An
architecture test asserts it, because a flag is a thing that can be wrong and a
missing module is not.

The one genuinely non-natural capability the specification asks for — §37's
stress test, a target outside the reachable range — appends a synthetic terminal
tick. It is permitted **only** where it can never enter a published record, is
labelled `NON-NATURAL TEST` wherever it appears, and is excluded from every
quality and realism measurement so it cannot contaminate them.

## Consequences

**Positive.** The Lab can be built without weakening the guarantee it exists to
validate, and the one rule it genuinely outgrows is widened deliberately rather
than worked around. The Human Owner's grant is on the record under their name
instead of surviving as an agent's recollection of a sentence.

**Negative.** Selection cannot reach an arbitrary target. Beyond roughly four
standard deviations the search cost is prohibitive — for `eurusd` on a
one-minute candle, five sigma is eight hours — so a genuinely extreme close is
only available through the labelled non-natural path. The specification already
required that boundary to exist (§37); this makes it a measured probability
instead of a heuristic.

**A correction the specification will need.** §10 asks the Lab to display the
engine's directional probabilities — "UP 51.8% / DOWN 48.2%". Those numbers
cannot exist here: the sign is an independent fair coin at every tick, so the
value is exactly 50/50 by construction and no influence breakdown can move it.
What is real, and worth watching, is the latent magnitude and rhythm state —
regime and its age, the cascade, arrival rate, keystream cursors. §10 becomes
that, and the panel says plainly that direction is 50/50 and why, which is the
best demonstration of the product the Lab can offer.
