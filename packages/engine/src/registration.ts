import type { MasterKeyring, RandomSource } from '@otc/core';
import {
  calibrateAssetAsync,
  type AssetDefinition,
  type CalibratedAsset,
  type CalibrationOptions,
} from './asset.js';
import { registrationKeyLabel, type AuthoringTargets, type RegisteredAsset } from './catalogue.js';
import {
  assertPersonalitySafe,
  authorPersonality,
  personalityConfig,
  type PersonalityTraits,
} from './personality.js';

/**
 * Registering an asset at run time.
 *
 * The catalogue was a compiled constant, so adding an asset meant editing
 * TypeScript. That is what PH-17 changes — but the important part is not that
 * the definition becomes data. It is that **everything the compiled catalogue
 * did by hand has to happen before the asset exists**, in order, with any step
 * able to refuse:
 *
 * 1. the identity is usable as a filename and a key label;
 * 2. the personality is *safe* — `assertPersonalitySafe` rejects combinations
 *    whose volatility inflation is unbounded, in microseconds;
 * 3. the traits are **solved** from targets rather than authored by hand, because
 *    `clustering` contributes to kurtosis raised to the power of the component
 *    count and PH-3 reached an excess kurtosis of 1366 doing it the other way;
 * 4. the lattice is **calibrated** from this asset's own return distribution;
 * 5. the asset is **differentiated** from every asset already in the catalogue,
 *    or INV-007 stops being true the moment the catalogue grows.
 *
 * Steps 3 and 4 are simulation. Registration is a job of order a minute, not an
 * insert, and anything driving it must treat it as one.
 *
 * ## Why the differentiation check is injected
 *
 * It needs `@otc/lab`, and the dependency direction forbids the engine from
 * reaching it — correctly, because lab carries the planted-defect corpus and
 * nothing in the venue may drag that in.
 *
 * So the engine states the *requirement* and the caller supplies the
 * implementation. That is deliberately not an optional parameter with a
 * permissive default: a registration with no differentiation check would let
 * a hundred assets be twenty clones of five, and INV-007 says they have
 * genuinely distinct statistical personalities. The check is required, and
 * `registerAsset` refuses without one.
 */

export type RegistrationStage =
  'identity' | 'safety' | 'authoring' | 'calibration' | 'differentiation';

export type RegistrationOutcome =
  | { readonly kind: 'registered'; readonly asset: RegisteredAsset }
  | {
      readonly kind: 'refused';
      readonly stage: RegistrationStage;
      readonly reason: string;
    };

/**
 * Decides whether a freshly calibrated asset is distinct enough to admit.
 *
 * Returns null to admit, or a reason to refuse. The caller brings this because
 * only the caller can depend on the laboratory that measures it.
 */
export type DifferentiationCheck = (
  candidate: CalibratedAsset,
  existing: readonly RegisteredAsset[],
) => Promise<string | null> | string | null;

export interface RegistrationRequest {
  readonly id: string;
  readonly family: AssetDefinition['family'];
  readonly displayName: string;
  readonly referencePrice: number;
  readonly displayPrecision: number;
  /**
   * The personality's character: the ladder of timescales and the shape.
   *
   * `volatility` and `clustering` are solved from {@link targets}, so whatever
   * is supplied for them here is a starting point for the solve rather than a
   * value that survives it.
   */
  readonly traits: PersonalityTraits;
  /** What the personality is solved to achieve. */
  readonly targets: AuthoringTargets;
}

export interface RegistrationOptions {
  readonly keyring: MasterKeyring;
  readonly environment: Parameters<MasterKeyring['derive']>[0]['env'];
  /** Assets already in the catalogue. A new one must differ from all of them. */
  readonly existing: readonly RegisteredAsset[];
  readonly differentiates: DifferentiationCheck;
  readonly calibration?: CalibrationOptions;
}

/**
 * The shape an asset id must take.
 *
 * It becomes a filename and part of a key derivation label, so the constraint is
 * the same one `FileStateStore` and `assertAssetId` already impose. Sharing the
 * shape rather than the code, because the engine may not import the runtime.
 */
export const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Refuse an identity that cannot be a filename, a key label, or told apart. */
export function checkIdentity(
  request: Pick<RegistrationRequest, 'id' | 'displayName' | 'referencePrice' | 'displayPrecision'>,
  existing: readonly RegisteredAsset[],
): string | null {
  if (!ASSET_ID_PATTERN.test(request.id)) {
    return `Asset id ${JSON.stringify(request.id)} must match ${String(ASSET_ID_PATTERN)}: it becomes a filename and a key-derivation label.`;
  }
  if (existing.some((asset) => asset.definition.id === request.id)) {
    // Two assets sharing an id share a keystream, which is one market published
    // under two names — INV-003 broken at registration time.
    return `Asset id ${request.id} is already registered. Two assets with one id derive the same streams.`;
  }
  if (!Number.isFinite(request.referencePrice) || request.referencePrice <= 0) {
    return `Reference price must be finite and positive, got ${request.referencePrice}.`;
  }
  if (!Number.isInteger(request.displayPrecision) || request.displayPrecision < 0) {
    return `Display precision must be a non-negative integer, got ${request.displayPrecision}.`;
  }
  if (request.displayName.trim().length === 0) {
    return 'An asset needs a display name.';
  }
  return null;
}

/**
 * Register an asset, or refuse and say at which stage.
 *
 * Every refusal names its stage, because "the asset was rejected" is not
 * actionable and "the personality solve could not reach the target tail weight
 * from this ladder" is.
 */
export async function registerAsset(
  request: RegistrationRequest,
  options: RegistrationOptions,
): Promise<RegistrationOutcome> {
  const identity = checkIdentity(request, options.existing);
  if (identity !== null) return { kind: 'refused', stage: 'identity', reason: identity };

  const derive = (purpose: string): RandomSource =>
    options.keyring.derive({
      env: options.environment,
      asset: registrationKeyLabel(request.id),
      purpose,
      keyEpoch: 0,
    });

  // The gate first, because it is microseconds and the solve is a minute.
  try {
    assertPersonalitySafe(personalityConfig(request.traits), derive('safety-probe'));
  } catch (error) {
    return { kind: 'refused', stage: 'safety', reason: (error as Error).message };
  }

  let authored;
  try {
    authored = authorPersonality(request.traits, request.targets, derive);
  } catch (error) {
    return { kind: 'refused', stage: 'authoring', reason: (error as Error).message };
  }

  const definition: AssetDefinition = {
    id: request.id,
    family: request.family,
    displayName: request.displayName,
    referencePrice: request.referencePrice,
    traits: authored.traits,
  };

  let calibrated: CalibratedAsset;
  try {
    calibrated = await calibrateAssetAsync(definition, derive, options.calibration ?? {});
  } catch (error) {
    return { kind: 'refused', stage: 'calibration', reason: (error as Error).message };
  }

  const distinct = await options.differentiates(calibrated, options.existing);
  if (distinct !== null) {
    return { kind: 'refused', stage: 'differentiation', reason: distinct };
  }

  return {
    kind: 'registered',
    asset: {
      definition,
      instrument: { ...calibrated.instrument, displayPrecision: request.displayPrecision },
      evidence: calibrated.evidence,
      authored: {
        excessKurtosis: authored.achievedExcessKurtosis,
        tickRms: authored.tickRms,
      },
    },
  };
}
