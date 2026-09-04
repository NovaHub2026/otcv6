import { describe, expect, it } from 'vitest';
import { MasterKeyring, type RandomSource } from '@otc/core';
import { ASSET_SEATS, seatArchetype, seatById, type AssetSeat } from './seats.js';
import { MINIMUM_TRAIT_DISTANCE, traitDistance } from './differentiation.js';
import {
  archetypeById,
  ASSET_ARCHETYPES,
  assertArchetypeFeasible,
  sampleArchetype,
  sampleTraits,
  type Range,
  type SampledTraitRanges,
} from './families.js';
import {
  assertPersonalityTraits,
  cascadeTimescalesMs,
  MIN_FASTEST_COMPONENT_TICKS,
  type PersonalityTraits,
} from './personality.js';
import { ASSET_ID_PATTERN } from './registration.js';

/**
 * PH-26.2: a seat is checked exactly the way an archetype is, and then more.
 *
 * A seat is a narrowing of an archetype's box that never enters
 * `ASSET_ARCHETYPES`. `assertArchetypeFeasible` iterates that array, and it is
 * not called at registration at all — its only caller is `families.test.ts` —
 * so a seat that nothing checks would be the one region of trait space nothing
 * has ever looked at. Every seat goes through the same guard here, and through
 * the three checks an archetype does not need: that it lies inside its parent,
 * that its budget departure is declared, and that no two seats are close enough
 * for the differentiation check to refuse a draw after a multi-million-tick
 * calibration.
 */
const keyring = MasterKeyring.forTesting('seats-spec');
const stream = (label: string): RandomSource =>
  keyring.derive({ env: 'test', asset: 'seats', purpose: label, keyEpoch: 0 });

const SAMPLED = [
  'tempoMs',
  'burstiness',
  'regimeSpread',
  'structureSpread',
  'durationCoupling',
  'cascadeDepth',
  'cascadeSpanMs',
  'cascadeSpacing',
  'regimeTempo',
  'arrivalMemoryMs',
] as const satisfies readonly (keyof SampledTraitRanges)[];

/** The ids the thirty replace. Retired, never reused (see `seats.ts`). */
const RETIRED = ['eurusd', 'gbpjpy', 'btcusd', 'spx', 'xauusd'];

const inside = (inner: Range, outer: Range): boolean =>
  inner.min >= outer.min && inner.max <= outer.max && inner.min <= inner.max;

describe('the catalogue of thirty', () => {
  it('is exactly thirty seats: eight pairs, eight equities, six crypto, eight indices', () => {
    expect(ASSET_SEATS).toHaveLength(30);
    const byFamily = new Map<string, number>();
    for (const seat of ASSET_SEATS) {
      byFamily.set(seat.family, (byFamily.get(seat.family) ?? 0) + 1);
    }
    // Equities are `etf` and three thematic indices are `etf` too, by the Human
    // Owner's decision; the crypto family holds the six pairs and two indices.
    expect(Object.fromEntries(byFamily)).toEqual({ forex: 8, etf: 11, crypto: 8, index: 3 });
    expect(ASSET_SEATS.filter((s) => s.id.endsWith('-idx-otc'))).toHaveLength(8);
  });

  it('gives every seat a legal, unique id that no retired incumbent ever used', () => {
    const ids = ASSET_SEATS.map((seat) => seat.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `${id} does not match ASSET_ID_PATTERN`).toMatch(ASSET_ID_PATTERN);
      expect(id.endsWith('-otc'), `${id} should carry the -otc suffix`).toBe(true);
      expect(RETIRED, `${id} reuses a retired id`).not.toContain(id);
    }
    expect(seatById('eurusd-otc').displayName).toBe('EUR/USD OTC');
    expect(() => seatById('eurusd')).toThrow(/No seat is recorded/);
  });
});

