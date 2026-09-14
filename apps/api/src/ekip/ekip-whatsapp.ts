/**
 * EKİP ↔ WHATSAPP köprüsü — SAF yardımcılar (DB/Nest yok; PLAN/19 §C, 2026-09-14).
 *
 * Muzaffer Bey WhatsApp botuna "şu işi yapın" yazınca bot işi Koordinatör'e iletir; süreç mesajları (başladı / bitti /
 * onay bekliyor / sizden istenen / yapamadı) yine bottan gelir; onay/ret/istek-kapatma bottan yazılarak verilir.
 * Burada yalnız metin işleri var: sahip komutu ayrıştırma, ekip yolu kapısı, WhatsApp'a gidecek mesaj biçimleri.
 * Nest servisi: ekip-whatsapp.service.ts. Bot controller (whatsapp-bot.controller.ts) bu dosyadan yalnız sahipKomutu /
 * ekipYoluMu / ekipWhatsappAcik çağırır — servis ModuleRef ile çözülür (modül döngüsü yok).
 *
 * MESAJ DİLİ (Muzaffer Bey 2026-09-15: "bilgilendirme mesajlarında çok gereksiz kodlar yazılar var"):
 *   iş numarası, taxpayerId, reçete kodu (R1), şablon cümlesi, "KURU TEST" başlığı, araç adı YAZILMAZ;
 *   başlık = mükellef · insan dilinde konu · dönem; rapordan yalnız BULGULAR (+ sizden istenen / emin değilim);
 *   "Onayınızı bekleyen: yok" gibi boş satırlar yok. Komut kimlikleri (ONAYLIYORUM #PRV-…, YAPILDI #…) kalır — komut için gerekli.
 *
 * Komutlar (satır başı, büyük/küçük harf fark etmez, # isteğe bağlı):
 *   ONAYLIYORUM #PRV-1A2B   → dışarı gönderim onayı (ekip-onay.service.onayla)
 *   REDDET #PRV-1A2B [not]  → onay kaydını reddet
 *   YAPILDI #cmnyd1a2       → "sizden istenen" kalemini kapat (bildirim kimliğinin ilk 8 karakteri)
 */
import { ajanSec, ogrenmeSatirlariniSuz } from '../moren-ai/ses-koordinator';
import { konuBasligi } from './ekip-akis';

/** Koordinatör koşusu için ilk cevap sınırı: aşınca "iletildi, sonucu buradan yazacağım" denir, koşu arka planda sürer. */
export const WHATSAPP_KOORDINATOR_ILK_CEVAP_MS = Math.max(5_000, Number(process.env.WHATSAPP_KOORDINATOR_ILK_CEVAP_MS || 20_000) || 20_000);

/** Köprü açık mı? Varsayılan AÇIK; kapatmak için EKIP_WHATSAPP_KOORDINATOR=off (ses köprüsündeki EKIP_SES_KOORDINATOR ile aynı kalıp). */
export function ekipWhatsappAcik(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.EKIP_WHATSAPP_KOORDINATOR || '').trim().toLowerCase() !== 'off';
}

/** Sync cevapta raporun en çok bu kadarı; koşu bitti mesajında bulgular özeti bu kadar. */
export const SAHIP_CEVABI_RAPOR_TAVAN = 1200;
export const BITIS_RAPOR_TAVAN = 900;
/** Başlık (konu) uzunluğu. */
export const KONU_TAVAN = 60;
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

