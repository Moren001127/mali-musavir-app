import axios from 'axios';
import { API_BASE } from './api';

// Mükellef portalı, müşavir oturumundan AYRI token kullanır (çakışmasın).
const TOKEN_KEY = 'moren_taxpayer_token';

export function getTaxpayerToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setTaxpayerToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export const taxpayerApi = axios.create({ baseURL: API_BASE });

taxpayerApi.interceptors.request.use((config) => {
  const t = getTaxpayerToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

taxpayerApi.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      if (window.location.pathname.startsWith('/mukellef')) {
        setTaxpayerToken(null);
        window.location.href = '/giris/mukellef';
      }
    }
    return Promise.reject(error);
  },
);
