# Project Introduction

Type: Permanent foundational project context  
Status: Foundational reference  
Lifecycle: Not a phase or subphase  
Governance: GOVERNANCE.md  
Language: English

---

# 1. Project Identity

This project is a synthetic OTC market engine designed primarily to support binary-options / fixed-expiration event-contract trading.

Its purpose is not merely to generate random prices or visually convincing charts.

The system must generate continuous synthetic markets that behave with sufficient structural, statistical, and visual richness to resemble plausible financial markets while remaining resistant to exploitable directional predictability.

The OTC Engine is intended to be a reusable multi-asset market platform capable of creating synthetic instruments inspired by multiple financial-market families.

Initial and expected asset families include:

- Forex;
- Crypto;
- Commodities;
- Indices;
- ETFs.

The engine must be extensible so that additional asset families can be introduced in the future without redesigning the core market-generation model.

---

# 2. Vision

The long-term vision is to create a high-integrity OTC market platform capable of generating multiple distinct synthetic markets continuously, consistently, and safely.

The system should produce markets that:

- feel alive and dynamic rather than scripted;
- exhibit recognizable financial-market behavior;
- preserve continuity through time;
- exhibit realistic regime, volatility, structure, and microstructure behavior;
- remain internally coherent across ticks, candles, timeframes, clients, and settlements;
- remain statistically differentiated between assets;
- resist exploitation through deterministic patterns;
- remain independent from user positions and the broker's economic exposure;
- can be audited and historically reconstructed.

The target is not perfect imitation of any specific real-world exchange.

The target is a credible synthetic market system with its own controlled personalities, statistical characteristics, and market dynamics.

---

# 3. Core Objective

The core objective of the project is:

> Build a continuous multi-asset synthetic OTC market engine for binary-options trading that produces rich, plausible, differentiated market behavior without exposing deterministic or materially exploitable directional patterns.

The engine must balance two properties simultaneously:

1. Market realism.
2. Anti-predictability.

Realism must not be achieved through rigid scripted patterns.

Anti-predictability must not be achieved by turning the market into meaningless white noise.

The desired system is structured but not deterministically exploitable.

---

# 4. Fundamental Market Principle

The foundational architectural principle is:

> Realism must exist in volatility, regime, structure and microstructure; exploitable predictability must not exist in future price direction.

The engine is allowed and expected to contain temporal dependence where that dependence is required for plausible market behavior.

Examples include:

- volatility persistence;
- volatility clustering;
- trends;
- consolidations;
- market-regime persistence;
- local microstructure;
- momentum evolution;
- mean-reverting influences;
- nested market structures.

However, these dependencies must not become simple deterministic rules that allow an external observer of the public price stream to infer future direction with a material and reproducible advantage.

---

# 5. Binary-Options Market Context

The OTC Engine is specifically intended to support binary-options / fixed-expiration contracts.

The primary target expiration horizons are:

- 30 seconds;
- 1 minute;
- 2 minutes;
- 3 minutes;
- 4 minutes;
- 5 minutes;
- 10 minutes;
- 15 minutes.

Anti-predictability must therefore be considered at these trading horizons and not only at the next-tick level.

The market-generation model must not introduce artificial patterns tied to:

- expiration duration;
- second of the minute;
- candle boundaries;
- minute boundaries;
- timeframe changes;
- fixed tick counts;
- fixed candle counts;
- fixed internal cycles.

Changing the expiration selected by a user must never influence the underlying market trajectory.

---

# 6. Product Payout Context

The trading product is expected to operate with a typical payout around:

85%

Some promotional or specially configured assets may offer payouts up to:

99%

Payout configuration belongs to the trading/product layer.

It must remain architecturally isolated from price generation.

The Price Engine must never use payout as an input when determining:

- price;
- direction;
- volatility;
- regime;
- market structure;
- future probability distribution.

---

# 7. Multi-Asset Market Model

The OTC Engine must support multiple asset families through a common market-generation foundation.

