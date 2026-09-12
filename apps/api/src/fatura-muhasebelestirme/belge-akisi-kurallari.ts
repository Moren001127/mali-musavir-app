/**
 * PLAN/16 §D–§E — BELGE AKIŞI + KDV TEYİT saf kuralları.
 *
 * SAF MODÜL (Prisma/Nest yok) — `scripts/belge-akisi-regression.cjs` doğrudan kullanır.
 *
 *  • belgeDurumu(doc)      → akış durumu sözlüğü (öncelik sıralı)
 *  • sekmeKaynagi(doc)     → belge hangi sekmede (yuklenen | entegrator | gib) + kaynak etiketi
 *  • sekmeWhere / durumWhere → aynı sözlüğün Prisma `where` karşılığı (liste + sayaçlar tek kaynaktan)
 *  • kdvFark(a, b)         → iki kaynak arasındaki fark (mutlak + yüzde + ±1 TL eşik uyarısı)
 *  • mizanKdvOku(rows)     → Luca mizan satırlarından 391/191/190 (KDV Kontrol'ün lucaCrosscheck mantığıyla aynı)
 *
 * `source` ayrık değerleri (canlı DB, 2026-09-12): integration-turmob_efatura · integration-turkcell ·
 *   integration-parasut · integration-elogo · mihsap · earsiv · gib-earsiv-api · fatura-merkezi.
 *   Kodda ayrıca: manual-web (varsayılan) · mobile-ocr (mobil uygulama) · gib-portal-api (GIB_PORTAL sağlayıcı).
 */

import { eskiUyariyiHaritala, UYARI_KOD, UyariSeviye } from './uyari-katmani';

// ─────────────────────────────────────────────────────────────────────────────
// DURUM SÖZLÜĞÜ
// ─────────────────────────────────────────────────────────────────────────────

export type AkisDurum = 'iptal' | 'hata' | 'okunuyor' | 'lucada' | 'onayli' | 'karar_bekliyor' | 'okundu';

export const DURUM_ETIKET: Record<AkisDurum, string> = {
  iptal: 'İptal',
  hata: 'Hata',
  okunuyor: 'Okunuyor',
  lucada: "Luca'da",
  onayli: 'Onaylı',
  karar_bekliyor: 'Karar bekliyor',
  okundu: 'Okundu',
};

/** Sahip kararı isteyen uyarı kodları (DEMIRBAS yalnız karar verilmemişse). */
export const KARAR_KODLARI: string[] = [
  UYARI_KOD.DEMIRBAS,
  UYARI_KOD.MUKERRER,
  'MUKERRER_GORSEL',
  UYARI_KOD.TEVKIFAT_EKSIK,
  UYARI_KOD.ALICI_TIPI_GEREKLI,
];

export const OKUNUYOR_OCR = ['PENDING', 'IN_PROGRESS', 'PROCESSING'];
export const LUCADA_LUCA = ['POSTED', 'MANUAL_DONE'];
export const ONAYLI_LUCA = ['QUEUED', 'POSTING'];
export const IPTAL_STATUS = ['CANCELLED', 'REJECTED'];

export interface UyariOzetSatir {
  kod: string;
  seviye: UyariSeviye;
  baslik: string;
}

/** ocrData.uyarilar → yeni modele yükseltilmiş, engel→uyarı→bilgi sıralı kısa liste. */
export function uyariOzetListesi(uyarilar: any, enFazla = 4): UyariOzetSatir[] {
  const list = (Array.isArray(uyarilar) ? uyarilar : []).map(eskiUyariyiHaritala).filter(Boolean) as any[];
  const sira = (s: UyariSeviye) => (s === 'engel' ? 0 : s === 'uyari' ? 1 : 2);
  return list
    .sort((a, b) => sira(a.seviye) - sira(b.seviye))
    .slice(0, enFazla)
    .map((u) => ({ kod: u.kod, seviye: u.seviye, baslik: u.baslik || u.kod }));
}

/** Belge sahip kararı bekliyor mu? (mükerrer bağı ya da engel/karar kodlu uyarı) */
export function kararBekliyorMu(doc: any): boolean {
  if (doc?.duplicateOfId) return true;
  const list = (Array.isArray(doc?.ocrData?.uyarilar) ? doc.ocrData.uyarilar : []).map(eskiUyariyiHaritala).filter(Boolean) as any[];
  return list.some((u) => {
    if (u.seviye === 'engel') return true;
    if (u.kod === UYARI_KOD.DEMIRBAS) return u.meta?.karar == null;
    return KARAR_KODLARI.includes(u.kod);
  });
}

