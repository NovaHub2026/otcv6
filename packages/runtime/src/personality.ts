import { createHash } from 'node:crypto';
import type { RegisteredAsset } from '@otc/engine';

/**
 * A fingerprint of the personality a checkpoint was written by.
 *
 * **PH-26.3.** A `MarketStateRecord` carried the asset's id and nothing about
 * the asset: a state file written under `eurusd` by one personality would be
 * loaded, its snapshot restored, and its market continued by *any* personality
 * compiled under that id later. Nothing compared them. The catalogue of thirty
 * dodged it by retiring every incumbent id rather than reusing one — but a
 * runtime that depends on nobody ever reusing an id is a runtime one
 * refactor away from resuming the wrong market (INV-008, INV-009).
 *
 * The fingerprint is over what decides a market's behaviour and settlement:
 * the twelve personality traits, the lattice quantum, the reference price and
 * the family. The id is deliberately not in it — the id is what the record is
 * already keyed by, and the question is whether the *same id* means the same
 * market. Canonical key order, so an equal personality is an equal string.
 */
export function personalityFingerprint(asset: RegisteredAsset): string {
  const traits = asset.definition.traits;
  const canonical = JSON.stringify({
    family: asset.definition.family,
    referencePrice: asset.definition.referencePrice,
    logQuantum: asset.instrument.logQuantum,
    traits: Object.fromEntries(
      (Object.keys(traits) as (keyof typeof traits)[]).sort().map((k) => [k, traits[k]]),
    ),
  });
  // base64url rather than hex: `resume.test.ts` scans every persisted record
  // for long hex runs as a guard against key material leaking into state, and
  // a fingerprint that looked like a key would either trip that guard or teach
  // it an exception — and an exception is exactly where a key would hide.
  return `sha256:${createHash('sha256').update(canonical).digest('base64url')}`;
}
