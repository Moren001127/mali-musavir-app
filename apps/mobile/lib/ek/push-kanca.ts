/**
 * ANLIK BİLDİRİM KANCALARI (push paketi, 2026-09-13) — app/index.tsx bunları çağırır; bkz. lib/ek/tur.ts.
 *  - girisSonrasi(api, persona): bildirim izni iste (iOS / Android 13+) → Expo push belirteci al →
 *    POST /notifications/push-token. Belirteç + taraf değişmediyse (son 24 saat içinde kayıtlıysa) tekrar gönderilmez
 *    (güvenli kasada son kayıt). Expo Go / simülatör / web'de belirteç alınamaz → sessizce geçer.
 *  - cikisOncesi(api): DELETE /notifications/push-token — çıkıştan sonra bu cihaza bildirim gitmesin.
 *  - dinle(gitRoute): bildirime dokununca data.route ile ekrana gider ('bildirim', 'm:ekip' ...);
 *    uygulama bildirimle (soğuk) açıldıysa son yanıt giriş tamamlanınca işlenir. Dönüş: temizleme işlevi.
 * Sunucu tarafı: apps/api/src/push (PushService → exp.host, ücretsiz Expo push servisi).
 * Android kanalı 'varsayilan' — sunucu channelId olarak aynı adı gönderir (expo-push.ts ANDROID_KANAL).
 */
import { Platform } from 'react-native';
import type { AxiosInstance } from 'axios';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { deleteStoredItem, getStoredItem, setStoredItem } from '../secure-storage';

const SON_KAYIT_ANAHTARI = 'moren.mobile.pushKayit';
const ANDROID_KANAL = 'varsayilan';
/** app.json → extra.eas.projectId (yedek olarak sabit; EAS derlemesinde app.json'dan gelir) */
const PROJE_ID_YEDEK = '123489bc-aff1-4fd0-a4f4-901c7b1f91bb';
/** Aynı belirteç bu süreden eskiyse sunucuya yeniden bildirilir (lastSeenAt tazelensin) */
const YENIDEN_KAYIT_MS = 24 * 60 * 60 * 1000;
/** Soğuk açılışta bildirim rotası, giriş tamamlanmazsa en geç bu kadar sonra yine de uygulanır */
const SOGUK_ACILIS_BEKLEME_MS = 8000;

type KayitBilgisi = { token: string; persona: 'adv' | 'tax'; zaman: number };

let onPlanAyarlandi = false;
let islenenYanitId: string | null = null; // aynı bildirim yanıtı iki kez işlenmesin (soğuk açılış + dinleyici)
let bekleyenRota: { route: string; uygula: () => void; zamanlayici: ReturnType<typeof setTimeout> } | null = null;

/** Gerçek cihaz + geliştirme derlemesi/mağaza sürümü. Expo Go (SDK 53+) ve web uzak push desteklemez. */
function pushDestekliMi(): boolean {
  if (Platform.OS === 'web') return false;
  if (!Device.isDevice) return false;
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

/** Ön planda gelen bildirim de gösterilsin (afiş + liste + ses). Bir kez kurulur. */
function onPlandaGoster(): void {
  if (onPlanAyarlandi || Platform.OS === 'web') return;
  onPlanAyarlandi = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    /* modül yoksa (web/eski derleme) geç */
  }
}

/** Android bildirim kanalı — önem yüksek (ekranın üstünde afiş + ses). Sunucu channelId='varsayilan' yollar. */
async function androidKanaliKur(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_KANAL, {
      name: 'Genel bildirimler',
      description: 'Onay bekleyen işler, görevler, beyanname ve e-Tebligat uyarıları',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#d4b876',
      sound: 'default',
    });
  } catch {
    /* kanal kurulamazsa sistem varsayılanı kullanılır */
  }
}

/** iOS ve Android 13+ izin ister; daha önce verilmişse tekrar sormaz. */
async function izinAl(): Promise<boolean> {
  try {
    const mevcut = await Notifications.getPermissionsAsync();
    if (mevcut.status === 'granted') return true;
    if (mevcut.status === 'denied' && mevcut.canAskAgain === false) return false;
    const yeni = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return yeni.status === 'granted';
  } catch {
    return false;
  }
}

/** Expo push belirteci (ExponentPushToken[...]); alınamazsa null (Expo Go, FCM/APNs kimliği yok, ağ yok). */
async function belirtecAl(): Promise<string | null> {
  try {
    const projectId: string =
      (Constants.expoConfig?.extra as any)?.eas?.projectId || Constants.easConfig?.projectId || PROJE_ID_YEDEK;
    const sonuc = await Notifications.getExpoPushTokenAsync({ projectId });
    return sonuc?.data || null;
  } catch {
    return null;
  }
}

