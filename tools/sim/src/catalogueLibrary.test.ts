import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOGUE, ASSET_SEATS } from '@otc/engine';
import { catalogueLibrary } from './catalogueLibrary.js';

/**
 * PH-26.4: the integration copy of the catalogue is the catalogue.
 *
 * `otc-integration/CATALOGUE.md` is what a broker reads; `ASSET_CATALOGUE` is
 * what the engine hosts. The first is generated from the second, and this is
 * the guard that an edit to either without regenerating the other fails by
 * name — a list a human maintains beside the source is a list that drifts.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const LIBRARY = path.join(repoRoot, 'docs', 'integration', 'CATALOGUE.md');

describe('the integration library is the catalogue', () => {
  it('lists exactly the thirty, in catalogue order, with the seat each was drawn from', () => {
    const text = catalogueLibrary();
    const rows = text.split('\n').filter((line) => /^\| `[a-z0-9-]+` \|/.test(line));
    expect(rows).toHaveLength(ASSET_CATALOGUE.length);
    expect(rows.map((r) => /^\| `([a-z0-9-]+)`/.exec(r)![1])).toEqual(
      ASSET_CATALOGUE.map((a) => a.definition.id),
    );
    for (const seat of ASSET_SEATS) {
      expect(text, `${seat.id} lacks its archetype`).toContain(`| ${seat.archetype} |`);
      expect(text, `${seat.id} lacks its character`).toContain(seat.character.slice(0, 40));
    }
  });

  it('is what the file on disk says, byte for byte', () => {
    const onDisk = readFileSync(LIBRARY, 'utf8');
    expect(onDisk, 'docs/integration/CATALOGUE.md is stale: run `npm run catalogue:library`').toBe(
      catalogueLibrary(),
    );
  });

  it('exposes nothing that reconstructs a future price (INV-010)', () => {
    // A seat's prose may say "volatility"; a trait *field* may not appear at
    // all, nor a keyring label, nor a cursor. The first version of this guard
    // forbade the word and failed on a sentence about a volatility state.
    const text = catalogueLibrary();
    expect(text).not.toMatch(
      /\b(volatility|clustering|tempoMs|burstiness|regimeSpread|structureSpread|durationCoupling|cascade\w*|regimeTempo|arrivalMemoryMs)\s*[:=]/,
    );
    for (const forbidden of ['keyring', 'cursor', 'registration-', 'logQuantum']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
