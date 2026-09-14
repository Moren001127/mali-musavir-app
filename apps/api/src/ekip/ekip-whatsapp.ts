/**
 * EKİP ↔ WHATSAPP köprüsü — SAF yardımcılar (DB/Nest yok; PLAN/19 §C, 2026-09-14).
 *
 * Muzaffer Bey WhatsApp botuna "şu işi yapın" yazınca bot işi Koordinatör'e iletir; süreç mesajları (başladı / bitti /
 * onay bekliyor / sizden istenen / yapamadı) yine bottan gelir; onay/ret/istek-kapatma bottan yazılarak verilir.
 * Burada yalnız metin işleri var: sahip komutu ayrıştırma, ekip yolu kapısı, WhatsApp'a gidecek mesaj biçimleri.
 * Nest servisi: ekip-whatsapp.service.ts. Bot controller (whatsapp-bot.controller.ts) bu dosyadan yalnız sahipKomutu /
 * ekipYoluMu / ekipWhatsappAcik çağırır — servis ModuleRef ile çözülür (modül döngüsü yok).
 *
 * Komutlar (satır başı, büyük/küçük harf fark etmez, # isteğe bağlı):
 *   ONAYLIYORUM #PRV-1A2B   → dışarı gönderim onayı (ekip-onay.service.onayla)
 *   REDDET #PRV-1A2B [not]  → onay kaydını reddet
 *   YAPILDI #cmnyd1a2       → "sizden istenen" kalemini kapat (bildirim kimliğinin ilk 8 karakteri)
 */
import { ajanSec, ogrenmeSatirlariniSuz } from '../moren-ai/ses-koordinator';

/** Koordinatör koşusu için ilk cevap sınırı: aşınca "iletildi, sonucu buradan yazacağım" denir, koşu arka planda sürer. */
export const WHATSAPP_KOORDINATOR_ILK_CEVAP_MS = Math.max(5_000, Number(process.env.WHATSAPP_KOORDINATOR_ILK_CEVAP_MS || 20_000) || 20_000);

/** Köprü açık mı? Varsayılan AÇIK; kapatmak için EKIP_WHATSAPP_KOORDINATOR=off (ses köprüsündeki EKIP_SES_KOORDINATOR ile aynı kalıp). */
export function ekipWhatsappAcik(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.EKIP_WHATSAPP_KOORDINATOR || '').trim().toLowerCase() !== 'off';
}

/** Sync cevapta raporun en çok bu kadarı; koşu bitti mesajında (arka plan/çocuk) daha kısa. */
export const SAHIP_CEVABI_RAPOR_TAVAN = 1200;
export const BITIS_RAPOR_TAVAN = 600;
/** YAPILDI komutunda bildirim kimliğinin gösterilen/aranan ön eki. */
export const ISTEK_KIMLIK_UZUNLUGU = 8;

export const KURU_TEST_SATIRI = "Kuru testte hazırladım; gerçekten yapmamı isterseniz 'canlı yap' yazın.";

