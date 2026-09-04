# DECISION LOG

Type: SUPPORTING DOCUMENTATION (living)
Status: Running record of autonomous decisions
Canonical for: what was decided, by whom, and why — where a full ADR is not warranted

---

## Why this exists

`GOVERNANCE.md` §5 delegates every code and product decision to the Development
Agent, and replaces escalation with **documentation**. This is the other half of
that trade.

An ADR is for a durable decision that shapes the system and will be cited later.
This log is for everything else the Human Owner would want to be able to find:
product choices, scope calls, things deliberately not built, and decisions that
were close enough that the reasoning matters.

The test for whether something belongs here is not importance. It is: **would
someone reading the repository later be surprised, and unable to find out why?**

"It was autonomous" is not a reason to leave a decision unwritten. It is the
reason to write it down.

## How to read it

Oldest first, newest at the end, so a reader who follows the log reads the
decisions in the order they were made. Each entry states what was decided, what the alternative was, and
what would make it worth revisiting. Where a decision has an ADR, the log links
to it rather than repeating it.

---

## 2026-08-31 — Lint keeps depending on the build, rather than resolving types itself

**Decided:** fix the clean-checkout lint failure by **ordering** — build before
lint — rather than by making ESLint resolve workspace types from sources through
path mapping, the way `vitest.config.ts` already does with aliases.

**Why:** path mapping would give the project two type resolvers that can
disagree — `tsc -b` through emitted declarations, ESLint through sources. Two
resolvers that can disagree is a worse failure mode than an ordering constraint,
because the disagreement is silent and the constraint is not.

**Cost:** `npm run gate` now always builds before linting, so a lint-only check
is no longer the cheapest thing you can run. That is a real ergonomic loss.

**Revisit when:** the build becomes slow enough that linting first matters, or
the two-resolver risk is eliminated some other way.

See [ADR-0009](ADR-0009-hosted-ci-reinstated.md).

---

## 2026-08-31 — The repository is public, and that was checked before it mattered

**Decided:** treat publication as safe, on evidence rather than on the assumption
that a synthetic engine has nothing to hide.

**Checked:** no committed key material, no tracked `.env`, no private keys in
history; `OTC_MASTER_SECRET` comes from the environment and the service refuses
to boot without it rather than inventing a default.

**Why it holds:** the security model never depended on the code being secret.
ADR-0002 puts secrecy in the key; ADR-0003 goes further and gives
`P(up) = P(down)` under _every public conditioning_, which includes an adversary
who has read the whole engine. Publishing gives an attacker nothing the theorem
had not already granted them.

**Revisit when:** anything key-derived, operator-specific, or customer-facing
enters the repository. The check is cheap and should be repeated then, not
assumed to still hold.

---

## 2026-08-31 — Governance itself stays with the Human Owner

**Decided:** the Development Agent will not amend `GOVERNANCE.md` on its own
authority, despite the Human Owner delegating "absolutely all decisions".

**Why:** a system that can rewrite its own constraints has no constraints. The
value of that document comes entirely from being harder to change than the code
it governs. The delegation was over _code and product_; Governance is neither —
it is the control system over both.

**Alternative:** take the delegation literally and treat Governance as editable.
Rejected because the first time it became inconvenient, it would be edited.

**Revisit when:** the Human Owner says so. §5.1 is one sentence to change, and
that is the point — the mechanism works precisely because they hold that pen.

See [ADR-0008](ADR-0008-full-delegation.md).

---

## 2026-08-31 — Hosted CI is not replaced, and the gap is not papered over

**Decided:** with hosted CI removed from the verification model (ADR-0008), no
substitute "independent" check is invented. The local gate is stated as the sole
verification authority, and its limitation is recorded rather than mitigated with
something that looks like independence but is not.

**Why:** the tempting move is to add a second local check and describe it as
corroboration. It would not be. Every local check runs in the same session, on
the same machine, at the same operator's discretion. Manufacturing the appearance
of independence is worse than recording its absence, and this project has already
found six guards that existed, were documented as sufficient, and had never been
tested against what they guarded.

**The standing option, unused:** making the repository public would restore free
GitHub Actions immediately, at no cost. It is not taken because it is a decision
about the product's positioning, which `GOVERNANCE.md` §5.1 leaves with the Human
Owner. **This is the cheapest available route back to independent verification
and it needs one word from the Human Owner.**

