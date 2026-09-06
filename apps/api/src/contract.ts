/**
 * The venue's contract lives with its clients (PH-29.3): `@otc/client` holds
 * the routes, the version and the renderer, so the venue and the broker's
 * conformance suite share one definition. This module is the venue's view of
 * it, kept so the controller and the guard import from where they always did.
 */
export {
  API_ROUTES,
  API_VERSION,
  CONTRACT_HISTORY,
  contractDigest,
  contractDocument,
  renderContract,
  type FieldType,
  type RouteContract,
  type Shape,
} from '@otc/client';