/**
 * Akış durumu — öncelik: iptal → hata → okunuyor → lucada → onaylı → karar bekliyor → okundu.
 * (İptal en başta: iptal/red edilmiş belge okuma hatası taşısa da "hata" değil "iptal" görünür.)
 */
export function belgeDurumu(doc: any): AkisDurum {
  const status = String(doc?.status || '').toUpperCase();
  const ocr = String(doc?.ocrStatus || '').toUpperCase();
  const luca = String(doc?.lucaStatus || '').toUpperCase();
  const val = String(doc?.validationStatus || '').toUpperCase();
  if (IPTAL_STATUS.includes(status)) return 'iptal';
  if (ocr === 'FAILED' || luca === 'FAILED' || val === 'INVALID') return 'hata';
  if (OKUNUYOR_OCR.includes(ocr)) return 'okunuyor';
  if (LUCADA_LUCA.includes(luca)) return 'lucada';
  if (status === 'APPROVED' || ONAYLI_LUCA.includes(luca)) return 'onayli';
  if (kararBekliyorMu(doc)) return 'karar_bekliyor';
  return 'okundu';
}

// Prisma `where` parçaları — hepsi POZİTİF süzgeç (NOT kullanılmaz: nullable kolonda NOT NULL'ları düşürür).
const HATA_WHERE = { OR: [{ ocrStatus: 'FAILED' }, { lucaStatus: 'FAILED' }, { validationStatus: 'INVALID' }] };
const HATA_DEGIL = {
  ocrStatus: { not: 'FAILED' },
  lucaStatus: { not: 'FAILED' },
  OR: [{ validationStatus: null }, { validationStatus: { not: 'INVALID' } }],
};
const IPTAL_WHERE = { status: { in: IPTAL_STATUS } };
const IPTAL_DEGIL = { status: { notIn: IPTAL_STATUS } };
const OKUNUYOR_WHERE = { ocrStatus: { in: OKUNUYOR_OCR } };
const OKUNUYOR_DEGIL = { ocrStatus: { notIn: OKUNUYOR_OCR } };
const LUCADA_WHERE = { lucaStatus: { in: LUCADA_LUCA } };
const LUCADA_DEGIL = { lucaStatus: { notIn: LUCADA_LUCA } };
const ONAYLI_WHERE = { OR: [{ status: 'APPROVED' }, { lucaStatus: { in: ONAYLI_LUCA } }] };
const ONAYLI_DEGIL = { status: { not: 'APPROVED' }, lucaStatus: { notIn: ONAYLI_LUCA } };

/**
 * Durum → Prisma where. `kararIds` = SQL ile bulunmuş "karar bekleyen" belge id'leri (uyarı JSON'u
 * Prisma where ile süzülemediğinden ham sorguyla çıkarılır; bkz. KARAR_SQL_KOSULU).
 */
export function durumWhere(durum: AkisDurum, kararIds: string[] = []): any {
  switch (durum) {
    case 'iptal': return IPTAL_WHERE;
    case 'hata': return { AND: [IPTAL_DEGIL, HATA_WHERE] };
    case 'okunuyor': return { AND: [IPTAL_DEGIL, HATA_DEGIL, OKUNUYOR_WHERE] };
    case 'lucada': return { AND: [IPTAL_DEGIL, HATA_DEGIL, OKUNUYOR_DEGIL, LUCADA_WHERE] };
    case 'onayli': return { AND: [IPTAL_DEGIL, HATA_DEGIL, OKUNUYOR_DEGIL, LUCADA_DEGIL, ONAYLI_WHERE] };
    case 'karar_bekliyor':
      return { AND: [IPTAL_DEGIL, HATA_DEGIL, OKUNUYOR_DEGIL, LUCADA_DEGIL, ONAYLI_DEGIL, { id: { in: kararIds } }] };
    case 'okundu':
      return { AND: [IPTAL_DEGIL, HATA_DEGIL, OKUNUYOR_DEGIL, LUCADA_DEGIL, ONAYLI_DEGIL, { id: { notIn: kararIds } }] };
    default: return {};
  }
}

/** "Karar bekliyor" ham SQL koşulu (invoice_accounting_documents satırı için; `kararBekliyorMu` ile aynı sözlük). */
export const KARAR_SQL_KOSULU = `(
  "duplicateOfId" IS NOT NULL OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof("ocrData"->'uyarilar') = 'array' THEN "ocrData"->'uyarilar' ELSE '[]'::jsonb END
    ) u
    WHERE u->>'seviye' = 'engel' OR u->>'siddet' = 'hata'
       OR u->>'kod' IN ('MUKERRER', 'MUKERRER_GORSEL', 'TEVKIFAT_EKSIK', 'ALICI_TIPI_GEREKLI')
       OR (u->>'kod' = 'DEMIRBAS' AND (u->'meta'->>'karar') IS NULL)
  )
)`;

