/**
 * SATICI HAFIZASI — aynı satıcının önceki faturalarından AI'ya SORMADAN sınıflandırma (2026-09-15).
 * SAF modül: DB / Nest bağımlılığı YOK (birim testli: satici-hafizasi.spec.ts). Servis örnekleri çeker, kararı uygular.
 *
 * Muzaffer Bey'in kuralı (aynen): "aynı VKN → aynı hesap diye körü körüne kopyalama; üç şart birden:
 *   (1) aynı satıcı VKN ve o satıcı için daha önce en az 2 kez AYNI sınıflandırma (Muzaffer Bey düzeltmemiş/onaylamış
 *       ya da AI'nın verip itiraz edilmemiş),
 *   (2) kalem/içerik benzer (yeni faturanın kalem adları/açıklaması, satıcının önceki faturalarındaki kalemlerle örtüşüyor),
 *   (3) tutar olağan aralıkta (önceki tutar aralığının çok dışında değil).
 *   Örnek: hep mal alınan cariden bu kez taşıt gelirse kalem adı ('araç, plaka, şasi') ve tutar kalıba uymaz → hafıza
 *   devre dışı, AI sınıflandırmasına gider; bugünkü demirbaş tanıma kuralı üstte aynen çalışır."
 *
 * KARAR KURALI (saticiHafizasiKarari):
 *   - Normalize: Türkçe küçük harf + aksan katlama (ç→c, ş→s, ı→i…), noktalama/rakam temizliği, 3+ harfli kelimeler,
 *     genel dolgu kelimeleri (adet, hizmet, bedeli, fatura, kdv…) atılır.
 *   - Benzerlik: Jaccard(yeni kalem kelimeleri, örneklerin kalem kelimeleri BİRLEŞİMİ); ayrıca en yakın tek örnekle
 *     Jaccard — ikisinin BÜYÜĞÜ alınır (birebir tekrar eden fatura, uzun geçmişte birleşim büyüdü diye kaybolmasın).
 *     Eşik: benzerlikEsigi (varsayılan 0.5).
 *   - Kalem YOKSA iki tarafta da (GİB e-Arşiv içeriksiz alış gibi): içerik şartı yerine EN AZ 3 örnek (kalemsizEnAzOrnek)
 *     + tutar şartı. Tek tarafta kalem varsa karşılaştırılamaz → uygulanmaz.
 *   - En sık sınıflandırma: hesap kodu varsa hesap koduna göre (gider türü metni AI'dan AI'ya değişebilir: "telefon" /
 *     "haberleşme" — aynı hesap aynı sınıftır); hesap kodu yoksa gider türü + kategori çiftine göre. En sık grup
 *     ≥ enAzOrnek (varsayılan 2) VE örneklerin ≥ %70'i (cogunlukOrani) o grupta olmalı.
 *   - Tutar: [min/2.5, max×2.5] (tutarKatsayisi) aralığında; tek örnekte de aynı katsayı (±%150). Yeni belgenin tutarı
 *     bilinmiyorsa uygulanmaz.
 *   - Demirbaş/taşıt şüphesi: yeni kalemlerde taşıt/araç/otomobil/şasi/plaka/demirbaş/makine/bilgisayar/laptop/klima/
 *     mobilya/gayrimenkul/arsa/bina… kelimesi geçiyor ve örneklerin kalemlerinde geçmiyorsa → uygulanmaz.
 *   - Kendi kendini besleme YOK (servis tarafı): sinifKaynak='satici-hafizasi' ile sınıflanmış belge, sahip onaylamadı/
 *     düzeltmediyse örnek sayılmaz.
 *   uygula:false dönüşünde de en sık sınıf özeti (`ipucu`) döner → AI prompt'una tek satır İPUCU olarak eklenir.
 *
 * KAPATMA (deploy gerektirmez): FM_SATICI_HAFIZASI=off → hiç bakılmaz; =ipucu → karar üretilir, uygulanmaz, yalnız
 *   log + AI ipucu (gölge/kuru mod). Boş/on → uygulanır.
 */