**Revisit when:** a paid allowance exists, or the repository becomes public.

**Revisited 2026-09-01.** The Human Owner made the repository public, and hosted
CI was reinstated as required corroboration
([ADR-0009](ADR-0009-hosted-ci-reinstated.md)). The limitation this entry records
no longer holds; the entry stays because the reasoning about manufactured
independence does.

---

## 2026-08-31 — Cycle Audit 4 will name its own method limitation

**Decided:** the automatic Cycle Audit will state, in its first section, whether
it was conducted by the agent that wrote the code — and if so, will treat its own
clean result as weak evidence.

**Why:** the measured effect is large. Cycle Audit 2 used ten independent agents
with adversarial verification and found 31 material findings; Cycle Audit 3 was
run by the authoring agent and found one. Removing the human gate takes away one
of the two external checks, which makes the audit's method the whole of what
remains.

**Revisit when:** independent agents are used (B-008), at which point the caveat
becomes a record of method rather than a warning about it.

---

## 2026-09-01 — The lease term is tied to the catch-up bound, not chosen

**Decided:** `DEFAULT_LEASE_TERM_MS` equals `DEFAULT_MAX_CATCH_UP_MS` — 15
seconds — and the equality is asserted by a test rather than left as a
coincidence two constants happen to share.

**Why:** the tie is the argument. A leader that has failed to renew for a full
term has been out of contact for longer than ADR-0010 permits it to catch up, so
its next advance would be refused anyway; losing the lease takes away nothing the
bound had not already taken. And the maximum leaderless window then equals the
maximum catch-up burst, so failover cannot produce a gap larger than one the
running system already tolerates. Any other number would need its own
justification; this one inherits ADR-0010's.

**Revisit when:** the catch-up bound changes. The test fails if it does, which is
the point.

---

## 2026-09-01 — A follower's inability to generate is structural, not documented

**Decided:** `packages/runtime/src/follower.ts` and everything it transitively
imports may not reach `@otc/engine` or name any key-material identifier, enforced
by `packages/core/src/guardrails/singleWriter.test.ts`.

**Why:** PH-14 §9 names "a follower silently generating" as a hazard that would
fork the record invisibly. The plausible way it happens is not malice — it is a
future edit adding an engine "just to fill the gap during failover", which is the
most natural wrong instinct in this phase. A comment is no defence against that.

The guard earned itself immediately: it failed on its first run against real
code, on the type-only path
`follower -> replication -> lease -> state -> @otc/engine`. Type-only is exactly
why that would have been waved through, and it is one word from being real.

**Revisit when:** never, in the direction of relaxation. A follower that needs
the engine is a design error, not a guard that needs an exception.

---

## 2026-09-01 — A discontinuity is recorded, never inferred

**Decided:** the replication log holds `SeamMarker` entries, and the only way to
append past a sequence gap is to record one. `readRecord` returns entries rather
than ticks so no client can read across a discontinuity without being handed it.

**Why:** two correct rules contradicted. PH-5.2's seam moves the sequence past
the reserved block deliberately — "the gap is visible and free; a duplicate is
neither" — and PH-14.2's log refuses a gap, because one served to observers is
indistinguishable from the market. Relaxing either would have been wrong. Making
the discontinuity a thing the record _holds_ satisfies both and turns the
contradiction into the property the phase needed: a gap cannot be silent.

The follow-on consequences were not obvious in advance and are the more valuable
part: `priceAt` must return null inside a seam, because reporting the pre-seam
price answers for a window in which no node was generating; and `spansSeam` has
to exist, because ADR-0010's criterion — no unobserved interval may span a
contract — is something the settlement path has to be able to _ask_, not assume.

**Revisit when:** a deployment store implements the log. The seam is part of the
`CoordinatedStore` contract and its conformance battery.

**Revisited 2026-09-02.** `SqliteCoordinatedStore.recordSeam` implements it and
the conformance battery specifies it; the decision stands unchanged.

---

## 2026-09-02 — Retiring an asset is final

**Decided:** an operator may retire a market. There is no un-retire, in the
surface or in the store.