Every asset should be capable of producing the same broad classes of financial-market behavior, including:

- bullish trends;
- bearish trends;
- sideways markets;
- high-volatility periods;
- low-volatility periods;
- pullbacks;
- consolidation;
- breakouts;
- false breakouts;
- retests;
- reversals;
- momentum changes;
- volatility spikes;
- changing microstructure.

However, assets must not behave identically.

The common behavioral grammar does not imply a common statistical personality.

---

# 8. Asset Personality

Every synthetic asset must possess a distinct market personality.

Two assets must not be equivalent to:

> the same synthetic market multiplied by a different volatility coefficient.

Asset personalities may differ through characteristics such as:

- baseline volatility;
- volatility persistence;
- volatility clustering strength;
- return distribution;
- tail behavior;
- average movement size;
- wick behavior;
- candle morphology;
- trend persistence;
- trend frequency;
- pullback characteristics;
- consolidation behavior;
- breakout behavior;
- reversal behavior;
- spike frequency;
- spike magnitude;
- microstructure;
- tick-size distribution;
- tick-velocity distribution.

Assets from the same family may share broad traits while remaining individually distinguishable.

For example, two Forex-style assets may both exhibit characteristics associated with that family while still having materially different statistical profiles.

The same principle applies to Crypto, Commodities, Indices, ETFs, and future families.

---

# 9. Dynamic but Plausible Behavior

The market must be dynamic without becoming visually or statistically chaotic.

Dynamic behavior means that the market can evolve naturally through:

- changing regimes;
- changing volatility;
- changing momentum;
- changing market structure;
- changing tick behavior;
- changing candle morphology.

Plausibility requires persistence and memory where appropriate.

The engine should not independently redraw the personality of the market on every candle.

Market behavior should emerge from an evolving underlying process.

---

# 10. Market Regimes

The engine must support, at minimum:

- bullish trend;
- bearish trend;
- sideways market;
- high-volatility state;
- low-volatility state.

Regimes must not behave like rigid visual templates.

Transitions may be:

- gradual;
- rapid;
- ambiguous;
- partial;
- aborted.

Regime duration must be stochastic rather than determined by fixed numbers of ticks, seconds, or candles.

The engine should also support nested behavior, such as:

- consolidation inside a larger trend;
- microtrends inside a range;
- pullbacks inside directional movement;
- temporary local structures that do not necessarily change the broader regime.

---

# 11. Trend Behavior

Trends must not be monotonic.

A bullish trend may contain:

- bearish candles;
- pullbacks;
- pauses;
- consolidations;
- failed movements;
- accelerations;
- weakening momentum.

A bearish trend must be capable of equivalent behavior in the opposite direction.

The engine must avoid rules such as:

- after N green candles, force a red candle;
- after N red candles, force a green candle;
- trend for exactly N candles;
- reverse after a fixed number of movements.

Trend length, slope, momentum, and internal structure must vary.

---

# 12. Volatility Behavior

Volatility must evolve through time.

The system should support:

- low-volatility periods;
- high-volatility periods;
- volatility clustering;
- probabilistic mean reversion;
- occasional spikes;
- changing movement speed;
- changing movement magnitude.

Volatility should coherently influence:

- tick size;
- tick speed;
- candle bodies;
- candle wicks;
- candle ranges;
- frequency of extreme moves.

Volatility must not evolve through easily observable fixed schedules or deterministic timers.

---

# 13. Tick-Level Microstructure

Ticks are the fundamental underlying market representation.

The credibility of the market cannot depend only on OHLC candles.

Within a candle, price must be able to:

- move in both directions;
- revisit previous levels;
- accelerate;
- decelerate;
- pause;
- make micro-pullbacks;
- make micro-impulses;
- locally consolidate.

The path inside a candle must not trivially reveal its eventual close.

Tick distances and tick timing must vary according to market state and asset personality.

The engine must avoid artificial alternation or index-based directional patterns.

---

# 14. Candles and OHLC

Candles must emerge from the underlying tick stream.

