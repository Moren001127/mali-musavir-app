/**
 * KALEM TAMAMLAMA — kalemsiz sağlayıcı XML'inde kalemleri belgenin PDF/görselinden okuma (PLAN/15 Faz 6, 2026-09-13).
 * SAF mantık (NestJS/Prisma YOK, birim testli: kalem-pdf.spec.ts). aiReadDocument bunu kullanır.
 *
 * CANLI BULGU: Paraşüt /e_invoices yalnız ÖZET verir (kalem yok) → sentetik UBL XML kalemsiz; gerçek fatura PDF'i
 *   belgede (ZIP original.pdf) VAR. aiReadDocument sağlayıcı XML'i varken görseli HİÇ okumuyordu (kullanıcı yönergesi:
 *   TÜRMOB XSLT görselinde yön ters okunuyordu → "XML'den oku"). Yönerge KALEMLİ XML için doğru; KALEMSİZ özet
 *   XML'de kalemler için PDF'e bakılmalı → 65 alış faturasının 55'i kalemsiz, sınıflandırma içeriksiz kalıyordu.
 *
 * GENEL KURAL (yalnız Paraşüt değil): XML kalemsiz + belgenin PDF/görseli var → kalemler dosyadan okunur.
 *
 * BİRLEŞTİRME KURALI (kalemPdfBirlestir): taraflar (satıcı/alıcı VKN-ad), yön, belge no/tarih, matrah/KDV/toplam,
 *   tevkifat/iade HER ZAMAN XML'den (preParsed) — dosya okuması YALNIZ kalemler[] (ad, tutar, oran), _kalemMetni
 *   (kalem adları; sınıflandırma içeriği) ve _pdfGiderTuru (yalnız yedek ipucu) sağlar. Başka alana DOKUNMAZ.
 *   Kalem toplamı XML matrahından ±%5'ten fazla saparsa kalemler yine alınır ama kalemKaynak='pdf-tahmin'
 *   (revalidate bilgi notu üretir). Uyuşuyorsa kalemKaynak='pdf'.
 *
 * GÜVEN: kalemKaynak pdf/pdf-tahmin olan belgede aiMatrahGuven en fazla 'orta' (aiMatrahGuvenTavani).
 * KAPATMA: ortam değişkeni FM_KALEM_PDF=off (deploy gerektirmez) → eski davranış (XML kalemsiz kalır).
 */

export type KalemPdfKalem = { ad: string; tutar: number; oran: number };
export type KalemKaynak = 'pdf' | 'pdf-tahmin';

/** Kalem toplamı ↔ XML matrahı kabul edilen sapma (oran; 0.05 = ±%5). */
export const KALEM_PDF_SAPMA_ESIGI = 0.05;
/** ocrData'ya yazılan en çok kalem sayısı (aiReadDocument ile aynı tavan). */
export const KALEM_PDF_EN_COK_KALEM = 30;

/** Dosya okuma girdisi: PDF metni (pdf-parse) ya da görsel (base64). */
export type KalemPdfDosya =
  | { tur: 'pdf-metin'; metin: string }
  | { tur: 'gorsel'; base64: string; mediaType: string };

/** claudeTextViaMax ile aynı biçimde çağrılan AI kapısı (servis gerçek Max altyapısını geçirir; testte sahte). */
export type KalemPdfAiCagri = (p: {
  prompt: string;
  images?: Array<{ base64: string; mediaType?: string }>;
  model?: string;
  timeoutMs?: number;
}) => Promise<{ ok: boolean; text?: string; error?: string }>;

export interface KalemPdfSonuc {
  kalemKaynak: KalemKaynak;
  kalemSayisi: number;
  kalemToplam: number;
  xmlMatrah: number;
  /** Yüzde sapma (|kalem toplamı − XML matrahı| / XML matrahı × 100); XML matrahı bilinmiyorsa null. */
  sapmaYuzde: number | null;
  /** Kalemleri hangi model okudu (log/ölçüm). */
  model?: string;
  dosyaTuru: KalemPdfDosya['tur'];
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** FM_KALEM_PDF=off|0|false|kapali → kapalı; aksi halde AÇIK (varsayılan). */
export function kalemPdfAcikMi(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env?.FM_KALEM_PDF || '').trim().toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false' || v === 'kapali');
}

/** XML ayrıştırması kalem vermedi mi? (kalemler yok / boş / adsız). */
export function xmlKalemsizMi(preParsed: any): boolean {
  if (!preParsed || typeof preParsed !== 'object') return false;
  const k = preParsed.kalemler;
  return !Array.isArray(k) || !k.some((x: any) => String(x?.ad || '').trim());
}

/** Kapı: sağlayıcı XML'i var + kalemsiz + özellik açık → dosyadan kalem tamamlama denenir. */
export function kalemPdfGerekliMi(preParsed: any, provXmlVar: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!provXmlVar && !!preParsed && xmlKalemsizMi(preParsed) && kalemPdfAcikMi(env);
}

