# ADR-0021 — A Contract Settles At Its Final Millisecond, And A Seam Never Closes A Market

Type: DECISION RECORD
Status: APPROVED
Date: 2026-09-26
Decided by: the Human Owner, 2026-09-26 — "una operación siempre debe liquidarse en el milisegundo final que es para terminar, si un usuario abre un contrato de 1 minuto nunca puede liquidarse antes", and "un usuario puede abrir un contrato siempre que quiera, a cualquier momento, siempre y cuando el activo esté abierto […] desde el punto de vista del motor, mientras esté activo y disponible para operar, el usuario puede hacerlo en cualquier momento".
Supersedes: the part of [ADR-0020](ADR-0020-a-stall-reopens-itself.md) that reads "Contracts in flight across the outage are refused, not settled", and the seam refusal `settle()` has carried since Cycle Audit 5. **Keeps** [ADR-0010](ADR-0010-catch-up-bound.md) (the missed interval is never generated), [ADR-0017](ADR-0017-the-expiry-price-is-inclusive.md) (the expiry price is the tick at or before expiry) and [ADR-0019](ADR-0019-a-keystream-is-keyed-by-when-it-starts.md) (a reopening draws from a fresh keystream).

---

## Context

A seam is where the record says the engine published nothing for a while — a
restart, a deploy, a host that withheld the CPU — and resumed at the clock.
Since ADR-0020 the engine takes that decision itself, and on a loaded host it
takes it often: 1,762 seams in one day on this machine, which were 51 process
stalls multiplied by thirty markets.

Until this record the engine made the seam a product event:

- `settle()` refused any contract whose window touched a seam, which a broker
  turns into a refund. Measured on that day's record, that is **20.5% of
  15-minute contracts and 1.7% of 30-second ones** among those opened while the
  market was publishing — and, under the advice to pause below, nobody could open
  at all for the **18.66% of the day** spent inside seams.
- `GET /markets/:id/price?at=` answered **409** for an instant inside a seam,
  so a contract whose final millisecond fell there had no price at all.
- The integration advice was to show a seam as `market_status: "paused"`, which
  in the broker's frontend blocks every new opening.

The Human Owner looked at a broker that settles and trades that way and said it
kills the experience. The Owner is right, and it also protects nothing.

## Decision

**1. A contract settles at its final millisecond, with the price in force at
that millisecond** — the tick at or before it (ADR-0017) — whether or not a
seam fell inside its window. Never before: the record must reach past the final
millisecond before the price can be read, which is already enforced
(`settle()` refuses an expiry beyond the record; `/price` answers 400 for an
instant after the newest published tick).

**2. A seam never closes a market.** An asset that is active and available can
be traded at any moment. During a seam the price in force is the last published
tick, and opening against it is opening against a real price. Trading
availability and the process's operational health are different questions, and
the engine answers them separately.

**3. One exception, and it is a guard, not a policy.** A seam that is also a
**change of lattice** — a release that recalibrates an asset — puts the entry
and the expiry integers in different units, so comparing them decides the
contract by rounding rather than by the market (Cycle Audit 13 measured a 9,900
win on a price that had not moved). Settlement refuses across such a seam, and a
release **must never change a lattice with contracts in flight**. The refusal
exists to make that operator error loud; it is not expected to fire.

## Why it is sound

- **The price is continuous across a seam.** ADR-0020 reopens a market at the
  price it last published, so the price in force during the gap is the price
  every observer was shown, and the price the market resumes from.
- **It is not exploitable.** In OTC the engine is the market: nothing outside it
  moves during the gap for anyone to see first. The reopening draws from a fresh
  keystream (ADR-0019), so P(up) = P(down) after it exactly as before. A seam that
  outlasts a contract leaves its entry and expiry prices equal — a tie, refunded
  under ADR-0007 — so nobody loses to one, and nobody can win by causing one.
- **It is reproducible.** The entry tick, the expiry tick and the seam are all in
  the record (INV-009). A seam changes nothing about how an outcome is derived;
  it is written down so an auditor can see that the price stood still.
- **What stays is protection, not product.** The engine still never generates the
  missed interval (ADR-0010) — that is what stops a past being fabricated after
  the fact — and still reopens on fresh keys — that is what stops a restart from
  replaying a predictable market. Neither is visible to a trader.

## Consequences

- **A broker does not need to know seams exist.** The integration guide stops
  asking it to handle them. `GET /markets/:id/seams` remains, as an audit and
  operations route.
- **`GET /markets/:id/price?at=` inside a seam answers the price in force** and
  names the seam it fell in, instead of 409. That is a behaviour change of the
  contract and is versioned.
- **A contract whose final millisecond falls inside a seam has its result fixed at
  that millisecond but can only be reported once the record reaches past it**,
  because until then nobody can know that no other tick was published at that
  instant. The outcome does not change; the notification can arrive late by at
  most the length of the seam.
- **The stream keeps a heartbeat during a seam, carrying the price in force**, so a
  broker's own freshness rule (Orbit's frontend refuses a quote older than fifteen
  seconds) does not close a market the engine considers open.
- `settle()`'s seam input gains a field saying whether a seam changed the frame.
  It is required, for Cycle Audit 12's reason: silence must not mean "no".

## What was considered and rejected

- **Refunding every contract that touches a seam** — the rule this replaces.
  Economically neutral and honest, and it turned a host problem into a product
  problem: a fifth of the longest contracts refunded on a bad day.
- **Pausing openings during a seam.** It protects nothing — the price in force is
  known and the market resumes from it — and it closes the product exactly when a
  trader is watching.
- **Cancelling open contracts when a seam begins.** It settles a contract before its
  final millisecond, which is the one thing the Human Owner ruled out absolutely.
