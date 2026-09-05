import type { AssetFamily } from '@otc/core';
import {
  archetypeById,
  type AssetArchetype,
  type Range,
  type SampledTraitRanges,
} from './families.js';

const SECOND = 1_000;
const HOUR = 3_600_000;

/**
 * A seat: where inside its archetype an asset of the catalogue of thirty lives.
 *
 * **PH-26.2.** The Human Owner asked for thirty predefined assets with distinct
 * characters, and decided that no archetype is added and no family is added.
 * A personality typed by hand is thirty chances to author something a
 * feasibility guard refuses after a multi-million-tick calibration; a bare draw
 * from an archetype has no character. A seat is the middle: a **narrowing of
 * the archetype's ranges**, recorded beside the asset, from which its
 * personality is drawn under a stream seeded by its own id. The seed makes it
 * reproducible, the archetype makes it legal, the seat makes it itself.
 *
 * A seat is not a ninth archetype. It never enters `ASSET_ARCHETYPES`, the
 * admin surface cannot name it, and `seats.test.ts` checks every seat exactly
 * the way `families.test.ts` checks every archetype — inside its parent's box on
 * every trait, feasible at its worst corner — because a narrowed box that
 * nothing checks is the one region of trait space nothing has ever looked at.
 *
 * ## Where a seat leaves its archetype's band, it says so
 *
 * Eight equity seats carry dispersion budgets of 0.105 to 0.32 against
 * `sector-etf`'s declared 0.035–0.07, and three index seats 0.14 to 0.24 against
 * `blue-chip-index`'s 0.01–0.022. Nothing in the registration pipeline clamps a
 * supplied budget, so these register — but Apple is not a sector fund, and the
 * departure is recorded in {@link AssetSeat.budgetNote} rather than presented
 * as conformance. `seats.test.ts` refuses a seat outside its band without one.
 *
 * ## Ids
 *
 * Every id carries `-otc`, and two of the thirty — EUR/USD and GBP/JPY — share
 * a name with an incumbent they replace. The incumbents' ids `eurusd` and
 * `gbpjpy` are retired and never reused: an id is a key-derivation label and a
 * state filename, and a checkpoint written by the old personality must never be
 * resumable by the new one under the same name (INV-008, INV-009).
 *
 * ## Reference prices
 *
 * The **August 2026 monthly average** of each real instrument, which is what
 * the Human Owner asked for, measured on 2026-09-04 against the dated source
 * recorded in {@link AssetSeat.priceSource}. The eight invented indices have no
 * true price and open at 1,000 USDT. A reference price is only the origin of the
 * log lattice; the market tracks nothing.
 */
export interface AssetSeat {
  readonly id: string;
  readonly displayName: string;
  /** The archetype whose box this seat narrows. Must exist in `ASSET_ARCHETYPES`. */
  readonly archetype: string;
  /** The family the archetype declares; recorded so the catalogue reads without a lookup. */
  readonly family: AssetFamily;
  readonly referencePrice: number;
  /** Where the reference price came from, with its date. */
  readonly priceSource: string;
  /** The profile the seat honours, in one or two sentences. */
  readonly character: string;
  /** σ of the terminal log return over a quarter. */
  readonly dispersion: number;
  /** Required when `dispersion` lies outside the archetype's declared band. */
  readonly budgetNote?: string;
  readonly excessKurtosis: Range;
  readonly traits: SampledTraitRanges;
}

const r = (min: number, max: number): Range => ({ min, max });
const h = (min: number, max: number): Range => ({ min: min * HOUR, max: max * HOUR });
const s = (min: number, max: number): Range => ({ min: min * SECOND, max: max * SECOND });

const FX_SOURCE = 'X-Rates monthly average table, August 2026, fetched 2026-09-04';
const ECB_SOURCE = 'ECB euro reference rates, August 2026 daily series, fetched 2026-09-04';
const STOCK_SOURCE =
  'stockanalysis.com daily closes, all 21 August 2026 sessions, fetched 2026-09-04';
const INDEX_SOURCE =
  'Invented index: no true price. Opens at a common base so a percentage reads at a glance.';

