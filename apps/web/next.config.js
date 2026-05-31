const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@mali-musavir/shared'],
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Bookmarklet'in çektiği moren-agent.js'in tarayıcıda cache'lenmesini engelle.
  // Vercel default static cache header'i agresif (1 yil), bu da yeni sürümlerin
  // kullanicinin tarayicisina ulasmasini geciktiriyor. no-cache + must-revalidate
  // ile her tıklamada en güncel JS indirilir.
  async headers() {
    return [
      {
        source: '/moren-agent.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