OHLC must remain mathematically and historically coherent.

For each interval:

OPEN = first valid underlying price.

HIGH = highest underlying price observed.

LOW = lowest underlying price observed.

CLOSE = last valid underlying price.

High and Low must correspond to prices that were actually visited by the underlying market.

The engine must naturally produce diverse candle morphology, including:

- small bodies;
- medium bodies;
- large bodies;
- near-dojis;
- upper wicks;
- lower wicks;
- two-sided wicks;
- large-body candles;
- small-body / large-wick candles.

Candle shape must not be generated from rigid color-specific templates.

---

# 15. Market Structure

The market should naturally be capable of creating visual structures that may be interpreted as:

- support;
- resistance;
- ranges;
- consolidation;
- breakouts;
- false breakouts;
- retests;
- reversals.

These structures must emerge from the underlying process.

They must not be controlled through deterministic rules such as:

> break resistance after exactly three touches.

or:

> reverse after a fixed sequence.

Structure should influence market behavior probabilistically without dictating a guaranteed future direction.

---

# 16. Single Underlying Market

Each asset must have one canonical underlying market stream.

All representations must derive from that same underlying market.

This includes:

- ticks;
- candles;
- timeframes;
- chart data;
- entry prices;
- expiration prices;
- settlement inputs;
- historical reconstruction.

There must not be independent future trajectories for different timeframes.

Changing the timeframe being observed must never alter the future market.

---

# 17. Cross-Timeframe Consistency

All supported timeframes must derive from the same underlying tick stream.

Higher-timeframe candles must be coherent aggregations of the same market activity represented by lower timeframes.

Multiple clients observing the same asset at the same moment must be observing the same underlying market regardless of the timeframe displayed.

Timeframe selection is an observer action.

It must never become an input to price generation.

---

# 18. Shared Multi-User Market

For a given asset and canonical moment, all users must receive the same market price.

There must not be personalized price trajectories.

User-specific information must not affect the market.

The following must remain outside the Price Engine's directional decision process:

- open positions;
- position direction;
- number of users on either side;
- wager volume;
- trader P&L;
- broker P&L;
- payout;
- user balance;
- broker exposure;
- desired winning ratio.

---

# 19. Anti-Manipulation Invariant

The most important market-integrity invariant is:

> The market must never know whether Orbit benefits economically from the next price movement.

The Price Engine must remain economically blind.

Information may flow from the Price Engine to systems that require market prices.

Economic trading state must not flow back into price generation in a way that changes the market trajectory.

Conceptually:

PRICE ENGINE
        ↓
TRADING / POSITION / SETTLEMENT SYSTEMS

must be allowed.

But:

BROKER EXPOSURE / USER POSITIONS / PAYOUT
        ↓
PRICE GENERATION

must not be allowed.

Violation of this principle is a critical architectural defect.

---

# 20. Settlement Integrity

Binary-options settlement must use the same canonical market used by the chart and price stream.

Entry price and expiration price must come from the same underlying market.

The project must maintain a canonical policy for expiration-price selection when no tick exists at the exact mathematical expiration instant.

That policy must be:

- deterministic;
- documented;
- reproducible;
- identical for all users.

Critical timing must be based on authoritative server time.

Client-provided timestamps must not be able to unilaterally determine settlement.

Historical settlement must be reproducible.

---

# 21. Auditability and Historical Reconstruction

The project must preserve sufficient information to investigate and reconstruct historical trading outcomes.

For a settled contract, it should ultimately be possible to reconstruct relevant information such as:

- entry timestamp;
- entry price;
- expiration timestamp;
- expiration price;
- relevant underlying ticks;
- settlement policy;
- final outcome.

Historical reconstruction is a product-integrity requirement, not merely a debugging convenience.

---

# 22. Continuous 24/7 Market

The synthetic market is expected to operate continuously.

The market must not artificially reset because of:

- midnight;
- day changes;
- candle changes;
- timeframe changes;
- process restarts;
- container restarts;
- server restarts.

