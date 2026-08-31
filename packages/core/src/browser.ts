/**
 * The domain primitives, without the entropy subsystem.
 *
 * The barrel at `@otc/core` re-exports everything, including the keyring — which
 * imports `node:crypto`. That is correct for a server and wrong for a browser
 * bundle, and PH-8 found it the only way such a thing is ever found: by actually
 * building for a browser, where the build simply failed.
 *
 * The deeper point is that "may `@otc/chart` depend on `@otc/core`?" was the
 * wrong question. It may, and does. What matters is *which part*: a rendering
 * package needs prices, instants and ticks, and has no business anywhere near
 * key derivation. Shipping keyring code to a browser is undesirable even when no
 * secret travels with it.
 *
 * This entry point exposes the time and market domain only. Nothing here reads
 * ambient state, performs I/O, or touches Node built-ins.
 */
export * from './time/index.js';
export * from './market/index.js';
export * from './math/index.js';
