// Invariant evidence: INV-007 (asset differentiation), INV-010 (private generator state).
import { describe, expect, it } from 'vitest';
import { yieldToLoop } from '@otc/core';
import { ASSET_CATALOGUE, ASSET_SEATS } from '@otc/engine';
import { requestFor } from './catalogueBuild.js';

/**
 * Every compiled entry is the seat's own draw (Cycle Audit 9, a3-02).
 *
 * `catalogue.test.ts` re-authors each entry from its record and compares —
 * which re-derives the two traits the authoring fixed point solves
 * (`clustering`, `volatility`) and passes the other ten through unchanged. A
 * hand-edited tempo, burstiness, cascade span or arrival memory in a compiled
 * entry therefore shipped through the unit project with the record still
 * saying "nothing below was typed". This is the assertion that record leans
 * on: for every seat, the request the builder would make today — the draw
 * under the seat's own registration keyring, with its retreats — carries the
 * exact trait values the compiled entry holds, and the same drawn tail weight
 * and retreat count.
 *
 * In the statistical project because a seat's draw is a feasibility loop
 * (tens of seconds for all thirty), not because the claim is statistical.
 */
const SOLVED = new Set(['clustering', 'volatility']);

describe('the compiled catalogue is the seats’ own draw', () => {
  it('every sampled trait, the drawn tail weight and the retreats of every entry match the seat', async () => {
    const byId = new Map(ASSET_CATALOGUE.map((asset) => [asset.definition.id, asset]));
    expect(byId.size).toBe(ASSET_SEATS.length);
    for (const seat of ASSET_SEATS) {
      await yieldToLoop();
      const compiled = byId.get(seat.id);
      expect(compiled, seat.id).toBeDefined();
      const { request, sample, retreats } = requestFor(seat);
      for (const [name, value] of Object.entries(request.traits)) {
        if (SOLVED.has(name)) continue;
        expect(
          compiled!.definition.traits[name as keyof typeof request.traits],
          `${seat.id} ${name}`,
        ).toBe(value);
      }
      expect(compiled!.authored.drawnExcessKurtosis, `${seat.id} drawnExcessKurtosis`).toBe(
        sample.excessKurtosis,
      );
      expect(compiled!.authored.clampedFrom, `${seat.id} clampedFrom`).toBe(sample.clampedFrom);
      expect(compiled!.authored.retreats, `${seat.id} retreats`).toBe(retreats);
      expect(compiled!.definition.referencePrice, `${seat.id} referencePrice`).toBe(
        seat.referencePrice,
      );
      expect(compiled!.definition.displayName, `${seat.id} displayName`).toBe(seat.displayName);
    }
  }, 600_000);
});