The system must preserve sufficient state to continue safely after failure or restart.

Restart behavior must not:

- repeat previously generated sequences;
- jump back to an old price;
- create an incompatible new trajectory;
- introduce artificial discontinuities.

---

# 23. Randomness and Private State

Production randomness must be appropriate for a market where public observation must not allow reconstruction of future random states.

Public information must not be sufficient to infer the production random stream.

The frontend must never receive private generator state such as:

- seeds;
- RNG internal state;
- future random values;
- private regime state;
- internal parameters whose disclosure would allow future-price reconstruction.

Different assets must have sufficient random-stream isolation.

Production randomness must also remain isolated from testing, simulation, staging, and backtesting environments.

---

# 24. Statistical Integrity

A market that looks realistic is not automatically acceptable.

The engine must ultimately be validated statistically.

Validation should assess, among other areas:

- return distributions;
- directional behavior;
- volatility persistence;
- runs;
- conditional probabilities;
- autocorrelation;
- mutual information;
- directional entropy;
- trend persistence;
- candle morphology;
- tick microstructure;
- regime behavior;
- cross-asset differentiation;
- outliers and tails.

The purpose of these analyses is not to force every metric toward perfect randomness.

Some structured dependencies are necessary for plausible market behavior.

The objective is to detect artificial structure that produces material and reproducible directional predictability.

---

# 25. Adversarial Anti-Predictability Principle

Before the engine can be considered production-ready, it must withstand adversarial attempts to discover exploitable directional patterns from public market information.

The assumed external observer may have access to:

- historical price streams;
- timestamps;
- public OHLC;
- large historical datasets.

The observer must not need access to private code or internal state.

The project must specifically consider attempts to predict whether future price will be above or below current price at the supported binary-options expirations.

A statistically significant and reproducible directional advantage caused by artificial internal patterns must be treated as a serious integrity failure.

---

# 26. Conceptual System Model

The intended conceptual generation model is:

MARKET STATE
        ↓
REGIME
        ↓
VOLATILITY
        ↓
MARKET STRUCTURE
        ↓
MICROSTRUCTURE
        ↓
TICKS
        ↓
OHLC / TIMEFRAME AGGREGATION
        ↓
PUBLIC MARKET REPRESENTATION
        ↓
TRADING / ENTRY / EXPIRATION / SETTLEMENT

This is a conceptual direction rather than a mandatory implementation architecture.

The Development Agent may evolve the internal implementation architecture as long as all foundational invariants remain protected.

---

# 27. Technical Foundation

Current foundational application stack:

## Backend / Application

- NestJS;
- TypeScript.

Current state:

- backend/application is not yet scaffolded.

## Frontend

- React;
- Next.js;
- TypeScript.

These technologies are part of the current project foundation unless intentionally superseded through an authorized project decision.

Detailed package selection, internal architecture, persistence technology, queues, deployment topology, testing libraries, and similar implementation choices remain under Development Agent authority unless another canonical document defines them.

---

# 28. Development Agent Autonomy

The project is governed under an autonomous-development model.

The Development Agent is expected to transform this Project Introduction and Human strategic intent into:

- detailed product decisions;
- architecture;
- roadmap;
- phases;
- subphases;
- Technical Documents;
- implementation;
- verification;
- documentation;
- Git history;
- audits;
- safe continuation.

The Human Owner is not expected to supply implementation-level specifications for every work block.

The Development Agent should make reasonable product and technical decisions autonomously whenever those decisions remain compatible with this document and Governance.

Human escalation should be reserved for decisions protected by Governance.

---

# 29. Foundational Invariants

The following principles are foundational and must remain protected throughout development.

## INV-001 — Economic Independence

Price generation must remain independent from user positions, user outcomes, payout, broker exposure, and desired business outcomes.

## INV-002 — Shared Market

All users observing the same asset and canonical moment must observe the same underlying market.

## INV-003 — Single Underlying Stream

Ticks, candles, timeframes, chart representation, entry prices, and expiration prices must derive from the same underlying market.

