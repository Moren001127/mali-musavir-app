/**
 * PLAN/16 §C — FİŞ (ÖKC) MÜKERRER EŞLEŞME ANAHTARI + yardımcılar. SAF MODÜL (Prisma/Nest yok).
 *
 * Kural (kullanıcı kararı 2026-09-12): ENGEL yalnız UZUN (≥10 hane) belge numarasında kalır
 * (e-Fatura/e-Arşiv numarası benzersizdir). Kısa fiş numarası (ÖKC "0049") gün/satıcı bazında
 * tekrar eder → kısa no + VKN + tutar (±0,01) + AYNI GÜN eşleşmesi UYARIDIR (MUKERRER_FIS).
 * Fiş numarası hiç okunmadıysa: VKN + aynı gün + SAAT + tutar → yine uyarı (MUKERRER_FIS).
 * Sahip "mükerrer değil" derse uyarı kalkar; "mükerrer" derse kopya teyit edilmiş sayılır.
 */

export type FisEslesmeTuru = 'uzun' | 'kisa' | 'saat';

export interface FisEslesmeAnahtari {
  tur: FisEslesmeTuru;
  /** İnsan-okur, deterministik anahtar (log/meta/test için). */
  anahtar: string;
  vkn: string;
  belgeNo: string | null;
  /** YYYY-MM-DD (UTC gün) — 'uzun' türde boş olabilir. */
  gun: string | null;
  /** HH:MM — yalnız 'saat' türünde dolu. */
  saat: string | null;
  /** 2 ondalıklı tutar — 'uzun' türde null (tutar şartı yok). */
  tutar: number | null;
}

/** Yer tutucu belge no: boş, "BILINMIYOR", "-", ETTN/uuid, belge id'sinin kendisi. */
export function belgeNoYerTutucuMu(belgeNo: any, docId?: string | null): boolean {
  const b = String(belgeNo ?? '').trim();
  if (!b) return true;
  if (/^(bilinmiyor|bilinmeyen|yok|-+|n\/a|na|null|undefined|belge ?no|fatura ?no)$/i.test(b)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b)) return true;
  if (docId && b === String(docId)) return true;
  return false;
}

/** Uzun (benzersiz) belge no: en az 10 rakam (ABC2026000000123 gibi). */
export function belgeNoUzunMu(belgeNo: any): boolean {
  return String(belgeNo ?? '').replace(/\D/g, '').length >= 10;
}

/** VKN/TCKN normalize: yalnız rakam; 10 ya da 11 hane değilse boş. */
export function vknNormalize(v: any): string {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? d : '';
}