// ─────────────────────────────────────────────────────────────────────────────
// SEKME / KAYNAK EŞLEMESİ
// ─────────────────────────────────────────────────────────────────────────────

// 'tumu' = kaynak ayrımı YOK (kullanıcı kararı 2026-09-12: kaynak sekmeleri kalktı; kaynak satırda rozet olarak görünür).
export type AkisSekme = 'tumu' | 'yuklenen' | 'entegrator' | 'gib' | 'silinen';

export const ENTEGRATOR_PREFIXLER = ['integration-', 'efatura-'];
export const ENTEGRATOR_KAYNAKLAR = ['mihsap', 'efatura-inbox'];
export const GIB_PREFIXLER = ['gib-'];
export const GIB_KAYNAKLAR = ['earsiv', 'gib-earsiv-api', 'gib-portal-api'];

const SAGLAYICI_ETIKET: Record<string, string> = {
  turmob_efatura: 'TÜRMOB',
  turmob: 'TÜRMOB',
  turkcell: 'Turkcell',
  parasut: 'Paraşüt',
  elogo: 'eLogo',
  uyumsoft: 'Uyumsoft',
  mikro: 'Mikro',
  izibiz: 'İzibiz',
  foriba: 'Foriba',
  eczacikart: 'Eczacıkart',
  gib_portal: 'GİB',
};

