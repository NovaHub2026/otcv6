import type { MasterKeyring } from '@otc/core';
import { archetypeById, sampleArchetype, type ArchetypeSample } from './families.js';
import { registrationKeyLabel } from './catalogue.js';
import type { RegistrationRequest } from './registration.js';

/**
 * What an operator actually supplies when creating an asset.
 *
 * A {@link RegistrationRequest} carries a twelve-number personality and a pair
 * of authoring targets. Nobody types those, and nobody should: the whole point
 * of an archetype is that it is a *region* a market is drawn from
 * (`docs/architecture/CATALOGUE_AND_PANEL.md` §2), and a form that asked for a
 * cascade depth would be inviting an operator to author a market by hand —
 * twenty of which are one market with twenty names, which is INV-007 false.
 *
 * So a brief is five fields, four of them identity, and the personality is
 * drawn.
 */
export interface AssetBrief {
  readonly id: string;
  /** Which archetype to draw from — an id from `ASSET_ARCHETYPES`. */
  readonly archetypeId: string;
  readonly displayName: string;
  readonly referencePrice: number;
  /**
   * σ of the terminal log return over a quarter, overriding the archetype's own
   * draw. Omit to take what the family gives.
   *
   * An operator who supplies one is stating a budget, not a price path: the
   * process is a martingale and this is dispersion, never direction
   * (`CATALOGUE_AND_PANEL.md` §3).
   */
  readonly dispersion?: number;
  /** Decimals to render at. Omit to take the lattice's own answer. */
  readonly displayPrecision?: number;
}

/**
 * Draw a personality for a brief, reproducibly.
 *
 * The stream is derived from the master keyring under the asset's own
 * registration label, so the same brief against the same keyring draws the same
 * market — twice, on another machine, a year later. That is what makes a
 * registered asset re-derivable rather than merely recorded: `evidence` says
 * what was measured, and this says the draw it was measured from can be
 * repeated.
 *
 * It also means an id is not a free choice. Two operators who pick the same id
 * for different assets get the same personality *and* the same keystream, which
 * `checkIdentity` refuses for the second reason before this matters.
 */
export function requestFromBrief(
  brief: AssetBrief,
  options: {
    readonly keyring: MasterKeyring;
    readonly environment: Parameters<MasterKeyring['derive']>[0]['env'];
  },
): { readonly request: RegistrationRequest; readonly sample: ArchetypeSample } {
  const archetype = archetypeById(brief.archetypeId);
  const stream = options.keyring.derive({
    env: options.environment,
    asset: registrationKeyLabel(brief.id),
    // A distinct purpose from anything `registerAsset` derives, so drawing the
    // personality cannot consume the solve's randomness or vice versa.
    purpose: 'brief',
    keyEpoch: 0,
  });
  const sample = sampleArchetype(archetype, stream);
  const dispersion = brief.dispersion ?? sample.dispersion;

  // A supplied budget rescales the amplitude the draw implies. The calibration
  // is homogeneous of degree one in `volatility` (CATALOGUE_AND_PANEL.md §3),
  // so this is a multiplication rather than a second search — and the *shape*
  // of the personality, which is what makes it distinct from its siblings, is
  // untouched by it.
  const scale = dispersion / sample.dispersion;
  return {
    sample,
    request: {
      id: brief.id,
      family: archetype.family,
      displayName: brief.displayName,
      referencePrice: brief.referencePrice,
      ...(brief.displayPrecision === undefined ? {} : { displayPrecision: brief.displayPrecision }),
      traits: { ...sample.traits, volatility: sample.traits.volatility * scale },
      targets: { excessKurtosis: sample.excessKurtosis, tickRms: sample.tickRms * scale },
      dispersion,
    },
  };
}