/** XML'den gelen KDV hariç matrah (kdv[] kırılımı toplamı; yoksa _ubl.matrah). */
export function xmlMatrahi(preParsed: any): number {
  const kd = Array.isArray(preParsed?.kdv) ? preParsed.kdv : [];
  const sum = kd.reduce((s: number, b: any) => s + (Number(b?.matrah) || 0), 0);
  if (sum > 0) return r2(sum);
  return r2(Number(preParsed?._ubl?.matrah) || 0);
}

/** Yalnız KALEM odaklı prompt — taraf/tutar/yön istenmez (onlar XML'den). */
export function kalemPdfPromptu(p: { yon: 'ALIS' | 'SATIS'; dosya: KalemPdfDosya; xmlMatrah?: number | null; belgeNo?: string | null }): string {
  const gorsel = p.dosya.tur === 'gorsel';
  const matrah = Number(p.xmlMatrah) || 0;
  const matrahNotu = matrah > 0
    ? `Belgenin KDV HARİÇ toplamı ZATEN BİLİNİYOR: ≈ ${matrah.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL — kalem tutarları toplamı buna yakın olmalı (iskonto varsa iskonto SONRASI tutarı yaz).`
    : '';
  return [
    gorsel
      ? 'Aşağıdaki görüntü bir Türk e-Fatura / e-Arşiv faturasıdır.'
      : 'Aşağıda bir Türk e-Fatura / e-Arşiv faturasının PDF metni var.',
    `Belgenin tarafları, tutarları, tarihi ve yönü (${p.yon === 'SATIS' ? 'mükellef SATICI' : 'mükellef ALICI'}) ZATEN BİLİNİYOR — onları OKUMA, YAZMA.`,
    'YALNIZ mal/hizmet KALEMLERİNİ çıkar. YALNIZCA şu JSON\'u döndür — kod bloğu, açıklama, başka metin YOK:',
    `{"kalemler":[{"ad":"<mal/hizmet kalem adı>","tutar":<o kalemin KDV hariç tutarı sayı>,"oran":<o kalemin KDV oranı sayı>}],"giderTuru":"<${p.yon === 'ALIS' ? 'faturadaki ANA mal/hizmetin kısa adı (akaryakıt/kira/elektrik/su/doğalgaz/telefon/internet/kırtasiye/danışmanlık/nakliye/yemek/temizlik/bakım onarım/sigorta/reklam/araç kiralama…); net değilse boş' : 'boş bırak'}>"}`,
    'kalemler: faturadaki mal/hizmet satırları (kalem adı + KDV hariç tutar + KDV oranı). ⚠️ ÇOK KALEMLİYSE (>15 satır) KDV oranına ve benzer ürün grubuna göre BİRLEŞTİR — en fazla 15 nesne (ör. "%1 gıda ürünleri", "%20 temizlik/sarf"). Az kalemliyse her satır ayrı.',
    'KURALLAR: Türk sayı biçimi "1.234,56" = 1234.56 (ondalıklı sayıya çevir). tutar = KDV HARİÇ satır tutarı (miktar × birim fiyat − satır iskontosu); KDV dahil tutarı YAZMA. Okunamayan tutarı 0 bırak, UYDURMA. Kalem hiç okunamıyorsa "kalemler": [].',
    matrahNotu,
    p.belgeNo ? `Belge no: ${p.belgeNo}` : '',
    gorsel ? '' : ('\nİÇERİK:\n' + String((p.dosya as any).metin || '').replace(/\s+/g, ' ').trim().slice(0, 16000)),
  ].filter(Boolean).join('\n');
}

