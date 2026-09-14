/**
 * SES → KOORDİNATÖR köprüsü (PLAN/13-AJAN-KADROSU.md §7).
 *
 * Canlı MOREN AI'da kulak+ağız OpenAI Realtime, beyin Max. Sesli soru artık
 * doğrudan chat()'e değil, EKİP omurgasındaki "koordinator" ajanına gider
 * (EkipRunnerService.calistir, kaynak:'ses'). Bu dosya yalnız SAF yardımcıları
 * taşır (env kapısı, canlı-mod kalıbı, akış olayı → sesli cevap); Nest servisi
 * moren-ai.service.ts içindedir.
 */

/** Koordinatör köprüsü açık mı? Varsayılan AÇIK; kapatmak için EKIP_SES_KOORDINATOR=off. */
export function sesKoordinatorAcik(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.EKIP_SES_KOORDINATOR || '').trim().toLowerCase() !== 'off';
}

/** Koordinatör koşusu için sesli bekleme tavanı; aşınca "hâlâ çalışıyorum" denir, iş arka planda biter. */
export const SES_KOORDINATOR_ZAMAN_ASIMI_MS = 90_000;
/** SESLİ İLK CEVAP SINIRI (kullanıcı bulgusu 2026-09-12: "soruyorum, bekliyor bekliyor, bana hiçbir şey demiyor; ekibin cevabı çok geç").
 *  Koşu bu sürede bitmezse sesli katman "iletildi, kontrol ettirip dönüş yapacağım" der ve iş arka planda sürer;
 *  istemci iş dosyasını izleyip sonucu gelince seslendirir (asenkron:true + isId). env: SES_KOORDINATOR_ILK_CEVAP_MS (varsayılan 25000). */
export const SES_KOORDINATOR_ILK_CEVAP_MS = Math.max(8_000, Number(process.env.SES_KOORDINATOR_ILK_CEVAP_MS || 25_000) || 25_000);

/** Sesli cevap tavanı (karakter) — compactFinalAnswer(voiceMode) ile aynı ölçek. */
const SES_CEVAP_TAVAN = 420;

