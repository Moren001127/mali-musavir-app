/**
 * Faz 2 (PLAN/15 §C "Uyarı katmanı") — KDV kısmi tevkifat kural tablosu + yıllık hadler.
 *
 * SAF MODÜL: Prisma/Nest yok; hem servis hem regresyon betiği (scripts/uyari-katmani-regression.cjs) kullanır.
 *
 * Kaynak: KDV Genel Uygulama Tebliği (KDVGUT) I/C-2.1.3 (kısmi tevkifat) + beyanname işlem türü kodları.
 * KOD DİLİ (mesleki denetim B.10):
 *   • 2xx → ALICI tarafı, KDV2 beyannamesi "kısmi tevkifat" işlem türü (201-227). Tablo anahtarı budur.
 *   • 6xx → SATICI tarafı, KDV1 beyannamesi "kısmi tevkifat uygulanan işlemler" (601-627) ve UBL-TR
 *           WithholdingTaxTotal kodu (2xx + 400: 224 ↔ 624).
 *   • 8xx → isteğe bağlı TAM tevkifat (KDVGUT I/C-2.1.2.5; 10/10) — UBL kodu 801-827 (2xx + 600).
 *   ("3xx satış bildirim kodu" diye bir kod AİLESİ YOKTUR — eski not yanlıştı, kaldırıldı.)
 * Oran ve kapsam alanlarında EMİN OLUNMAYAN satırlar `teyit_gerekli: true` ile işaretlidir — mevzuat
 * teyidi sahibin/müşavirin onayıyla kapatılır; kural o zamana kadar da çalışır ama uyarı metninde
 * "teyit gerekli" notu düşer.
 *
 * KAPSAM:
 *   • tum_kdv_mukellefleri  → alıcı KDV mükellefi olan herkes tevkifat yapar (alıcı tipi GEREKMEZ).
 *   • belirlenmis_alicilar  → yalnız KDVGUT I/C-2.1.3.1/b "belirlenmiş alıcılar" (5018 cetvel idareleri,
 *                             belediyeler, üniversiteler, KİT'ler, bankalar, sigorta şirketleri, borsaya
 *                             kayıtlı şirketler, OSB'ler, yarıdan fazlası kamuya ait kuruluşlar…).
 *   • kamu_5018             → yalnız 5018 sayılı Kanuna ekli cetvellerdeki idare/kurum/kuruluşlar.
 *
 * KURUM TÜRÜ (alıcı): kamu | banka | belediye | universite | kit | belirlenmis_diger | diger | kdv_mukellefi_degil
 *   • belirlenmis_diger   → BİST şirketi, OSB, kamu kurumu niteliğindeki meslek kuruluşu, döner sermaye,
 *                           emekli/yardım sandığı, kalkınma ajansı ve bunların %50+ iştirakleri (belirlenmiş alıcı).
 *   • diger               → normal KDV mükellefi (belirlenmiş alıcı değil).
 *   • kdv_mukellefi_degil → nihai tüketici / şahıs; tevkifat yapamaz (satışta TCKN'li alıcı sorusunun cevabı).
 *
 * EŞİK: KDV DAHİL işlem bedeli, VUK 232 fatura düzenleme sınırını (yıllık) AŞIYORSA tevkifat uygulanır
 *   (KDVGUT I/C-2.1.3.4.1; tam sınır muaf). Env TEVKIFAT_ESIK_TL ile (2026 ve sonrası) ezilebilir.
 * TEVKİFAT UYGULANMAYAN HALLER (B.2): hesaplanan KDV yoksa (istisna/KDV'siz belge), iade belgesi,
 *   satıcı KDV mükellefi değilse (gider pusulası vb.) ve sabit kıymet alımı — kural hiç çalışmaz.
 */

export type TevkifatKapsam = 'tum_kdv_mukellefleri' | 'belirlenmis_alicilar' | 'kamu_5018';
export type KurumTuru = 'kamu' | 'banka' | 'belediye' | 'universite' | 'kit' | 'belirlenmis_diger' | 'diger' | 'kdv_mukellefi_degil';

/** Geçerli kurum türü değerleri (servis doğrulaması + UI seçenekleri buradan beslenir). */
export const KURUM_TURLERI: KurumTuru[] = ['kamu', 'banka', 'belediye', 'universite', 'kit', 'belirlenmis_diger', 'diger', 'kdv_mukellefi_degil'];

/** Belirlenmiş alıcı sayılan kurum türleri (KDVGUT I/C-2.1.3.1/b). */
export const BELIRLENMIS_ALICI_TURLERI: KurumTuru[] = ['kamu', 'banka', 'belediye', 'universite', 'kit', 'belirlenmis_diger'];

/** 216 "Diğer hizmetler" (5/10, I/C-2.1.3.2.13) alıcıları: 5018 cetvel idareleri, kanunla/CBK ile kurulan kamu
 *  kurumları (belediye, KİT), döner sermaye, kamu kurumu niteliğindeki meslek kuruluşları, banka/sigorta/
 *  reasürans/emeklilik şirketleri, emekli-yardım sandıkları, kalkınma ajansları. BİST şirketi ve OSB bu
 *  kapsamda DEĞİLDİR (belirlenmis_diger karışık olduğu için uyarı metninde not düşülür). */
