/**
 * The frontend consumes the API over HTTP, never the engine.
 *
 * `@otc/chart` and `@otc/core` are written for NodeNext, so their internal
 * imports carry `.js` specifiers that point at `.ts` sources. A bundler will not
 * make that mapping on its own, so it is stated here rather than worked around
 * by duplicating the packages' internals.
 *
 * Those two packages contain no React and no I/O, which is what keeps the
 * rendering contract testable in a plain Node process rather than only in a
 * browser.
 */
const config = {
  reactStrictMode: true,
  transpilePackages: ['@otc/chart', '@otc/core'],
  /*
   * The engine is served under the panel's own origin at `/engine`, by the route
   * handler in `src/app/engine/[...path]/route.ts` rather than by a rewrite
   * here. A rewrite to an external destination does not stream, and a live
   * market is nothing but a stream — the reasoning and the measurement are in
   * that file.
   *
   * `OTC_API_BASE` is still read on the server and never reaches the browser, so
   * the engine does not have to be publicly reachable at all.
   */
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return webpackConfig;
  },
};

export default config;