function normalize(text: string): string {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kullanıcı sözlü olarak canlı (kuru test dışı) çalıştırma istedi mi?
 * Sistem promptu değil, basit metin kalıbı: "canlı yap", "gerçek çalıştır",
 * "kuru test olmasın", "canlı modda". Tersini söyleyen ("canlı yapma") canlı sayılmaz.
 */
export function canliModIstendi(question: string): boolean {
  const t = normalize(question);
  if (!t) return false;
  // Olumsuz kalıp önce: "canlı yapma", "gerçek çalıştırma", "canlı olmasın".
  if (/(canli|gercek)\s*(yapma|calistirma|olmasin|degil|istemiyorum)/.test(t)) return false;
  if (/kuru\s*test\s*(olsun|yap|kalsin|modunda)/.test(t)) return false;
  const kaliplar: RegExp[] = [
    /\bcanli\s*(yap|calistir|mod|modda|moda|olarak|olsun|gec|calis)/,
    /\bgercek(ten)?\s*(calistir|yap|uygula|kaydet|gonder)/,
    /\bgercek\s*mod/,
    /\bkuru\s*test\s*(degil|olmasin|kapat|istemiyorum|yapma)/,
    /\bkuru\s*testi\s*(kapat|birak)/,
  ];
  return kaliplar.some((r) => r.test(t));
}

export interface SesKosuOzeti {
  rapor: string;
  kuruTestSayisi: number;
  onayBekleyen: Array<{ previewId: string; name: string; confirmationText: string }>;
  dryRun: boolean;
  hata?: string | null;
  /** Koşu 90 sn'yi aştı; cevap "hâlâ çalışıyorum" kalıbıdır. */
  zamanAsimi?: boolean;
  isId?: string;
}

/** Markdown/yıldız/başlık/madde işaretlerini sesli okumaya uygun düz metne çevirir. */
export function sesIcinSadelestir(text: string): string {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\n)\s{0,3}#{1,6}\s*/g, '$1')
    .replace(/(^|\n)\s*[-*•·]\s+/g, '$1')
    .replace(/(^|\n)\s*\d+[.)]\s+/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * "ÖĞRENDİM:" / "Öğrendiklerim:" başlığı — büyük/küçük harf, baştaki madde imi (-, •, 1.), kalın (**) ve başlık (#)
 * işaretleri fark etmez. İki nokta sonrası gövde m[1]'e düşer (boşsa dersler alt maddelerde demektir).
 * İki nokta yoksa yalnız ÇIPLAK başlık ("### ÖĞRENDİM", "**Öğrendiklerim**") yakalanır; "Öğrendim ki …" cümlesi ders değildir.
 * Runner'ın ogrenilenleriAyikla kalıbıyla aynı iki biçim (PLAN/19 H2-c, 2026-09-14).
 */
const OGRENME_BASLIGI = /^[ÖO][ĞG]REND[İI](?:M|KLER[İI]M)\s*[*_`]*\s*(?::\s*[*_`]*\s*(.*)|)$/i;
const MADDE_IMI = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * Öğrenme satırlarını süzer (Muzaffer Bey'e giden / sesli okunan metne ders satırı karışmasın — PLAN/19 H2-c):
 *  - "ÖĞRENDİM: …", "**Öğrendiklerim:** …", "- ÖĞRENDİM: …", "### ÖĞRENDİM: …" satırları düşer;
 *  - başlık tek başına yazıldıysa ("Öğrendiklerim:" / "### ÖĞRENDİM" + alt maddeler) altındaki madde satırları da düşer;
 *    madde olmayan ilk dolu satır başlığı kapatır ve korunur.
 */
export function ogrenmeSatirlariniSuz(satirlar: string[]): string[] {
  const out: string[] = [];
  let baslikAltinda = false;
  for (const ham of satirlar) {
    const satir = String(ham ?? '');
    const soyulmus = satir.replace(/^[\s*_`#>\-•]+/, '').replace(/^\d+[.)]\s+/, '');
    const m = soyulmus.match(OGRENME_BASLIGI);
    if (m) {
      baslikAltinda = !String(m[1] || '').replace(/[*_`\s]+/g, '').length;
      continue;
    }
    if (baslikAltinda) {
      if (!satir.trim()) {
        out.push(satir); // boş satır başlığı kapatmaz (runner ile aynı)
        continue;
      }
      if (MADDE_IMI.test(satir)) continue; // başlığın altındaki madde = ders satırı
      baslikAltinda = false;
    }
    out.push(satir);
  }
  return out;
}

/**
 * Ajan cevabından sesli okunacak kısmı çıkarır:
 * - "RAPOR:" varsa ondan sonrası (SORU: dahil), "ÖĞRENDİM:" / "Öğrendiklerim:" satırları atılır (ogrenmeSatirlariniSuz).
 * - "RAPOR:" yoksa tüm metin (öğrenme satırları yine atılır).
 */
export function raporMetniAyikla(rapor: string): { rapor: string; soru: string } {
  const ham = String(rapor || '').replace(/\r/g, '');
  const satirlar = ogrenmeSatirlariniSuz(ham.split('\n'));
  const metin = satirlar.join('\n');
  // "RAPOR:", "**RAPOR:**", "**RAPOR**:" biçimlerinin hepsi.
  const raporIdx = metin.search(/(^|\n)\s*(\*\*)?RAPOR\s*(\*\*)?\s*:/i);
  const govde = raporIdx >= 0 ? metin.slice(raporIdx).replace(/^\s*(\*\*)?RAPOR\s*(\*\*)?\s*:\s*(\*\*)?\s*/i, '') : metin;
  const soruIdx = govde.search(/(^|\n)\s*(\*\*)?SORU\s*(\*\*)?\s*:/i);
  const raporKismi = soruIdx >= 0 ? govde.slice(0, soruIdx) : govde;
  const soruKismi = soruIdx >= 0 ? govde.slice(soruIdx).replace(/^\s*(\*\*)?SORU\s*(\*\*)?\s*:\s*(\*\*)?\s*/i, '') : '';
  return {
    rapor: sesIcinSadelestir(raporKismi).replace(/\n/g, ' ').trim(),
    soru: sesIcinSadelestir(soruKismi).replace(/\n/g, ' ').trim(),
  };
}

function cumleKirp(text: string, tavan: number): string {
  const temiz = String(text || '').trim();
  if (temiz.length <= tavan) return temiz;
  const cumleler = temiz.match(/[^.!?]+[.!?]?/g) || [temiz];
  let out = '';
  for (const c of cumleler) {
    if ((out + c).trim().length > tavan) break;
    out += c;
  }
  return out.trim() || temiz.slice(0, tavan).trim();
}

/**
 * Koşu sonucu → sesli okunacak kısa cevap.
 * Sıra: [CANLI modda] + rapor (kırpılmış) + kuru test (1 cümle) + onay (1 cümle) + soru (1 cümle).
 */
export function sesCevabiOlustur(o: SesKosuOzeti): string {
  const parcalar: string[] = [];
  if (!o.dryRun) parcalar.push('CANLI modda.');

  if (o.zamanAsimi) {
    parcalar.push(o.dryRun === false
      ? 'İsteğinizi ekibe ilettim, canlı modda üzerinde çalışıyorlar; sonucu gelir gelmez size söyleyeceğim.'
      : 'İsteğinizi ekibe ilettim, kontrol ettiriyorum; sonucu gelir gelmez size söyleyeceğim.');
    return parcalar.join(' ');
  }

  const { rapor, soru } = raporMetniAyikla(o.rapor);
  if (o.hata && !rapor) {
    parcalar.push(`İşi bitiremedim: ${cumleKirp(sesIcinSadelestir(o.hata), 160)}`);
    return parcalar.join(' ');
  }
  if (rapor) parcalar.push(cumleKirp(rapor, SES_CEVAP_TAVAN));

  if (o.kuruTestSayisi > 0) {
    parcalar.push(
      o.kuruTestSayisi === 1
        ? 'Kuru testte bir adım yapılmadı, yalnız kaydedildi.'
        : `Kuru testte ${o.kuruTestSayisi} adım yapılmadı, yalnız kaydedildi.`,
    );
  }
  if (o.onayBekleyen.length > 0) {
    const ilk = o.onayBekleyen[0];
    parcalar.push(
      o.onayBekleyen.length === 1
        ? `Bir mesaj onayınızı bekliyor; onaylamak için "${ilk.confirmationText}" deyin.`
        : `${o.onayBekleyen.length} mesaj onayınızı bekliyor; ilki için "${ilk.confirmationText}" deyin.`,
    );
  }
  if (soru) parcalar.push(cumleKirp(soru, 180));

  const cevap = parcalar.join(' ').replace(/\s+/g, ' ').trim();
  return cevap || 'Koordinatör bir sonuç üretmedi; soruyu bir daha söyler misiniz?';
}

// ─── KOORDİNATÖR YÖNLENDİRME — PLAN/17 §5 tablosunun kod karşılığı (2026-09-13) ───

export interface AjanSecimi {
  /** Hedef ajan; null = ajan başlatılmaz (neden dolu: ekibe kapalı iş / modül kapalı). */
  ajanId: string | null;
  /** Reçete kodu (R1…R11, K1 e-defter, 'ekran' Luca Operatörü); ajan yoksa null. */
  recete: string | null;
  /** Koordinatör LLM'e giden tek satır gerekçe. */
  neden: string;
}

const secim = (ajanId: string, recete: string, neden: string): AjanSecimi => ({ ajanId, recete, neden });

/**
 * Muzaffer Bey’in cümlesini PLAN/17 §5 tablosuna göre ajan + reçeteye çevirir (saf; anahtar kelime, Türkçe normalize).
 *  - KDV kontrol / mutabakat / Luca ile karşılaştır → beyanname · R1 (PORTAL işi; luca-operator'e ASLA gitmez)
 *  - gelir tablosu / bilanço / İHÖ analiz-yorum-kâr → analist · R2 (hazır tablo okunur)
 *  - KDV beyannamesi / ödenecek çıkar mı / KDV1 → beyanname · R3
 *  - muhasebeleştir / hesap ata / Luca'ya at / faturaları işle → fatura · R4
 *  - faturaları çek / entegratör / e-arşiv indir → fatura · R5 ("mihsap" geçerse ajan yok: Muzaffer Bey’de)
 *  - geçici vergi öncesi denetim / mizanda sorun / kasa-ortak / mizanı denetle → denetci · R6
 *  - geçici vergi paketi/beyannamesi → beyanname · R7
 *  - banka / ekstre / kasa-banka → banka-kasa · R8;  evrak / hatırlatma → AJAN YOK (evrak otomasyonu; Koordinatör kendisi okur);  tebligat → musteri · R10
 *  - e-defter / berat → edefter · K1
 *  - bordro / SGK / muhtasar → ajan yok ("bordro modülü kapalı")
 *  - "Luca'da … aç/doldur/oku/fiş" YALNIZ bu kalıp → luca-operator · ekran (KDV/mizan/gelir tablosu geçiyorsa değil)
 *  - belirsiz → null (Koordinatör tek satır soru sorar)
 */
export function ajanSec(cumle: string): AjanSecimi | null {
  const t = normalize(cumle);
  if (!t) return null;

  // Ekibe kapalı / kapalı modül — önce bunlar (yanlışlıkla ajan başlatılmasın)
  if (/\bmihsap\b/.test(t)) return { ajanId: null, recete: null, neden: 'Mihsap çekimi ekibe kapalı; Muzaffer Bey portaldan çeker (Fatura Merkezi işi fatura/R4-R5).' };
  if (/\b(bordro|sgk|muhtasar|aphb|bildirge)/.test(t)) return { ajanId: null, recete: null, neden: 'HAZIR DEĞİL: bordro modülü kapalı (bordro verisi portalda yok); ajan başlatılmaz.' };

  // KDV Kontrol zinciri — PORTAL işi
  if (/kdv[^.]*\b(kontrol|mutabakat|karsilastir)/.test(t) || /alis[- ]?satis[^.]*mutabakat/.test(t) || /luca ile karsilastir/.test(t)) {
    return secim('beyanname', 'R1', 'KDV Kontrol portal işidir; Beyanname Uzmanı zinciri kendi yürütür (Luca Operatörü DEĞİL). Dönem: YYYY/MM.');
  }
  // Geçici vergi paketi (R7) — denetimden önce bakılır ("geçici vergi beyannamesi")
  if (/gecici vergi[^.]*\b(paket|beyanname|beyani|hazirla)/.test(t)) {
    return secim('beyanname', 'R7', 'Geçici vergi paketi; önce Denetçi R6 raporu var mı bakılır. Dönem: YYYY-Qn.');
  }
  // KDV1 beyanname hazırlığı (R3)
  if (/kdv[^.]*\b(beyanname|beyan|kdv1|taslak)/.test(t) || /\bkdv1\b/.test(t) || /odenecek[^.]*\b(cikar|kdv)/.test(t)) {
    return secim('beyanname', 'R3', 'KDV1 paketi; KDV Kontrol (R1) bitmemişse ajan önce R1 yapar. Dönem: YYYY-MM.');
  }
  // Dönem denetimi (R6)
  if (/\bdenet(im|le)/.test(t) || /mizanda sorun/.test(t) || /kasa[- ]?ortak/.test(t) || /ortak cari/.test(t) || /mizan[^.]*\b(cek|cekim|cekilsin)/.test(t)) {
    return secim('denetci', 'R6', 'Dönem denetimi (14 madde); kilitli mizan varsa Luca çekimi İSTENMEZ, çekim yalnız PRV ile. Dönem: YYYY-Qn.');
  }
  // Gelir tablosu / bilanço / İHÖ analizi (R2) — hazır tablo
  if (/(gelir tablosu|bilanco|\biho\b|isletme hesap ozeti|gecici vergi[^.]*ongor|\bkar(i|im|imiz)?\b[^.]*\bnasil|kar durumu|karlilik)/.test(t)) {
    return secim('analist', 'R2', 'Portaldaki hazır (kilitli) tablo okunur; önce mali_donemler_listele ile hazır mı bak, hazırsa Luca/Denetçi ÖNERME. Dönem: YYYY-Qn | YYYY-YILLIK.');
  }
  // Fatura muhasebeleştirme (R4)
  if (/muhasebelestir/.test(t) || /hesap ata/.test(t) || /luca'?ya at/.test(t) || /fatura[^.]*\b(isle|islensin)\b/.test(t)) {
    return secim('fatura', 'R4', 'Fatura Merkezi → hesap önerisi → onay listesi; fm_onayla Muzaffer Bey’de. Dönem: YYYY-MM.');
  }
  // Entegratör / e-arşiv çekimi (R5)
  if (/fatura[^.]*\b(cek|indir|al)\b/.test(t) || /entegrator/.test(t) || /e-?arsiv[^.]*\b(cek|indir|al)/.test(t)) {
    return secim('fatura', 'R5', 'Entegratör/e-Arşiv çekimi (GİB yolu kuru testte hariç). Dönem: YYYY-MM.');
  }
  // Banka / ekstre (R8)
  if (/\b(ekstre|banka)\b/.test(t) || /kasa[- ]?banka/.test(t)) {
    return secim('banka-kasa', 'R8', 'Ekstre takibi + 100/102/131/331 mantık; banka hareketi tablosu portalda yok. Dönem: YYYY-MM.');
  }
  // Tebligat (R10) — çekim gece otomasyonu, iletim Müşteri İlişkileri (Evrak Sorumlusu 2026-09-13'te kaldırıldı)
  if (/tebligat/.test(t)) {
    return secim('musteri', 'R10', 'e-Tebligat iletimi Müşteri İlişkileri (R10); çekim gece otomasyonu, 09:00 Akıllı Bildirim. Ajan çekim başlatmaz.');
  }
  // Evrak / hatırlatma — AJAN YOK: evrak talep/geldi mesajları EVRAK OTOMASYONU'nun işi (mükellef kartındaki teslim günü;
  //   10:00 cron hatırlatma; 'geldi' işaretlenince onay mesajı). Eksik listesi Koordinatör'ün kendi aracıyla cevaplanır.
  if (/\bevrak/.test(t) || /hatirlat/.test(t)) {
    return {
      ajanId: null,
      recete: null,
      neden: 'Evrak hatırlatma/onay mesajları OTOMATİK (evrak otomasyonu: mükellef kartındaki teslim günü). Taslak HAZIRLAMA, ajan BAŞLATMA; eksik evrak listesini list_taxpayers_monthly_status ile kendin söyle (dönem YYYY-MM).',
    };
  }
  // e-Defter / berat
  if (/e-?defter/.test(t) || /\bberat/.test(t)) {
    return secim('edefter', 'K1', 'e-Defter kontrolü / berat takvimi; çekim PRV ile, berat Muzaffer Bey yükler.');
  }
  // Luca Operatörü — YALNIZ "Luca'da … aç/doldur/oku/fiş" kalıbı
  if (/\bluca'?(da|de)\b/.test(t) && /\b(ac|acar|acsin|doldur|oku|okusun|fis|fisi|ekran|menu|taslak|taslag)/.test(t)) {
    return secim('luca-operator', 'ekran', "Luca ekran işi (aç/doldur/oku/fiş taslağı); Kaydet/Gönder Muzaffer Bey’in onayı. Portal işi değil.");
  }
  return null;
}

/** Sesli soru → koordinatör görev metni. Varsa PLAN/17 §5 ön eşlemesi "YÖNLENDİRME ÖNERİSİ" satırı olarak eklenir. */
export function sesGoreviOlustur(p: {
  question: string;
  currentPath?: string;
  taxpayerAdi?: string | null;
  canli: boolean;
}): string {
  const oneri = ajanSec(p.question);
  const baglam = [
    'Muzaffer Bey canlı ses üzerinden konuşuyor; cevabın sesli okunacak.',
    p.currentPath ? `Aktif portal ekranı: ${p.currentPath}.` : '',
    p.taxpayerAdi ? `Seçili mükellef: ${p.taxpayerAdi}.` : '',
    p.canli ? 'Muzaffer Bey bu görev için sözlü olarak CANLI (kuru test dışı) çalışmayı istedi.' : '',
    oneri
      ? oneri.ajanId
        ? `YÖNLENDİRME ÖNERİSİ: ${oneri.ajanId}/${oneri.recete} — ${oneri.neden}`
        : `YÖNLENDİRME ÖNERİSİ: ajan yok — ${oneri.neden}`
      : '',
  ].filter(Boolean);
  return `${baglam.join('\n')}\n\nSORU/KOMUT: ${String(p.question || '').trim()}`;
}
