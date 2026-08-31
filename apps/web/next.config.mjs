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
  env: {
    OTC_API_BASE: process.env.OTC_API_BASE ?? 'http://127.0.0.1:3000',
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
