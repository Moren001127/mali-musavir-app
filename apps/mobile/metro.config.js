// Learn more https://docs.expo.dev/guides/monorepos
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// .html dosyalarını varlık (asset) olarak yükle — WebView ile birebir HTML tasarımı göstermek için
config.resolver.assetExts.push('html');

module.exports = config;
