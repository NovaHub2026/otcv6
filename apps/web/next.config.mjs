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
/** Where this server reaches the engine. Never sent to the browser. */
const engineOrigin = process.env.OTC_API_BASE ?? 'http://127.0.0.1:3000';

const config = {
  reactStrictMode: true,
  transpilePackages: ['@otc/chart', '@otc/core'],
  env: {
    OTC_API_BASE: engineOrigin,
  },
  /**
   * The engine is served under the panel's own origin, at `/engine`.
   *
   * The browser therefore talks to exactly one host and one port. That is worth
   * more than it looks:
   *
   * - It removes a whole class of "cannot reach the engine" — a second port to
   *   open, forward, or find already taken. The first person to open this panel
   *   hit exactly that: the panel loaded and every request to the engine's port
   *   failed, because something else on the host already held it.
   * - It removes the dependency on CORS for the ordinary deployment. The engine
   *   still sends the headers, because a separate origin is a legitimate way to
   *   run it, but the default path does not need them.
   *
   * `OTC_API_BASE` is read here, on the server, and never reaches the browser —
   * so the engine does not have to be publicly reachable at all.
   */
  async rewrites() {
    return [{ source: '/engine/:path*', destination: `${engineOrigin}/:path*` }];
  },
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return webpackConfig;
  },
};

export default config;