function cihazAdi(): string {
  const ad = Device.deviceName || Device.modelName || '';
  const sistem = [Platform.OS === 'ios' ? 'iOS' : 'Android', Device.osVersion].filter(Boolean).join(' ');
  return [ad, sistem].filter(Boolean).join(' · ').slice(0, 100);
}

async function sonKaydiOku(): Promise<KayitBilgisi | null> {
  try {
    const ham = await getStoredItem(SON_KAYIT_ANAHTARI);
    if (!ham) return null;
    const k = JSON.parse(ham);
    return k && typeof k.token === 'string' ? (k as KayitBilgisi) : null;
  } catch {
    return null;
  }
}

/** Soğuk açılışta bekletilen bildirim rotasını uygular (giriş bitince ya da süre dolunca). */
function bekleyenRotayiUygula(): void {
  if (!bekleyenRota) return;
  const r = bekleyenRota;
  bekleyenRota = null;
  clearTimeout(r.zamanlayici);
  r.uygula();
}

export async function girisSonrasi(api: AxiosInstance, persona: 'adv' | 'tax'): Promise<void> {
  // Uygulama bildirime dokunarak açıldıysa: giriş tamamlandı, HTML uygulama ekranına geçti → rotaya git (kısa gecikme: render)
  if (bekleyenRota) setTimeout(bekleyenRotayiUygula, 800);

  if (!pushDestekliMi()) return;
  onPlandaGoster();
  await androidKanaliKur();
  if (!(await izinAl())) return;
  const token = await belirtecAl();
  if (!token) return;

  // Aynı belirteç + aynı taraf son 24 saatte kaydedildiyse sunucuyu yorma
  const onceki = await sonKaydiOku();
  if (onceki && onceki.token === token && onceki.persona === persona && Date.now() - (onceki.zaman || 0) < YENIDEN_KAYIT_MS) return;

  await api.post('/notifications/push-token', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    persona,
    deviceName: cihazAdi(),
  });
  try {
    const kayit: KayitBilgisi = { token, persona, zaman: Date.now() };
    await setStoredItem(SON_KAYIT_ANAHTARI, JSON.stringify(kayit));
  } catch {
    /* kasa yazılamazsa bir sonraki girişte yeniden kaydedilir */
  }
}

export async function cikisOncesi(api: AxiosInstance): Promise<void> {
  const onceki = await sonKaydiOku();
  if (!onceki?.token) return;
  try {
    // Oturum belirteci henüz geçerli (index.tsx çıkışta bunu auth.logout'tan ÖNCE çağırır)
    await api.delete('/notifications/push-token', { data: { token: onceki.token } });
  } finally {
    // Sunucuya ulaşılamasa da yerel kaydı sil: bir sonraki giriş belirteci yeni sahibiyle yeniden kaydeder
    await deleteStoredItem(SON_KAYIT_ANAHTARI).catch(() => undefined);
  }
}

export function dinle(gitRoute: (route: string) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  onPlandaGoster();

  const isle = (yanit: Notifications.NotificationResponse | null, sogukAcilis: boolean) => {
    if (!yanit) return;
    const id = yanit.notification?.request?.identifier || '';
    if (id && id === islenenYanitId) return;
    islenenYanitId = id;
    const veri: any = yanit.notification?.request?.content?.data || {};
    const route = typeof veri.route === 'string' && veri.route ? veri.route : 'bildirim';
    if (!sogukAcilis) {
      gitRoute(route);
      return;
    }
    // Soğuk açılış: WebView + giriş henüz hazır olmayabilir → girisSonrasi'nda ya da en geç 8 sn sonra uygula
    if (bekleyenRota) clearTimeout(bekleyenRota.zamanlayici);
    bekleyenRota = {
      route,
      uygula: () => gitRoute(route),
      zamanlayici: setTimeout(bekleyenRotayiUygula, SOGUK_ACILIS_BEKLEME_MS),
    };
  };

  let abonelik: { remove: () => void } | null = null;
  try {
    abonelik = Notifications.addNotificationResponseReceivedListener((yanit) => isle(yanit, false));
    Notifications.getLastNotificationResponseAsync()
      .then((yanit) => isle(yanit, true))
      .catch(() => undefined);
  } catch {
    /* bildirim modülü yoksa dinleme yok */
  }

  return () => {
    try {
      abonelik?.remove();
    } catch {
      /* zaten kaldırılmış */
    }
    if (bekleyenRota) {
      clearTimeout(bekleyenRota.zamanlayici);
      bekleyenRota = null;
    }
  };
}
