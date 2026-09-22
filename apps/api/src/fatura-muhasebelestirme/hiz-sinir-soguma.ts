/**
 * ENTEGRATÖR HIZ SINIRI SOĞUMASI (2026-09-22, saf modül; DB/servis yok)
 *
 * Muzaffer Bey: "Yavuz Özkan'da faturaları çek dediğimizde hız sınırına takılıp yarım kalıyor; Mihsap sorunsuz yapıyor."
 *
 * CANLI TEŞHİS (bu tarihte, Yavuz Özkan Turkcell/isim360 API anahtarıyla):
 *  • Liste ucu ŞU AN normal (HTTP 200) — ceza kalıcı değil, frekansa bağlı.
 *  • Kutuda 48.616 gelen fatura var; liste `PageSize=500` kabul ediyor (kodda 100'dü → 5 kat fazla istek).
 *  • `startDate/endDate` süzgeci ucu 400 veriyor (desteklenmiyor) → dönem, sıralı listede geriye giderek bulunur.
 *  • Liste öğesinde `isNew` bayrağı var → Mihsap her gece yalnız yeni gelenleri (günde ~28) çekiyor, bu yüzden
 *    hiç limite girmiyor. Bizim eski akış ay sonunda ~850 faturayı tek seferde indirmeye çalışıyordu.
 *
 * KURAL: 429 görünce inatla tekrar denemek cezayı UZATIYOR (uç sıcak kalıyor). Bunun yerine çekimi nazikçe bitir ve
 * hesaba SOĞUMA koy; soğuma bitene kadar o mükellef+sağlayıcı için ne elle tur döngüsü ne gece çekimi istek atsın.
 * Soğuma bilgisi DB'de (integration_connections.config.taxpayers[tp].cooldownUntil) durur → deploy'a dayanıklıdır.
 */

/** İlk ceza 30 dk; her üst üste 429'da iki katı; tavan 4 saat. */
export const SOGUMA_ILK_MS = 30 * 60 * 1000;
export const SOGUMA_TAVAN_MS = 4 * 60 * 60 * 1000;

export interface SogumaDurumu {
  /** ISO zaman: bu ana kadar istek atılmaz. */
  cooldownUntil?: string | null;
  /** Üst üste kaçıncı 429 (katlama için). */
  cooldownStreak?: number | null;
}

/** Soğuma şu an sürüyor mu? (bozuk/eksik değer → sürmüyor sayılır, çekim engellenmez) */
export function sogumaSuruyorMu(durum: SogumaDurumu | null | undefined, simdi: Date = new Date()): boolean {
  const t = Date.parse(String(durum?.cooldownUntil || ''));
  return Number.isFinite(t) && t > simdi.getTime();
}

/** Kalan soğuma (dakika, yukarı yuvarlı); sürmüyorsa 0. */
export function sogumaKalanDk(durum: SogumaDurumu | null | undefined, simdi: Date = new Date()): number {
  const t = Date.parse(String(durum?.cooldownUntil || ''));
  if (!Number.isFinite(t) || t <= simdi.getTime()) return 0;
  return Math.ceil((t - simdi.getTime()) / 60000);
}

/** 429 alındı → yeni soğuma penceresi (streak katlanır, tavan 4 saat). */
export function sogumaBaslat(onceki: SogumaDurumu | null | undefined, simdi: Date = new Date()): Required<SogumaDurumu> {
  const oncekiStreak = Number(onceki?.cooldownStreak);
  const streak = Number.isFinite(oncekiStreak) && oncekiStreak > 0 ? Math.min(oncekiStreak + 1, 8) : 1;
  const sure = Math.min(SOGUMA_ILK_MS * Math.pow(2, streak - 1), SOGUMA_TAVAN_MS);
  return { cooldownUntil: new Date(simdi.getTime() + sure).toISOString(), cooldownStreak: streak };
}

/** Çekim 429 görmeden bittiyse ceza serisi sıfırlanır (bir dahaki 429 yine 30 dk'dan başlar). */
export function sogumaTemizle(): Required<SogumaDurumu> {
  return { cooldownUntil: null, cooldownStreak: 0 };
}

/**
 * Gece planı / tur döngüsü için: bu satır şu an atlanmalı mı? Atlanacaksa sebep metniyle döner (log/rapor için).
 */
export function sogumaAtlaSebebi(
  durum: SogumaDurumu | null | undefined,
  simdi: Date = new Date(),
): string | null {
  if (!sogumaSuruyorMu(durum, simdi)) return null;
  return `hız sınırı soğuması sürüyor (${sogumaKalanDk(durum, simdi)} dk kaldı)`;
}
