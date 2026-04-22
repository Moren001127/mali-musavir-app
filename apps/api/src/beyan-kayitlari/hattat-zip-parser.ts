/**
 * Hattat ZIP Parser
 *
 * Hattat'ın toplu export ZIP'i şu yapıda geliyor:
 *
 *   ROOT.zip
 *   └── MOREN MALI MÜSAVIRLIK/        (ofis klasörü)
 *       ├── {MÜKELLEF_ADI}-{HATTAT_ID}/
 *       │   ├── 2025(KDV1-ASIL)/
 *       │   │   ├── KDV1-3-2025-Tahakkuk-40687199.pdf
 *       │   │   └── KDV1-3-2025-Beyanname-40687198.pdf
 *       │   ├── 2025(KDV2-ASIL)/
 *       │   ├── 2025(MUHSGK-ASIL)/
 *       │   └── 2025(KGECICI-ASIL)/    (Kurumlar Geçici Vergi)
 *       └── ...
 *
 * Bu dosya klasör/dosya adlarından metadata çıkarır (AI'a gerek yok).
 */

/** Klasör adı: "ZEKI ÖZKAYNAK-598407" → { ad: 'ZEKI ÖZKAYNAK', hattatId: '598407' } */
export function parseMukellefKlasoru(name: string): { ad: string; hattatId: string } | null {
  // Format: "{ad}-{id}" — id sayısal (4+ hane)
  const m = name.match(/^(.+?)-(\d{4,})$/);
  if (!m) return null;
  return { ad: m[1].trim(), hattatId: m[2] };
}

/** Klasör adı: "2025(KDV1-ASIL)" → 'KDV1' */
export function parseBeyanTipiKlasoru(name: string): string | null {
  // 2025(KDV1-ASIL), 2025(MUHSGK-ASIL), 2025(KGECICI-ASIL) vb.
  const m = name.match(/\(([\w-]+?)(?:-ASIL|-ONAY|-KOPYA)?\)/i);
  if (!m) return null;
  const raw = m[1].toUpperCase();
  return raw;
}

/** Hattat beyan tipi → Moren beyan tipi eşleştirme */
export function mapBeyanTipi(hattatTipi: string): string {
  const map: Record<string, string> = {
    'KDV1': 'KDV1',
    'KDV2': 'KDV2',
    'MUHSGK': 'MUHSGK',
    'MUHTASAR': 'MUHSGK',
    'MUH': 'MUHSGK',
    'KGECICI': 'GECICI_VERGI',     // Kurum Geçici Vergi
    'GGECICI': 'GECICI_VERGI',     // Gelir Geçici Vergi
    'GECICI': 'GECICI_VERGI',
    'GVG': 'GECICI_VERGI',
    'DAMGA': 'DAMGA',
    'DV': 'DAMGA',
    'POSET': 'POSET',
    'KURUMLAR': 'KURUMLAR',
    'KURUM': 'KURUMLAR',
    'KV': 'KURUMLAR',
    'GELIR': 'GELIR',
    'GV': 'GELIR',
    'KONAKLAMA': 'DIGER',
    'TURIZM': 'DIGER',
    'EDEFTER': 'EDEFTER',
    'DEFTER': 'EDEFTER',
    'BILDIRGE': 'BILDIRGE',
  };
  return map[hattatTipi] || 'DIGER';
}

/**
 * PDF dosya adı parse.
 *
 * Örnekler:
 *   - "KDV1-3-2025-Tahakkuk-40687199.pdf"   → tip=KDV1, ay=3, yil=2025, rolü=tahakkuk, onay=40687199
 *   - "KDV1-3-2025-Beyanname-40687198.pdf"  → rolü=beyanname
 *   - "MUHSGK-12-2024-Tahakkuk-12345.pdf"   → MUHSGK 2024-12
 *   - "KGECICI-1-2025-Tahakkuk-98765.pdf"   → Geçici Vergi 1. dönem 2025
 */
export function parsePdfAd(filename: string): {
  tip: string;
  ay: number;
  yil: number;
  rolu: 'tahakkuk' | 'beyanname' | 'diger';
  onayNo: string;
} | null {
  const base = filename.replace(/\.pdf$/i, '');
  // Format: TIPI-AY-YIL-ROLU-ONAYNO
  const m = base.match(/^([\w]+)-(\d{1,2})-(\d{4})-(\w+)-(\d+)$/);
  if (!m) return null;
  const [, tip, ayStr, yilStr, roluRaw, onayNo] = m;
  const ay = parseInt(ayStr, 10);
  const yil = parseInt(yilStr, 10);
  if (!ay || !yil || ay < 1 || ay > 12) return null;

  const rLower = roluRaw.toLowerCase();
  const rolu: 'tahakkuk' | 'beyanname' | 'diger' =
    rLower.includes('tahakkuk') ? 'tahakkuk' :
    rLower.includes('beyanname') ? 'beyanname' : 'diger';

  return { tip: tip.toUpperCase(), ay, yil, rolu, onayNo };
}

/**
 * Dönemi Moren formatına çevir.
 *
 * - Aylık beyanlar (KDV1, KDV2, MUHSGK, DAMGA, POSET): "yyyy-mm"
 * - Geçici vergi: "yyyy-Q{1-4}" (dönem numarası ayda 3. çeyrek gibi)
 * - Yıllık (KURUMLAR, GELIR): "yyyy-YIL"
 */
export function formatDonem(beyanTipi: string, ay: number, yil: number): string {
  if (beyanTipi === 'GECICI_VERGI') {
    // Hattat'ın ay alanı geçici vergi döneminin kendisi (1-4) ya da son çeyrek ayı olabilir.
    // Uygulamada genelde dönem numarası (1,2,3,4) geliyor. 1-4 ise Q{n}, 3/6/9/12 ise çeyrek sonu.
    if (ay >= 1 && ay <= 4) return `${yil}-Q${ay}`;
    const q = Math.ceil(ay / 3);
    return `${yil}-Q${q}`;
  }
  if (beyanTipi === 'KURUMLAR' || beyanTipi === 'GELIR') {
    // Yıllık beyan — genelde 3. veya 4. ayda verilir, yıl etiketi önceki yıl olabilir
    return `${yil}-YIL`;
  }
  return `${yil}-${String(ay).padStart(2, '0')}`;
}

/** İsim normalize — fuzzy match için */
export function normalizeAd(s: string): string {
  return s
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/\bANONIM\b/g, '').replace(/\bSIRKETI\b/g, '').replace(/\bSIRKET\b/g, '')
    .replace(/\bLIMITED\b/g, '').replace(/\bLTD\b/g, '').replace(/\bSTI\b/g, '')
    .replace(/\bVE TICARET\b/g, '').replace(/\bTIC\b/g, '').replace(/\bTICARET\b/g, '')
    .replace(/\bSANAYI\b/g, '').replace(/\bSAN\b/g, '')
    .replace(/[.,\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Basit jaccard benzerliği (kelimesel) — 0..1 */
export function adBenzerlik(a: string, b: string): number {
  const aw = new Set(normalizeAd(a).split(' ').filter((w) => w.length >= 2));
  const bw = new Set(normalizeAd(b).split(' ').filter((w) => w.length >= 2));
  if (aw.size === 0 || bw.size === 0) return 0;
  let common = 0;
  for (const w of aw) if (bw.has(w)) common++;
  return common / Math.max(aw.size, bw.size);
}
