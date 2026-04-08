const nodeExternals = require('webpack-node-externals');
const path = require('path');

// pnpm workspace'de node_modules hem root'ta hem api'de olabilir
const rootNodeModules = path.resolve(__dirname, '../../node_modules');
const apiNodeModules = path.resolve(__dirname, 'node_modules');

module.exports = function (options, webpack) {
  return {
    ...options,
    externals: [
      nodeExternals({
        // pnpm workspace root node_modules
        modulesDir: rootNodeModules,
        additionalModuleDirs: [apiNodeModules],
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
    plugins: [...options.plugins],
    // Kritik bağımlılık uyarılarını hata olarak sayma
    stats: {
      ...options.stats,
      warningsFilter: [/Critical dependency/],
    },
  };
};
