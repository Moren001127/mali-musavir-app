/**
 * ÖĞRENME HIZLI YOLU — sahip onayıyla öğrenilmiş satıcı+içerik kararından Max'e HİÇ sormadan hesap seçimi.
 * SAF modül: DB / Nest bağımlılığı YOK (regresyon betiği doğrudan yükler: scripts/ogrenme-hizli-yol-regression.cjs).
 *
 * GÖREV B (2026-09-13) — canlı ölçüm: tek Max sınıflandırma çağrısı 95-153 sn (kapı=3 eşzamanlı). Aynı satıcı (VKN)
 * + aynı kalem içeriği (icerikImza) daha önce sahip onayıyla öğrenildiyse sınıflandırma + hesap bu modülden gelir;
 * Max çağrılmaz ([CLS-SKIP-LEARNED]). Onaylar arttıkça sistem kendiliğinden hızlanır.
 *
 * Kurallar (öncelik sırasıyla):
 *  (a) HAFIZA     — aynı mükellef + aynı VKN + imza eşleşmesi (mevcut pickVendorMemoryAccount eşik mantığı: onayAdedi ≥ 2,
 *                   CARI hariç, kod planda KAYDEDİLEBİLİR yaprak). Öncelik: imza+oran → imza → (imzaZorunlu=false ise)
 *                   oran-genel → tamamen genel. AI atlama yolunda imza ZORUNLU (içerik-körü atlama yok).
 *  (b) HAFIZA_AD  — aynı mükellefte kod artık planda YOK (plan yenilendi) ama karar hesap ADI taşıyorsa, plandaki
 *                   AYNI ADLI (normalize) TEK yaprağa çözülür. İmza eşleşmesi şart.
 *  (c) HAFIZA_AD  — mükellefler arası: aynı VKN için BAŞKA mükellef(ler)de imzası eşleşen onaylı kararların toplamı
 *                   ≥ caprazEsik (2) ve hepsi AYNI hesap adına gidiyorsa (baskın ad; rakip ad varsa REDDEDİLİR) ve bu
 *                   mükellefin planında aynı adlı TEK yaprak varsa → guven ORTA. Yalnız BİLANÇO (iki taraf da).
 *  (d) MEVZUAT AĞI — alışta 6xx ASLA; satışta 7xx/15x/25x ASLA; had-üstü demirbaşta yalnız 25x. Ağdan geçmeyen
 *                   karar SEÇİLMEZ (null → normal AI yolu).
 *  İşletme defteri bu modülün DIŞINDADIR (hesap planı yok; pickIsletmeMemory ayrı çalışır).
 *
 * Girdi kararlar dizisi çağıran tarafından TEK sorguyla çekilir (VKN'ye göre tenant'ın tüm 'fatura' kararları,
 * onayAdedi/sonKullanim sıralı, limit 200); hesapAdi/defterTuru alanlarını çağıran çözer (plan snapshot'ından).
 */

export type HizliYolKarar = {
  taxpayerId: string | null;
  /** vendor_memory_decisions.kategori — fatura kararında HESAP KODU. */
  kategori: string;
  /** oran rakamı ('20'), 'CARI' ya da null (genel). */
  altKategori: string | null;
  icerikImza: string | null;
  onayAdedi: number;
  /** Kararın verildiği mükellefin planındaki hesap ADI (çağıran çözer). Boşsa ad kuralları (b/c) çalışmaz. */
  hesapAdi?: string | null;
  /** Kararın mükellefinin defter türü (çağıran çözer). 'isletme' ise çapraz kuraldan dışlanır. */
  defterTuru?: 'bilanco' | 'isletme' | null;
};

export type HizliYolGirdi = {
  kararlar: HizliYolKarar[];
  taxpayerId: string;
  vkn: string;
  icerikImza: string | null;
  defterTuru: 'bilanco' | 'isletme';
  yon: 'ALIS' | 'SATIS';
  /** Satırın KDV oranı (rakam, '20'); boş = orana bakma. */
  oran?: string | null;
  /** Mükellefin GÜNCEL planı (tüm satırlar; yaprak/grup burada ayrıştırılır). */
  plan: Array<{ code: string; name: string }>;
  /** true (varsayılan): yalnız imza eşleşmesi kabul (AI atlama). false: oran/genel yedekler de (rematch). */
  imzaZorunlu?: boolean;
  /** Had-üstü demirbaş tespiti: yalnız 25x kabul. */
  demirbas?: boolean;
  /** Aynı mükellef onay eşiği (varsayılan 2 — pickVendorMemoryAccount R2 ile aynı). */
  esik?: number;
  /** Mükellefler arası toplam onay eşiği (varsayılan 2). */
  caprazEsik?: number;
};

