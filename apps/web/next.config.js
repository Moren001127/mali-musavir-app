const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@mali-musavir/shared'],
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Akıllı Bildirim kısa belge linkleri: portal.morenmusavirlik.com/b/<token>
  // mesajlarda kısa görünür; istek API'nin /b ucuna yönlenir, o da belgeye yönlendirir.
  async rewrites() {
    const api = (process.env.NEXT_PUBLIC_API_URL || 'https://mali-musavir-app-production.up.railway.app/api/v1').replace(/\/$/, '');
    return [{ source: '/b/:token', destination: `${api}/b/:token` }];
  },
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
          // CORS: eklenti bu dosyayı MIHSAP/Luca sayfalarından (farklı origin) MAIN world'de
          // fetch ediyor. Vercel'de otomatik gelen CORS header'ı Railway'e taşınınca kayboldu →
          // app.mihsap.com'dan "Failed to fetch" → MIHSAP token senkronizasyonu 25.06'da durdu.
          // ACAO:* ile cross-origin fetch tekrar açılır (credentials:'omit' ile uyumlu).
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