## INV-004 — Timeframe Observer Independence

Changing the displayed timeframe must never modify the future market.

## INV-005 — Expiration Independence

Binary-options expiration selection must never modify price generation.

## INV-006 — No Deterministic Exploitable Directional Rules

The engine must not rely on simple internal rules that create materially exploitable future-direction patterns.

## INV-007 — Asset Differentiation

Assets must possess distinct statistical and behavioral personalities.

## INV-008 — Continuous Market State

Candle boundaries, clock boundaries, and process restarts must not arbitrarily reset the underlying market process.

## INV-009 — Reproducible Settlement

Historical trading outcomes must be explainable and reproducible from authoritative market and settlement records.

## INV-010 — Private Generator State

Private randomness and generator state must never be exposed in a way that enables reconstruction of future market behavior.

---

# 30. Non-Negotiable Product Characteristics

The intended product must remain:

- multi-asset;
- continuous;
- dynamic;
- structurally plausible;
- statistically validated;
- economically independent;
- auditable;
- reproducible;
- resistant to artificial predictability;
- suitable for short fixed-expiration contracts;
- extensible to additional synthetic asset families.

---

# 31. Anti-Goals

The project must not become:

## 31.1 A simple random walk with cosmetic candles

Visual realism without meaningful market dynamics is insufficient.

## 31.2 A collection of scripted chart patterns

The engine must not simply choose from rigid templates for trends, breakouts, reversals, or candles.

## 31.3 A market that secretly reacts to broker exposure

Economic incentives must never alter the synthetic market trajectory.

## 31.4 A set of statistical clones

Assets must not differ only by price scale or volatility multiplier.

## 31.5 A timeframe-specific market generator

There must be one underlying market, not independent markets for 1m, 5m, 15m, or other chart representations.

## 31.6 A visually random but statistically exploitable system

Visual inspection alone is not sufficient evidence of integrity.

## 31.7 A perfectly memoryless noise generator

The market should contain enough state, persistence, and structure to produce plausible behavior.

---

# 32. Definition of Project Success

The project is successful when it can produce multiple continuous synthetic assets whose public behavior demonstrates:

- recognizable but non-scripted market regimes;
- natural trends and pullbacks;
- meaningful volatility dynamics;
- plausible market structure;
- rich tick-level microstructure;
- diverse candle morphology;
- coherent cross-timeframe aggregation;
- clearly differentiated asset personalities;
- reliable multi-user consistency;
- economically blind price generation;
- reproducible entry and settlement behavior;
- continuity through normal operational restarts;
- historical auditability;
- statistical evidence against material artificial directional predictability.

The final standard is not:

> Does the chart look real?

The final standard is:

> Does the system behave like a coherent synthetic market, remain internally auditable, preserve economic independence, and resist exploitation arising from artificial deterministic structure?

---

# 33. Long-Term Direction

The OTC Engine should become a reusable synthetic-market foundation rather than a one-off price generator.

Its architecture should allow the project to evolve toward:

- additional synthetic assets;
- additional asset families;
- richer asset personalities;
- stronger validation tooling;
- deeper market-behavior modeling;
- improved observability;
- improved historical reconstruction;
- continued statistical hardening.

Future evolution must preserve the foundational integrity principles defined in this document.

---

# 34. Final Foundational Statement

The intended OTC Engine is:

> A continuous multi-asset stochastic market system with limited memory and emergent behavior, capable of producing distinct synthetic Forex, Crypto, Commodity, Index, ETF, and future market personalities for binary-options trading.

It must be capable of showing:

- structure;
- momentum;
- regimes;
- volatility;
- memory;
- personality;
- trends;
- consolidations;
- breakouts;
- reversals;
- realistic tick-level movement.

But the public history of the market must not expose a reliable deterministic rule that reveals what internal event will produce the next directional movement.

The market must remain economically blind.

The market must remain shared.

The market must remain reconstructable.

The market must remain coherent.

And every future product, architectural, and implementation decision must preserve those principles.