export type HizliYolSecim = {
  kod: string;
  ad: string;
  kaynak: 'HAFIZA' | 'HAFIZA_AD';
  guven: 'yuksek' | 'orta';
  neden: string;
  /** Kararın geldiği mükellef (çapraz kuralda başka mükellef). */
  kararTaxpayerId: string | null;
  /** Hangi kural seçti: a | b | c */
  kural: 'a' | 'b' | 'c';
};

export const HIZLI_YOL_ESIK = 2;
export const HIZLI_YOL_CAPRAZ_ESIK = 2;

/** Hesap adı normalize: Türkçe küçük harf, boşluk/noktalama tek boşluk; oran etiketi (%20) KORUNUR. */
export function hesapAdiNormalize(ad: string | null | undefined): string {
  return String(ad || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/%\s+(\d)/g, '%$1')          // "% 20" → "%20"
    .replace(/[^0-9a-zçğıöşüâîû%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** (d) Mevzuat ağı — learnedMatrahCompatibleWithContent ile aynı: alışta 6xx yok; satışta 7xx/15x/25x yok; demirbaşta yalnız 25x. */
export function mevzuatUygunMu(kod: string, yon: 'ALIS' | 'SATIS', demirbas?: boolean): boolean {
  const c = String(kod || '').trim();
  if (!c) return false;
  if (demirbas) return /^25/.test(c);
  if (yon === 'SATIS') return !/^(7|15|25)/.test(c);
  return !/^6/.test(c);
}

/** Plandan KAYDEDİLEBİLİR yapraklar (noktalı, ana segment ≥3 hane, altında başka kod yok) → kod→ad. plan-adaylari ile aynı kural. */
export function planYaprakHaritasi(plan: Array<{ code: string; name: string }>): Map<string, string> {
  const adMap = new Map<string, string>();
  for (const h of Array.isArray(plan) ? plan : []) {
    const kod = String((h && h.code) || '').trim();
    if (!kod || adMap.has(kod)) continue;
    adMap.set(kod, String((h && h.name) || '').replace(/\s+/g, ' ').trim());
  }
  const grup = new Set<string>();
  for (const kod of adMap.keys()) {
    let ix = kod.indexOf('.');
    while (ix !== -1) { grup.add(kod.slice(0, ix)); ix = kod.indexOf('.', ix + 1); }
  }
  const out = new Map<string, string>();
  for (const [kod, ad] of adMap) {
    if (kod.includes('.') && !grup.has(kod) && kod.split('.')[0].replace(/\D/g, '').length >= 3) out.set(kod, ad);
  }
  return out;
}

/** Normalize ada göre plandaki TEK yaprağı bul; aynı adda birden çok yaprak varsa (belirsiz) null. */
export function adlaYaprakBul(yapraklar: Map<string, string>, ad: string | null | undefined): { kod: string; ad: string } | null {
  const hedef = hesapAdiNormalize(ad);
  if (!hedef) return null;
  let bulunan: { kod: string; ad: string } | null = null;
  for (const [kod, yAd] of yapraklar) {
    if (hesapAdiNormalize(yAd) !== hedef) continue;
    if (bulunan) return null; // belirsiz
    bulunan = { kod, ad: yAd };
  }
  return bulunan;
}

const oranRakam = (v: string | null | undefined) => String(v || '').replace(/[^0-9]/g, '');
const kodMu = (v: string | null | undefined) => /^\d/.test(String(v || '').trim());
const cariMi = (k: HizliYolKarar) => String(k.altKategori || '').trim().toUpperCase() === 'CARI';
const imzaEsit = (k: HizliYolKarar, imza: string) => !!imza && String(k.icerikImza || '').trim() === imza;

/** Karar dizisinden temel süzgeç: fatura kararı, kod numerik, CARI değil, eşik üstü. Sıra korunur (çağıran onay/sonKullanim sıralı verir). */
function gecerliKararlar(kararlar: HizliYolKarar[], esik: number): HizliYolKarar[] {
  return (Array.isArray(kararlar) ? kararlar : []).filter((k) => k && kodMu(k.kategori) && !cariMi(k) && (Number(k.onayAdedi) || 0) >= esik);
}

/**
 * Ad çözümü GEREKEN kararlar (çağıran plan snapshot'larından hesapAdi doldurur, sonra ogrenilmisKararSec'i yeniden çağırır).
 *  - aynı mükellef, imza eşleşen, kodu güncel planda yaprak OLMAYAN kararlar (kural b),
 *  - başka mükellef, imza eşleşen kararlar (kural c; yalnız bilanço mükellefinde).
 * İmza yoksa boş (ad kuralları imzasız çalışmaz).
 */
export function adCozumAdaylari(g: Pick<HizliYolGirdi, 'kararlar' | 'taxpayerId' | 'icerikImza' | 'plan' | 'defterTuru' | 'esik'>): Array<{ taxpayerId: string; kod: string }> {
  const imza = String(g.icerikImza || '').trim();
  if (!imza || g.defterTuru !== 'bilanco') return [];
  const esik = Number(g.esik) > 0 ? Number(g.esik) : HIZLI_YOL_ESIK;
  const yaprak = planYaprakHaritasi(g.plan);
  const out: Array<{ taxpayerId: string; kod: string }> = [];
  const seen = new Set<string>();
  for (const k of gecerliKararlar(g.kararlar, 1)) {
    if (!imzaEsit(k, imza) || !k.taxpayerId || k.hesapAdi) continue;
    const kod = String(k.kategori).trim();
    const ayni = k.taxpayerId === g.taxpayerId;
    if (ayni && ((Number(k.onayAdedi) || 0) < esik || yaprak.has(kod))) continue; // (a) zaten çözer / eşik altı
    if (!ayni && k.defterTuru === 'isletme') continue;
    const key = `${k.taxpayerId}|${kod}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ taxpayerId: k.taxpayerId, kod });
    if (out.length >= 30) break;
  }
  return out;
}

/** Ana seçim. null = öğrenilmiş güvenli karar yok → normal AI yolu. */
export function ogrenilmisKararSec(g: HizliYolGirdi): HizliYolSecim | null {
  if (!g || !g.taxpayerId) return null;
  const vkn = String(g.vkn || '').replace(/\D/g, '');
  if (vkn.length !== 10 && vkn.length !== 11) return null;
  if (g.defterTuru !== 'bilanco') return null; // işletme dışarıda
  const yon: 'ALIS' | 'SATIS' = g.yon === 'SATIS' ? 'SATIS' : 'ALIS';
  const imzaZorunlu = g.imzaZorunlu !== false;
  const esik = Number(g.esik) > 0 ? Number(g.esik) : HIZLI_YOL_ESIK;
  const caprazEsik = Number(g.caprazEsik) > 0 ? Number(g.caprazEsik) : HIZLI_YOL_CAPRAZ_ESIK;
  const imza = String(g.icerikImza || '').trim();
  if (imzaZorunlu && !imza) return null;
  const oran = oranRakam(g.oran);
  const yaprak = planYaprakHaritasi(g.plan);
  if (!yaprak.size) return null;
  const kararlar = gecerliKararlar(g.kararlar, esik);

  // ── (a) aynı mükellef, kod planda yaprak ──
  const kendi = kararlar.filter((k) => k.taxpayerId === g.taxpayerId && yaprak.has(String(k.kategori).trim()));
  const imzasiz = (k: HizliYolKarar) => !String(k.icerikImza || '').trim();
  const byImzaOran = imza && oran ? kendi.find((k) => imzaEsit(k, imza) && oranRakam(k.altKategori) === oran) : undefined;
  const byImza = imza ? kendi.find((k) => imzaEsit(k, imza)) : undefined;
  const byOran = !imzaZorunlu && oran ? kendi.find((k) => imzasiz(k) && oranRakam(k.altKategori) === oran) : undefined;
  const genel = !imzaZorunlu ? kendi.find((k) => imzasiz(k) && !String(k.altKategori || '').trim()) : undefined;
  const pickA = byImzaOran || byImza || byOran || genel;
  if (pickA) {
    const kod = String(pickA.kategori).trim();
    if (!mevzuatUygunMu(kod, yon, g.demirbas)) return null; // (d) — ağdan geçmeyen öğrenme UYGULANMAZ, AI'a düşer
    const imzali = imzaEsit(pickA, imza);
    return {
      kod, ad: yaprak.get(kod) || '', kaynak: 'HAFIZA', guven: 'yuksek', kural: 'a', kararTaxpayerId: pickA.taxpayerId,
      neden: imzali
        ? `Bu satıcı (${vkn}) + aynı içerik daha önce ${pickA.onayAdedi} kez onaylandı → ${kod}`
        : `Bu satıcı (${vkn}) için ${oranRakam(pickA.altKategori) ? '%' + oranRakam(pickA.altKategori) + ' oranında ' : ''}öğrenilmiş hesap (${pickA.onayAdedi} onay) → ${kod}`,
    };
  }

  // Ad kuralları imza şart (içerik-körü ad çözümü yok).
  if (!imza) return null;

  // ── (b) aynı mükellef, kod planda yok ama ad var → aynı adlı TEK yaprak ──
  {
    let adaylar = kararlar.filter((k) => k.taxpayerId === g.taxpayerId && imzaEsit(k, imza) && !yaprak.has(String(k.kategori).trim()) && String(k.hesapAdi || '').trim());
    if (oran && adaylar.some((k) => oranRakam(k.altKategori) === oran)) adaylar = adaylar.filter((k) => oranRakam(k.altKategori) === oran);
    for (const k of adaylar) {
      const y = adlaYaprakBul(yaprak, k.hesapAdi);
      if (!y) continue;
      if (!mevzuatUygunMu(y.kod, yon, g.demirbas)) return null;
      return {
        kod: y.kod, ad: y.ad, kaynak: 'HAFIZA_AD', guven: 'yuksek', kural: 'b', kararTaxpayerId: k.taxpayerId,
        neden: `Öğrenilmiş kod ${String(k.kategori).trim()} güncel planda yok; aynı adlı yaprak "${y.ad}" → ${y.kod} (${k.onayAdedi} onay)`,
      };
    }
  }

  // ── (c) mükellefler arası: başka mükellef(ler)de aynı VKN + imza → baskın hesap adı ──
  {
    let digerler = gecerliKararlar(g.kararlar, 1).filter((k) => k.taxpayerId && k.taxpayerId !== g.taxpayerId && imzaEsit(k, imza) && k.defterTuru !== 'isletme' && String(k.hesapAdi || '').trim());
    if (oran && digerler.some((k) => oranRakam(k.altKategori) === oran)) digerler = digerler.filter((k) => oranRakam(k.altKategori) === oran);
    if (digerler.length) {
      const toplam = new Map<string, { onay: number; ad: string; mukellefler: Set<string> }>();
      for (const k of digerler) {
        const n = hesapAdiNormalize(k.hesapAdi);
        if (!n) continue;
        const t = toplam.get(n) || { onay: 0, ad: String(k.hesapAdi).trim(), mukellefler: new Set<string>() };
        t.onay += Number(k.onayAdedi) || 0;
        t.mukellefler.add(String(k.taxpayerId));
        toplam.set(n, t);
      }
      const sirali = [...toplam.values()].sort((x, y) => y.onay - x.onay);
      const en = sirali[0];
      const ikinci = sirali[1];
      // Baskınlık: eşik üstü VE rakip ad YOK (rakip varsa yayılma riski — sahip karar versin; AI yoluna düş).
      if (en && en.onay >= caprazEsik && !ikinci) {
        const y = adlaYaprakBul(yaprak, en.ad);
        if (y && mevzuatUygunMu(y.kod, yon, g.demirbas)) {
          return {
            kod: y.kod, ad: y.ad, kaynak: 'HAFIZA_AD', guven: 'orta', kural: 'c', kararTaxpayerId: null,
            neden: `Aynı satıcı (${vkn}) + aynı içerik ${en.mukellefler.size} başka mükellefte ${en.onay} onayla "${en.ad}" hesabına gitti; bu planda aynı adlı yaprak → ${y.kod}`,
          };
        }
      }
    }
  }
  return null;
}

/** Hesap kodundan kaba kategori (ocrData.matrahKategori) — yalnız ALIŞ; satışta boş. */
export function kodKategori(kod: string, yon: 'ALIS' | 'SATIS'): string {
  const c = String(kod || '').trim();
  if (yon === 'SATIS' || !c) return '';
  if (/^15[012]/.test(c)) return 'hammadde';
  if (/^15/.test(c)) return 'ticari_mal';
  if (/^25/.test(c)) return 'demirbas';
  if (/^76/.test(c)) return 'pazarlama';
  if (/^7/.test(c)) return 'genel_gider';
  return '';
}