export const ASSET_SEATS: readonly AssetSeat[] = [
  // ── Forex: six majors on major-fx, two crosses on cross-fx ──────────────────
  {
    id: 'eurusd-otc',
    displayName: 'EUR/USD OTC',
    archetype: 'major-fx',
    family: 'forex',
    referencePrice: 1.16,
    priceSource: `${FX_SOURCE}: 1.158853`,
    character:
      'The deepest ladder and the longest excitation memory of the eight pairs: sixteen rungs at the tightest spacing the box allows, and a regime that holds.',
    dispersion: 0.038,
    excessKurtosis: r(48, 56),
    traits: {
      tempoMs: r(680, 760),
      burstiness: r(0.56, 0.6),
      regimeSpread: r(0.92, 0.98),
      structureSpread: r(0.97, 1.03),
      durationCoupling: r(0.22, 0.26),
      cascadeDepth: r(16, 16),
      cascadeSpanMs: h(40, 44),
      cascadeSpacing: r(1.9, 2.0),
      regimeTempo: r(1.9, 2.1),
      arrivalMemoryMs: s(370, 400),
    },
  },
  {
    id: 'gbpusd-otc',
    displayName: 'GBP/USD OTC',
    archetype: 'major-fx',
    family: 'forex',
    referencePrice: 1.35,
    priceSource: `${FX_SOURCE}: 1.353825`,
    character:
      'The burstiest major: branching at the ceiling on the shallowest ladder in the box, with the fastest regime turnover. Flurries, then quiet.',
    dispersion: 0.043,
    excessKurtosis: r(64, 74),
    traits: {
      tempoMs: r(600, 670),
      burstiness: r(0.63, 0.66),
      regimeSpread: r(1.06, 1.13),
      structureSpread: r(0.92, 0.98),
      durationCoupling: r(0.27, 0.31),
      cascadeDepth: r(11, 11),
      cascadeSpanMs: h(24, 26),
      cascadeSpacing: r(2.65, 2.8),
      regimeTempo: r(1.2, 1.3),
      arrivalMemoryMs: s(200, 240),
    },
  },
  {
    id: 'usdjpy-otc',
    displayName: 'USD/JPY OTC',
    archetype: 'major-fx',
    family: 'forex',
    referencePrice: 159,
    priceSource: `${FX_SOURCE}: 158.797918`,
    character:
      'The fastest tape of the majors on the shortest excitation memory, with the flattest session shape: pace without structure.',
    dispersion: 0.052,
    excessKurtosis: r(58, 68),
    traits: {
      tempoMs: r(550, 590),
      burstiness: r(0.58, 0.62),
      regimeSpread: r(1.02, 1.08),
      structureSpread: r(0.9, 0.93),
      durationCoupling: r(0.19, 0.23),
      cascadeDepth: r(14, 14),
      cascadeSpanMs: h(32, 37),
      cascadeSpacing: r(2.35, 2.55),
      regimeTempo: r(1.5, 1.7),
      arrivalMemoryMs: s(150, 165),
    },
  },
  {
    id: 'audusd-otc',
    displayName: 'AUD/USD OTC',
    archetype: 'major-fx',
    family: 'forex',
    referencePrice: 0.71,
    priceSource: `${FX_SOURCE}: 0.709795`,
    character:
      'The widest regime multipliers and the heaviest tail in the majors, with the weakest duration coupling: a commodity currency that changes state, not rhythm.',
    dispersion: 0.058,
    excessKurtosis: r(70, 75),
    traits: {
      tempoMs: r(770, 850),
      burstiness: r(0.61, 0.65),
      regimeSpread: r(1.12, 1.15),
      structureSpread: r(1.07, 1.13),
      durationCoupling: r(0.18, 0.2),
      cascadeDepth: r(13, 13),
      cascadeSpanMs: h(26, 29),
      cascadeSpacing: r(2.55, 2.7),
      regimeTempo: r(1.35, 1.45),
      arrivalMemoryMs: s(175, 195),
    },
  },
  {
    id: 'usdchf-otc',
    displayName: 'USD/CHF OTC',
    archetype: 'major-fx',
    family: 'forex',
    referencePrice: 0.81,
    priceSource: `${ECB_SOURCE}, EUR/CHF ÷ EUR/USD: 0.8076`,
    character:
      'The calmest major: burstiness at the floor, the narrowest regimes, the longest regime sojourns, and the lightest tail the box allows.',
    dispersion: 0.033,
    excessKurtosis: r(45, 50),
    traits: {
      tempoMs: r(880, 960),
      burstiness: r(0.52, 0.54),
      regimeSpread: r(0.9, 0.93),
      structureSpread: r(0.95, 1.01),
      durationCoupling: r(0.25, 0.28),
      cascadeDepth: r(13, 13),
      cascadeSpanMs: h(37, 41),
      cascadeSpacing: r(2.2, 2.35),
      regimeTempo: r(2.1, 2.2),
      arrivalMemoryMs: s(310, 350),
    },
  },
  {
    id: 'eurgbp-otc',
    displayName: 'EUR/GBP OTC',
    archetype: 'major-fx',
    family: 'forex',
    referencePrice: 0.856,
    priceSource: `${ECB_SOURCE}: 0.8561`,
    character:
      'The slowest tape of the eight pairs and the smallest budget in the catalogue, with structure and duration coupling at their ceilings: a range that breathes.',
    dispersion: 0.03,
    excessKurtosis: r(53, 61),
    traits: {
      tempoMs: r(1000, 1050),
      burstiness: r(0.53, 0.57),
      regimeSpread: r(0.97, 1.03),
      structureSpread: r(1.12, 1.15),
      durationCoupling: r(0.3, 0.32),
      cascadeDepth: r(15, 15),
      cascadeSpanMs: h(29, 32),
      cascadeSpacing: r(2.0, 2.15),
      regimeTempo: r(1.7, 1.9),
      arrivalMemoryMs: s(255, 285),
    },
  },
  {
    id: 'gbpjpy-otc',
    displayName: 'GBP/JPY OTC',
    archetype: 'cross-fx',
    family: 'forex',
    referencePrice: 215,
    priceSource: `${ECB_SOURCE}, EUR/JPY ÷ EUR/GBP: 215.06`,
    character:
      'The fastest tape of the eight pairs on six widely separated rungs: the cross that changes character abruptly, with the heaviest tail in forex.',
    dispersion: 0.215,
    excessKurtosis: r(120, 130),
    traits: {
      tempoMs: r(355, 390),
      burstiness: r(0.68, 0.7),
      regimeSpread: r(1.26, 1.3),
      structureSpread: r(0.85, 0.89),
      durationCoupling: r(0.28, 0.32),
      cascadeDepth: r(6, 6),
      cascadeSpanMs: h(10.5, 12),
      cascadeSpacing: r(4.0, 4.2),
      regimeTempo: r(0.4, 0.5),
      arrivalMemoryMs: s(25, 32),
    },
  },
  {
    id: 'eurjpy-otc',
    displayName: 'EUR/JPY OTC',
    archetype: 'cross-fx',
    family: 'forex',
    referencePrice: 184,
    priceSource: `${ECB_SOURCE}: 184.10`,
    character:
      'The considered cross: nine rungs close together, the longest memory the box allows, and the calmest budget in cross-fx.',
    dispersion: 0.15,
    excessKurtosis: r(85, 92),
    traits: {
      tempoMs: r(540, 600),
      burstiness: r(0.55, 0.58),
      regimeSpread: r(1.05, 1.11),
      structureSpread: r(1.05, 1.1),
      durationCoupling: r(0.18, 0.22),
      cascadeDepth: r(9, 9),
      cascadeSpanMs: h(6, 7),
      cascadeSpacing: r(3.0, 3.15),
      regimeTempo: r(0.74, 0.8),
      arrivalMemoryMs: s(60, 70),
    },
  },

  // ── Equities: eight on sector-etf, declared etf (the Human Owner's decision) ─
  {
    id: 'aapl-otc',
    displayName: 'Apple OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 310,
    priceSource: `${STOCK_SOURCE}, AAPL mean close 310.19`,
    character:
      'The long-memory large-cap: excitation that decays over six to seven minutes on a ten-rung ladder whose slowest component turns over in a day and a half.',
    dispersion: 0.12,
    budgetNote: 'A single stock, not a sector fund: 1.7× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(44, 54),
    traits: {
      tempoMs: r(1050, 1200),
      burstiness: r(0.42, 0.47),
      regimeSpread: r(0.86, 0.93),
      structureSpread: r(1.22, 1.32),
      durationCoupling: r(0.2, 0.24),
      cascadeDepth: r(10, 10),
      cascadeSpanMs: h(34, 40),
      cascadeSpacing: r(2.5, 2.8),
      regimeTempo: r(1.75, 1.95),
      arrivalMemoryMs: s(360, 420),
    },
  },
  {
    id: 'msft-otc',
    displayName: 'Microsoft OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 495,
    priceSource: `${STOCK_SOURCE}, MSFT mean close 494.01`,
    character:
      'The market that holds one state: the slowest tape of the eight, the narrowest regimes, the longest sojourns, nine widely separated rungs.',
    dispersion: 0.105,
    budgetNote: 'A single stock, not a sector fund: 1.5× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(40, 48),
    traits: {
      tempoMs: r(1200, 1300),
      burstiness: r(0.42, 0.46),
      regimeSpread: r(0.85, 0.9),
      structureSpread: r(1.3, 1.4),
      durationCoupling: r(0.2, 0.25),
      cascadeDepth: r(9, 9),
      cascadeSpanMs: h(36, 40),
      cascadeSpacing: r(3.1, 3.4),
      regimeTempo: r(2.0, 2.2),
      arrivalMemoryMs: s(380, 420),
    },
  },
  {
    id: 'nvda-otc',
    displayName: 'NVIDIA OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 220,
    priceSource: `${STOCK_SOURCE}, NVDA mean close 218.18`,
    character:
      'The fastest of the eight: branching at the ceiling on a short memory, so dense flurries die inside four minutes while the volatility state keeps changing.',
    dispersion: 0.26,
    budgetNote: 'A single stock, not a sector fund: 3.7× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(58, 70),
    traits: {
      tempoMs: r(750, 850),
      burstiness: r(0.54, 0.58),
      regimeSpread: r(1.0, 1.08),
      structureSpread: r(1.1, 1.18),
      durationCoupling: r(0.28, 0.33),
      cascadeDepth: r(9, 9),
      cascadeSpanMs: h(22, 26),
      cascadeSpacing: r(2.2, 2.45),
      regimeTempo: r(1.3, 1.45),
      arrivalMemoryMs: s(200, 240),
    },
  },
  {
    id: 'tsla-otc',
    displayName: 'Tesla OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 340,
    priceSource: `${STOCK_SOURCE}, TSLA mean close 340.21`,
    character:
      'Duration coupling at the ceiling with the widest regimes and the shortest cascade span: violent bursts that resolve, then re-form somewhere else.',
    dispersion: 0.3,
    budgetNote: 'A single stock, not a sector fund: 4.3× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(60, 70),
    traits: {
      tempoMs: r(820, 950),
      burstiness: r(0.5, 0.55),
      regimeSpread: r(1.02, 1.1),
      structureSpread: r(1.14, 1.24),
      durationCoupling: r(0.32, 0.35),
      cascadeDepth: r(10, 10),
      cascadeSpanMs: h(20, 24),
      cascadeSpacing: r(2.85, 3.15),
      regimeTempo: r(1.3, 1.5),
      arrivalMemoryMs: s(250, 300),
    },
  },
  {
    id: 'meta-otc',
    displayName: 'Meta OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 575,
    priceSource: `${STOCK_SOURCE}, META mean close 575.61`,
    character:
      'Structure at the ceiling against narrow regimes on eleven close rungs: the intraday shape dominates and the slow state does not.',
    dispersion: 0.21,
    budgetNote: 'A single stock, not a sector fund: 3.0× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(50, 62),
    traits: {
      tempoMs: r(950, 1080),
      burstiness: r(0.47, 0.52),
      regimeSpread: r(0.9, 0.98),
      structureSpread: r(1.34, 1.4),
      durationCoupling: r(0.24, 0.29),
      cascadeDepth: r(11, 11),
      cascadeSpanMs: h(30, 36),
      cascadeSpacing: r(2.3, 2.6),
      regimeTempo: r(1.6, 1.8),
      arrivalMemoryMs: s(300, 350),
    },
  },
  {
    id: 'amzn-otc',
    displayName: 'Amazon OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 265,
    priceSource: `${STOCK_SOURCE}, AMZN mean close 266.55`,
    character:
      'Twelve rungs at the tightest spacing the box allows: volatility with memory at every horizon from twenty seconds to a day and a half, and no dominant rhythm.',
    dispersion: 0.17,
    budgetNote: 'A single stock, not a sector fund: 2.4× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(46, 56),
    traits: {
      tempoMs: r(880, 1000),
      burstiness: r(0.46, 0.51),
      regimeSpread: r(0.94, 1.02),
      structureSpread: r(1.18, 1.28),
      durationCoupling: r(0.22, 0.27),
      cascadeDepth: r(12, 12),
      cascadeSpanMs: h(26, 32),
      cascadeSpacing: r(2.2, 2.4),
      regimeTempo: r(1.85, 2.05),
      arrivalMemoryMs: s(270, 320),
    },
  },
  {
    id: 'pbr-otc',
    displayName: 'Petrobras OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 18.4,
    priceSource: `${STOCK_SOURCE}, PBR (NYSE ADR, USD) mean close 18.38`,
    character:
      'The shortest memory in the equity group on both axes — excitation and cascade — with the widest regimes and the narrowest structure: regime-driven, the inverse of Meta.',
    dispersion: 0.19,
    budgetNote: 'A single stock, not a sector fund: 2.7× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(56, 68),
    traits: {
      tempoMs: r(900, 1020),
      burstiness: r(0.52, 0.57),
      regimeSpread: r(1.04, 1.1),
      structureSpread: r(1.1, 1.17),
      durationCoupling: r(0.3, 0.35),
      cascadeDepth: r(11, 11),
      cascadeSpanMs: h(20, 24),
      cascadeSpacing: r(2.6, 2.85),
      regimeTempo: r(1.45, 1.62),
      arrivalMemoryMs: s(180, 210),
    },
  },
  {
    id: 'nu-otc',
    displayName: 'Nubank OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 14.4,
    priceSource: `${STOCK_SOURCE}, NU (NYSE, USD) mean close 14.42`,
    character:
      'Eight rungs at the widest spacing the box allows — few, cleanly separated rhythms — under the widest budget of the eight: a high-beta fintech.',
    dispersion: 0.32,
    budgetNote: 'A single stock, not a sector fund: 4.6× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(50, 60),
    traits: {
      tempoMs: r(780, 880),
      burstiness: r(0.49, 0.54),
      regimeSpread: r(0.96, 1.04),
      structureSpread: r(1.1, 1.16),
      durationCoupling: r(0.26, 0.31),
      cascadeDepth: r(8, 8),
      cascadeSpanMs: h(28, 34),
      cascadeSpacing: r(3.2, 3.4),
      regimeTempo: r(1.3, 1.48),
      arrivalMemoryMs: s(190, 230),
    },
  },

  // ── Crypto: three majors and three alts ─────────────────────────────────────
  {
    id: 'btcusdt-otc',
    displayName: 'BTC/USDT OTC',
    archetype: 'major-crypto',
    family: 'crypto',
    referencePrice: 70_000,
    priceSource:
      'Fortune dated daily quotes, August 2026 (flat near 63k, then 78k late in the month): mean ≈ 69,000',
    character:
      'The deepest ladder in the catalogue at the tightest spacing, on the calmest budget in crypto: the major that drifts through many nested timescales.',
    dispersion: 0.34,
    excessKurtosis: r(115, 128),
    traits: {
      tempoMs: r(300, 340),
      burstiness: r(0.72, 0.75),
      regimeSpread: r(1.25, 1.31),
      structureSpread: r(0.9, 0.96),
      durationCoupling: r(0.2, 0.24),
      cascadeDepth: r(17, 18),
      cascadeSpanMs: h(34, 40),
      cascadeSpacing: r(1.85, 1.95),
      regimeTempo: r(0.4, 0.5),
      arrivalMemoryMs: s(24, 30),
    },
  },
  {
    id: 'ethusdt-otc',
    displayName: 'ETH/USDT OTC',
    archetype: 'major-crypto',
    family: 'crypto',
    referencePrice: 2_100,
    priceSource:
      'Fortune dated daily quotes, August 2026 (below 1,950 for nineteen days, then higher): mean ≈ 2,100',
    character:
      'The same deep ladder as BTC but louder and tighter-breathing: branching at the ceiling on the shortest memory, with the most restless regimes.',
    dispersion: 0.44,
    excessKurtosis: r(138, 155),
    traits: {
      tempoMs: r(340, 400),
      burstiness: r(0.78, 0.82),
      regimeSpread: r(1.36, 1.45),
      structureSpread: r(1.02, 1.1),
      durationCoupling: r(0.27, 0.32),
      cascadeDepth: r(15, 16),
      cascadeSpanMs: h(28, 34),
      cascadeSpacing: r(2.05, 2.25),
      regimeTempo: r(0.3, 0.38),
      arrivalMemoryMs: s(15, 20),
    },
  },
  {
    id: 'bnbusdt-otc',
    displayName: 'BNB/USDT OTC',
    archetype: 'major-crypto',
    family: 'crypto',
    referencePrice: 650,
    priceSource: 'crypto.news dated 2026-08-24 (near 704) and adjacent August quotes: mean ≈ 640',
    character:
      'The ordinary major: the shortest slowest-component of the three, so the volatility level resets about daily, with duration coupling at the ceiling.',
    dispersion: 0.4,
    excessKurtosis: r(125, 140),
    traits: {
      tempoMs: r(420, 500),
      burstiness: r(0.74, 0.78),
      regimeSpread: r(1.3, 1.38),
      structureSpread: r(1.08, 1.15),
      durationCoupling: r(0.31, 0.35),
      cascadeDepth: r(14, 15),
      cascadeSpanMs: h(24, 27),
      cascadeSpacing: r(1.95, 2.1),
      regimeTempo: r(0.34, 0.42),
      arrivalMemoryMs: s(19, 24),
    },
  },
  {
    id: 'solusdt-otc',
    displayName: 'SOL/USDT OTC',
    archetype: 'alt-crypto',
    family: 'crypto',
    referencePrice: 85,
    priceSource:
      'CoinCodex daily closes, August 2026 (26 sessions, low 72.55 on Aug 6, late-month rally): mean 85.73 (sum 2,228.90; the digits swapped, 83.57, stood here until Cycle Audit 9 a3-06 re-summed the closes)',
    character:
      'Fast, shallow and extreme: a handful of widely separated rungs turning over in a few hours, so the chart changes character abruptly rather than gradually.',
    dispersion: 0.59,
    excessKurtosis: r(140, 155),
    traits: {
      tempoMs: r(280, 330),
      burstiness: r(0.8, 0.85),
      regimeSpread: r(1.3, 1.4),
      structureSpread: r(0.9, 1.02),
      durationCoupling: r(0.4, 0.5),
      cascadeDepth: r(8, 9),
      cascadeSpanMs: h(2.5, 4),
      cascadeSpacing: r(3.2, 3.8),
      regimeTempo: r(0.4, 0.5),
      arrivalMemoryMs: s(25, 33),
    },
  },
  {
    id: 'xrpusdt-otc',
    displayName: 'XRP/USDT OTC',
    archetype: 'alt-crypto',
    family: 'crypto',
    referencePrice: 1.2,
    priceSource:
      'CoinCodex daily closes, August 2026 (27 sessions, low 0.9922 on Aug 16): mean 1.181',
    character:
      'The calmest alt: the long end of the cascade span and of the excitation memory, structure over regime — structurally an alt that reads closest to a major.',
    dispersion: 0.53,
    excessKurtosis: r(130, 140),
    traits: {
      tempoMs: r(340, 400),
      burstiness: r(0.72, 0.76),
      regimeSpread: r(1.2, 1.28),
      structureSpread: r(1.05, 1.2),
      durationCoupling: r(0.3, 0.36),
      cascadeDepth: r(9, 9),
      cascadeSpanMs: h(4, 5),
      cascadeSpacing: r(2.6, 2.9),
      regimeTempo: r(0.5, 0.6),
      arrivalMemoryMs: s(38, 45),
    },
  },
  {
    id: 'dogeusdt-otc',
    displayName: 'DOGE/USDT OTC',
    archetype: 'alt-crypto',
    family: 'crypto',
    referencePrice: 0.078,
    priceSource:
      'CoinCodex daily closes, August 2026 (27 sessions, flat 0.069–0.072 then higher): mean 0.0765',
    character:
      'The widest budget in the catalogue on the fastest tape and the shallowest ladder: gap, then flurry. A quiet stretch and then a cluster of large arrivals.',
    dispersion: 0.66,
    excessKurtosis: r(150, 165),
    traits: {
      tempoMs: r(250, 290),
      burstiness: r(0.85, 0.88),
      regimeSpread: r(1.42, 1.5),
      structureSpread: r(0.8, 0.9),
      durationCoupling: r(0.55, 0.65),
      cascadeDepth: r(7, 7),
      cascadeSpanMs: h(1.5, 2.2),
      cascadeSpacing: r(3.8, 4.2),
      regimeTempo: r(0.3, 0.38),
      arrivalMemoryMs: s(15, 20),
    },
  },

  // ── Thematic indices, quoted in USDT, all opening at 1,000 ──────────────────
  {
    id: 'mmx-idx-otc',
    displayName: 'MMX/USDT OTC',
    archetype: 'alt-crypto',
    family: 'crypto',
    referencePrice: 1_000,
    priceSource: INDEX_SOURCE,
    character:
      'Meme Market Index (DOGE · SHIB · PEPE · BONK · FLOKI). The most dynamic asset in the thirty by both dials — alt-crypto pace with the session shape of a meme rally: branching at the ceiling, duration coupling that loads every pause, but a longer memory than DOGE so a move persists.',
    dispersion: 0.62,
    excessKurtosis: r(145, 162),
    traits: {
      tempoMs: r(255, 300),
      burstiness: r(0.84, 0.88),
      regimeSpread: r(1.38, 1.48),
      structureSpread: r(1.05, 1.2),
      durationCoupling: r(0.5, 0.62),
      cascadeDepth: r(9, 9),
      cascadeSpanMs: h(3.5, 5),
      cascadeSpacing: r(2.6, 3.0),
      regimeTempo: r(0.5, 0.6),
      arrivalMemoryMs: s(35, 45),
    },
  },
  {
    id: 'cgx-idx-otc',
    displayName: 'CGX/USDT OTC',
    archetype: 'major-crypto',
    family: 'crypto',
    referencePrice: 1_000,
    priceSource: INDEX_SOURCE,
    character:
      'Crypto Giants Index (BTC · ETH · SOL · XRP · BNB). The deepest ladder in the repository at the narrowest spacing — a continuous smear of rhythms — on a budget below the individual majors, because a basket is less dispersive than its parts.',
    dispersion: 0.38,
    excessKurtosis: r(118, 132),
    traits: {
      // Pushed away from BTC on tempo, regime, structure and coupling after the
      // measurement in `seats.test.ts` put the two 0.020 apart: a basket is
      // slower and more session-shaped than its largest constituent.
      tempoMs: r(390, 450),
      burstiness: r(0.75, 0.79),
      regimeSpread: r(1.33, 1.41),
      structureSpread: r(1.02, 1.1),
      durationCoupling: r(0.25, 0.3),
      cascadeDepth: r(16, 18),
      cascadeSpanMs: h(30, 38),
      cascadeSpacing: r(1.85, 1.92),
      regimeTempo: r(0.44, 0.5),
      arrivalMemoryMs: s(21, 27),
    },
  },
  {
    id: 'aix-idx-otc',
    displayName: 'AIX/USDT OTC',
    archetype: 'blue-chip-index',
    family: 'index',
    referencePrice: 1_000,
    priceSource: INDEX_SOURCE,
    character:
      'Artificial Intelligence Index (NVIDIA · Microsoft · Alphabet · Meta · AMD). The longest memory in the thirty: regimes held two to three times their base sojourn, the narrowest regime multipliers, and structure at the ceiling. What a reader calls a trend here is a long excursion inside a persistent volatility state.',
    dispersion: 0.2,
    budgetNote:
      'A five-name thematic basket, not a blue-chip index: 9.1× the blue-chip-index ceiling of 0.022.',
    excessKurtosis: r(45, 55),
    traits: {
      tempoMs: r(1050, 1150),
      burstiness: r(0.5, 0.56),
      regimeSpread: r(0.75, 0.82),
      structureSpread: r(1.35, 1.45),
      durationCoupling: r(0.26, 0.32),
      cascadeDepth: r(10, 10),
      cascadeSpanMs: h(42, 46),
      cascadeSpacing: r(3.0, 3.2),
      regimeTempo: r(2.5, 2.8),
      arrivalMemoryMs: s(500, 600),
    },
  },
  {
    id: 'tcx-idx-otc',
    displayName: 'TCX/USDT OTC',
    archetype: 'blue-chip-index',
    family: 'index',
    referencePrice: 1_000,
    priceSource: INDEX_SOURCE,
    character:
      'Tech Index (Apple · Microsoft · NVIDIA · Amazon · Meta · Alphabet · Tesla). The calm end of the trend group and the anchor of the amplitude ladder: the slowest tape and the smallest budget of the eight indices — the one a five-minute view can hold.',
    dispersion: 0.14,
    budgetNote:
      'A seven-name thematic basket, not a blue-chip index: 6.4× the blue-chip-index ceiling of 0.022.',
    excessKurtosis: r(30, 40),
    traits: {
      tempoMs: r(1300, 1500),
      burstiness: r(0.42, 0.47),
      regimeSpread: r(0.82, 0.9),
      structureSpread: r(1.2, 1.28),
      durationCoupling: r(0.18, 0.22),
      cascadeDepth: r(8, 8),
      cascadeSpanMs: h(36, 40),
      cascadeSpacing: r(3.6, 3.9),
      regimeTempo: r(2.2, 2.5),
      arrivalMemoryMs: s(300, 380),
    },
  },
  {
    id: 'scx-idx-otc',
    displayName: 'SCX/USDT OTC',
    archetype: 'blue-chip-index',
    family: 'index',
    referencePrice: 1_000,
    priceSource: INDEX_SOURCE,
    character:
      'Social Index (Meta · Alphabet · Snap · Pinterest · Reddit). The loudest of the slow markets: branching at the box ceiling on the longest excitation memory and the fewest, widest-spaced rungs — momentum that persists for ten minutes on a sparse ladder — with the largest budget of the three index seats, because Snap, Pinterest and Reddit are the highest-beta names in any of the baskets.',
    dispersion: 0.24,
    budgetNote:
      'A five-name thematic basket, not a blue-chip index: 10.9× the blue-chip-index ceiling of 0.022.',
    excessKurtosis: r(38, 48),
    traits: {
      tempoMs: r(1150, 1250),
      burstiness: r(0.52, 0.56),
      regimeSpread: r(0.88, 0.95),
      structureSpread: r(1.27, 1.35),
      durationCoupling: r(0.28, 0.32),
      // Seven rungs, the box floor, at the widest spacing it allows: the
      // measurement in `seats.test.ts` put the first version of this seat 0.014
      // from Microsoft's — above the differentiation floor, below the margin —
      // and a social index should not share a ladder with a mega-cap anyway.
      cascadeDepth: r(7, 7),
      cascadeSpanMs: h(38, 43),
      cascadeSpacing: r(3.7, 3.9),
      regimeTempo: r(1.9, 2.1),
      arrivalMemoryMs: s(520, 600),
    },
  },
  {
    id: 'gmx-idx-otc',
    displayName: 'GMX/USDT OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 1_000,
    priceSource: INDEX_SOURCE,
    character:
      'Gaming Index (Roblox · NVIDIA · Take-Two · Electronic Arts · Unity). The most restless of the equity-flavoured indices: the fastest tape and the shortest cascade span sector-etf allows, with branching at the ceiling and the shortest regime sojourns — frequent changes of rhythm.',
    dispersion: 0.22,
    budgetNote:
      'A five-name thematic basket with Roblox and Unity in it: 3.1× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(62, 70),
    traits: {
      tempoMs: r(750, 820),
      burstiness: r(0.55, 0.58),
      regimeSpread: r(0.85, 0.9),
      structureSpread: r(1.3, 1.4),
      durationCoupling: r(0.2, 0.24),
      cascadeDepth: r(8, 8),
      cascadeSpanMs: h(20, 23),
      cascadeSpacing: r(2.2, 2.4),
      regimeTempo: r(1.3, 1.4),
      arrivalMemoryMs: s(180, 200),
    },
  },
  {
    id: 'evx-idx-otc',
    displayName: 'EVX/USDT OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 1_000,
    priceSource: INDEX_SOURCE,
    character:
      'Electric Vehicles Index (Tesla · BYD · Rivian · NIO · Li Auto). Aggressive by the three dials the engine can supply: regime multipliers at the ceiling, duration coupling at the ceiling, and the largest budget of any equity-flavoured index — on the deepest ladder the box allows.',
    dispersion: 0.3,
    budgetNote:
      'A five-name thematic basket of high-beta names: 4.3× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(64, 70),
    traits: {
      tempoMs: r(1000, 1100),
      burstiness: r(0.44, 0.49),
      regimeSpread: r(1.08, 1.1),
      structureSpread: r(1.2, 1.3),
      durationCoupling: r(0.33, 0.35),
      cascadeDepth: r(12, 12),
      cascadeSpanMs: h(36, 40),
      cascadeSpacing: r(2.9, 3.1),
      regimeTempo: r(2.0, 2.2),
      arrivalMemoryMs: s(330, 370),
    },
  },
  {
    id: 'brx-idx-otc',
    displayName: 'BRX/USDT OTC',
    archetype: 'sector-etf',
    family: 'etf',
    referencePrice: 1_000,
    priceSource: INDEX_SOURCE,
    character:
      'Brazil Index (Petrobras · Vale · Nubank · Itaú · Mercado Libre). Structure-led with the macro layer quiet behind it — the shape of the session matters more than a global risk regime — on a short cascade span and a medium budget. Behaves unlike the tech and crypto indices because it lives in neither box.',
    dispersion: 0.17,
    budgetNote:
      'A five-name thematic basket, not a sector fund: 2.4× the sector-etf ceiling of 0.07.',
    excessKurtosis: r(40, 48),
    traits: {
      tempoMs: r(1100, 1180),
      burstiness: r(0.42, 0.45),
      regimeSpread: r(0.92, 0.97),
      structureSpread: r(1.36, 1.4),
      durationCoupling: r(0.2, 0.23),
      cascadeDepth: r(10, 10),
      cascadeSpanMs: h(24, 28),
      cascadeSpacing: r(3.3, 3.4),
      regimeTempo: r(1.4, 1.55),
      arrivalMemoryMs: s(240, 270),
    },
  },
];

/**
 * The narrowed box as an archetype value, so `sampleArchetype` and
 * `assertArchetypeFeasible` can take it exactly as they take the parent.
 *
 * Never registered anywhere: the id is `parent:seat`, and `archetypeById`
 * cannot resolve it — a seat is reachable only through its asset.
 */
export function seatArchetype(seat: AssetSeat): AssetArchetype {
  const parent = archetypeById(seat.archetype);
  return {
    id: `${parent.id}:${seat.id}`,
    label: seat.displayName,
    family: parent.family,
    character: seat.character,
    dispersion: { min: seat.dispersion, max: seat.dispersion },
    excessKurtosis: seat.excessKurtosis,
    traits: seat.traits,
  };
}

export function seatById(id: string): AssetSeat {
  const seat = ASSET_SEATS.find((candidate) => candidate.id === id);
  if (seat === undefined) throw new RangeError(`No seat is recorded for asset ${id}.`);
  return seat;
}