**Why:** a market resumed after a gap either invents the interval nobody
generated — which the catch-up bound (ADR-0010) refuses outright — or takes a
seam in a published record. The second is available and is worse than it looks:
an operator would be _choosing_ to put a discontinuity into a market that had
already printed prices, and every observer of that market would see it.

Nothing is lost by the refusal. Everything a retired market published stays
readable for ever: history, settlement, publication journal. The asset that
cannot come back is the _generator_, and an operator who wants that market again
registers one — which is a new id, a new keystream and an honest new market
rather than an old one with a hole in it.

**Alternative:** an un-retire that resumes the generator after the gap.
Rejected, because both ways of doing it are worse than a new registration: the
interval is either invented (which ADR-0010 refuses) or seamed on purpose.

**Where:** `AssetOverlay.retiredAt`, `VenueService.retire`,
`POST /assets/:id/retire` (409 on a second call), and the panel's confirmation
wording. Guarded by three plants in PH-20.3.

**Revisit when:** never in the direction of resuming a retired generator. A new
registration is the honest way back.

---

## 2026-09-02 — A cause for the gate's RPC timeout is accepted only with a reproduction

**Decided:** no change may be recorded as the cause of
`Timeout calling "onTaskUpdate"` unless it comes with a reproduction that
produces that exact error and a change that makes the same reproduction pass.

**Why:** the out-of-band audit (a1-07) found four causes recorded for this one
failure — file oversubscription (CA6-01), console and reporter traffic (CA6-02),
`execFileSync` in the meta-audit (`c736707`), long loops without a yield
(PH-21.1) — each written as settled, each followed by another red run, and none
consistent with the mechanism: a worker-to-main request whose reply is read too
late. The failure reproduces in a ten-line file in sixty-five seconds
(`spin(65_000)` after a test boundary). Anything that cannot make that file
fail and then pass has not explained it.

**Alternative:** keep recording the most plausible mechanism per occurrence.
Rejected: that is how the project spent a cycle fixing pressure on the channel
without touching the request that timed out.

**Revisit when:** the gate's instrument changes — `vitest.setup.statistical.ts`
now fails a file by name when a request stays unanswered for thirty seconds, so
the next occurrence should arrive with its own attribution.

---

## 2026-09-02 — The repository is readable, and grants nothing

**Decided:** publish under "all rights reserved, source-available", with a
`LICENSE` and a `NOTICE` file, rather than under a permissive licence or under
no licence at all.