export const DIGER_HIZMET_216_ALICILARI: KurumTuru[] = ['kamu', 'belediye', 'universite', 'kit', 'banka', 'belirlenmis_diger'];

export interface TevkifatKural {
  /** KDV2 beyannamesi işlem türü kodu (alıcı tarafı, 2xx). Satıcı KDV1/UBL kodu = kod + 400 (6xx); isteğe bağlı tam tevkifat = kod + 600 (8xx). */
  kod: string;
  ad: string;
  /** Görünen oran ("2/10"). */
  oran: string;
  /** Pay (2/10 → 2). */
  pay: number;
  tur: 'hizmet' | 'mal';
  kapsam: TevkifatKapsam;
  /** giderTuru / kalem adlarında aranan kelime ipuçları (Türkçe karakter duyarsız; kelime BAŞI sınırı aranır). */
  anahtar: string[];
  /** NEGATİF LİSTE (B.13): metinde bunlardan biri geçiyorsa bu kural ATLANIR (sonraki kurallar denenir). */
  haric?: string[];
  madde?: string;
  /** Oran/kapsam mevzuat teyidi bekliyor. */
  teyit_gerekli?: boolean;
  not?: string;
}

const K = (
  kod: string, ad: string, oran: string, tur: 'hizmet' | 'mal', kapsam: TevkifatKapsam, anahtar: string[],
  madde?: string, ekstra?: { teyit_gerekli?: boolean; not?: string; haric?: string[] },
): TevkifatKural => ({
  kod, ad, oran, pay: Number(oran.split('/')[0]) || 0, tur, kapsam, anahtar, madde, ...(ekstra || {}),
});