/** WhatsApp için sadeleştirme: kod/kalın/başlık işaretleri ve reçete kodları "(R1)" düşer, madde imleri "• " olur, satırlar korunur. */
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
    .replace(/\s*\(R\d{1,2}[a-z]?\)/g, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function kirp(text: string, tavan: number): string {
  const t = String(text || '').trim();
  return t.length > tavan ? `${t.slice(0, tavan).trimEnd()}…` : t;
}

/** Tavanı aşan metni satır (yoksa kelime) sınırında keser; yarım cümleyle bitmesin. */
function satirSinirindaKirp(text: string, tavan: number): string {
  const t = String(text || '').trim();
  if (t.length <= tavan) return t;
  const parca = t.slice(0, tavan);
  const satir = parca.lastIndexOf('\n');
  const kelime = parca.lastIndexOf(' ');
  const kes = satir > tavan * 0.5 ? satir : kelime > tavan * 0.5 ? kelime : tavan;
  return `${parca.slice(0, kes).trimEnd()}…`;
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const AY_ADI_KALIBI = /\b(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)\b/i;

/** "2026/08" · "2026-08" · "Dönem: 2026/08" → "Ağustos 2026"; yoksa ''. */
export function donemEtiketi(metin: string): string {
  const m = String(metin || '').match(/\b(20\d{2})[/-](0[1-9]|1[0-2])\b/);
  if (!m) return '';
  return `${AYLAR[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * İnsan başlığı: iş emri metninden reçete kodu "(R1)", "Mükellef: … (taxpayerId: …)", kimlikler ve şablon kuyruğu kırpılır;
 * ilk cümle alınır; dönem varsa "· Ağustos 2026" eklenir (metinde ay adı yoksa). En çok KONU_TAVAN karakter, kelime sınırında.
 *  "KDV Kontrol (R1). Mükellef: YAŞAR ÖZKAN (taxpayerId: cmnyd…). Dönem: 2026/08 …" → "KDV Kontrol · Ağustos 2026"
 *  "SORU/KOMUT: yaşar özkan ın ağustos 2026 kdv kontrolünü portaldan yap — kuru test olarak değil canlı" → "yaşar özkan ın ağustos 2026 kdv kontrolünü portaldan yap"
 */
export function insanKonusu(gorev: string, tavan = KONU_TAVAN): string {
  const ham = String(gorev || '');
  let s = konuBasligi(ham, 400);
  s = s
    .replace(/\s*\(R\d{1,2}[a-z]?\)/gi, '')
    .replace(/\s*\((?:taxpayerId|mükellef id|id)\s*:[^)]*\)/gi, '')
    .replace(/\b(?:taxpayerId|mükellef id)\s*:\s*[A-Za-z0-9_-]+/gi, '')
    .replace(/\s*[;.]?\s*Mükellef\s*:\s*[^.;—\n]*/i, '')
    .replace(/\s*[;.]?\s*Dönem\s*:\s*[^.;—\n]*/i, '')
    .trim();
  // ilk cümle / ilk parça
  const kesim = s.search(/(\.\s|;\s|\s—\s|\s-\s|\n)/);
  if (kesim > 8) s = s.slice(0, kesim);
  s = s.replace(/[.;:,\s]+$/, '').trim();
  if (s.length > tavan) {
    const parca = s.slice(0, tavan);
    const bosluk = parca.lastIndexOf(' ');
    s = `${(bosluk > tavan * 0.5 ? parca.slice(0, bosluk) : parca).trimEnd()}…`;
  }
  const donem = donemEtiketi(ham);
  if (donem) {
    // başlığın içindeki "2026/08" → "Ağustos 2026"; hiç yoksa sona "· Ağustos 2026"
    const icinde = s.replace(/\b(20\d{2})[/-](0[1-9]|1[0-2])\b/g, (_m, y, ay) => `${AYLAR[Number(ay) - 1]} ${y}`);
    if (icinde !== s) s = icinde;
    else if (!AY_ADI_KALIBI.test(s)) s = s ? `${s} · ${donem}` : donem;
  }
  return s || 'iş';
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

/** Personel rapor bölümleri (kadro/00_ORTAK_KURALLAR rapor şablonu). */
const BOLUM_BASLIGI =
  /^\s*[*_#>\-•\s]*(Yaptığım iş|Yaptığım işler|Baktığım kaynaklar|Bulgular|Bulgu|Onayınızı bekleyen|Sizden istenen|Kime döndü|Öğrendiklerim|Öğrendim|Emin değilim|Emin olmadıklarım|DEVİR|Devir|Sonuç)\s*[*_]*\s*:\s*(.*)$/i;

/** "yok" / "-" / boş → bölüm boş sayılır. */
function bolumBosMu(satirlar: string[]): boolean {
  const t = satirlar.join(' ').replace(/[*_`•\-\s]+/g, ' ').trim();
  return !t || /^(yok|yoktur|—|-|boş|bos|none)\.?$/i.test(t);
}

/**
 * Bitiş mesajı için rapor ÖZETİ: bölümlü raporda yalnız BULGULAR (+ "Sizden istenen", "Emin değilim" doluysa);
 * "Yaptığım iş / Baktığım kaynaklar / Kime döndü / Öğrendiklerim / DEVİR" ve başlık satırı ("KDV KONTROL — … — KURU TEST") düşer.
 * Bölümsüz raporda whatsappRaporMetni. Tavanı satır sınırında keser.
 */
