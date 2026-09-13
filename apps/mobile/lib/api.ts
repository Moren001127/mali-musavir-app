import axios from 'axios';
import { deleteStoredItem, getStoredItem, setStoredItem } from './secure-storage';

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'https://mali-musavir-app-production.up.railway.app/api/v1';

const ACCESS_TOKEN_KEY = 'moren.mobile.accessToken';
const REFRESH_TOKEN_KEY = 'moren.mobile.refreshToken';

let refreshPromise: Promise<string | null> | null = null;

// Aktif kimlik: müşavir mi mükellef mi? Mükellef token'ı refresh edilmez (12 saatlik, 401'de yeniden giriş).
type Audience = 'advisor' | 'taxpayer';
let currentAudience: Audience = 'advisor';

export function setApiAudience(audience: Audience) {
  currentAudience = audience;
}

// ---- Dayanıklılık kancaları (2026-09-13) ----
// Bağlantı durumu: her yanıt (true) / ağ hatası (false, mesaj). index.tsx bunu HTML'deki ince şeride bağlar.
type BaglantiDinleyici = (ok: boolean, mesaj?: string) => void;
let baglantiDinleyici: BaglantiDinleyici | null = null;
export function setBaglantiDinleyici(fn: BaglantiDinleyici | null) {
  baglantiDinleyici = fn;
}

// Oturum düştü: 401 sonrası belirteç yenilenemedi (ya da mükellef belirteci bitti) → belirteçler silindi.
// Paralel isteklerin hepsi 401 alsa da BİR kez bildirilir; yeni belirteç kaydedilince tekrar bildirilebilir.
let oturumDustuDinleyici: (() => void) | null = null;
let oturumDustuBildirildi = false;
export function setOturumDustuDinleyici(fn: (() => void) | null) {
  oturumDustuDinleyici = fn;
}

function baglantiBildir(ok: boolean, mesaj?: string) {
  try {
    baglantiDinleyici?.(ok, mesaj);
  } catch {
    /* dinleyici hatası isteği etkilemesin */
  }
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
  oturumDustuBildirildi = false; // yeni oturum → düşerse yine haber ver
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
  (response) => {
    baglantiBildir(true);
    return response;
  },
  async (error) => {
    // Sunucudan yanıt yoksa (ağ kopuk / DNS / zaman aşımı) → şerit; kullanıcı iptali sayılmaz
    if (!error?.response && !axios.isCancel(error)) {
      const zamanAsimi = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || ''));
      baglantiBildir(false, zamanAsimi ? 'Sunucu yanıt vermiyor' : 'Bağlantı yok');
      return Promise.reject(error);
    }
    if (error?.response) baglantiBildir(true); // sunucu cevap verdi (hata da olsa bağlantı var)

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

      // Yenileme başarısız: oturum düştü → belirteçleri sil, uygulamaya (bir kez) haber ver
      const oturumVardi = await hasStoredSession();
      await clearTokenPair();
      if (oturumVardi && !oturumDustuBildirildi) {
        oturumDustuBildirildi = true;
        try {
          oturumDustuDinleyici?.();
        } catch {
          /* dinleyici hatası isteği etkilemesin */
        }
      }
    }

    return Promise.reject(error);
  },
);

export { API_BASE };