function normalize(text: string): string {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── SAHİP KOMUTU ───

export type SahipKomutTuru = 'ONAYLIYORUM' | 'REDDET' | 'YAPILDI';

export interface SahipKomutu {
  tur: SahipKomutTuru;
  /** ONAYLIYORUM/REDDET: "PRV-XXXX" (büyük harf); YAPILDI: bildirim kimliği ön eki (küçük harf). */
  kimlik: string;
  /** Komuttan sonra yazılan serbest metin (REDDET notu); yoksa ''. */
  not: string;
}

const KOMUT_KALIBI = /^\s*(onayl[ıiİI]yorum|reddet|yap[ıiİI]ld[ıiİI])[\s:\-–]*#?\s*([A-Za-z0-9-]{4,32})\b\s*([\s\S]*)$/i;

/**
 * Sahip komutu mu? "ONAYLIYORUM #PRV-1A2B", "reddet prv-1a2b yanlış mükellef", "yapıldı #cmnyd1a2".
 *  - ONAYLIYORUM/REDDET kimliği PRV-XXXX biçimine getirilir ("1A2B" → "PRV-1A2B"); uymayan kimlik → null (eski akışa kalır).
 *  - YAPILDI kimliği küçük harf; 4-32 harf/rakam.
 *  - Baştaki * / _ (WhatsApp kalın kopyası) ve komuttan sonraki ":" tolere edilir.
 * Çıplak "onaylıyorum" (kimliksiz) eşleşmez → belge-gönder akışının onayı bozulmaz.
 */
export function sahipKomutu(metin: string): SahipKomutu | null {
  const m = String(metin || '').replace(/^[\s*_]+/, '').replace(/[*_]+\s*$/, '').match(KOMUT_KALIBI);
  if (!m) return null;
  const ham = normalize(m[1]);
  const tur: SahipKomutTuru | null = ham.startsWith('onayl') ? 'ONAYLIYORUM' : ham === 'reddet' ? 'REDDET' : ham.startsWith('yap') ? 'YAPILDI' : null;
  if (!tur) return null;
  const not = String(m[3] || '').trim().replace(/^[.,;!]+\s*/, '');
  if (tur === 'YAPILDI') {
    const kimlik = String(m[2]).toLowerCase();
    if (!/^[a-z0-9]{4,32}$/.test(kimlik)) return null;
    return { tur, kimlik, not };
  }
  const buyuk = String(m[2]).toUpperCase();
  const prv = buyuk.match(/^(?:PRV-?)?([A-Z0-9]{4,8})$/);
  if (!prv) return null;
  return { tur, kimlik: `PRV-${prv[1]}`, not };
}

// ─── EKİP YOLU KAPISI ───

const EKIP_KELIMELERI = /(^|[^a-z])(ekip|ekib|koordinator|isler ne durumda|ne yaptiniz|hangi is|personel)/;

/**
 * Mesaj Koordinatör'e gitmeli mi? (bot controller: deterministik kapılardan sonra, runViaMorenAi'den önce)
 *  - PLAN/17 §5 eşlemesi (ajanSec) null değilse — "ajan yok" gerekçeli sonuçlar dahil (Koordinatör nedenini söyler),
 *  - ya da ekip/koordinatör/işler ne durumda/ne yaptınız/hangi iş/personel geçiyorsa (Türkçe ekler serbest: "ekibe", "koordinatöre").
 * Selam/teşekkür/tek kelimelik mesajlar false.
 */
export function ekipYoluMu(metin: string): boolean {
  const t = normalize(metin);
  if (!t) return false;
  if (t.split(' ').filter(Boolean).length < 2) return false;
  if (ajanSec(metin)) return true;
  return EKIP_KELIMELERI.test(t);
}

// ─── METİN YARDIMCILARI ───

/** WhatsApp için sadeleştirme: kod/kalın/başlık işaretleri düşer, madde imleri "• " olur, satırlar korunur. */
export function whatsappIcinSadelestir(text: string): string {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\n)\s{0,3}#{1,6}\s*/g, '$1')
    .replace(/(^|\n)\s*[-*·]\s+/g, '$1• ')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function kirp(text: string, tavan: number): string {
  const t = String(text || '').trim();
  return t.length > tavan ? `${t.slice(0, tavan).trimEnd()}…` : t;
}

/**
 * Ajan raporundan WhatsApp'a gidecek gövde: "RAPOR:" varsa sonrası (SORU: satırı kalır), ÖĞRENDİM/Öğrendiklerim satırları
 * düşer (ogrenmeSatirlariniSuz), markdown sadeleşir, tavan kadar kırpılır.
 */
export function whatsappRaporMetni(rapor: string, tavan = SAHIP_CEVABI_RAPOR_TAVAN): string {
  const metin = ogrenmeSatirlariniSuz(String(rapor || '').replace(/\r/g, '').split('\n')).join('\n');
  const i = metin.search(/(^|\n)\s*(\*\*)?RAPOR\s*(\*\*)?\s*:/i);
  const govde = i >= 0 ? metin.slice(i).replace(/^\s*(\*\*)?RAPOR\s*(\*\*)?\s*:\s*(\*\*)?\s*/i, '') : metin;
  return kirp(whatsappIcinSadelestir(govde), tavan);
}

/** "<mükellef · konu>" — mükellef bilinmiyorsa yalnız konu; konu da boşsa "iş". */
export function baslikSatiri(mukellefAd: string | null | undefined, konu: string | null | undefined): string {
  const k = String(konu || '').trim();
  const m = String(mukellefAd || '').trim();
  if (m && k) return `${m} · ${k}`;
  return m || k || 'iş';
}

/** "Onayınızı bekleyen: yok" ya da her kayıt için "#PRV-… → ONAYLIYORUM #PRV-… yazın". */
export function onaySatiri(onaylar: Array<{ previewId: string }>): string {
  if (!onaylar?.length) return 'Onayınızı bekleyen: yok';
  const idler = onaylar.map((o) => String(o.previewId || '').trim()).filter(Boolean);
  if (idler.length === 1) return `Onayınızı bekleyen: #${idler[0]} → ONAYLIYORUM #${idler[0]} yazın`;
  return `Onayınızı bekleyen: ${idler.map((id) => `#${id}`).join(', ')} → her biri için ONAYLIYORUM #PRV-XXXX yazın`;
}

/** "Sizden istenen: <başlık> — yapınca YAPILDI #<kimlik8> yazın" (birden fazlaysa satır satır). */
export function istekSatiri(istekler: Array<{ id: string; baslik: string }>): string {
  return (istekler || [])
    .filter((i) => i?.id)
    .map((i) => `Sizden istenen: ${kirp(i.baslik || 'iş', 120)} — yapınca YAPILDI #${String(i.id).slice(0, ISTEK_KIMLIK_UZUNLUGU)} yazın`)
    .join('\n');
}

// ─── MESAJ BİÇİMLERİ ───

export interface SahipCevabiGirdisi {
  rapor: string;
  hata?: string | null;
  dryRun: boolean;
  kuruTestSayisi: number;
  onayBekleyen: Array<{ previewId: string }>;
  /** Koşu sırasında açılan "sizden istenen" kalemleri (servis toplar). */
  istekler?: Array<{ id: string; baslik: string }>;
}

/** Koşu 20 sn içinde bitti → sync cevap: [CANLI modda] + rapor + onay + istek + kuru test satırı. */
export function sahipCevabiOlustur(o: SahipCevabiGirdisi): string {
  const rapor = whatsappRaporMetni(o.rapor, SAHIP_CEVABI_RAPOR_TAVAN);
  if (o.hata && !rapor) return `❌ Koordinatör yapamadı: ${kirp(whatsappIcinSadelestir(o.hata), 300)}`;
  const parcalar: string[] = [];
  if (!o.dryRun) parcalar.push('CANLI modda.');
  if (rapor) parcalar.push(rapor);
  if (o.onayBekleyen?.length) parcalar.push(onaySatiri(o.onayBekleyen));
  const istek = istekSatiri(o.istekler || []);
  if (istek) parcalar.push(istek);
  if (o.dryRun && o.kuruTestSayisi > 0) parcalar.push(KURU_TEST_SATIRI);
  return parcalar.join('\n\n').trim() || 'Koordinatör bir sonuç üretmedi; isteği bir daha yazar mısınız?';
}

/** İlk cevap sınırı aşıldı: koşu arka planda sürüyor. */
export function iletildiMetni(isId: string | null | undefined, dryRun: boolean): string {
  const kimlik = isId ? ` (iş #${String(isId).slice(0, ISTEK_KIMLIK_UZUNLUGU)})` : '';
  return `İsteğinizi aldım, Koordinatör'e ilettim${kimlik}. Sonucu buradan yazacağım.${dryRun ? '' : ' CANLI modda.'}`;
}

/** Bot kuru denemesi (__dryRun): koşu başlatılmaz, hiçbir şey gönderilmez — yalnız ne olacağı söylenir. */
export function kuruDenemeMetni(o: { canli: boolean; oneri: ReturnType<typeof ajanSec> }): string {
  const yon = o.oneri ? (o.oneri.ajanId ? `; yönlendirme: ${o.oneri.ajanId}/${o.oneri.recete}` : '; yönlendirme: ajan yok') : '';
  return `Kuru deneme: mesaj Koordinatör'e iletilecekti (${o.canli ? 'CANLI' : 'kuru test'}${yon}). Koşu başlatılmadı, mesaj gönderilmedi.`;
}

export interface BitisMesajiGirdisi {
  ajanAd: string;
  mukellefAd?: string | null;
  konu: string;
  rapor: string;
  hata?: string | null;
  basarisiz: boolean;
  dryRun: boolean;
  kuruTestSayisi: number;
  onayBekleyen: Array<{ previewId: string }>;
}

/** ✅ "<Ajan> bitirdi — <mükellef · konu>\n<rapor ilk 600 kr>\nOnayınızı bekleyen: …" · ❌ "<Ajan> yapamadı — <konu>: <neden>" */
export function bitisMesaji(o: BitisMesajiGirdisi): string {
  const baslik = baslikSatiri(o.mukellefAd, o.konu);
  if (o.basarisiz) return `❌ ${o.ajanAd} yapamadı — ${baslik}: ${kirp(whatsappIcinSadelestir(o.hata || 'bilinmeyen neden'), 300)}`;
  const satirlar = [`✅ ${o.ajanAd} bitirdi — ${baslik}${o.dryRun ? '' : ' (canlı)'}`];
  const rapor = whatsappRaporMetni(o.rapor, BITIS_RAPOR_TAVAN);
  if (rapor) satirlar.push(rapor);
  satirlar.push(onaySatiri(o.onayBekleyen));
  if (o.dryRun && o.kuruTestSayisi > 0) satirlar.push(KURU_TEST_SATIRI);
  return satirlar.join('\n');
}

/** ▶️ "<Ajan> başladı — <mükellef · konu>" (çocuk koşu açılırken; canlıysa "(canlı)"). */
export function baslangicMesaji(o: { ajanAd: string; mukellefAd?: string | null; konu: string; dryRun: boolean }): string {
  return `▶️ ${o.ajanAd} başladı — ${baslikSatiri(o.mukellefAd, o.konu)}${o.dryRun ? '' : ' (canlı)'}`;
}

/** 📌 "Sizden istenen: <başlık> — yapınca YAPILDI #<kimlik8> yazın" */
export function istekMesaji(o: { ajanAd: string; mukellefAd?: string | null; baslik: string; bildirimId: string }): string {
  const kim = String(o.mukellefAd || '').trim();
  return `📌 Sizden istenen${kim ? ` (${kim})` : ''}: ${kirp(o.baslik || 'iş', 160)} — yapınca YAPILDI #${String(o.bildirimId).slice(0, ISTEK_KIMLIK_UZUNLUGU)} yazın (${o.ajanAd})`;
}

/** 🔔 onay kaydı açıldı: ajan · konu · araç → hedef · ONAYLIYORUM / REDDET satırı. */
export function onayMesaji(o: { ajanAd: string; mukellefAd?: string | null; konu: string; previewId: string; arac: string; hedef?: string | null }): string {
  const hedef = String(o.hedef || '').trim();
  return [
    `🔔 ${o.ajanAd} onayınızı bekliyor — ${baslikSatiri(o.mukellefAd, o.konu)}`,
    `${o.arac}${hedef ? ` → ${hedef}` : ''}`,
    `ONAYLIYORUM #${o.previewId} yazın (vazgeçmek için REDDET #${o.previewId})`,
  ].join('\n');
}