export function whatsappRaporOzeti(rapor: string, tavan = BITIS_RAPOR_TAVAN): string {
  const satirlar = ogrenmeSatirlariniSuz(String(rapor || '').replace(/\r/g, '').split('\n'));
  const bolumler: Array<{ ad: string; satirlar: string[] }> = [];
  let aktif: { ad: string; satirlar: string[] } | null = null;
  for (const satir of satirlar) {
    const temiz = satir.replace(/^\s*(\*\*)?RAPOR\s*(\*\*)?\s*:\s*/i, '');
    const m = temiz.match(BOLUM_BASLIGI);
    if (m) {
      aktif = { ad: normalize(m[1]), satirlar: [] };
      bolumler.push(aktif);
      if (String(m[2] || '').trim()) aktif.satirlar.push(m[2].trim());
      continue;
    }
    if (aktif) aktif.satirlar.push(temiz);
  }
  const bul = (adlar: string[]) => bolumler.filter((b) => adlar.includes(b.ad));
  const bulgular = bul(['bulgular', 'bulgu', 'sonuc']);
  if (!bulgular.length) return satirSinirindaKirp(whatsappRaporMetni(rapor, tavan + 200), tavan);
  const parcalar: string[] = [];
  const bulguMetni = whatsappIcinSadelestir(bulgular.map((b) => b.satirlar.join('\n')).join('\n'));
  if (bulguMetni) parcalar.push(bulguMetni);
  for (const [ad, etiket] of [
    [['sizden istenen'], 'Sizden istenen'],
    [['emin degilim', 'emin olmadiklarim'], 'Emin olmadığım'],
  ] as Array<[string[], string]>) {
    const b = bul(ad);
    if (!b.length || b.every((x) => bolumBosMu(x.satirlar))) continue;
    parcalar.push(`${etiket}: ${whatsappIcinSadelestir(b.map((x) => x.satirlar.join('\n')).join('\n'))}`);
  }
  return satirSinirindaKirp(parcalar.join('\n').trim(), tavan);
}

/** "<mükellef · konu>" — mükellef bilinmiyorsa yalnız konu; konu zaten mükellefin adıyla başlıyorsa mükellef tekrar yazılmaz. */
export function baslikSatiri(mukellefAd: string | null | undefined, konu: string | null | undefined): string {
  const k = String(konu || '').trim();
  const m = String(mukellefAd || '').trim();
  if (m && k) {
    const ilkKelime = normalize(m).split(' ')[0] || '';
    if (ilkKelime.length >= 4 && normalize(k).includes(ilkKelime)) return k;
    return `${m} · ${k}`;
  }
  return m || k || 'iş';
}

/** Onay bekleyen kayıt varsa satır; yoksa '' (boş "yok" satırı yazılmaz). */
export function onaySatiri(onaylar: Array<{ previewId: string }>): string {
  const idler = (onaylar || []).map((o) => String(o?.previewId || '').trim()).filter(Boolean);
  if (!idler.length) return '';
  if (idler.length === 1) return `Göndermek için ONAYLIYORUM #${idler[0]} yazın.`;
  return `Onayınızı bekleyen: ${idler.map((id) => `#${id}`).join(', ')} — her biri için ONAYLIYORUM #PRV-XXXX yazın.`;
}

/** "Sizden istenen: <başlık> — yapınca YAPILDI #<kimlik8> yazın" (birden fazlaysa satır satır). */
export function istekSatiri(istekler: Array<{ id: string; baslik: string }>): string {
  return (istekler || [])
    .filter((i) => i?.id)
    .map((i) => `Sizden istenen: ${kirp(i.baslik || 'iş', 120)} — yapınca YAPILDI #${String(i.id).slice(0, ISTEK_KIMLIK_UZUNLUGU)} yazın.`)
    .join('\n');
}

/** Dışarı gönderim aracı → insan adı (onay mesajında araç kodu yazılmaz). */
const DISARI_ARAC_ADI: Record<string, string> = {
  send_whatsapp_message: 'WhatsApp mesajı',
  send_whatsapp_template: 'WhatsApp mesajı',
  send_whatsapp_freeform: 'WhatsApp mesajı',
  send_whatsapp_document: 'WhatsApp belgesi',
  send_email: 'E-posta',
  send_sms: 'SMS',
};

