/**
 * ANLIK BİLDİRİM — saf yardımcılar (ağ/DB yok, birim testi kolay).
 *
 * Expo push servisi (ücretsiz): https://exp.host/--/api/v2/push/send
 *  - Tek istekte en fazla 100 mesaj → PARCALA().
 *  - Yanıt: { data: [ {status:'ok', id} | {status:'error', message, details:{error}} ] } — sıra istekle aynı.
 *  - details.error === 'DeviceNotRegistered' → belirteç ölü, bir daha gönderilmez (disabledAt).
 *  - Kesin sonuç 'makbuz'ta gelir (getReceipts, ~15 dk sonra); iOS'ta ölü belirteç çoğu zaman ancak orada görünür.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_MAKBUZ_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const EXPO_PARCA_BOYU = 100;
/** Android bildirim kanalı — mobil tarafta (push-kanca.ts) aynı adla açılır. */
export const ANDROID_KANAL = 'varsayilan';

export type PushHedef = {
  /** Müşavir/personel kullanıcısı */
  userId?: string | null;
  /** Mükellef portalı kullanıcısı */
  taxpayerId?: string | null;
  /** Yalnız tenantId verilirse: ofisin TÜM müşavir cihazları (tenant geneli bildirim, userId=null) */
  tenantId?: string | null;
};

export type PushMesaj = {
  title: string;
  body: string;
  /** route: mobil uygulamanın gideceği ekran ('bildirim', 'm:ekip' ...) */
  data?: Record<string, unknown> & { route?: string };
  /** true → sessiz saati DELER (yalnız güvenlik: yeni cihaz girişi) */
  acil?: boolean;
};

export type ExpoMesaj = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
  channelId: string;
};

export type ExpoBilet = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };

/** Expo belirteci biçimi: ExponentPushToken[...] ya da ExpoPushToken[...] */
export function expoBelirteciMi(token: unknown): token is string {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/.test(token);
}

/** Diziyi en fazla `boy` elemanlı parçalara böler (Expo tek istekte 100 mesaj kabul eder). */
export function parcala<T>(dizi: T[], boy: number = EXPO_PARCA_BOYU): T[][] {
  const sonuc: T[][] = [];
  for (let i = 0; i < dizi.length; i += boy) sonuc.push(dizi.slice(i, i + boy));
  return sonuc;
}

/**
 * Sessiz saat: Europe/Istanbul'da 22:00–08:00 arası push GİTMEZ (owner-notifier'ın gece kuralıyla uyumlu;
 * gece birikenler sabah özetinde zaten geliyor — ertelenmiş kuyruk YOK, sadece atlanır).
 * Env: PUSH_SESSIZ_BASLANGIC (varsayılan 22, dahil) · PUSH_SESSIZ_BITIS (varsayılan 8, hariç).
 */
export function sessizSaatMi(simdi: Date = new Date()): boolean {
  const baslangic = Number(process.env.PUSH_SESSIZ_BASLANGIC ?? 22);
  const bitis = Number(process.env.PUSH_SESSIZ_BITIS ?? 8);
  if (Number.isNaN(baslangic) || Number.isNaN(bitis) || baslangic === bitis) return false;
  const saat = Number(
    new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', hour12: false, timeZone: 'Europe/Istanbul' }).format(simdi),
  );
  return baslangic > bitis ? saat >= baslangic || saat < bitis : saat >= baslangic && saat < bitis;
}

/** Boşlukları sıkıştırır, `enFazla` karaktere kısaltır (push gövdesi kısa olmalı). */
export function kisalt(metin: unknown, enFazla: number): string {
  const s = String(metin ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= enFazla) return s;
  return s.slice(0, Math.max(0, enFazla - 1)).trimEnd() + '…';
}

/**
 * Bildirim kaydından mobil rota: Ekip (metadata.automationId 'ekip:' ile başlar ya da tur onay/istek) → 'm:ekip';
 * geri kalan her şey → 'bildirim' (zil listesi).
 */
export function rotaSec(bildirim: { metadata?: unknown } | null | undefined): string {
  const md = bildirim?.metadata && typeof bildirim.metadata === 'object' ? (bildirim.metadata as Record<string, unknown>) : {};
  if (String(md.automationId ?? '').startsWith('ekip:')) return 'm:ekip';
  if (md.tur === 'onay' || md.tur === 'istek') return 'm:ekip';
  return 'bildirim';
}

/** Expo'ya gidecek mesaj gövdesi. */
export function expoMesajiKur(token: string, mesaj: PushMesaj): ExpoMesaj {
  return {
    to: token,
    title: kisalt(mesaj.title, 120),
    body: kisalt(mesaj.body, 240),
    data: mesaj.data,
    sound: 'default',
    priority: 'high',
    channelId: ANDROID_KANAL,
  };
}

/** Bilet dizisinden ölü belirteçleri (DeviceNotRegistered) ayıklar; sıra istekteki mesaj sırasıdır. */
export function oluBelirtecler(biletler: ExpoBilet[] | undefined, gonderilen: ExpoMesaj[]): string[] {
  if (!Array.isArray(biletler)) return [];
  const olu: string[] = [];
  biletler.forEach((b, i) => {
    if (b && b.status === 'error' && b.details?.error === 'DeviceNotRegistered' && gonderilen[i]) olu.push(gonderilen[i].to);
  });
  return olu;
}

/** JWT gövdesini DOĞRULAMADAN okur — yalnız hangi Passport stratejisinin deneneceğine karar vermek için. */
export function jwtGovdesi(authorization: unknown): Record<string, unknown> | null {
  const m = /^Bearer\s+(\S+)$/i.exec(String(authorization ?? '').trim());
  if (!m) return null;
  const parca = m[1].split('.');
  if (parca.length < 2) return null;
  try {
    const govde = JSON.parse(Buffer.from(parca[1], 'base64url').toString('utf8'));
    return govde && typeof govde === 'object' ? govde : null;
  } catch {
    return null;
  }
}
