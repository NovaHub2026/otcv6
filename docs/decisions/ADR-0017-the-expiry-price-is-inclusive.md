# ADR-0017 — The expiry price is the tick at or before expiry; a candle is half-open; they differ by the boundary tick, and settlement is authoritative

Type: ARCHITECTURAL DECISION
Status: APPROVED
Date: 2026-09-03
Deciders: Development Agent
Supersedes: —
Relates to: LAB-SPECIFICATION-AUDIT-001 (LA-02), INV-003, INV-009, PH-23 §3, PH-23.1

---

## Context

Two rules in this repository name "the price at the end of a candle", and they
are not the same rule.

- **The chart's bucket is half-open on the right.** `CandleAggregator` assigns
  a tick to the bucket `bucketStart(tick.instant)` floors it into, so a tick at
  exactly `14:33:00.000` is the **first** tick of the 14:33 candle and the
  14:32 candle closed on the tick before it.
- **The settlement lookup is inclusive.** `settle` reads the expiry price with
  `priceAtOrBefore(expiryInstant)` — the last tick at or before the instant —
  and the attack battery samples with the same function, deliberately, so that
  what was attacked and what settles are one quantity.

So a contract expiring at `14:33:00.000` settles on the tick that opened the
14:33 candle, when there is one. Reproduced on 2026-09-03: a folded 1m candle
closing at 110, a settlement of 120 at its boundary. Measured on the shipped
engine over 500,000 ticks per asset, a tick lands on a 1m boundary once in
1,163 candles for EUR/USD and once in 471 for BTC/USD.

PH-23 §3 wrote that "candle close = expiration settlement = one canonical
price" was "already INV-003 and already true". INV-003 is true — one stream,
one record, every quantity derived from it. The sentence was wrong about the
other half, and no test related a candle's close to the price in force at its
end.

## Decision

**Settlement's rule is authoritative, and it does not change.** The price in
force at an instant is the last tick at or before it. That is the rule the
battery samples with, the rule every recorded settlement was computed with
(INV-009), and the rule real venues use: a print at the expiry instant is the
expiry price.

**The chart's rule does not change either.** A candle is `[start, end)` and a
tick at `end` opens the next one, as on every charting platform. Moving the
boundary tick into the closing candle would break the nesting every coarser
timeframe is folded by.

**The two are allowed to differ by exactly the boundary tick, and that is now a
tested property rather than an unnoticed one.** `packages/trading` asserts:
with no tick at the boundary, candle close and expiry price are the same tick;
with one, the expiry price is that tick and it is the next candle's open.

**Candle Close Control addresses the settlement price.** "Close = X at exactly
14:33:00" means the price in force at 14:33:00.000, which is what a position
expiring then is paid on. The Lab's selection window is inclusive of a tick at
the boundary (`labStepsAhead` keeps a tick whose instant equals the window's
end), so a selected close is the settlement close. The chart's 14:32 candle
shows it too, except in the one-in-a-thousand case where the engine prints
exactly on the boundary — and then the chart shows it as the open of 14:33,
which is where that print belongs.

## Consequences

**Positive.** Nothing in the price path, the record, the battery or historical
settlement changes. The relationship is stated, tested, and the Lab's exact
close is defined against the number that pays.

**Negative.** The specification's L5 — "is the final settlement tick exactly the
same tick used as candle close?" — is answered _almost always_ rather than
_always_, and the exception is now documented rather than discovered. A
product surface that wants the two to read identically must render the expiry
price beside the candle, not redefine either rule.
