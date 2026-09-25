# Broker readiness — what was verified on 2026-09-25, and what was not

Type: EVIDENCE RECORD
Commit verified: `948f39e` (`main`)
Venue: the deployment on ports 7300/7301, serving contract 3.0.0

---

## 1. What this record is

An answer to one question: can a real broker use this engine? It is written to
be falsifiable rather than reassuring, so every line below is either a command
that was run or a refusal that was recorded. What is **not** covered is in §4,
and §4 is the part to read first if a decision rests on this.

## 2. Executed evidence

**The quality gate**, on `948f39e`, with `OTC_REQUIRE_BROWSER=1`:

```
npm run gate  ->  GATE_EXIT=0        (09:24-10:37Z)
  unit         175 files, 3,584 tests          81.3s
  coverage     175 files, 3,584 tests         289.8s   (floors enforced)
  statistical   47 files,   411 tests       3,804.6s   (real browser)
```

**Hosted CI on the same commit** — the corroboration ADR-0009 asks for —
**green on both jobs** (run 36124995948, finished 11:32Z). The PH-38 approval
commit `f5d9c21` is also green on both.

**The broker's own checklist**, against the running venue:

```
npm run conformance -- --base http://127.0.0.1:7300   ->  exit 0
  33 checks pass, 0 fail
  a recorded price states the frame it counts in | pass |
    2 declared frame(s), boundary 1529110 gap 0.002%
```

**Four sweeps over all thirty assets of the live venue:**

|                                                                      |                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| oldest retained tick renders a price                                 | **30 / 30**, none null                               |
| at the precision it was published                                    | **30 / 30** (15 on the old frame, 15 on the current) |
| history bars cross-checked against the tick record, at 1m, 1h and 1d | **225 bars, 0 disagreeing, worst 0.0000%**           |
| bars stating no frame, correctly not drawn                           | 227                                                  |

**A worked case.** `eurusd-otc` sequence 1429108, the last tick before the
v2.4.0 relattice: the venue answers `1.1631992` with
`logQuantum 3.131447750503912e-7`. Before this work it answered `1.202006` — a
number nobody ever published — and after the first fix it answered `1.163199`,
one digit short of what was published.

## 3. What was found by attacking the claim rather than asserting it

Eight independent refuters were asked to break this verdict before it was given.
**Four broke it.** Everything they found is either fixed below or carried in §4.

| Found                                                                                                                                                  | Status       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| the chart drew prices nobody published on 27 of 30 assets, up to 452%, and the same moment read as three different prices at four timeframes (INV-004) | fixed        |
| frame-1 declarations carried today's `displayPrecision`: 0 of 30 matched what was published, `tsla-otc` and `meta-otc` lost two decimals               | fixed        |
| the conformance frame check had no independent anchor — a venue rendering every recorded price on a lattice nobody published scored 33/33 exit 0       | fixed        |
| "no stored integer was rewritten" is false of the candle store: 113,158 of 134,002 rows were converted by hand before this phase                       | recorded, §4 |
| `settle()` accepts `seams: []` as an assertion it cannot verify                                                                                        | recorded, §4 |
| a planted defect survived: the stored frame wired into the resumed generator passes every unit suite                                                   | recorded, §4 |

The three fixes were each verified against the live venue, not against a test,
and that is how two further bugs were found: an epoch written at the record's
boundary instead of the bar's (a spread over a wider type the compiler could not
see), and a bar refused only when its two ends disagreed rather than when a
boundary fell inside it.

## 4. What this does **not** cover

- **A market that starves before its first tick never reopens again.** Thirty
  markets stalled, reopened themselves as PH-36 says they should, stalled again
  twenty-two seconds later and were still stalled twenty-three minutes on with
  the machine idle. The venue needed an operator. `DECISION-LOG.md`, 2026-09-25.
  **An operator must know that a `degraded` venue with a non-advancing record
  does not heal by itself.**
- **The calibration simulates a market the engine does not run** — Cycle Audit
  12's finding 7, measured at a refund bias of +1.91pp. It is the next phase.
- **The multi-node replication log carries prices with no frame.** It does not
  affect a single-node deployment, which is what is verified here.
- **227 history bars are not drawn**, because they cross a real lattice boundary
  or the record's 250,000-tick window can no longer date them. The chart shows
  what it can corroborate.
- **The process on 7300 is the Lab composition** (ADR-0018), which serves every
  production route plus `/lab`. A broker runs the production composition; that
  composition is covered by the gate but this venue is not it.
- **No cryptographic corroboration on this venue.**
  `OTC_PUBLICATION_DIR` is unset, so `/markets/:id/proof/:sequence` answers 404
  and every check above rests on the venue's own files plus git history. Those
  are independent of the route under test but they are not a signed chain.
- **The candle conversion of 2026-09-24 has no tool and no record.** Nineteen
  days of chart rested on an irreproducible operator action. What replaces it —
  dating bars against the record — is reproducible and refuses what it cannot
  evidence.

## 5. The honest summary

The tick path — the one settlement reads — is verified end to end on this
commit, corroborated by hosted CI, and passes the broker's own checklist against
a running venue. The chart path is verified against the record bar by bar. The
engine's anti-predictability guarantee is untouched by this work and its mirror
test still passes.

What would stop a deployment today is §4's first item: this venue does not
recover by itself from a second stall under load. That is an operational defect
with a known cause and no fix yet, and it belongs in front of any decision to
put real money behind this.