export interface HafizaOrnegi {
  hesapKodu: string | null;
  matrahKategori: string | null;
  giderTuru: string | null;
  kalemAdlari: string[];
  /** KDV hariç matrah (yoksa belge toplamı). */
  tutar: number;
  /** ISO tarih (fatura tarihi; yoksa kayıt tarihi) — yalnız iz/özet için. */
  tarih: string;
  /** Sahip onayladı (APPROVED) ya da elle düzeltti (matrah satırı kaynak=KULLANICI). */
  onayli: boolean;
}

export interface SaticiHafizasiAyar {
  /** En sık sınıfın en az örnek sayısı (varsayılan 2). */
  enAzOrnek?: number;
  /** Kalem benzerliği eşiği 0..1 (varsayılan 0.5). */
  benzerlikEsigi?: number;
  /** En sık sınıfın örnekler içindeki payı (varsayılan 0.7). */
  cogunlukOrani?: number;
  /** Tutar aralığı katsayısı: [min/k, max×k] (varsayılan 2.5). */
  tutarKatsayisi?: number;
  /** İki tarafta da kalem yoksa gereken en az örnek (varsayılan 3). */
  kalemsizEnAzOrnek?: number;
  /** En sık grupta gereken en az ONAYLI örnek (varsayılan 0 — "AI verdi, itiraz edilmedi" de sayılır). */
  enAzOnayli?: number;
}

export interface SaticiHafizasiKarari {
  uygula: boolean;
  hesapKodu?: string | null;
  matrahKategori?: string | null;
  giderTuru?: string | null;
  neden: string;
  ornekSayisi: number;
  /** 0..1 — kalem benzerliği (kalemsiz kuralda 1). */
  benzerlik: number;
  /** Uygulanırken güven: tüm örnekler aynı sınıf + benzerlik ≥ 0.75 → yuksek; değilse orta. */
  guven?: 'yuksek' | 'orta';
  /** En sık sınıf özeti (uygula:false iken AI ipucu için de dolar). */
  enSik?: { hesapKodu: string | null; matrahKategori: string | null; giderTuru: string | null; sayi: number; onayliSayi: number };
  /** AI prompt'una eklenecek tek satır ipucu (örnek varsa). */
  ipucu?: string;
}

export const SATICI_HAFIZASI_VARSAYILAN: Required<SaticiHafizasiAyar> = {
  enAzOrnek: 2,
  benzerlikEsigi: 0.5,
  cogunlukOrani: 0.7,
  tutarKatsayisi: 2.5,
  kalemsizEnAzOrnek: 3,
  enAzOnayli: 0,
};

/** Genel dolgu kelimeleri — benzerliği şişirmesin (buildIcerikImza STOP listesiyle uyumlu, biraz geniş). */
const DOLGU = new Set([
  'adet', 'kutu', 'paket', 'urun', 'urunler', 'mamul', 'fiyat', 'tutar', 'birim', 'siyah', 'beyaz', 'renk', 'model', 'seti',
  'takim', 'parca', 'kalem', 'malzeme', 'hizmet', 'hizmeti', 'genel', 'toplam', 'iskonto', 'bedeli', 'bedel', 'fatura',
  'kdv', 'dahil', 'haric', 'aylik', 'donem', 'donemi', 'tarih', 'tarihli', 'sayi', 'sayili', 'icin', 'ile', 'veya',
  'olarak', 'ucreti', 'ucret', 'gideri', 'gider',
]);

/** Demirbaş/taşıt anahtar kelimeleri (katlanmış biçim). ≥5 harfliler önek eşleşir (plaka→plakali), kısalar birebir. */
const DEMIRBAS_ANAHTAR = [
  'tasit', 'arac', 'otomobil', 'kamyon', 'kamyonet', 'minibus', 'otobus', 'motosiklet', 'traktor', 'forklift', 'romork',
  'sasi', 'plaka', 'demirbas', 'makine', 'makina', 'bilgisayar', 'laptop', 'notebook', 'tablet', 'klima', 'mobilya',
  'gayrimenkul', 'tasinmaz', 'arsa', 'bina', 'jenerator',
];

