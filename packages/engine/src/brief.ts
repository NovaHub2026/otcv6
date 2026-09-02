import type { MasterKeyring, RandomSource } from '@otc/core';
import { archetypeById, sampleArchetype, type ArchetypeSample } from './families.js';
import { registrationKeyLabel } from './catalogue.js';
import { authorPersonality, TailWeightUnreachableError } from './personality.js';
import { checkAssetId, type RegistrationRequest } from './registration.js';

/**
 * How far a drawn tail-weight target retreats when the solve cannot reach it.
 *
 * `sampleArchetype` clamps the target to `reachableExcessKurtosis`, and that
 * ceiling has **no closed form** — it is estimated by simulation (PH-10.1 §5.1),
 * so it is a noisy estimate and 0.95 of a noisy estimate is still sometimes too
 * high. Measured after the CA6-24 clamp: **1 brief in 400** was still refused at
 * `authoring`, all of them `alt-crypto`, which is a 22% chance that a
 * hundred-asset build stops on one of them.
 *
 * The only exact oracle for "can this personality reach this tail weight" is the
 * solve. So the brief runs it, and steps the target down by a tenth until it
 * succeeds. Ten percent is coarse enough to converge in one or two steps and
 * fine enough that the personality keeps the character its family drew.
 */
const AUTHORING_RETREAT = 0.9;

/** Retreats before giving up. 0.9^6 is 0.53 — past that the draw was wrong. */
export const AUTHORING_ATTEMPTS = 6;

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
): {
  readonly request: RegistrationRequest;
  readonly sample: ArchetypeSample;
  /**
   * How far the drawn tail weight had to retreat before the solve accepted it.
   *
   * Zero almost always. `AUTHORING_ATTEMPTS` means it never did, and
   * `registerAsset` will refuse this brief at `authoring` and say why.
   */
  readonly retreats: number;
} {
  const archetype = archetypeById(brief.archetypeId);
  // The id becomes the key label below. **Cycle Audit 7, a3-04.** An id the
  // pattern admitted but the label could not hold threw from inside the
  // keyring, and the operator saw a stream-label error where `registerAsset`
  // would have said "too long" at `identity`. Same check, same words, first.
  const identity = checkAssetId(brief.id);
  if (identity !== null) throw new RangeError(identity);
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

  // The same derivation `registerAsset` will use, so this check is not a
  // rehearsal — it is the identical solve against the identical streams, and a
  // target that authors here authors there.
  const derive = (purpose: string): RandomSource =>
    options.keyring.derive({
      env: options.environment,
      asset: registrationKeyLabel(brief.id),
      purpose,
      keyEpoch: 0,
    });
  const { target: excessKurtosis, retreats } = reachableTarget(sample, derive);

  // A supplied budget rescales the amplitude the draw implies. The calibration
  // is homogeneous of degree one in `volatility` (CATALOGUE_AND_PANEL.md §3),
  // so this is a multiplication rather than a second search — and the *shape*
  // of the personality, which is what makes it distinct from its siblings, is
  // untouched by it.
  const scale = dispersion / sample.dispersion;
  return {
    sample,
    retreats,
    request: {
      id: brief.id,
      family: archetype.family,
      displayName: brief.displayName,
      referencePrice: brief.referencePrice,
      ...(brief.displayPrecision === undefined ? {} : { displayPrecision: brief.displayPrecision }),
      traits: { ...sample.traits, volatility: sample.traits.volatility * scale },
      // What the family asked for travels with what the solve was given, so
      // the registered record can say whether the two differ (a3-05).
      targets: {
        excessKurtosis,
        tickRms: sample.tickRms * scale,
        drawnExcessKurtosis: sample.excessKurtosis,
        retreats,
        ...(sample.clampedFrom === undefined ? {} : { clampedFrom: sample.clampedFrom }),
      },
      dispersion,
    },
  };
}

/**
 * The drawn tail weight, or the highest one below it the solve can reach.
 *
 * Returns the target unchanged in the ordinary case — the estimated ceiling is
 * right almost always — and retreats only when the solve says otherwise. A
 * refusal that reaches an operator here would be a refusal about a personality
 * they never chose, which is not something anyone can act on.
 */
function reachableTarget(
  sample: ArchetypeSample,
  derive: (purpose: string) => RandomSource,
): { target: number; retreats: number } {
  let target = sample.excessKurtosis;
  for (let retreats = 0; retreats < AUTHORING_ATTEMPTS; retreats += 1) {
    try {
      authorPersonality(sample.traits, { excessKurtosis: target, tickRms: sample.tickRms }, derive);
      return { target, retreats };
    } catch (error) {
      // Only the refusal a lower target can fix is retried. **Cycle Audit 7,
      // a3-12.** The solve also refuses when the regime and structure layers
      // alone exceed the target — which a retreat makes worse — and when the
      // solved volatility leaves its bounds, which a retreat cannot touch;
      // retrying those cost six structure simulations before an honest
      // refusal that then arrived with the wrong words.
      if (!(error instanceof TailWeightUnreachableError)) throw error;
      target *= AUTHORING_RETREAT;
    }
  }
  // Six retreats and still unauthorable means the *rhythm* is the problem, not
  // the target. `registerAsset` refuses it at `authoring` and names the reason,
  // which is the honest outcome for a draw nothing can solve.
  return { target, retreats: AUTHORING_ATTEMPTS };
}