describe('every seat is an archetype’s box, narrowed', () => {
  it.each(ASSET_SEATS.map((seat) => [seat.id, seat] as const))(
    '%s names an archetype that exists and takes its family',
    (_id, seat) => {
      expect(ASSET_ARCHETYPES.map((a) => a.id)).toContain(seat.archetype);
      expect(seat.family).toBe(archetypeById(seat.archetype).family);
    },
  );

  it.each(ASSET_SEATS.map((seat) => [seat.id, seat] as const))(
    '%s lies inside its parent on every sampled trait and on tail weight',
    (id, seat) => {
      const parent = archetypeById(seat.archetype);
      for (const name of SAMPLED) {
        expect(
          inside(seat.traits[name], parent.traits[name]),
          `${id} ${name} [${seat.traits[name].min}, ${seat.traits[name].max}] leaves ` +
            `${parent.id} [${parent.traits[name].min}, ${parent.traits[name].max}]`,
        ).toBe(true);
      }
      expect(inside(seat.excessKurtosis, parent.excessKurtosis), `${id} kurtosis`).toBe(true);
    },
  );

  it.each(ASSET_SEATS.map((seat) => [seat.id, seat] as const))(
    '%s passes the same feasibility guard an archetype does',
    (_id, seat) => {
      expect(() => assertArchetypeFeasible(seatArchetype(seat))).not.toThrow();
    },
  );

  it('declares every budget that leaves its archetype’s band, and only those', () => {
    for (const seat of ASSET_SEATS) {
      const band = archetypeById(seat.archetype).dispersion;
      const departs = seat.dispersion < band.min || seat.dispersion > band.max;
      if (departs) {
        expect(
          seat.budgetNote,
          `${seat.id} leaves ${seat.archetype}'s band silently`,
        ).toBeDefined();
        expect(seat.budgetNote!.length).toBeGreaterThan(20);
      } else {
        expect(seat.budgetNote, `${seat.id} carries a note it does not need`).toBeUndefined();
      }
    }
    // The departures are the equity and thematic-index seats, and nothing else.
    const departing = ASSET_SEATS.filter((s) => s.budgetNote !== undefined).map((s) => s.id);
    expect(departing.every((id) => seatById(id).family !== 'forex')).toBe(true);
    expect(departing.every((id) => seatById(id).family !== 'crypto')).toBe(true);
    expect(departing).toHaveLength(14);
  });

  it('records where every reference price came from', () => {
    for (const seat of ASSET_SEATS) {
      expect(seat.referencePrice).toBeGreaterThan(0);
      expect(seat.priceSource.length).toBeGreaterThan(20);
      if (seat.id.endsWith('-idx-otc')) {
        expect(seat.referencePrice, `${seat.id} is an invented index`).toBe(1_000);
      } else {
        expect(seat.priceSource, `${seat.id} price has no date`).toMatch(/2026/);
      }
    }
  });
});

describe('a seat draws what it says it draws', () => {
  it.each(ASSET_SEATS.map((seat) => [seat.id, seat] as const))(
    '%s: sixty draws are legal and stay inside the seat',
    (id, seat) => {
      const box = seatArchetype(seat);
      const source = stream(`draw-${id}`);
      for (let draw = 0; draw < 60; draw += 1) {
        const traits = sampleTraits(box, source);
        expect(() => assertPersonalityTraits(traits), `${id} draw ${draw}`).not.toThrow();
        for (const name of SAMPLED) {
          const { min, max } = seat.traits[name];
          expect(traits[name], `${id} draw ${draw} ${name}`).toBeGreaterThanOrEqual(min);
          expect(traits[name], `${id} draw ${draw} ${name}`).toBeLessThanOrEqual(max);
        }
        const scales = cascadeTimescalesMs(traits);
        expect(scales[scales.length - 1]!).toBeGreaterThanOrEqual(
          MIN_FASTEST_COMPONENT_TICKS * traits.tempoMs,
        );
      }
    },
  );

  it('no two seats can draw personalities the differentiation check would refuse', () => {
    // The check at registration is `traitDistance >= MINIMUM_TRAIT_DISTANCE`
    // against every asset already registered. Measured over draws rather than
    // argued from centres: twenty draws per seat, every cross-seat pair, and
    // the closest pair anywhere must clear the floor with room to spare.
    const draws = new Map<string, PersonalityTraits[]>();
    for (const seat of ASSET_SEATS) {
      const box = seatArchetype(seat);
      const source = stream(`pair-${seat.id}`);
      draws.set(
        seat.id,
        Array.from({ length: 20 }, () => sampleArchetype(box, source).traits),
      );
    }
    let closest = Number.POSITIVE_INFINITY;
    let closestPair = '';
    for (let i = 0; i < ASSET_SEATS.length; i += 1) {
      for (let j = i + 1; j < ASSET_SEATS.length; j += 1) {
        const a = ASSET_SEATS[i]!.id;
        const b = ASSET_SEATS[j]!.id;
        for (const x of draws.get(a)!) {
          for (const y of draws.get(b)!) {
            const d = traitDistance(x, y);
            if (d < closest) {
              closest = d;
              closestPair = `${a} vs ${b}`;
            }
          }
        }
      }
    }
    console.info(`closest cross-seat draw: ${closest.toFixed(4)} (${closestPair})`);
    // Twice the floor, because the calibration that follows a refusal at the
    // differentiation stage is the expensive part of registration.
    expect(closest, closestPair).toBeGreaterThan(2 * MINIMUM_TRAIT_DISTANCE);
  });
});

describe('the seat guard has teeth', () => {
  const eurusd = seatById('eurusd-otc');

  it('refuses a seat that leaves its parent’s box', () => {
    const outside: AssetSeat = {
      ...eurusd,
      traits: { ...eurusd.traits, tempoMs: { min: 400, max: 760 } },
    };
    const parent = archetypeById(outside.archetype);
    expect(inside(outside.traits.tempoMs, parent.traits.tempoMs)).toBe(false);
  });

  it('refuses a seat whose worst corner has no feasible spacing', () => {
    const infeasible: AssetSeat = {
      ...eurusd,
      traits: {
        ...eurusd.traits,
        cascadeDepth: { min: 16, max: 16 },
        cascadeSpanMs: { min: 24 * 3_600_000, max: 24 * 3_600_000 },
        cascadeSpacing: { min: 2.8, max: 2.8 },
        tempoMs: { min: 1_050, max: 1_050 },
      },
    };
    expect(() => assertArchetypeFeasible(seatArchetype(infeasible))).toThrow(
      /no feasible cascade spacing/,
    );
  });
});