/** Sıra ÖNEMLİ: özel kurallar genel olanlardan ÖNCE (ilk eşleşen kural kullanılır). */
export const TEVKIFAT_KURALLARI: TevkifatKural[] = [
  // ── HİZMETLER ──
  K('208', 'Yapı denetim hizmetleri', '9/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['yapi denetim', 'bina denetim'], 'KDVGUT I/C-2.1.3.2.6'),
  K('201', 'Yapım işleri (+ birlikte ifa edilen mühendislik-mimarlık, etüt-proje)', '4/10', 'hizmet', 'belirlenmis_alicilar',
    ['insaat', 'yapim isi', 'taahhut', 'tadilat', 'dekorasyon', 'altyapi isi', 'cevre duzenleme', 'siva boya', 'boya badana', 'elektrik tesisat', 'su tesisat', 'cati isi', 'zemin doseme', 'hakedis', 'kaba insaat', 'ince insaat'],
    'KDVGUT I/C-2.1.3.2.1',
    { teyit_gerekli: true, not: 'KDV mükelleflerine ifa edilen yapım işlerinde bedel 5 milyon TL ve üzeriyse (2021 sonrası) kapsam tüm KDV mükellefleridir — bedel sınırı ve güncel oran teyit edilmeli.',
      // B.13: araç/kasa/damper/dorse "tadilatı" yapım işi DEĞİL, taşıt tadil-bakım-onarımıdır (203) → bu kural atlanır.
      haric: ['arac', 'tasit', 'kamyon', 'kamyonet', 'damper', 'dorse', 'romork', 'treyler', 'kasa tadil', 'makine tadil', 'techizat tadil', 'plaka'] }),
  K('202', 'Etüt, plan-proje, danışmanlık, denetim ve benzeri hizmetler', '9/10', 'hizmet', 'belirlenmis_alicilar',
    ['danismanlik', 'musavirlik hizmet', 'etut', 'plan proje', 'fizibilite', 'kontrolluk', 'proje yonetim', 'ekspertiz', 'denetim hizmet', 'muhendislik hizmet', 'mimarlik hizmet', 'teknik destek hizmet', 'yazilim danisman'],
    'KDVGUT I/C-2.1.3.2.2'),
  K('203', 'Makine, teçhizat, demirbaş ve taşıtlara ait tadil, bakım ve onarım hizmetleri', '7/10', 'hizmet', 'belirlenmis_alicilar',
    ['bakim onarim', 'bakim-onarim', 'makine bakim', 'techizat bakim', 'teknik servis hizmet', 'revizyon hizmet', 'periyodik bakim', 'klima bakim', 'asansor bakim', 'jenerator bakim', 'ekipman bakim', 'arac bakim', 'tadil', 'onarim hizmet', 'tamir hizmet'],
    'KDVGUT I/C-2.1.3.2.3'),
  K('204', 'Yemek servis hizmeti', '5/10', 'hizmet', 'belirlenmis_alicilar',
    ['yemek servis', 'yemek hizmet', 'catering', 'tabldot', 'toplu yemek', 'ikram hizmet'], 'KDVGUT I/C-2.1.3.2.4'),
  K('205', 'Organizasyon hizmeti', '5/10', 'hizmet', 'belirlenmis_alicilar',
    ['organizasyon hizmet', 'organizasyon', 'etkinlik hizmet', 'kongre organizasyon', 'fuar organizasyon'], 'KDVGUT I/C-2.1.3.2.4'),
  K('206', 'İşgücü temin hizmetleri', '9/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['isgucu temin', 'personel temin', 'isci temin', 'eleman temin', 'gecici personel', 'gecici isci', 'personel kiralama'], 'KDVGUT I/C-2.1.3.2.5'),
  K('207', 'Özel güvenlik hizmeti', '9/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['guvenlik hizmet', 'ozel guvenlik', 'guvenlik personel', 'koruma hizmet'], 'KDVGUT I/C-2.1.3.2.5'),
  K('209', 'Fason tekstil-konfeksiyon, çanta ve ayakkabı dikim işleri ve aracılık', '7/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['fason', 'dikim isi', 'fason konfeksiyon', 'fason tekstil', 'fason dikim'], 'KDVGUT I/C-2.1.3.2.7'),
  K('210', 'Turistik mağazalara verilen müşteri bulma/götürme hizmetleri', '9/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['musteri bulma', 'musteri goturme', 'turist getirme', 'tur komisyon'], 'KDVGUT I/C-2.1.3.2.8'),
  K('211', 'Spor kulüplerinin yayın, reklam ve isim hakkı gelirleri', '9/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['isim hakki', 'yayin hakki', 'spor kulub', 'forma reklam'], 'KDVGUT I/C-2.1.3.2.9'),
  K('212', 'Temizlik hizmeti', '9/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['temizlik hizmet', 'temizlik sirket', 'bina temizlik', 'ofis temizlik', 'dezenfeksiyon hizmet', 'hasere ilaclama', 'ilaclama hizmet'], 'KDVGUT I/C-2.1.3.2.10'),
  K('213', 'Çevre ve bahçe bakım hizmetleri', '9/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['bahce bakim', 'cevre bakim', 'peyzaj bakim', 'cim bicme', 'agac budama'], 'KDVGUT I/C-2.1.3.2.10'),
  K('214', 'Servis taşımacılığı hizmeti', '5/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['servis tasimacilik', 'personel servis', 'personel tasima', 'ogrenci servis', 'servis araci hizmet', 'servis tasima'], 'KDVGUT I/C-2.1.3.2.11'),
  K('215', 'Her türlü baskı ve basım hizmetleri', '7/10', 'hizmet', 'belirlenmis_alicilar',
    ['baski hizmet', 'basim hizmet', 'matbaa hizmet', 'ofset baski', 'dijital baski', 'kitap basim', 'brosur baski', 'katalog baski'], 'KDVGUT I/C-2.1.3.2.12'),
  K('224', 'Kara yolu yük taşımacılığı hizmeti', '2/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['nakliye', 'nakliyat', 'tasimacilik', 'kara tasima', 'yuk tasima', 'lojistik', 'sevkiyat', 'yuk nakli', 'tasima hizmet', 'navlun'],
    'KDVGUT I/C-2.1.3.2.11', { not: 'Yalnız kara yolu; deniz/hava/demiryolu yük taşıması ve kargo/kurye hizmeti kapsam dışıdır.' }),
  K('225', 'Ticari reklam hizmetleri', '3/10', 'hizmet', 'tum_kdv_mukellefleri',
    ['reklam hizmet', 'tanitim filmi', 'reklam ajans', 'dijital reklam', 'billboard', 'medya satin alma', 'reklam yayin', 'sosyal medya reklam', 'google reklam', 'reklam bedeli'],
    'KDVGUT I/C-2.1.3.2.15'),
  K('216', 'Diğer hizmetler (belirlenmiş alıcılara — 5018 idareleri, belediye, KİT, banka/sigorta, üniversite, döner sermaye, meslek kuruluşu)', '5/10', 'hizmet', 'belirlenmis_alicilar',
    [], 'KDVGUT I/C-2.1.3.2.13',
    { not: 'Anahtar kelimesi yok: başka bir kural eşleşmediyse, hizmet/genel gider kategorisinde ve alıcı 216 kapsamındaysa BİLGİ amaçlı gösterilir (BİST şirketi ve OSB bu kapsamda değildir).' }),
  // ── MAL TESLİMLERİ ──
  K('217', 'Hurda metalden elde edilen külçe teslimleri', '7/10', 'mal', 'tum_kdv_mukellefleri',
    ['hurda kulce', 'hurda metalden kulce', 'kulce teslim'], 'KDVGUT I/C-2.1.3.3.1',
    { haric: ['gumus', 'altin', 'gold', 'silver', 'platin'] }),
  K('218', 'Hurda metalden elde edilenler dışındaki bakır, çinko, alüminyum ve kurşun külçe teslimleri', '7/10', 'mal', 'tum_kdv_mukellefleri',
    ['bakir kulce', 'cinko kulce', 'aluminyum kulce', 'kursun kulce', 'kulce'], 'KDVGUT I/C-2.1.3.3.1',
    // B.13: külçe altın/gümüş (kıymetli maden) bu kapsamda değil.
    { haric: ['gumus', 'altin', 'gold', 'silver', 'platin'] }),
  K('219', 'Bakır, çinko, alüminyum ve kurşun ürünlerinin teslimi', '7/10', 'mal', 'tum_kdv_mukellefleri',
    ['bakir boru', 'bakir tel', 'bakir levha', 'cinko levha', 'aluminyum profil', 'aluminyum levha', 'aluminyum urun', 'kursun levha', 'bakir urun'],
    'KDVGUT I/C-2.1.3.3.2', { teyit_gerekli: true, not: 'Ürün grubu geniş (profil/levha/tel/boru); nihai ürün (kablo, klima vb.) kapsam dışı — kalem içeriği teyit edilmeli.' }),
  K('220', 'İstisnadan vazgeçenlerin hurda ve atık teslimi', '7/10', 'mal', 'tum_kdv_mukellefleri',
    ['hurda', 'atik teslim', 'hurda metal', 'hurda demir', 'hurda bakir'], 'KDVGUT I/C-2.1.3.3.3'),
  K('221', 'Metal, plastik, lastik, kauçuk, kâğıt ve cam hurda ve atıklarından elde edilen hammadde teslimi', '9/10', 'mal', 'tum_kdv_mukellefleri',
    // B.13: yalnız HURDA/ATIKTAN elde edilen hammadde (geri dönüşüm granülü); orijinal/ithal plastik hammadde kapsam dışı.
    ['geri donusum hammadde', 'geri donusum granul', 'hurda granul', 'atik granul', 'geri kazanim granul', 'geri donusum plastik', 'konfeksiyon kirpinti', 'kirpinti', 'cam kirigi'],
    'KDVGUT I/C-2.1.3.3.4', { haric: ['orijinal', 'orjinal', 'ithal', 'virgin'] }),
  K('222', 'Pamuk, tiftik, yün ve yapağı ile ham post ve deri teslimleri', '9/10', 'mal', 'tum_kdv_mukellefleri',
    // B.13: yalnız HAM pamuk (kütlü/çırçırlanmış/lif/balya); pamuk ipliği-kumaşı-hidrofil pamuk kapsam dışı.
    ['ham pamuk', 'kutlu pamuk', 'cirlanmis pamuk', 'lif pamuk', 'pamuk balya', 'pamuk teslim', 'tiftik', 'yun teslim', 'ham yun', 'yapagi', 'ham post', 'ham deri'],
    'KDVGUT I/C-2.1.3.3.5', { haric: ['pamuk iplig', 'pamuklu', 'pamuk kumas', 'hidrofil', 'pamuk sargi', 'kulak pamug'] }),
  K('223', 'Ağaç ve orman ürünleri teslimi', '5/10', 'mal', 'tum_kdv_mukellefleri',
    ['tomruk', 'kereste', 'orman urun', 'odun', 'yonga levha', 'kontrplak', 'agac urun'], 'KDVGUT I/C-2.1.3.3.6'),
  K('227', 'Demir-çelik ve alaşımlarından mamul ürünlerin teslimi', '5/10', 'mal', 'tum_kdv_mukellefleri',
    ['demir celik', 'insaat demiri', 'celik profil', 'celik levha', 'celik boru', 'nervurlu demir', 'sac levha', 'celik hasir'],
    'KDVGUT I/C-2.1.3.3.8', { teyit_gerekli: true, not: 'Oran 2022\'de 4/10, sonra 5/10 olarak değişti; ithalatçı/üretici ilk teslim istisnaları var — teyit gerekli.' }),
  K('226', 'Diğer teslimler (yalnız Devlet Malzeme Ofisi Genel Müdürlüğü\'ne)', '2/10', 'mal', 'kamu_5018',
    [], 'KDVGUT I/C-2.1.3.3.7',
    // B.12: kapsam yalnız DMO'ya yapılan, Tebliğde özel olarak belirlenmeyen teslimlerdir (su/elektrik/gaz/ısıtma-soğutma enerji hariç).
    { not: 'Anahtar kelimesi yok; yalnız alıcı Devlet Malzeme Ofisi ise geçerlidir (diğer kamu idarelerine mal teslimi bu kapsamda DEĞİLDİR). Otomatik uyarı üretmez.' }),
];

/** VUK 313 — doğrudan gider yazılabilecek demirbaş haddi (KDV hariç, iktisadi kıymet başına). Yıl → TL.
 *  2026 değeri KESİN (VUK 588 Sıra No.lu Genel Tebliği: 12.000 TL). */
export const DEMIRBAS_HADDI_TL: Record<number, number> = {
  2022: 2_000,
  2023: 4_400,
  2024: 6_900,
  2025: 9_900,
  2026: 12_000,
};

/** VUK 232 fatura düzenleme sınırı = kısmi tevkifat alt sınırı (KDV dahil). Yıl → TL.
 *  2026 değeri KESİN (VUK 588 GT: 12.000 TL). */
export const TEVKIFAT_ESIK_TL: Record<number, number> = {
  2022: 2_000,
  2023: 4_400,
  2024: 6_900,
  2025: 9_900,
  2026: 12_000,
};

/** Tablodaki değerlerin KESİN olduğu son yıl (B.16). Daha sonraki yıllar: env ya da son bilinen değer + teyit gerekli. */
const KESIN_SON_YIL = 2026;

export interface HadSonuc {
  yil: number;
  tutar: number;
  kaynak: 'env' | 'tablo' | 'son_bilinen';
  teyit_gerekli: boolean;
}

/** Türkçe/İngilizce biçimli tutarı sayıya çevirir (B.15): "12.400" → 12400, "12.400,50" → 12400.5,
 *  "12400.50" → 12400.5, "12400" → 12400, "12 400" → 12400. Geçersizse 0. */
export function tutarParse(v: any): number {
  let s = String(v ?? '').trim().replace(/[^\d.,]/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    // Türkçe: nokta binlik, virgül ondalık.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    const parts = s.split('.');
    const son = parts[parts.length - 1];
    // "12.400" / "1.250.000" → binlik ayracı (son grup tam 3 hane ve birden çok grup); "12400.50" → ondalık.
    if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3) && son.length === 3) s = parts.join('');
    else if (parts.length > 2) s = parts.slice(0, -1).join('') + '.' + son;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function hadCoz(tablo: Record<number, number>, envAd: string, yil?: number, env: Record<string, string | undefined> = process.env): HadSonuc {
  const y = Number(yil) || new Date().getFullYear();
  const envVal = tutarParse(env[envAd]);
  // Env yalnız kesin-son yıl ve sonrası için geçerli (geçmiş yılların tablo değeri ezilmez).
  if (y >= KESIN_SON_YIL && envVal > 0) return { yil: y, tutar: envVal, kaynak: 'env', teyit_gerekli: false };
  // Tablodaki yıl: kesin (teyit yalnız KESIN_SON_YIL'dan SONRAKİ yıllarda gerekir).
  if (tablo[y] != null) return { yil: y, tutar: tablo[y], kaynak: 'tablo', teyit_gerekli: y > KESIN_SON_YIL };
  // Tabloda olmayan yıl (gelecek): son bilinen değer; teyit gerekli.
  const bilinen = Object.keys(tablo).map(Number).sort((a, b) => b - a);
  const enSon = bilinen.find((k) => k <= y) ?? bilinen[bilinen.length - 1];
  return { yil: y, tutar: tablo[enSon], kaynak: 'son_bilinen', teyit_gerekli: true };
}

export function demirbasHaddiTL(yil?: number, env?: Record<string, string | undefined>): HadSonuc {
  return hadCoz(DEMIRBAS_HADDI_TL, 'DEMIRBAS_HADDI_TL', yil, env);
}
export function tevkifatEsikTL(yil?: number, env?: Record<string, string | undefined>): HadSonuc {
  return hadCoz(TEVKIFAT_ESIK_TL, 'TEVKIFAT_ESIK_TL', yil, env);
}

/** Belirlenmiş alıcı mı? null = bilinmiyor (kurum türü girilmemiş). 'diger' ve 'kdv_mukellefi_degil' → false. */
export function belirlenmisAliciMi(kurumTuru: KurumTuru | string | null | undefined): boolean | null {
  const k = String(kurumTuru || '').trim().toLowerCase();
  if (!k) return null;
  return (BELIRLENMIS_ALICI_TURLERI as string[]).includes(k);
}

export function trFold(s: any): string {
  return String(s || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/ı/g, 'i')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ünvandan kurum türü tahmini (T.C. / Belediye / Üniversite / Bankası / KİT). Kesin değil → sahip onayı. */
export function kurumTuruTahmin(unvan: string | null | undefined): KurumTuru | null {
  const u = trFold(unvan);
  if (!u) return null;
  if (/\bbelediye/.test(u)) return 'belediye';
  if (/\buniversite/.test(u)) return 'universite';
  if (/\bbankasi\b|\bbank\b|\bbanka\b|katilim bankasi/.test(u)) return 'banka';
  if (/^t\.\s?c\.?\s|\st\.\s?c\.?\s|\bbakanlig|\bil mudurlug|\bilce mudurlug|\bvaliligi|\bkaymakamlig|\bbaskanlig|\bgenel mudurlug|\bkomutanlig|\bsayistay|\btbmm|\bsgk\b|\bsosyal guvenlik kurumu|\bdevlet hastanesi|\bsehir hastanesi|\bmilli egitim/.test(u)) return 'kamu';
  if (/\bkit\b|\btcdd\b|\bptt\b|\btpao\b|\beti maden\b|\bboren\b|\bdhmi\b|\btei\b|\bthy\b|\bturkiye elektrik/.test(u)) return 'kit';
  return null;
}

export function tevkifatKuralBul(kod: string | null | undefined): TevkifatKural | null {
  const k = String(kod || '').trim();
  if (!k) return null;
  // Satıcı KDV1 / UBL-TR WithholdingTaxTotal kodu 6xx (601-627) ve isteğe bağlı TAM tevkifat kodu 8xx (801-827)
  //   → alıcı KDV2 2xx işlem türü karşılığı (624 ↔ 824 ↔ 224). 3xx: GİB'de böyle bir aile YOK; yalnız Muhasebeleştir
  //   editöründeki Mihsap kaynaklı "(Satış)" seçici kodları (301-327) için geriye dönük alias olarak 2xx'e çevrilir.
  const norm = /^[368]\d\d$/.test(k) ? `2${k.slice(1)}` : k;
  return TEVKIFAT_KURALLARI.find((r) => r.kod === norm) || null;
}

/** Kod isteğe bağlı TAM tevkifat (8xx) ailesinden mi? */
export function tamTevkifatKoduMu(kod: string | null | undefined): boolean {
  return /^8\d\d$/.test(String(kod || '').trim());
}

/** 0..1 oran ya da yüzde (20) → "2/10". Bilinmiyorsa ''. */
export function oranMetni(oran: number | null | undefined): string {
  let o = Number(oran) || 0;
  if (o <= 0) return '';
  if (o > 1) o = o / 100; // yüzde
  const pay = Math.round(o * 10);
  if (pay < 1 || pay > 10) return '';
  return `${pay}/10`;
}

/** Belgede TEVKİFAT VARKEN kodunu tahmin et (2026-09-15, Luca İşletme CSV "KOD" sütunu — NÜLÜFER BEYHAN satışları):
 *  kalem adı / gider türü / açıklama metninde kural anahtar kelimesi geçen İLK kural; belgedeki oran payı verilmişse
 *  kuralın payıyla TUTMALI (5/10 ≠ 7/10 ise kod uydurulmaz → null). Satıcı (KDV1/UBL) kodu = kod + 400 (614). */
export function tevkifatKuralTahmin(g: { giderTuru?: string | null; kalemler?: Array<string | null | undefined> | null; oranPay?: number | null }): TevkifatKural | null {
  const giderTuru = String(g.giderTuru || '').trim();
  const kalemMetni = (Array.isArray(g.kalemler) ? g.kalemler : []).filter(Boolean).map((x) => String(x)).join(' ');
  if (!giderTuru && !kalemMetni) return null;
  const pay = Number(g.oranPay) || 0;
  for (const kural of TEVKIFAT_KURALLARI) {
    if (!kural.anahtar.length) continue;
    if (kural.haric?.length && (iceriyor(giderTuru, kural.haric) || iceriyor(kalemMetni, kural.haric))) continue;
    const hit = (giderTuru && iceriyor(giderTuru, kural.anahtar)) || (kalemMetni && iceriyor(kalemMetni, kural.anahtar));
    if (!hit) continue;
    if (pay > 0 && kural.pay !== pay) continue; // oran tutmuyor → bu kural değil (sonrakine bak)
    return kural;
  }
  return null;
}

/** "2/10" / "%20" / 0.2 → pay (2). Bilinmiyorsa 0. */
export function oranPay(v: any): number {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,2})\s*\/\s*10$/);
  if (m) return Number(m[1]);
  const n = Number(s.replace('%', '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n > 1 ? n / 100 : n) * 10);
}

export interface TevkifatEksikGirdi {
  invoiceKind: 'ALIS' | 'SATIS' | string;
  /** AI'ın kısa hizmet/mal açıklaması (sınıflandırma çıktısı). */
  giderTuru?: string | null;
  /** AI matrah kategorisi (ticari_mal / hammadde / demirbas / genel_gider / pazarlama …). */
  matrahKategori?: string | null;
  kalemler?: string[] | null;
  /** KDV DAHİL işlem bedeli. */
  kdvDahilTutar: number;
  yil?: number;
  /** Belgede GERÇEK tevkifat verisi var mı (tutar/oran) — kelime ipucu DEĞİL. */
  tevkifatVar: boolean;
  isFixedAsset?: boolean;
  /** Alıcının kurum türü (alışta mükellefin kendisi, satışta müşteri cari). null = bilinmiyor. */
  aliciKurumTuru?: KurumTuru | string | null;
  aliciUnvan?: string | null;
  /** Alıcı kimlik no (VKN 10 / TCKN 11 hane) — B.4: satışta TCKN'li alıcı + kurum türü boş → 'bilgi' + "KDV mükellefi mi?" sorusu. */
  aliciKimlikNo?: string | null;
  /** Belgede hesaplanan KDV (B.2). 0 → istisna/KDV'siz belge → tevkifat uygulanmaz. null/undefined = bilinmiyor (kural çalışır). */
  kdvTutari?: number | null;
  /** İade belgesi (B.2) → tevkifat kuralı çalışmaz. */
  isReturn?: boolean;
  /** Satıcı KDV mükellefi mi (B.2)? false (gider pusulası, basit usul, muafiyet…) → tevkifat yok. null = bilinmiyor. */
  saticiKdvMukellefi?: boolean | null;
  env?: Record<string, string | undefined>;
}

export interface TevkifatEksikSonuc {
  tip: 'TEVKIFAT_EKSIK' | 'ALICI_TIPI_GEREKLI';
  seviye: 'bilgi' | 'uyari';
  kural: TevkifatKural;
  esik: HadSonuc;
  /** Eşleşme kaynağı: 'ai' = giderTuru (AI sınıflandırması), 'kalem' = kalem adı (AI okuması altında). */
  eslesme: 'ai' | 'kalem';
  eslesenKelime: string;
  /** ALICI_TIPI_GEREKLI için ünvan tahmini. */
  tahmin?: KurumTuru | null;
  /** B.4: satışta alıcı TCKN'li şahıs ve KDV mükellefi olup olmadığı bilinmiyor → 'bilgi' seviyesinde soru. */
  aliciKdvMukellefiSoru?: boolean;
  /** B.5: kural eşleşmedi ama alıcı 216 "Diğer hizmetler" kapsamında → 'bilgi'. */
  digerHizmet216?: boolean;
}

/** Anahtar kelime eşleşmesi: Türkçe-duyarsız, KELİME BAŞI sınırıyla ("nakliye" → " nakliyesi" eşleşir; "etut" → "ihtiyat" eşleşmez). */
function iceriyor(metin: string, anahtar: string[]): string {
  const m = ` ${trFold(metin)} `;
  for (const a of anahtar) {
    const k = trFold(a);
    if (!k) continue;
    const i = m.indexOf(k);
    if (i < 0) continue;
    // kelime başı: önceki karakter harf/rakam olmasın (tüm geçişler denenir)
    let j = i;
    while (j >= 0) {
      if (!/[a-z0-9]/.test(m[j - 1] || ' ')) return a;
      j = m.indexOf(k, j + 1);
    }
  }
  return '';
}

/**
 * Tevkifat-eksik kuralı:
 *   kalem/hizmet türü tabloyla eşleşir (AI sınıflandırması ŞART: giderTuru ya da matrahKategori dolu;
 *   kelime ipucu tek başına yetmez) VE KDV dahil tutar > yıllık eşik VE (kapsam tüm mükellef → uyarı;
 *   belirlenmiş alıcı → alıcı tipi gerekir: belirlenmişse uyarı, 'diger' ise kapsam dışı, boşsa ALICI_TIPI_GEREKLI).
 * Kural HİÇ çalışmaz (null): belgede gerçek tevkifat var, sabit kıymet alımı, iade belgesi, hesaplanan KDV yok
 *   (istisna/KDV'siz), satıcı KDV mükellefi değil, alıcı KDV mükellefi değil (kurum türü 'kdv_mukellefi_degil').
 * Kural eşleşmezse: alıcı 216 "Diğer hizmetler" kapsamındaysa ve kategori hizmet/genel giderse → 216 'bilgi' (B.5).
 */
export function tevkifatEksikDegerlendir(g: TevkifatEksikGirdi): TevkifatEksikSonuc | null {
  if (g.tevkifatVar || g.isFixedAsset || g.isReturn === true) return null;
  // B.2 — hesaplanan KDV yoksa (istisna / KDV'siz belge) tevkif edilecek KDV de yoktur.
  if (g.kdvTutari != null && Number.isFinite(Number(g.kdvTutari)) && Number(g.kdvTutari) <= 0) return null;
  // B.2 — satıcı KDV mükellefi değilse (gider pusulası, basit usul, muaf) KDV hesaplanmaz → tevkifat yok.
  if (g.saticiKdvMukellefi === false) return null;
  const aliciKurum = String(g.aliciKurumTuru || '').trim().toLowerCase();
  // Alıcı nihai tüketici / KDV mükellefi değil → tevkifat yapamaz (hiçbir kural).
  if (aliciKurum === 'kdv_mukellefi_degil') return null;
  const esik = tevkifatEsikTL(g.yil, g.env);
  const tutar = Number(g.kdvDahilTutar) || 0;
  if (!(tutar > esik.tutar)) return null;
  const giderTuru = String(g.giderTuru || '').trim();
  const kat = trFold(g.matrahKategori);
  // AI sınıflandırması yoksa (ham/okunmamış belge) karar verilmez — "AI ile oku" sonrası değerlendirilir.
  if (!giderTuru && !kat) return null;
  // Mal alımı kategorisi (ticari mal/hammadde/demirbaş) hizmet kurallarını kapatır; mal kuralları açık kalır.
  const malKategori = ['ticari_mal', 'hammadde', 'demirbas', 'sabit_kiymet'].includes(kat);
  const kalemMetni = (Array.isArray(g.kalemler) ? g.kalemler : []).filter(Boolean).join(' ');
  const hizmetKat = !kat || ['genel_gider', 'pazarlama', 'hizmet', 'diger'].includes(kat);
  let secilen: { kural: TevkifatKural; eslesme: 'ai' | 'kalem'; kelime: string } | null = null;
  for (const kural of TEVKIFAT_KURALLARI) {
    if (!kural.anahtar.length) continue;
    if (kural.tur === 'hizmet' && malKategori) continue;
    // B.13 — negatif liste: metinde hariç kelime geçiyorsa bu kural atlanır (sonraki kurallar bakar).
    if (kural.haric?.length && (iceriyor(giderTuru, kural.haric) || iceriyor(kalemMetni, kural.haric))) continue;
    const aiHit = giderTuru ? iceriyor(giderTuru, kural.anahtar) : '';
    if (aiHit) { secilen = { kural, eslesme: 'ai', kelime: aiHit }; break; }
    const kalemHit = kalemMetni ? iceriyor(kalemMetni, kural.anahtar) : '';
    // Kalem ipucu YALNIZ AI kategorisi hizmet/gider yönlüyken (genel_gider/pazarlama/boş) sayılır.
    if (kalemHit && (hizmetKat || kural.tur === 'mal')) {
      secilen = { kural, eslesme: 'kalem', kelime: kalemHit }; break;
    }
  }
  if (!secilen) {
    // B.5 — 216 "Diğer hizmetler" (5/10): özel kural eşleşmedi, kategori hizmet/genel gider, alıcı 216 kapsamında,
    //   eşik üstü → BİLGİ (mal kategorisi ya da kategori yoksa üretilmez).
    const k216 = TEVKIFAT_KURALLARI.find((r) => r.kod === '216');
    if (k216 && kat && hizmetKat && !malKategori && (DIGER_HIZMET_216_ALICILARI as string[]).includes(aliciKurum)) {
      return { tip: 'TEVKIFAT_EKSIK', seviye: 'bilgi', kural: k216, esik, eslesme: giderTuru ? 'ai' : 'kalem', eslesenKelime: '', digerHizmet216: true };
    }
    return null;
  }
  const { kural, eslesme, kelime } = secilen;
  if (kural.kapsam === 'tum_kdv_mukellefleri') {
    // B.4 — SATIŞ + alıcı TCKN'li (11 hane) + kurum türü boş: şahıs KDV mükellefi olmayabilir → engel/uyarı değil, 'bilgi' + soru.
    const isSale = String(g.invoiceKind || '').toUpperCase() === 'SATIS';
    const tckn = /^\d{11}$/.test(String(g.aliciKimlikNo || '').replace(/\D/g, ''));
    if (isSale && tckn && !aliciKurum) {
      return { tip: 'TEVKIFAT_EKSIK', seviye: 'bilgi', kural, esik, eslesme, eslesenKelime: kelime, aliciKdvMukellefiSoru: true };
    }
    return { tip: 'TEVKIFAT_EKSIK', seviye: 'uyari', kural, esik, eslesme, eslesenKelime: kelime };
  }
  const bel = belirlenmisAliciMi(g.aliciKurumTuru);
  if (bel === true) {
    if (kural.kapsam === 'kamu_5018' && aliciKurum !== 'kamu') return null;
    return { tip: 'TEVKIFAT_EKSIK', seviye: 'uyari', kural, esik, eslesme, eslesenKelime: kelime };
  }
  if (bel === false) return null; // normal KDV mükellefi alıcı → bu kural kapsam dışı
  const tahmin = kurumTuruTahmin(g.aliciUnvan);
  return { tip: 'ALICI_TIPI_GEREKLI', seviye: tahmin ? 'uyari' : 'bilgi', kural, esik, eslesme, eslesenKelime: kelime, tahmin };
}

/**
 * TEVKIFAT_VAR tutarlılığı: belgedeki oran ↔ tevkifat kodu ↔ fiş satırı (360/391) oranı/hesap adı.
 * Uyuşmazlık listesi döner (boş = tutarlı).
 * B.10: belge oranı 10/10 ise (isteğe bağlı TAM tevkifat, KDVGUT I/C-2.1.2.5) kod 6xx/8xx/2xx işlem türünü
 *   gösterir, oran uyuşmazlığı SAYILMAZ.
 */
export function tevkifatTutarlilik(p: {
  tevkifatOrani?: number | null;      // 0..1
  tevkifatKodu?: string | null;
  satirOranlari?: Array<string | null | undefined>;  // fiş tevkifat satırlarının rate alanı ('2/10')
  hesapAdlari?: Array<string | null | undefined>;    // 360/391 satırlarının plan adı
}): string[] {
  const sorun: string[] = [];
  const belgePay = oranPay(p.tevkifatOrani);
  const kural = tevkifatKuralBul(p.tevkifatKodu);
  if (tamTevkifatKoduMu(p.tevkifatKodu) && belgePay && belgePay !== 10) {
    sorun.push(`tevkifat kodu ${String(p.tevkifatKodu).trim()} isteğe bağlı TAM tevkifat (10/10) kodudur, belge oranı ${belgePay}/10`);
  } else if (kural && belgePay && belgePay !== 10 && kural.pay && kural.pay !== belgePay) {
    sorun.push(`belge oranı ${belgePay}/10, tevkifat kodu ${kural.kod} (${kural.oran} ${kural.ad}) ile uyuşmuyor`);
  }
  for (const r of p.satirOranlari || []) {
    const pay = oranPay(r);
    if (pay && belgePay && pay !== belgePay) sorun.push(`fiş satırı oranı ${pay}/10 ≠ belge oranı ${belgePay}/10`);
  }
  for (const ad of p.hesapAdlari || []) {
    const m = String(ad || '').match(/(\d{1,2})\s*\/\s*10/);
    if (m && belgePay && Number(m[1]) !== belgePay) sorun.push(`hesap adı "${String(ad).trim()}" ${m[1]}/10 oranını taşıyor, belge ${belgePay}/10`);
  }
  return Array.from(new Set(sorun));
}
