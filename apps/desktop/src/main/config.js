'use strict';

// Canlı API (Railway). Geliştirmede MOREN_API_URL ile değiştirilebilir.
const PROD_API = 'https://mali-musavir-app-production.up.railway.app/api/v1';

module.exports = {
  appName: 'Moren Masaüstü',
  apiBaseUrl: (process.env.MOREN_API_URL || PROD_API).replace(/\/+$/, ''),
  isDev: process.env.MOREN_DEV === '1',
};
