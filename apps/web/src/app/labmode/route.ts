import { isLabMode } from '../../lib/labMode.js';

/**
 * The deployment's declaration, read when asked (PH-24.12, ADR-0018 §2).
 *
 * A layout-level constant read `process.env` when the page was **built**, where
 * no deployment variables exist, and baked `false` into every prerendered
 * screen: the browser flow saw no banner on Vista with both bases on one
 * origin. Environment is a runtime fact, so it is served by a route that Next
 * evaluates per request, and the banner asks for it on mount.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(
    { active: isLabMode(process.env.OTC_LAB_BASE, process.env.OTC_API_BASE) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