export function disariAracAdi(arac: string): string {
  const a = String(arac || '').trim();
  if (DISARI_ARAC_ADI[a]) return DISARI_ARAC_ADI[a];
  if (/whatsapp/i.test(a)) return 'WhatsApp mesajı';
  if (/mail/i.test(a)) return 'E-posta';
  if (/sms/i.test(a)) return 'SMS';
  return a.replace(/_/g, ' ');
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

/** Koşu 20 sn içinde bitti → sync cevap: [Canlı modda.] + rapor + onay + istek + kuru test satırı. */
export function sahipCevabiOlustur(o: SahipCevabiGirdisi): string {
  const rapor = whatsappRaporMetni(o.rapor, SAHIP_CEVABI_RAPOR_TAVAN);
  if (o.hata && !rapor) return `❌ Koordinatör yapamadı: ${kirp(whatsappIcinSadelestir(o.hata), 300)}`;
  const parcalar: string[] = [];
  if (!o.dryRun) parcalar.push('Canlı modda.');
  if (rapor) parcalar.push(rapor);
  const onay = onaySatiri(o.onayBekleyen);
  if (onay) parcalar.push(onay);
  const istek = istekSatiri(o.istekler || []);
  if (istek) parcalar.push(istek);
  if (o.dryRun && o.kuruTestSayisi > 0) parcalar.push(KURU_TEST_SATIRI);
  return parcalar.join('\n\n').trim() || 'Koordinatör bir sonuç üretmedi; isteği bir daha yazar mısınız?';
}

/** İlk cevap sınırı aşıldı: koşu arka planda sürüyor (iş numarası yazılmaz). */
export function iletildiMetni(_isId: string | null | undefined, dryRun: boolean): string {
  return dryRun
    ? "İsteğinizi aldım, Koordinatör'e ilettim. Sonucu buradan yazacağım."
    : "İsteğinizi aldım, Koordinatör'e canlı modda ilettim. Sonucu buradan yazacağım.";
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

/**
 * ✅ "<Ajan> bitirdi — <mükellef · konu> [(canlı)]" + bulgular özeti + (varsa) onay satırı + (kuru testte) kuru test satırı
 * ❌ "<Ajan> yapamadı — <başlık>" + neden (ikinci satır)
 */
export function bitisMesaji(o: BitisMesajiGirdisi): string {
  const baslik = baslikSatiri(o.mukellefAd, o.konu);
  if (o.basarisiz) return `❌ ${o.ajanAd} yapamadı — ${baslik}\n${kirp(whatsappIcinSadelestir(o.hata || 'bilinmeyen neden'), 300)}`;
  const satirlar = [`✅ ${o.ajanAd} bitirdi — ${baslik}${o.dryRun ? '' : ' (canlı)'}`];
  const ozet = whatsappRaporOzeti(o.rapor, BITIS_RAPOR_TAVAN);
  if (ozet) satirlar.push(ozet);
  const onay = onaySatiri(o.onayBekleyen);
  if (onay) satirlar.push(onay);
  if (o.dryRun && o.kuruTestSayisi > 0) satirlar.push(KURU_TEST_SATIRI);
  return satirlar.join('\n');
}

/** ▶️ "<Ajan> başladı — <mükellef · konu>" (çocuk koşu açılırken; canlıysa "(canlı)"). */
export function baslangicMesaji(o: { ajanAd: string; mukellefAd?: string | null; konu: string; dryRun: boolean }): string {
  return `▶️ ${o.ajanAd} başladı — ${baslikSatiri(o.mukellefAd, o.konu)}${o.dryRun ? '' : ' (canlı)'}`;
}

/** 📌 "<Ajan> sizden istiyor — <mükellef>: <başlık>\nYapınca YAPILDI #<kimlik8> yazın." */
export function istekMesaji(o: { ajanAd: string; mukellefAd?: string | null; baslik: string; bildirimId: string }): string {
  const kim = String(o.mukellefAd || '').trim();
  return `📌 ${o.ajanAd} sizden istiyor — ${kim ? `${kim}: ` : ''}${kirp(o.baslik || 'iş', 160)}\nYapınca YAPILDI #${String(o.bildirimId).slice(0, ISTEK_KIMLIK_UZUNLUGU)} yazın.`;
}

/** 🔔 onay kaydı açıldı: ajan · başlık · ne gidecek → kime · ONAYLIYORUM / REDDET satırı. */
export function onayMesaji(o: { ajanAd: string; mukellefAd?: string | null; konu: string; previewId: string; arac: string; hedef?: string | null }): string {
  const hedef = String(o.hedef || '').trim();
  return [
    `🔔 ${o.ajanAd} onayınızı bekliyor — ${baslikSatiri(o.mukellefAd, o.konu)}`,
    `${disariAracAdi(o.arac)}${hedef ? ` → ${hedef}` : ''}`,
    `Göndermek için ONAYLIYORUM #${o.previewId}, vazgeçmek için REDDET #${o.previewId} yazın.`,
  ].join('\n');
}