/** Türkçe küçük harf + aksan katlama (İ/I/ı doğru; ç→c, ğ→g, ö→o, ş→s, ü→u). */
export function hafizaKatla(s: string): string {
  return String(s || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/** Metin(ler)den anlamlı kelime kümesi: katla → noktalama/rakam → boşluk → 3+ harf, dolgu dışı. */
export function hafizaKelimeleri(metin: string | string[] | null | undefined): Set<string> {
  const out = new Set<string>();
  const parcalar = Array.isArray(metin) ? metin : [metin];
  for (const p of parcalar) {
    for (const t of hafizaKatla(String(p || '')).split(/[^a-z]+/)) {
      if (t.length >= 3 && !DOLGU.has(t)) out.add(t);
    }
  }
  return out;
}

/** Jaccard benzerliği (0..1); iki küme de boşsa 0. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let kesisim = 0;
  for (const x of a) if (b.has(x)) kesisim++;
  const birlesim = a.size + b.size - kesisim;
  return birlesim ? kesisim / birlesim : 0;
}

/** Yeni kalemlerde demirbaş/taşıt kelimesi var mı ve örneklerde YOK mu? */
export function demirbasSuphesi(yeniKelimeler: Set<string>, ornekKelimeleri: Set<string>): string | null {
  const bul = (kume: Set<string>): string | null => {
    for (const k of DEMIRBAS_ANAHTAR) {
      for (const t of kume) {
        if (t === k || (k.length >= 5 && t.startsWith(k))) return k;
      }
    }
    return null;
  };
  const yeniHit = bul(yeniKelimeler);
  if (!yeniHit) return null;
  // Örneklerde de aynı aile geçiyorsa (satıcı zaten araç/makine satıyor, geçmişte onaylandı) şüphe yok.
  const ornekHit = (() => {
    for (const t of ornekKelimeleri) if (t === yeniHit || (yeniHit.length >= 5 && t.startsWith(yeniHit))) return true;
    return false;
  })();
  return ornekHit ? null : yeniHit;
}

/** FM_SATICI_HAFIZASI: off → 'kapali'; ipucu → 'ipucu' (gölge); aksi → 'acik'. */
export function saticiHafizasiModu(env: NodeJS.ProcessEnv = process.env): 'kapali' | 'ipucu' | 'acik' {
  const v = String(env?.FM_SATICI_HAFIZASI || '').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'kapali') return 'kapali';
  if (v === 'ipucu' || v === 'golge' || v === 'shadow' || v === 'dry') return 'ipucu';
  return 'acik';
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function sinifAnahtari(o: HafizaOrnegi): string {
  const kod = String(o.hesapKodu || '').trim();
  if (kod) return `kod:${kod}`;
  const gt = hafizaKatla(String(o.giderTuru || '')).replace(/\s+/g, ' ').trim();
  const kat = hafizaKatla(String(o.matrahKategori || '')).trim();
  return `gt:${gt}|kat:${kat}`;
}

/** Bir grupta en sık görülen (boş olmayan) metin değeri. */
function enSikDeger(degerler: Array<string | null | undefined>): string | null {
  const sayac = new Map<string, { asil: string; n: number }>();
  for (const d of degerler) {
    const s = String(d || '').trim();
    if (!s) continue;
    const key = hafizaKatla(s);
    const cur = sayac.get(key);
    if (cur) cur.n++; else sayac.set(key, { asil: s, n: 1 });
  }
  let best: { asil: string; n: number } | null = null;
  for (const v of sayac.values()) if (!best || v.n > best.n) best = v;
  return best ? best.asil : null;
}

function ipucuMetni(enSik: NonNullable<SaticiHafizasiKarari['enSik']>, toplam: number): string {
  const hesap = enSik.hesapKodu ? `${enSik.hesapKodu} hesabı` : (enSik.giderTuru ? `"${enSik.giderTuru}" gider türü` : (enSik.matrahKategori ? `"${enSik.matrahKategori}" kategorisi` : ''));
  if (!hesap) return '';
  const gt = enSik.hesapKodu && enSik.giderTuru ? ` (gider türü "${enSik.giderTuru}")` : '';
  return `SATICI HAFIZASI İPUCU: Bu satıcıdan önceki ${toplam} faturanın ${enSik.sayi}'inde genelde ${hesap}${gt} kullanıldı; yeni belge içerik/tutar olarak farklıysa içeriğe göre kendi kararını ver, körü körüne kopyalama.`;
}

/**
 * KARAR — üç şart birden: (1) en az N aynı sınıf, (2) kalem/içerik benzer, (3) tutar olağan aralıkta.
 * Demirbaş/taşıt şüphesi her hâlükârda engeller. uygula:false iken de `enSik` + `ipucu` döner (AI'ya ipucu).
 */
export function saticiHafizasiKarari(
  yeni: { kalemAdlari: string[]; tutar: number; aciklama?: string },
  ornekler: HafizaOrnegi[],
  ayar?: SaticiHafizasiAyar,
): SaticiHafizasiKarari {
  // Yalnız TANIMLI (sayısal) ayarlar varsayılanı ezer — env'den gelen undefined/NaN varsayılanı bozmasın.
  const a: Required<SaticiHafizasiAyar> = { ...SATICI_HAFIZASI_VARSAYILAN };
  for (const k of Object.keys(SATICI_HAFIZASI_VARSAYILAN) as Array<keyof SaticiHafizasiAyar>) {
    const v = ayar?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) (a as any)[k] = v;
  }
  const liste = (Array.isArray(ornekler) ? ornekler : []).filter((o) => o && (String(o.hesapKodu || '').trim() || String(o.giderTuru || '').trim() || String(o.matrahKategori || '').trim()));
  const n = liste.length;
  if (!n) return { uygula: false, neden: 'bu satıcı için örnek yok', ornekSayisi: 0, benzerlik: 0 };

  // ── En sık sınıf
  const gruplar = new Map<string, HafizaOrnegi[]>();
  for (const o of liste) {
    const k = sinifAnahtari(o);
    const g = gruplar.get(k);
    if (g) g.push(o); else gruplar.set(k, [o]);
  }
  let enSikGrup: HafizaOrnegi[] = [];
  for (const g of gruplar.values()) {
    if (g.length > enSikGrup.length) enSikGrup = g;
    else if (g.length === enSikGrup.length && g.length) {
      // Eşitlikte onaylı örneği çok olan grup.
      const onA = g.filter((x) => x.onayli).length, onB = enSikGrup.filter((x) => x.onayli).length;
      if (onA > onB) enSikGrup = g;
    }
  }
  const enSik: NonNullable<SaticiHafizasiKarari['enSik']> = {
    hesapKodu: String(enSikGrup[0]?.hesapKodu || '').trim() || null,
    matrahKategori: enSikDeger(enSikGrup.map((x) => x.matrahKategori)),
    giderTuru: enSikDeger(enSikGrup.map((x) => x.giderTuru)),
    sayi: enSikGrup.length,
    onayliSayi: enSikGrup.filter((x) => x.onayli).length,
  };
  const ipucu = ipucuMetni(enSik, n) || undefined;
  const red = (neden: string, benzerlik = 0): SaticiHafizasiKarari => ({ uygula: false, neden, ornekSayisi: n, benzerlik: r2(benzerlik), enSik, ipucu });

  // ── Kalem / içerik benzerliği
  const yeniKalem = (Array.isArray(yeni?.kalemAdlari) ? yeni.kalemAdlari : []).map((x) => String(x || '').trim()).filter(Boolean);
  const yeniKelimeler = yeniKalem.length ? hafizaKelimeleri(yeniKalem) : hafizaKelimeleri(yeni?.aciklama || '');
  const ornekKumeleri = liste.map((o) => hafizaKelimeleri(Array.isArray(o.kalemAdlari) ? o.kalemAdlari : []));
  const birlesim = new Set<string>();
  for (const k of ornekKumeleri) for (const t of k) birlesim.add(t);
  const kalemsiz = !yeniKelimeler.size && !birlesim.size;
  let benzerlik = 0;
  if (!kalemsiz) {
    if (!yeniKelimeler.size) return red('yeni belgede kalem/içerik yok, önceki faturalarda var — karşılaştırılamadı');
    if (!birlesim.size) return red('önceki faturalarda kalem yok, yeni belgede var — karşılaştırılamadı');
    const dSuphe = demirbasSuphesi(yeniKelimeler, birlesim);
    if (dSuphe) return red(`demirbaş/taşıt şüphesi ("${dSuphe}" yeni kalemlerde var, önceki faturalarda yok)`);
    let enYakin = 0;
    for (const k of ornekKumeleri) { const j = jaccard(yeniKelimeler, k); if (j > enYakin) enYakin = j; }
    benzerlik = Math.max(jaccard(yeniKelimeler, birlesim), enYakin);
    if (benzerlik < a.benzerlikEsigi) return red(`kalem benzerliği düşük (%${Math.round(benzerlik * 100)} < %${Math.round(a.benzerlikEsigi * 100)})`, benzerlik);
  } else {
    benzerlik = 1; // iki tarafta da kalem yok → içerik şartı yerine daha çok örnek + tutar
  }

  // ── En az örnek + çoğunluk
  const gerekliOrnek = kalemsiz ? Math.max(a.enAzOrnek, a.kalemsizEnAzOrnek) : a.enAzOrnek;
  if (enSik.sayi < gerekliOrnek) return red(`aynı sınıflandırma ${enSik.sayi} kez (en az ${gerekliOrnek} gerekli${kalemsiz ? '; kalemsiz belge' : ''})`, benzerlik);
  const pay = enSik.sayi / n;
  if (pay < a.cogunlukOrani) return red(`en sık sınıf örneklerin %${Math.round(pay * 100)}'i (en az %${Math.round(a.cogunlukOrani * 100)} gerekli)`, benzerlik);
  if (a.enAzOnayli > 0 && enSik.onayliSayi < a.enAzOnayli) return red(`onaylı örnek ${enSik.onayliSayi} (en az ${a.enAzOnayli} gerekli)`, benzerlik);

  // ── Tutar aralığı (en sık grup üzerinden)
  const yeniTutar = Number(yeni?.tutar) || 0;
  if (yeniTutar <= 0) return red('yeni belgenin tutarı bilinmiyor', benzerlik);
  const tutarlar = enSikGrup.map((o) => Number(o.tutar) || 0).filter((t) => t > 0);
  if (!tutarlar.length) return red('önceki faturaların tutarı bilinmiyor', benzerlik);
  const k = a.tutarKatsayisi > 1 ? a.tutarKatsayisi : SATICI_HAFIZASI_VARSAYILAN.tutarKatsayisi;
  const alt = Math.min(...tutarlar) / k;
  const ust = Math.max(...tutarlar) * k;
  if (yeniTutar < alt || yeniTutar > ust) return red(`tutar olağan aralık dışında (${r2(yeniTutar)} ∉ [${r2(alt)}, ${r2(ust)}])`, benzerlik);

  const guven: 'yuksek' | 'orta' = pay === 1 && benzerlik >= 0.75 && !kalemsiz ? 'yuksek' : 'orta';
  const hesapMetni = enSik.hesapKodu ? `hesap ${enSik.hesapKodu}` : `gider türü "${enSik.giderTuru || enSik.matrahKategori || '-'}"`;
  return {
    uygula: true,
    hesapKodu: enSik.hesapKodu,
    matrahKategori: enSik.matrahKategori,
    giderTuru: enSik.giderTuru,
    neden: `${n} örneğin ${enSik.sayi}'i aynı (${hesapMetni}; ${enSik.onayliSayi} onaylı), ${kalemsiz ? 'iki tarafta da kalem yok' : `kalem benzerliği %${Math.round(benzerlik * 100)}`}, tutar aralıkta [${r2(alt)}, ${r2(ust)}]`,
    ornekSayisi: n,
    benzerlik: r2(benzerlik),
    guven,
    enSik,
    ipucu,
  };
}
