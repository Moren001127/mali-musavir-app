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
 * Ajan cevabından sesli okunacak kısmı çıkarır:
 * - "RAPOR:" varsa ondan sonrası (SORU: dahil), "ÖĞRENDİM:" satırları atılır.
 * - "RAPOR:" yoksa tüm metin (ÖĞRENDİM satırları yine atılır).
 */
export function raporMetniAyikla(rapor: string): { rapor: string; soru: string } {
  const ham = String(rapor || '').replace(/\r/g, '');
  const satirlar = ham.split('\n').filter((s) => !/^\s*[-*•]?\s*ÖĞRENDİM\s*:/i.test(s));
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

/** Sesli soru → koordinatör görev metni. */
export function sesGoreviOlustur(p: {
  question: string;
  currentPath?: string;
  taxpayerAdi?: string | null;
  canli: boolean;
}): string {
  const baglam = [
    'Sahip canlı ses üzerinden konuşuyor; cevabın sesli okunacak.',
    p.currentPath ? `Aktif portal ekranı: ${p.currentPath}.` : '',
    p.taxpayerAdi ? `Seçili mükellef: ${p.taxpayerAdi}.` : '',
    p.canli ? 'Sahip bu görev için sözlü olarak CANLI (kuru test dışı) çalışmayı istedi.' : '',
  ].filter(Boolean);
  return `${baglam.join('\n')}\n\nSORU/KOMUT: ${String(p.question || '').trim()}`;
}