export function kaynakEtiketi(source: any, opts: { documentType?: any; belgeKaynak?: any } = {}): string {
  const s = String(source || '').trim().toLowerCase();
  if (!s || s === 'manual-web' || s === 'fatura-merkezi' || s === 'upload' || s === 'web') return 'Yükleme';
  if (s.startsWith('mobile')) return 'Mobil';
  if (s.startsWith('whatsapp')) return 'WhatsApp';
  if (s === 'mihsap') return 'Mihsap';
  if (s === 'efatura-inbox' || s.startsWith('efatura-')) return 'Entegratör';
  if (s.startsWith('integration-')) {
    const p = s.slice('integration-'.length);
    if (SAGLAYICI_ETIKET[p]) return SAGLAYICI_ETIKET[p];
    return p.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (GIB_KAYNAKLAR.includes(s) || s.startsWith('gib-')) {
    const dt = String(opts.documentType || '').toUpperCase();
    const bk = String(opts.belgeKaynak || '').toUpperCase();
    return dt === 'E_FATURA' || bk === 'EFATURA' ? 'GİB e-Fatura' : 'GİB';
  }
  return `Yükleme (${s})`;
}

/** Belgenin sekmesi + kaynak etiketi. Bilinmeyen kaynak "yuklenen"e düşer (hiçbir belge sekmesiz kalmaz). */
export function sekmeKaynagi(doc: any): { sekme: Exclude<AkisSekme, 'silinen'>; etiket: string; kod: string } {
  const s = String(doc?.source || '').trim().toLowerCase();
  const etiket = kaynakEtiketi(s, { documentType: doc?.documentType, belgeKaynak: doc?.ocrData?.belgeKaynak });
  if (ENTEGRATOR_KAYNAKLAR.includes(s) || ENTEGRATOR_PREFIXLER.some((p) => s.startsWith(p))) return { sekme: 'entegrator', etiket, kod: s };
  if (GIB_KAYNAKLAR.includes(s) || GIB_PREFIXLER.some((p) => s.startsWith(p))) return { sekme: 'gib', etiket, kod: s };
  return { sekme: 'yuklenen', etiket, kod: s || 'manual-web' };
}

const ENTEGRATOR_WHERE = {
  OR: [
    { source: { in: ENTEGRATOR_KAYNAKLAR } },
    ...ENTEGRATOR_PREFIXLER.map((p) => ({ source: { startsWith: p } })),
  ],
};
const GIB_WHERE = {
  OR: [
    { source: { in: GIB_KAYNAKLAR } },
    ...GIB_PREFIXLER.map((p) => ({ source: { startsWith: p } })),
  ],
};

/** Sekme → Prisma where (yuklenen = diğer ikisinin tümleyeni). */
export function sekmeWhere(sekme: AkisSekme): any {
  if (sekme === 'entegrator') return ENTEGRATOR_WHERE;
  if (sekme === 'gib') return GIB_WHERE;
  if (sekme === 'silinen' || sekme === 'tumu') return {};
  return { NOT: [ENTEGRATOR_WHERE, GIB_WHERE] };
}

// ─────────────────────────────────────────────────────────────────────────────
// KDV TEYİT — FARK HESABI
// ─────────────────────────────────────────────────────────────────────────────

export interface KdvFark {
  /** a − b (işaretli, 2 hane). */
  fark: number;
  mutlak: number;
  /** |a−b| / max(|a|,|b|) × 100 — iki taraf da 0 ise 0. */
  yuzde: number;
  /** |a−b| > eşik (varsayılan 1 TL). */
  uyari: boolean;
}

export function kdvFark(a: number | null | undefined, b: number | null | undefined, esikTL = 1): KdvFark | null {
  if (a == null || b == null || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return null;
  const x = Number(a), y = Number(b);
  const fark = Math.round((x - y) * 100) / 100;
  const mutlak = Math.abs(fark);
  const payda = Math.max(Math.abs(x), Math.abs(y));
  const yuzde = payda > 0.005 ? Math.round((mutlak / payda) * 10000) / 100 : 0;
  return { fark, mutlak, yuzde, uyari: mutlak > esikTL + 1e-9 };
}

/** KDV1 sonucu: ödenecek / sonraki döneme devreden (KDV Kontrol `kdv1OnHazirlik` ile aynı formül). */
export function kdvSonuc(hesaplanan: number, indirilecek: number, devreden: number) {
  const diff = Math.round((hesaplanan - indirilecek - devreden) * 100) / 100;
  return {
    odenecek: diff > 0 ? diff : 0,
    sonrakiDevreden: diff < 0 ? Math.round(-diff * 100) / 100 : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LUCA MİZAN → 391 / 191 / 190
// ─────────────────────────────────────────────────────────────────────────────

export interface MizanSatir {
  kod?: string; hesapKodu?: string;
  borcToplami?: any; alacakToplami?: any; borcBakiye?: any; alacakBakiye?: any;
}

const mizanKod = (r: any) => String(r?.kod || r?.hesapKodu || '').trim();
const mizanTutar = (v: any) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Hesap prefix'i için bakiye: yaprak satırların bakiye toplamı; sıfırsa (ay sonu tahakkuk fişi
 * kapatmışsa) aynı taraftaki dönem hareketi; hiyerarşi yoksa tam kod satırı; son çare tüm eşleşenler.
 * KDV Kontrol `lucaCrosscheck.sumBakiye` ile birebir.
 */
export function mizanBakiye(rows: MizanSatir[], kodPrefix: string, taraf: 'borc' | 'alacak'): number | null {
  const list = Array.isArray(rows) ? rows : [];
  const matches = list.filter((r) => { const k = mizanKod(r); return k === kodPrefix || k.startsWith(kodPrefix + '.'); });
  if (!matches.length) return null;
  const kodlar = new Set(matches.map(mizanKod).filter(Boolean));
  const leaf = matches.filter((r) => { const k = mizanKod(r); const p = k + '.'; for (const o of kodlar) if (o !== k && o.startsWith(p)) return false; return !!k; });
  const bakiyeAlan = taraf === 'borc' ? 'borcBakiye' : 'alacakBakiye';
  const hareketAlan = taraf === 'borc' ? 'borcToplami' : 'alacakToplami';
  const topla = (items: any[], alan: string) => r2(items.reduce((s, r) => s + mizanTutar(r?.[alan]), 0));
  const leafBakiye = topla(leaf, bakiyeAlan);
  if (Math.abs(leafBakiye) > 0.005) return leafBakiye;
  const leafHareket = topla(leaf, hareketAlan);
  if (Math.abs(leafHareket) > 0.005) return leafHareket;
  const exact = matches.find((r) => mizanKod(r) === kodPrefix);
  if (exact) {
    const b = r2(mizanTutar((exact as any)[bakiyeAlan]));
    if (Math.abs(b) > 0.005) return b;
    const h = r2(mizanTutar((exact as any)[hareketAlan]));
    if (Math.abs(h) > 0.005) return h;
  }
  return topla(matches, bakiyeAlan);
}

export function mizanKdvOku(rows: MizanSatir[]) {
  return {
    hesaplanan: mizanBakiye(rows, '391', 'alacak'),
    indirilecek: mizanBakiye(rows, '191', 'borc'),
    devreden: mizanBakiye(rows, '190', 'borc'),
  };
}
