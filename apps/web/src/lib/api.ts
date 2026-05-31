import axios from 'axios';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

export function setAccessToken(token: string | null) {
  accessToken = token || null;
}

export function getAccessToken() {
  return accessToken;
}

function clearAuthAndRedirect() {
  setAccessToken(null);
  if (typeof window === 'undefined') return;
  if (!window.location.pathname.startsWith('/giris')) {
    window.location.href = '/giris';
  }
}

export function refreshAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const { data } = await axios.post(
        `${API_BASE}/auth/refresh`,
        {},
        { withCredentials: true },
      );
      setAccessToken(data.accessToken);
      return data.accessToken as string;
    })()
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const url = String(original?.url || '');
    const isAuthRequest =
      url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/refresh');

    if (error.response?.status === 401 && original && !original._retry && !isAuthRequest) {
      original._retry = true;

      const nextAccessToken = await refreshAccessToken();
      if (nextAccessToken) {
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${nextAccessToken}`;
        return api(original);
      }

      clearAuthAndRedirect();
    }

    return Promise.reject(error);
  },
);

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = accessToken || (await refreshAccessToken());
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const requestInit: RequestInit = {
    ...init,
    headers,
    credentials: init.credentials || 'include',
  };
  let response = await fetch(input, requestInit);

  if (response.status === 401) {
    const nextAccessToken = await refreshAccessToken();
    if (nextAccessToken) {
      headers.set('Authorization', `Bearer ${nextAccessToken}`);
      response = await fetch(input, { ...requestInit, headers });
    }
    if (response.status === 401) clearAuthAndRedirect();
  }

  return response;
}

export const apiClient = api;