**Why:** the repository was made public on 2026-08-31 for one reason — free
hosted CI, so the verification could be run by someone other than the operator
who produced it — and it stayed public for a better one: every statistical claim
in it is seeded and re-runnable by anyone who reads it. Neither reason needs a
grant of rights. But an omission is not a decision, and until this was written
down a reader could not tell whether the missing licence was a position or an
oversight; the audit found it as an oversight (a7-21, Issue #13).

**Alternative:** MIT or Apache-2.0. Rejected — this is a market engine whose
value is the part that is expensive to reproduce, and granting commercial use is
irreversible. "All rights reserved" forecloses nothing, including going open
later; a permissive licence forecloses everything else.

**Revisit when:** the Human Owner wants someone else to run this engine. The
licence is then the first thing to change.

See [ADR-0014](ADR-0014-chart-library-and-repository-licence.md).

---

## 2026-09-02 — Governance is amended by proposal, because the agent could not amend it

**Decided:** the thirteen contradictions the audit found in `GOVERNANCE.md` are
written as an applicable proposal ([ADR-0013](ADR-0013-governance-says-what-is-true.md))
rather than applied, even though the Human Owner authorized the agent to resolve
them.

**Why:** the environment refuses to let this agent write `GOVERNANCE.md`, which
is the same protection §5.1 asks for by other means. Working around a refusal
would be worse than the contradictions: the one document that constrains the
agent would have been edited by the agent through a side door, and no future
reader could tell which of its sentences survived that. §58 says the agent may
propose and may not apply; the refusal made that concrete rather than
theoretical.

**Alternative:** find a route the classifier does not cover — a subagent, a
patch applied by a test, a rename. Rejected as laundering.

**Revisit when:** the Human Owner applies the proposal or grants the permission.
Issue #14 stays open until then.

---

## 2026-09-02 — Distribution at scale is the next phase, and the transport is not the lever

**Decided:** PH-22 is distribution under thousands of observers, prioritised by
the Human Owner ahead of everything else after PH-21 and Cycle Audit 7. The
transport stays SSE until a measurement says otherwise.

**Why:** the question was whether thousands of clients with several charts each
argue for WebSocket. Measured on the running engine: a WebSocket frame costs 2
bytes against SSE's 18, on a 58-byte payload — 21% of the traffic, which at the
venue's own measured rate is 24 bytes per second per viewer. Latency is
identical; both are one TCP connection already open, and SSE starts marginally
sooner because there is no upgrade handshake.

Reading the delivery path found the thing that does matter: the SSE frame is
built inside the per-subscriber callback, so one tick is serialised once per
subscriber — ~120,000 times a second at the scale being planned (Issue #15).
That is one to two cores, it is a hundred times the framing difference, and
switching transport does not touch it.

**What WebSocket would genuinely buy** is binary framing: a tick is three
numbers and fits in 16 bytes against 58 as JSON, and SSE is text-only so binary
costs a base64 tax. That is a real argument, worth 9.1 MB/s against 2.2 MB/s at
ten thousand clients — and it is an argument to make _after_ serialising once,
multiplexing assets onto one connection (Issue #16) and putting HTTP/2 in front,
because those three are free of protocol risk and one of them is larger than the
protocol.

**What it would cost.** `Last-Event-ID` is part of SSE: exact resumption, and an
explicit refusal when the sequence has been evicted. On WebSocket that is code
to write, test and audit, and a silently served gap is INV-002 broken.

**Revisit when:** PH-22 has measured a thousand, five thousand and ten thousand
concurrent subscribers with the fan-out fixed. If bandwidth or CPU still bind,
the binary tick and its transport get their own ADR.

## 2026-09-02 — A refused resume may ask to be told instead (`onGap=live`)

**Decision.** `GET /markets/:id/stream` takes an optional `onGap=live`. Without
it, a sequence the feed cannot serve is a `400`, exactly as before. With it, the
client gets the live edge and an explicit `gap` event carrying the sequence it
asked for and the feed's own reason.

**Why not simply keep refusing.** The refusal is right and the panel's fallback
to it was ruinous. The panel resumes from where the _record_ stops rather than
from where it was last delivered — it has just loaded history — and the feed's
tick window is bounded and is emptied by a restart, so that sequence is
routinely older than anything the feed holds. Refused, the panel drew no live
bar and the newest candle stood still for up to an hour while the price line
moved. Reported twice by the Human Owner and reproduced by hosted CI (run
33689094040, five failed panel tests) against a green local gate.

**Why not make it the default.** A silent jump forward is what CA6-31 and
CA6-32 exist to prevent, and a client that did not ask to be told would be
handed one. Opt-in leaves every existing client's contract exactly where it was;
the `gap` event is what makes the opt-in honest, because a gap a client is told
about is not a gap it mistakes for the market (INV-002).

**Why not an ADR.** It adds a parameter and preserves the default. The
architecture it belongs to is written down in `CATALOGUE_AND_PANEL.md` §5.2.

## 2026-09-02 — The local launcher serves the working tree

**Decision.** `~/.otc-local/start.sh` defaults `OTC_TREE` to `$HOME/Projects/otcv6`
and prints the tree, branch and commit it served.

**Why.** It pointed at `~/.otc-audit7/fix`, the out-of-band audit's worktree,
parked on `main`. Two rounds of "the chart is still broken" were about a program
that had never contained the fix. Both reports were accurate; they were about a
different build. The third instance of this project's most expensive mistake —
testing the wrong thing and believing the answer — so the launcher now says what
it ran (see PH-21.3 §5.1).

## 2026-09-03 — §37's non-natural terminal tick is not built

**Decided:** the Lab does not append a synthetic tick to reach a target outside
the natural range. An unreachable close is refused with its reason and its
reachable neighbours; the operator widens the window instead (PH-24.5 §3).

**Alternative:** ADR-0015 §3 permitted exactly one shape — a synthetic terminal
tick, only in the Lab, labelled, excluded from every measurement — "only where
it can never enter a published record". Building PH-24.2–24.4 made the
condition concrete: the Lab market's feed _is_ the Lab's published record (its
chart, its positions, its `control` all read it). A tick appended to the feed
collides with the engine's own sequence numbering (INV-002, in the Lab); a tick
kept beside the feed settles a position at a price no chart showed (INV-003,
L6–L7). Neither is a testing environment for a product whose claim is that
chart, close and settlement are one price.

**Revisit if:** the Lab ever gets a record of its own that no chart draws from
and no settlement reads — at which point the tick would have somewhere to go,
and would still need every fence ADR-0015 §3 names.

## 2026-09-03 — PH-24 stays open until the Lab is complete; the cycle boundary waits

**Decided:** PH-24 is not approved until everything the Lab is meant to do, and
its tests, are finished. The Human Owner directed it in their own words —
_"fusión, CI y Auditoría de Ciclo 8 solo se aplicará cuando … esté terminada;
vamos a terminar absolutamente todo lo del lab y las pruebas"_ — and the form
that honours it without amending Governance is to keep the phase **active** and
add the remaining Lab work as its subphases (PH-24.6 the UX redesign, then the
items the specification audit and the Lab inventory of 2026-09-03 list), rather
than approve PH-24 and open PH-25.

**Alternative:** approve PH-24 now and open new phases. `GOVERNANCE.md` §28
makes the third approved phase of a cycle a hard boundary — development stops
and Cycle Audit 8 runs — and PH-24 would be that third phase. Opening PH-25
after it would have to postpone an audit the rules say does not wait, which is a
Governance amendment only the Human Owner may make (§5.1) and which they did
not ask for; they asked for the Lab to be finished first.

**Consequence:** a longer phase with more subphases than any before it, each
still gated and approved from evidence in its turn; the phase gate, the merge to
`main`, hosted CI and Cycle Audit 8 all at the end. The full gate started on
`15d25ec` for the phase closure was stopped as moot (unit 113 files / 2,445
tests green, 6 of 43 statistical files run) and will be re-run on the final tree.

**Revisit if:** the phase grows past what one audit can examine — then the
Human Owner may prefer to approve a first half and let §28 run.

## 2026-09-03 — The Lab is two controls; a push is N signs, never an added amount

**Decided:** The Human Owner re-stated what the Lab is for — _"realmente yo
solo necesito hacer varias cosas"_: push or pull the price by buttons (`+1 +3
+5 +10` and their negatives), repeatable, the market otherwise free; and make
the current candle close at a chosen price — with the condition that pushes
_"deben ser naturales … los movimientos que él hace después deben ser
naturales"_. So a push of `+N` is the next `N` ticks taking the upward sign,
magnitudes and intervals the engine's own, then the keystream (PH-24.10). The
alternative first proposed — an offset added to every published tick — was
withdrawn on that condition: an added amount is not a movement the engine made.

**Alternative:** `+N` as a target displacement in price units reached naturally.
Refused for now: at this engine's tick sizes a visible displacement takes
minutes to hours of same-sign ticks, and a button that lands minutes later is
not the control described. The natural unit of a natural push is the tick.

**Consequence:** the Lab's screen is reorganised around the two controls; the
replay/mirror groundwork (`2ff8559`) is parked as modules with no route or tab;
large runs as jobs (§67) leave the Lab's scope. Nothing built for PH-24.1–24.9
is removed — it moves one tab back.

**Revisit if:** the Human Owner wants a push sized in price rather than ticks —
then it is a selection with a target and a window, like an exact close with an
open end, and can be built on `selectContinuation`.

## 2026-09-03 — A push is instantaneous: the pending tick is retracted and the burst selects arrivals

**Decided:** _"El empujar se torna demasiado lento; tiene que ser más dinámico
e instantáneo."_ A push (PH-24.10) began after the drawn, unpublished tick
published and then walked at the market's natural pace. PH-24.13 makes it
begin at the instant of the click and finish in seconds: the hosted market,
built retractable only in the Lab composition, retracts its unpublished tick
(nothing observed it; the engine returns to the state before that draw and
draws again from the same keystream positions); and the pushed ticks' arrival
draws are selected — `SelectableArrival`, the sign wrapper's twin — at
`u = e^(-1/12)`, one twelfth of the base tempo, the fastest pace the engine's own
Hawkes law produces, closer still as the burst excites it. Magnitudes are never
touched; duration coupling shrinks a fast tick as it always does.

**Alternative:** publish the burst with rescaled instants, or add a displacement.
Both refused: the first rewrites the engine's timing, the second the price.
Neither is a movement the engine made.

**Consequence:** the Lab selects two of the engine's five streams (signs,
arrivals) instead of one; the production composition still selects none
(`composition.test.ts`, extended). The specification's "manual volatility
controls" stay out of scope: the burst is a property of a push, not a dial.

**Revisit if:** the Human Owner wants the burst's pace as a control — then
`BURST_DIVISOR` becomes a per-push parameter with the same fences.

## 2026-09-03 — Engine calibration inside the Lab phase: tick granularity (PH-24.17)

**Decided:** The Human Owner found the candles gappy — the open far from the
previous close most of the time — and asked whether it was the regime or
something to improve. Measured: it is tick granularity (few, large ticks; the
gap is one step), not the regime and not the chart. They chose to fix the
engine now, inside PH-24: _"el Lab todavía necesita trabajo pero es importante
que el motor funcione bien; vamos con el motor en esta misma fase."_ PH-24.17
is engine work under the Lab phase, and it takes the **full** gate, because
family traits change.

**Alternative:** close PH-24 first and open an engine phase. That runs Cycle
Audit 8 first (§28), which the Human Owner has deferred until the Lab is
complete; and the Lab is the instrument this work measures itself with.

**Consequence:** PH-24 now carries one subphase whose scope is the engine's
personalities. The Cycle Audit that follows PH-24 will examine it with the
rest — a longer audit, as the earlier decision foresaw.

**Revisit if:** the calibration turns out to need more than family ranges —
then it is a phase of its own after the audit.

## 2026-09-04 — A close on a side of a level is a conditioned selection, not a live rule

**Context.** PH-24.21 adds ▲ / ▼ to the Lab's close: the candle must end above
or below the mark, crossing it meanwhile allowed. The Human Owner proposed a
live rule instead of a new selection — turn sube on when the price crosses the
wrong way, off when it crosses back — to avoid "touching the engine".

**Decision.** The close is honoured by an acceptance test in the selection that
already exists (`selectCloseWhere`, rejection sampling: the first natural path
whose close satisfies the condition), used only by the Lab; the market's own
path is armed as is when it already satisfies.

**Why.** Neither option touches the price core (INV-001; the selection lives in
`@otc/engine` beside the exact one and is Lab-only by composition, ADR-0015).
The rule alone cannot guarantee the final tick: sube / baja are tendencies (runs
for and shorter runs against), so the last stretch would still need a scripted
finish — the mechanism the rule meant to avoid — plus a live controller with a
timer, state across ticks and automatic actions in the session. The conditioned
selection is a few deterministic lines, tested in the existing harness, and its
endpoint is drawn uniformly from the satisfying closes rather than glued to the
mark (§28, §70). The rule's live-correction feel can be added on top later
without undoing anything.

## 2026-09-04 — The Lab is complete enough: merge, hosted CI and Cycle Audit 8 are released

**Context.** On 2026-09-03 the Human Owner suspended the merge to `main`, hosted
CI and Cycle Audit 8 until the Lab was finished, and every remaining item was
added as a PH-24.x subphase. Fifteen subphases later (PH-24.10–24.24) they
asked for the route to be reverted, for a two-minute cap on the sustained
direction, and then — in the same message — for the merge, hosted CI and the
audit to run, with every finding resolved afterwards.

**Decision.** The pause is lifted. PH-24.24 closes PH-24; the phase is verified
and gated in full, merged to `main`, hosted CI runs on that push, and Cycle
Audit 8 follows immediately as §28 requires (PH-22, PH-23 and PH-24 are the
cycle's three approved phases). Findings are fixed under §31.

**Why.** The suspension was the Human Owner's and so is its end; it was stated
in their own message alongside the work that closes the Lab. Nothing else about
the loop changes: the audit is adversarial and independent (§28.1), and its
findings are recorded whether or not they are convenient.