/** Tutarı 2 ondalığa yuvarla; geçersiz/≤0 → null. Türkçe biçim ("1.234,56") kabul edilir. */
export function tutarNormalize(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'object' && typeof (v as any).toNumber === 'function') n = (v as any).toNumber(); // Prisma.Decimal
  else {
    const s = String(v).trim().replace(/\s|₺|TL/gi, '');
    const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/[^\d.-]/g, '');
    n = Number(normalized);
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Tarihi UTC güne indirger: 'YYYY-MM-DD' (geçersiz → null). GG.AA.YYYY / YYYY-MM-DD / Date kabul eder. */
export function gunAnahtari(tarih: Date | string | null | undefined): string | null {
  if (!tarih) return null;
  let d: Date | null = null;
  if (tarih instanceof Date) d = tarih;
  else {
    const s = String(tarih).trim();
    let m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
    if (m) d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    else {
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      else d = new Date(s);
    }
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** UTC gün aralığı [gte, lt) — Prisma faturaTarihi süzgeci için. */
export function gunAraligi(tarih: Date | string | null | undefined): { gte: Date; lt: Date } | null {
  const g = gunAnahtari(tarih);
  if (!g) return null;
  const [y, m, d] = g.split('-').map((x) => parseInt(x, 10));
  return { gte: new Date(Date.UTC(y, m - 1, d)), lt: new Date(Date.UTC(y, m - 1, d + 1)) };
}

/** ±0,01 tutar aralığı (Prisma totalAmount süzgeci). */
export function tutarAraligi(tutar: number): { gte: number; lte: number } {
  return { gte: Math.round((tutar - 0.01) * 100) / 100, lte: Math.round((tutar + 0.01) * 100) / 100 };
}

/**
 * Ham fiş metninden SAAT ayıkla → 'HH:MM' (24 saat). Öncelik:
 *   1) "SAAT: 18:30" / "SAAT 18.30" etiketli,
 *   2) tarihin hemen ardındaki saat ("05.08.2026 18:30"),
 *   3) metindeki ilk geçerli HH:MM (18:30:45 gibi saniyeli de olur).
 * Bulunamazsa null. Geçersiz saat (25:70) elenir.
 */
export function saatAyikla(text: any): string | null {
  const t = String(text ?? '');
  if (!t) return null;
  const gecerli = (hh: string, mm: string): string | null => {
    const h = parseInt(hh, 10), m = parseInt(mm, 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  let m = t.match(/SAAT[İI]?\s*[:.]?\s*(\d{1,2})[:.](\d{2})(?!\d)/i);
  if (m) { const s = gecerli(m[1], m[2]); if (s) return s; }
  m = t.match(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\s+(\d{1,2})[:.](\d{2})(?!\d)/);
  if (m) { const s = gecerli(m[1], m[2]); if (s) return s; }
  const re = /(?<![\d.,])(\d{1,2}):(\d{2})(?::\d{2})?(?![\d.,])/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(t))) { const s = gecerli(r[1], r[2]); if (s) return s; }
  return null;
}

/** Saat metnini normalize et ('18.30', '8:5' → '18:30', '08:05'); geçersiz → null. */
export function saatNormalize(saat: any): string | null {
  const s = String(saat ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[:.](\d{1,2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/**
 * Fiş eşleşme anahtarı: hangi kuralla mükerrer aranacağını ve anahtar bileşenlerini üretir.
 *   • uzun : belge no ≥10 rakam + VKN                         → ENGEL adayı (tutar/tarih şartı yok)
 *   • kisa : kısa belge no + VKN + tutar + gün                → UYARI adayı (MUKERRER_FIS)
 *   • saat : belge no yok/yer tutucu + VKN + gün + saat + tutar → UYARI adayı (MUKERRER_FIS)
 *   Şartlar sağlanmıyorsa null (aranmaz).
 */
export function fisEslesmeAnahtari(p: {
  belgeNo?: any;
  vkn?: any;
  tutar?: any;
  tarih?: Date | string | null;
  saat?: any;
  rawText?: any;
  docId?: string | null;
}): FisEslesmeAnahtari | null {
  const vkn = vknNormalize(p.vkn);
  if (!vkn) return null;
  const belgeNoHam = String(p.belgeNo ?? '').trim();
  const yerTutucu = belgeNoYerTutucuMu(belgeNoHam, p.docId || null);
  const gun = gunAnahtari(p.tarih ?? null);
  const tutar = tutarNormalize(p.tutar);
  if (!yerTutucu && belgeNoUzunMu(belgeNoHam)) {
    return { tur: 'uzun', anahtar: `uzun|${vkn}|${belgeNoHam}`, vkn, belgeNo: belgeNoHam, gun, saat: null, tutar: null };
  }
  if (!yerTutucu) {
    if (!gun || tutar == null) return null; // kısa no: gün ve tutar şart (fiş no tekrar eder)
    return { tur: 'kisa', anahtar: `kisa|${vkn}|${belgeNoHam}|${gun}|${tutar.toFixed(2)}`, vkn, belgeNo: belgeNoHam, gun, saat: null, tutar };
  }
  const saat = saatNormalize(p.saat) || saatAyikla(p.rawText);
  if (!gun || tutar == null || !saat) return null;
  return { tur: 'saat', anahtar: `saat|${vkn}|${gun}|${saat}|${tutar.toFixed(2)}`, vkn, belgeNo: null, gun, saat, tutar };
}

/** Mevcut belgenin saatini bul: ocrData.saat → rawText (ocrData.rawText / ocrRawText). */
export function belgeSaati(doc: { ocrData?: any; ocrRawText?: any } | null | undefined): string | null {
  if (!doc) return null;
  const od: any = doc.ocrData || {};
  return saatNormalize(od.saat) || saatAyikla(od.rawText) || saatAyikla(doc.ocrRawText);
}

/**
 * UBL XML'den ETTN (Invoice/cbc:UUID) ayıkla → küçük harf uuid; XML değilse/yoksa null.
 * Görsel/PDF sihirli baytları görülürse hiç aranmaz.
 */
export function ettnAyikla(input: Buffer | string | null | undefined): string | null {
  if (!input) return null;
  let head: string;
  if (Buffer.isBuffer(input)) {
    if (input.length >= 4) {
      const b0 = input[0], b1 = input[1], b2 = input[2];
      if ((b0 === 0xff && b1 === 0xd8) || (b0 === 0x89 && b1 === 0x50) || (b0 === 0x25 && b1 === 0x50 && b2 === 0x44) || (b0 === 0x47 && b1 === 0x49) || (b0 === 0x42 && b1 === 0x4d) || (b0 === 0x50 && b1 === 0x4b)) return null;
    }
    head = input.subarray(0, 65536).toString('utf8');
  } else head = String(input).slice(0, 65536);
  if (!/<(?:[\w.-]+:)?(?:Invoice|CreditNote|ArchiveInvoice)\b/i.test(head) && !/<(?:[\w.-]+:)?UUID\b/i.test(head)) return null;
  const m = head.match(/<(?:[\w.-]+:)?UUID[^>]*>\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*</);
  return m ? m[1].toLowerCase() : null;
}
