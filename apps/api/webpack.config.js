const nodeExternals = require('webpack-node-externals');
const path = require('path');

module.exports = function (options, webpack) {
  return {
    ...options,
    externals: [
      nodeExternals({
        allowlist: ['@mali-musavir/shared'],
      }),
    ],
    resolve: {
      ...options.resolve,
      alias: {
        '@mali-musavir/shared': path.resolve(
          __dirname,
          '../../packages/shared/src/index.ts',
        ),
      },
    },
    plugins: [
      ...options.plugins,
    ],
  };
};
