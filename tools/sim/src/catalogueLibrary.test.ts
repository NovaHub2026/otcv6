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
    // And by value, not only by name (Cycle Audit 9, a8-10): a trait or a
    // lattice quantum emitted as a bare number, without its field name, passed
    // the checks above. No numeric token in the library may equal any trait
    // value or quantum of any compiled entry, as JavaScript prints them.
    const printed = new Set(
      [...text.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map((m) => m[0].toLowerCase()),
    );
    const secrets = new Map<string, string>();
    for (const asset of ASSET_CATALOGUE) {
      for (const [name, value] of Object.entries(asset.definition.traits) as [string, number][]) {
        // A small integer (`cascadeDepth: 16`) is not a fingerprint and any text
        // contains it; every other trait prints with a dozen digits or more.
        if (Number.isInteger(value) && Math.abs(value) < 1_000) continue;
        secrets.set(String(value).toLowerCase(), `${asset.definition.id}.${name}`);
      }
      secrets.set(
        String(asset.instrument.logQuantum).toLowerCase(),
        `${asset.definition.id}.logQuantum`,
      );
    }
    const leaked = [...secrets].filter(([value]) => printed.has(value)).map(([, who]) => who);
    expect(leaked, 'a trait or quantum value appears in the library').toEqual([]);
  });
});
