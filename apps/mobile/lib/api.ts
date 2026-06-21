import axios from 'axios';
import { deleteStoredItem, getStoredItem, setStoredItem } from './secure-storage';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const ACCESS_TOKEN_KEY = 'moren.mobile.accessToken';
const REFRESH_TOKEN_KEY = 'moren.mobile.refreshToken';

let refreshPromise: Promise<string | null> | null = null;

// Aktif kimlik: müşavir mi mükellef mi? Mükellef token'ı refresh edilmez (12 saatlik, 401'de yeniden giriş).
type Audience = 'advisor' | 'taxpayer';
let currentAudience: Audience = 'advisor';

export function setApiAudience(audience: Audience) {
  currentAudience = audience;
}

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
});

export async function saveTokenPair(accessToken: string, refreshToken?: string) {
  await setStoredItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    await setStoredItem(REFRESH_TOKEN_KEY, refreshToken);
  } else {
    await deleteStoredItem(REFRESH_TOKEN_KEY);
  }
}

export async function clearTokenPair() {
  await deleteStoredItem(ACCESS_TOKEN_KEY);
  await deleteStoredItem(REFRESH_TOKEN_KEY);
}

export async function hasStoredSession() {
  return Boolean(await getStoredItem(ACCESS_TOKEN_KEY));
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await getStoredItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) return null;

      const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
      await saveTokenPair(data.accessToken, data.refreshToken);
      return data.accessToken as string;
    })()
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

api.interceptors.request.use(async (config) => {
  const token = await getStoredItem(ACCESS_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const url = String(original?.url || '');
    const isAuthRequest =
      url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/refresh') ||
      url.includes('/portal/auth/login');

    if (error.response?.status === 401 && original && !original._retry && !isAuthRequest) {
      original._retry = true;

      // Mükellef oturumunda refresh yok; 401 = oturum bitti, token temizlenir.
      const accessToken = currentAudience === 'advisor' ? await refreshAccessToken() : null;

      if (accessToken) {
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      }

      await clearTokenPair();
    }

    return Promise.reject(error);
  },
);

export { API_BASE };
