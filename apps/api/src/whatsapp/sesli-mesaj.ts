/**
 * WhatsApp SESLİ MESAJ yardımcıları (PLAN/19 §D, 2026-09-14) — SAF fonksiyonlar, bağımlılık yok.
 *
 * Akış (yalnız SAHİP numaraları): sesli not gelir → Whisper ile yazıya çevrilir → aynı sahip akışına girer
 * → yazılı cevap + (sesli geldiyse ya da "sesli cevap ver" dendiyse) Ogg/Opus sesli not.
 * Bu dosyadaki fonksiyonlar controller'dan bağımsız test edilir (sesli-mesaj.spec.ts).
 */

/** Sesli nota çevrilecek metnin tavanı: uzun raporun yalnız başı seslendirilir, tamamı yazılı gider. */
export const SESLI_NOT_MAX_KARAKTER = 900;
/** "Dediğiniz" satırında gösterilen transkript uzunluğu. */
export const DEDIGINIZ_MAX_KARAKTER = 200;
/** Çeviriye alınacak sesli notun tavanı (Whisper tavanı 25 MB; sesli not ~16 kbps → 8 MB zaten saatlik). */
export const SESLI_NOT_MAX_BAYT = 8 * 1024 * 1024;
/** Çeviriye alınacak sesli notun süre tavanı (saniye): 5 dakika. */
export const SESLI_NOT_MAX_SANIYE = 300;
/** Kuru denemede sesli notun yerine geçen metin (OpenAI çağrısı yapılmaz). */
export const KURU_SESLI_NOT_METNI = '[kuru deneme: sesli not çevrilecekti]';
/** Kuru denemede sesli gönderim yerine __dryReply'a düşen not. */
export const KURU_SESLI_GONDERIM_NOTU = '[kuru deneme: sesli not gönderilecekti]';
/** WhatsApp sesli notunun MIME türü (Baileys varsayılanıyla aynı). */
export const SESLI_NOT_MIME = 'audio/ogg; codecs=opus';
/** Sahibe giden sesli cevabın ses talimatı (MOREN AI ses ekranıyla aynı ton). */
export const SESLI_NOT_SES_TALIMATI = 'Doğal, sıcak, profesyonel bir Türkçe kadın sesiyle konuş. Kısa duraklamalar kullan; hızlı okuma.';

/** Sahibin YAZILI mesajında sesli cevap istemi: "sesli cevap ver", "sesli söyle", "sesli oku", "sesle söyle", "sesli yanıt/anlat". */
const SESLI_CEVAP_KALIBI = /(?:^|[^a-zçğıöşü])sesl[iı] (?:cevap|yanıt|söyle|oku|anlat)|sesle söyle/;

export function sesliCevapIstendi(metin: string): boolean {
  const t = String(metin || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
  return SESLI_CEVAP_KALIBI.test(t);
}

/**
 * Yazılı cevabı seslendirmeye hazırlar: etiketler ([[document:…]]), bağlantılar, markdown işaretleri ve emoji
 * çıkar; boşlukları toplar; `max` karakteri aşarsa kelime sınırında kesip "…" ekler.
 */
export function sesliMetniKirp(metin: string, max = SESLI_NOT_MAX_KARAKTER): string {
  const t = String(metin || '')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' (bağlantı) ')
    .replace(/[*_`~]+/g, '')
    .replace(/[#>|]+/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (t.length <= max) return t;
  const kesik = t.slice(0, max);
  const sonBosluk = Math.max(kesik.lastIndexOf(' '), kesik.lastIndexOf('\n'));
  const govde = sonBosluk > max * 0.6 ? kesik.slice(0, sonBosluk) : kesik;
  return `${govde.replace(/[\s,;:.-]+$/g, '')}…`;
}

/** Yazılı cevabın başına konan tek satır: sahip yanlış anlamayı görsün. */
export function dediginizSatiri(transkript: string, max = DEDIGINIZ_MAX_KARAKTER): string {
  const tek = String(transkript || '').replace(/\s+/g, ' ').trim();
  const kisa = tek.length > max ? `${tek.slice(0, max).trimEnd()}…` : tek;
  return `🎙️ Dediğiniz: "${kisa}"`;
}

/**
 * Ogg/Opus tamponunun süresi (saniye). Son Ogg sayfasının "granule position" değeri Opus'ta hep 48 kHz
 * örnek sayısıdır → /48000. Sayfa bulunamaz ya da değer anlamsızsa null (çağıran tahmine düşer).
 * Ön-atlama (pre-skip, ~6 ms) ihmal edilir. Dekoder/ffmpeg gerekmez.
 */
export function oggOpusSuresiSn(tampon: Buffer): number | null {
  if (!tampon || tampon.length < 27 || tampon.toString('latin1', 0, 4) !== 'OggS') return null;
  let konum = tampon.length;
  for (let deneme = 0; deneme < 8 && konum > 0; deneme++) {
    const i = tampon.lastIndexOf('OggS', konum - 1, 'latin1');
    if (i < 0) return null;
    konum = i;
    if (i + 27 > tampon.length || tampon[i + 4] !== 0) continue; // sürüm baytı 0 olmalı; değilse veri içi rastlantı
    const granule = tampon.readBigInt64LE(i + 6);
    if (granule <= 0n) continue; // -1 = paket bitmeyen sayfa, 0 = başlık sayfası
    const sn = Number(granule) / 48000;
    if (!Number.isFinite(sn) || sn <= 0 || sn > 3600) continue;
    return Math.max(1, Math.round(sn));
  }
  return null;
}

/** Süre okunamazsa kaba tahmin: Türkçe TTS ≈ 14 karakter/sn. */
export function sesliNotSuresiTahmini(metin: string): number {
  return Math.max(1, Math.round(String(metin || '').length / 14));
}
