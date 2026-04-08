const nodeExternals = require('webpack-node-externals');
const path = require('path');

module.exports = function (options, webpack) {
  const isDev = process.env.NODE_ENV !== 'production';

  const entry = isDev
    ? ['webpack/hot/poll?100', options.entry]
    : options.entry;

  const plugins = isDev
    ? [
        ...options.plugins,
        new webpack.HotModuleReplacementPlugin(),
        new webpack.WatchIgnorePlugin({ paths: [/\.js$/, /\.d\.ts$/] }),
      ]
    : [
        ...options.plugins,
        // whatsapp-web.js ve puppeteer'ı Railway'de yok sayıyoruz
        new webpack.IgnorePlugin({ resourceRegExp: /^whatsapp-web\.js$/ }),
        new webpack.IgnorePlugin({ resourceRegExp: /^puppeteer$/ }),
        new webpack.IgnorePlugin({ resourceRegExp: /^puppeteer-core$/ }),
      ];

  return {
    ...options,
    entry,
    externals: [
      nodeExternals({
        allowlist: ['webpack/hot/poll?100', '@mali-musavir/shared'],
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
    plugins,
  };
};
