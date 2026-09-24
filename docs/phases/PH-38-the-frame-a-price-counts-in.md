# PH-38 — The Frame A Stored Price Counts In

Type: PHASE CONTEXT DOCUMENT
Identifier: PH-38
Status: ACTIVE
Cycle: 13 (phase 2)
Created: 2026-09-24
Branch: `feature/ph-38-the-frame`, cut from `main` at `88292d0`
Origin: Cycle Audit 12, finding 3, carried as a phase rather than patched

---

## 1. What is wrong

A published price in this system is an integer. `toDisplayPrice` turns it into a
number the only way it can:

```
referencePrice * exp(logQuantum * price)
```

(`packages/core/src/market/instrument.ts:122-124`). The integer is therefore
meaningless on its own. It means something only next to the pair it counts in.

The durable stores keep the integer and throw the pair away. The `tick` table
has four columns — `asset_id`, `sequence`, `instant`, `price` — and nothing
else (`packages/runtime/src/tickRecord.ts:259-266`). The `candle` table stores
open, high, low and close as bare integers
(`packages/runtime/src/sqliteHistory.ts:76-88`). The multi-node replication log
does the same (`packages/runtime/src/sqliteStore.ts:493-506`). No row, no
table and no file in any of them records a quantum.

Every read route then renders those integers with **today's** pair, taken from
the live catalogue entry rather than from anything stored beside the row:
`published()` at `apps/api/src/market.controller.ts:1293-1304` pairs
`asset.instrument.logQuantum` with whatever tick it was handed, and
`GET /catalogue` hands the panel the same current number
(`market.controller.ts:733`).

PH-37 fixed this for the checkpoint. `MarketStateRecord` gained an optional
`logQuantum` (`packages/runtime/src/state.ts:46-57`) so a market resuming onto
a different lattice re-expresses its last published price. The tick record and
the candle history did not gain it, so the moment a lattice moves, the whole
retained past starts rendering on a lattice it was never written on.

## 2. What was measured

Not synthesised. Measured on the live venue, through a consistent snapshot
taken with the repository's own tool (`state:backup`, "Consistent: every file
agrees", `~/.otc-local/state-backup-20260924T204718Z`), because the live record
had **no backup at all** before this phase and the pre-change integers exist
nowhere else.

v2.4.0 moved all thirty lattices. The record retains 250,000 ticks per asset,
which on this venue reaches back to 2026-09-06 — seventeen days, because the
host suspended repeatedly and the markets froze with it. The relattice seam
sits at **2026-09-24 04:44:49 UTC** on all thirty assets.

| | |
| --- | --- |
| Pre-relattice ticks still retained | **3,664,367 of 7,500,278 — 48.9%** |
| Assets affected | **30 of 30** |
| Rendering error, median | **31.7%** |
| Rendering error, range | 0.77% (msft) to **1,472%** (dogeusdt) |

Worked example, `eurusd-otc`, the last tick before the seam: published as
`1.163184`, rendered by the venue today as `1.201802`. `gbpjpy-otc`: published
`220.31`, rendered `357.88`.

**Half of the published record renders wrong right now**, and the median
figure independently reproduces the 31.7% Cycle Audit 12 measured by a
different route for finding 2 — as does the 1,472% against its 1,474%.

This answers the question the audit left open and two of three independent
designs flagged they could not settle: the defect is not theoretical, and it
has not self-healed inside the trim window. It will, eventually, one asset at a
time and silently — which is worse, because the evidence disappears before the
fix does.

## 3. What was decided

**No stored integer is ever rewritten.** This is not conservatism, it is
INV-009. Re-expression is `Math.round((price * source) / to)`
(`packages/runtime/src/resume.ts:496`), and PH-37 coarsened the thirty by
×9.10 to ×22.97, so roughly thirteen distinct EUR/USD prices collapse onto one
new integer. `resolve()` refunds when `expiryPrice === entryPrice`
(`packages/trading/src/settle.ts:157-161`). Converting the record would turn
settled wins and losses into ties: a past outcome would stop being reproducible
from the record that produced it. The fix is therefore about **interpretation**,
never about conversion.

**What is stored is a frame, not a quantum.** Display is
`referencePrice * exp(logQuantum * price)`, so the pair is what makes an integer
a price, and `displayPrecision` is what makes it a string. Both `logQuantum` and
`referencePrice` sit inside the personality fingerprint
(`packages/runtime/src/personality.ts:26-29`), so either can move across a
release and force a seam. `displayPrecision` does not, and can move with no
seam at all — which is precisely why a frame history cannot be derived from the
seam table and must be its own record.

This decision also exposes a live latent defect found independently by two of
the three designs: `onLattice` (`packages/runtime/src/resume.ts:485-497`)
rescales by `price * source / to` and silently assumes `referencePrice` never
moved. A grep for `referencePrice` across the non-test runtime sources returns
exactly one hit. Storing only the quantum would be the same defect one release
later.

**The migration refuses to guess.** Nothing in the repository can soundly date
the rows that already exist: a sequence jump says a seam happened, not what the
lattice was on either side. An undeclared range is reported as undeclared, not
silently rendered on the current frame. Seeding every asset from
`LATTICE_BEFORE_PH37` would be wrong in a new direction, because the live
record already holds post-change ticks.

**The guard is fed the previous release's artefact.** This is the audit's own
headline: the defect that shipped was not a missing test but a missing test
*input*, because every test in the repository builds its artefacts with the
code under test. PH-38's guards materialise `v2.4.0` from git, build it, write
a `record.db` with it, and open that file with this build — the recipe already
proven at `packages/engine/src/lattices.test.ts`.

## 4. What this phase may not do

- It may not rewrite, re-express or VACUUM any existing `tick`, `seam` or
  `candle` row. §3 says why.
- It may not restart the engine the Human Owner watches. A restart costs a
  recorded seam per asset; this phase's own measurement shows thirty of them at
  18:58:46 UTC today from exactly that.
- It may not put `displayPrecision` into the personality fingerprint. That
  would seam every live market for a cosmetic change.
- It may not touch the calibration. That is finding 7 and the phase after this
  one; doing it first would migrate a catalogue whose stores still cannot say
  which lattice they were written on.
- It does not repair the values brokers have already derived and stored. The
  venue becomes right; their books do not. The only levers are the contract
  version and the conformance suite, and the phase says so out loud rather than
  implying a reach it does not have.

## 5. Subphases

| Subphase | Title                                                     |
| -------- | --------------------------------------------------------- |
| PH-38.1  | A stored price states the frame it counts in              |
| PH-38.2  | The past is declared or refused, never guessed            |
| PH-38.3  | Every read route renders on the frame the price was in    |
| PH-38.4  | A candle never spans two frames                           |

PH-38.1 comes first because nothing else can be built on a store that cannot
record a frame. PH-38.2 is separate from it because the migration is where this
phase can do real damage, and it deserves its own guard watched failing.
PH-38.3 is the defect a broker actually sees. PH-38.4 is last because a folded
bar spanning a frame boundary is a distinct question from a tick, and the
answer — withhold or convert — depends on what PH-38.3 establishes about who
owns a rendered price.

## 6. What it costs

A schema version on the record (2 → 3), a side table written inside the append
transaction that already exists, a contract that states a tick's frame, and a
migration that leaves an honestly undeclared range behind on every deployment
that upgrades across v2.4.0 — including this one, for 3.66 million ticks until
the trim window carries them away.

The honest failure modes the three designs surfaced are carried into the
subphase documents rather than summarised away here, because each belongs with
the guard that has to catch it.