/** AI yanıtındaki JSON'u çöz; kalemleri temizle (ad ≤80, sayılar). Kalem yoksa/çözülemezse null. */
export function kalemPdfYanitiCoz(text: string | null | undefined): { kalemler: KalemPdfKalem[]; giderTuru: string } | null {
  const s = String(text || '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any = null;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const num = (v: any): number => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const t = String(v ?? '').trim();
    if (!t) return 0;
    // "1.234,56" → 1234.56 ; "1234.56" → 1234.56
    const tr = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    const n = Number(tr.replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const kalemler: KalemPdfKalem[] = (Array.isArray(j.kalemler) ? j.kalemler : [])
    .map((k: any) => ({ ad: String(k?.ad || '').replace(/\s+/g, ' ').trim().slice(0, 80), tutar: r2(num(k?.tutar)), oran: r2(num(k?.oran)) }))
    .filter((k: KalemPdfKalem) => k.ad)
    .slice(0, KALEM_PDF_EN_COK_KALEM);
  if (!kalemler.length) return null;
  return { kalemler, giderTuru: String(j.giderTuru || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
}

/**
 * BİRLEŞTİRME: preParsed'e YALNIZ kalemler/_kalemMetni/_pdfGiderTuru/_kalemKaynak yazılır; taraf/tutar/yön alanlarına
 * dokunulmaz. Kalem toplamı XML matrahıyla ±eşik içinde → 'pdf', değilse (ya da XML matrahı bilinmiyorsa) → 'pdf-tahmin'.
 * Kalem yoksa null döner ve preParsed DEĞİŞMEZ.
 */
export function kalemPdfBirlestir(
  preParsed: any,
  okunan: { kalemler: KalemPdfKalem[]; giderTuru?: string } | null | undefined,
  opts?: { sapmaEsigi?: number },
): Omit<KalemPdfSonuc, 'model' | 'dosyaTuru'> | null {
  if (!preParsed || typeof preParsed !== 'object') return null;
  const kalemler = (okunan?.kalemler || []).filter((k) => String(k?.ad || '').trim());
  if (!kalemler.length) return null;
  const esik = Number(opts?.sapmaEsigi ?? KALEM_PDF_SAPMA_ESIGI);
  const xmlMatrah = xmlMatrahi(preParsed);
  const kalemToplam = r2(kalemler.reduce((s, k) => s + (Number(k.tutar) || 0), 0));
  const sapma = xmlMatrah > 0 ? Math.abs(kalemToplam - xmlMatrah) / xmlMatrah : null;
  const kalemKaynak: KalemKaynak = sapma != null && sapma <= esik ? 'pdf' : 'pdf-tahmin';
  preParsed.kalemler = kalemler.map((k) => ({ ad: k.ad, tutar: r2(k.tutar), oran: r2(k.oran) }));
  preParsed._kalemMetni = kalemler.map((k) => k.ad).join('; ');
  const gt = String(okunan?.giderTuru || '').trim().slice(0, 40);
  if (gt) preParsed._pdfGiderTuru = gt;
  preParsed._kalemKaynak = kalemKaynak;
  return { kalemKaynak, kalemSayisi: kalemler.length, kalemToplam, xmlMatrah, sapmaYuzde: sapma == null ? null : r2(sapma * 100) };
}

/**
 * UÇTAN UCA (servis bunu çağırır): kapı → prompt → AI (1. deneme hızlı model, kalem gelmezse 2. deneme güçlü model)
 * → yanıt çöz → birleştir. AI/dosya yoksa null (eski davranış). preParsed yalnız başarıda değişir.
 */
export async function kalemPdfTamamla(
  preParsed: any,
  dosya: KalemPdfDosya | null | undefined,
  aiCagri: KalemPdfAiCagri,
  opts: { yon: 'ALIS' | 'SATIS'; belgeNo?: string | null; env?: NodeJS.ProcessEnv; modeller?: Array<string | undefined>; timeoutMs?: number; sapmaEsigi?: number },
): Promise<KalemPdfSonuc | null> {
  if (!kalemPdfGerekliMi(preParsed, true, opts.env || process.env)) return null;
  if (!dosya) return null;
  if (dosya.tur === 'pdf-metin' && String(dosya.metin || '').trim().length <= 80) return null; // taranmış/şifreli PDF: metin yok
  if (dosya.tur === 'gorsel' && String(dosya.base64 || '').length < 100) return null;
  const prompt = kalemPdfPromptu({ yon: opts.yon, dosya, xmlMatrah: xmlMatrahi(preParsed), belgeNo: opts.belgeNo });
  const modeller = opts.modeller && opts.modeller.length ? opts.modeller : [undefined];
  let okunan: { kalemler: KalemPdfKalem[]; giderTuru: string } | null = null;
  let kullanilan: string | undefined;
  for (const model of modeller) {
    const res = await aiCagri({
      prompt,
      ...(dosya.tur === 'gorsel' ? { images: [{ base64: dosya.base64, mediaType: dosya.mediaType }] } : {}),
      model,
      timeoutMs: opts.timeoutMs ?? 75000,
    }).catch(() => ({ ok: false, text: '' }));
    if (!res?.ok || !res.text) continue;
    okunan = kalemPdfYanitiCoz(res.text);
    if (okunan) { kullanilan = model; break; }
  }
  const b = kalemPdfBirlestir(preParsed, okunan, { sapmaEsigi: opts.sapmaEsigi });
  if (!b) return null;
  return { ...b, model: kullanilan, dosyaTuru: dosya.tur };
}

/** kalemKaynak pdf/pdf-tahmin ise 'yuksek' → 'orta' (tavan); diğer değerler olduğu gibi. */
export function aiMatrahGuvenTavani(guven: string | null | undefined, kalemKaynak: string | null | undefined): string | undefined {
  const g = guven == null ? undefined : String(guven);
  if (!g) return undefined;
  const k = String(kalemKaynak || '');
  if ((k === 'pdf' || k === 'pdf-tahmin') && g === 'yuksek') return 'orta';
  return g;
}
