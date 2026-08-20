/**
 * GİB e-Arşiv Portalı — "Fatura Oluştur" veri sözleşmesi.
 *
 * KAYNAK: sözleşme TAHMİN DEĞİL. 2026-08-20'de EDELER YEMEK mükellefinde portalın
 * kendi ekranından bir taslak oluşturulurken, tarayıcının GİB'e gönderdiği istek
 * birebir yakalandı (cmd=EARSIV_PORTAL_FATURA_OLUSTUR, pageName=RG_BASITFATURA).
 *
 * İLK DENEMEMİZİN NEDEN REDDEDİLDİĞİ (GİB yalnızca "Bir hata meydana geldi" diyor,
 * hangi alanın yanlış olduğunu SÖYLEMİYOR — o yüzden bu notlar kritik):
 *   1) Tutarlar NOKTA ile yazılır ("0.1"), Türkçe virgül ("0,20") REDDEDİLİR.
 *   2) faturaUuid BOŞ gönderilir; belge kimliğini GİB üretir.
 *   3) kdvOrani METİN'dir ("10"), sayı değil.
 *   4) 52 alanın TAMAMI gönderilir; eksik alan varsa istek reddedilir.
 *   5) Bazı alanlar boş string değil TEK BOŞLUK ister: sehir, vergiCesidi,
 *      fisSaati, fisTipi. (Portalın kendi formu böyle gönderiyor.)
 *   6) yatirimTesvikTarihi boş değil, BUGÜNÜN tarihidir.
 *   7) Kalemde vergininKdvTutari / ozelMatrahTutari /
 *      hesaplananotvtevkifatakatkisi alanları da bulunmalıdır.
 *
 * SATICI BİLGİSİ GÖNDERİLMEZ — GİB oturumdan bilir.
 */

export type GibFaturaGirdi = {
  aliciVkn: string;
  aliciUnvan: string;
  aliciAdres?: string | null;
  aliciVd?: string | null;
  aliciEposta?: string | null;
  faturaTarihi: Date;
  aciklama: string;
  miktar: number;
  birim?: string | null;
  matrah: number;
  kdvOrani: number;
  kdvTutari: number;
  toplam: number;
};

const ikiHane = (n: number) => String(n).padStart(2, '0');

/** GİB gg/aa/yyyy bekler. */
export function gibTarih(d: Date): string {
  return `${ikiHane(d.getDate())}/${ikiHane(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** GİB SS:dd:ss bekler. */
export function gibSaat(d: Date): string {
  return `${ikiHane(d.getHours())}:${ikiHane(d.getMinutes())}:${ikiHane(d.getSeconds())}`;
}

/**
 * Tutar biçimi: NOKTA ondalık, gereksiz sıfır YOK ("1", "0.1", "1.1").
 * Portalın kendi formu da böyle gönderiyor; virgül kullanılırsa GİB isteği reddeder.
 */
export function gibTutar(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const yuvarlanmis = Math.round((n + Number.EPSILON) * 100) / 100;
  return String(yuvarlanmis);
}

/**
 * BİRİM KODLARI — GİB birim ADI değil KODU bekler (UN/ECE Rec.20).
 * Eskiden "ADET" dışındaki her şey ham metin olarak gidiyordu: kullanıcı "KG" yazınca
 * GİB'e "KG" gidiyordu; doğrusu "KGM". Tanınmayan birim SESSİZCE gönderilmez —
 * taslak oluşturulurken hata verilir (bkz. fatura-kes.service.ts).
 */
export const GIB_BIRIM: Record<string, string> = {
  ADET: 'C62', AD: 'C62', 'C62': 'C62',
  KG: 'KGM', KILOGRAM: 'KGM', KGM: 'KGM',
  GRAM: 'GRM', GR: 'GRM', GRM: 'GRM',
  TON: 'TNE', TNE: 'TNE',
  LITRE: 'LTR', LT: 'LTR', LTR: 'LTR',
  METRE: 'MTR', M: 'MTR', MTR: 'MTR',
  M2: 'MTK', METREKARE: 'MTK', MTK: 'MTK',
  M3: 'MTQ', METREKUP: 'MTQ', MTQ: 'MTQ',
  KM: 'KMT', KILOMETRE: 'KMT', KMT: 'KMT',
  PAKET: 'PK', PK: 'PK',
  KUTU: 'BX', BX: 'BX',
  KOLI: 'CT', CT: 'CT',
  CIFT: 'PR', PR: 'PR',
  DUZINE: 'DZN', DZN: 'DZN',
  TAKIM: 'SET', SET: 'SET',
  SAAT: 'HUR', HUR: 'HUR',
  GUN: 'DAY', DAY: 'DAY',
  AY: 'MON', MON: 'MON',
  YIL: 'ANN', ANN: 'ANN',
};

/** Türkçe birim adını GİB koduna çevirir. Tanınmazsa null (sessizce varsayma). */
export function birimKodu(v: any): string | null {
  const ham = String(v || '').trim().toUpperCase();
  if (!ham) return 'C62';
  const sade = ham
    .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9]/g, '');
  return GIB_BIRIM[sade] || null;
}

/**
 * BİRİM FİYAT — miktar × birim fiyat, matrahı TUTMALIDIR.
 *
 * Eskiden birim fiyat koşulsuz 2 haneye yuvarlanıyordu: matrah 100 / miktar 3 →
 * "33.33", 3 × 33,33 = 99,99 ≠ 100. GİB tutarsız kalemi anlamsız hatayla reddeder.
 * Artık 2 hane tutuyorsa AYNEN 2 hane kullanılır (doğrulanmış miktar=1 yolu hiç
 * değişmez); tutmuyorsa tutana kadar hane artırılır.
 */
export function gibBirimFiyat(matrah: number, miktar: number): string {
  const adet = Number.isFinite(miktar) && miktar > 0 ? miktar : 1;
  const ham = matrah / adet;
  for (let hane = 2; hane <= 6; hane++) {
    const aday = Number(ham.toFixed(hane));
    if (Math.abs(aday * adet - matrah) < 0.005) return String(aday);
  }
  return String(Number(ham.toFixed(6)));
}

/**
 * Draft → GİB payload. 52 alanın tamamı üretilir.
 * Alıcı 11 haneli (TCKN) ise ad/soyad, 10 haneli (VKN) ise ünvan alanı doldurulur —
 * portalın kendi davranışı budur.
 */
export function gibFaturaPayload(g: GibFaturaGirdi, simdi: Date = new Date()): Record<string, any> {
  const vkn = String(g.aliciVkn || '').replace(/\D/g, '');
  const tckn = vkn.length === 11;
  const adSoyad = String(g.aliciUnvan || '').trim();
  const bosluk = adSoyad.lastIndexOf(' ');
  const ad = tckn ? (bosluk > 0 ? adSoyad.slice(0, bosluk) : adSoyad) : '';
  const soyad = tckn ? (bosluk > 0 ? adSoyad.slice(bosluk + 1) : '') : '';

  const kalem = {
    malHizmet: String(g.aciklama || '').trim(),
    miktar: g.miktar,
    birim: birimKodu(g.birim) || 'C62',
    birimFiyat: gibBirimFiyat(g.matrah, g.miktar),
    fiyat: gibTutar(g.matrah),
    iskontoOrani: 0,
    iskontoTutari: '0',
    iskontoNedeni: '',
    malHizmetTutari: gibTutar(g.matrah),
    kdvOrani: String(g.kdvOrani),
    vergiOrani: 0,
    kdvTutari: gibTutar(g.kdvTutari),
    vergininKdvTutari: '0',
    ozelMatrahTutari: '0',
    hesaplananotvtevkifatakatkisi: '0',
  };

  return {
    faturaUuid: '', // GİB üretir — dolu gönderilirse reddedilir
    belgeNumarasi: '',
    faturaTarihi: gibTarih(g.faturaTarihi),
    saat: gibSaat(simdi),
    paraBirimi: 'TRY',
    dovzTLkur: '0',
    faturaTipi: 'SATIS',
    hangiTip: '5000/30000',
    vknTckn: vkn,
    aliciUnvan: tckn ? '' : adSoyad,
    aliciAdi: ad,
    aliciSoyadi: soyad,
    binaAdi: '',
    binaNo: '',
    kapiNo: '',
    kasabaKoy: '',
    vergiDairesi: String(g.aliciVd || '').trim(),
    ulke: 'Türkiye',
    bulvarcaddesokak: String(g.aliciAdres || '').trim(),
    irsaliyeNumarasi: '',
    irsaliyeTarihi: '',
    mahalleSemtIlce: '',
    sehir: ' ', // TEK BOŞLUK — portalın kendi formu böyle gönderiyor
    postaKodu: '',
    tel: '',
    fax: '',
    eposta: String(g.aliciEposta || '').trim(),
    websitesi: '',
    iadeTable: [],
    ihracKayitliKarsiBelgeNo: '',
    yatirimTesvikNumarasi: '',
    yatirimTesvikTarihi: gibTarih(simdi), // boş DEĞİL — bugünün tarihi
    kdvOranKontrolMuafiyeti: false,
    vergiCesidi: ' ', // TEK BOŞLUK
    malHizmetTable: [kalem],
    tip: 'İskonto',
    matrah: gibTutar(g.matrah),
    malhizmetToplamTutari: gibTutar(g.matrah),
    toplamIskonto: '0',
    hesaplanankdv: gibTutar(g.kdvTutari),
    vergilerToplami: gibTutar(g.kdvTutari),
    vergilerDahilToplamTutar: gibTutar(g.toplam),
    odenecekTutar: gibTutar(g.toplam),
    not: '',
    siparisNumarasi: '',
    siparisTarihi: '',
    fisNo: '',
    fisTarihi: '',
    fisSaati: ' ', // TEK BOŞLUK
    fisTipi: ' ', // TEK BOŞLUK
    zRaporNo: '',
    okcSeriNo: '',
  };
}

/** Portalın gönderdiği 52 alanın tam listesi — eksik alan denetimi için. */
export const GIB_ZORUNLU_ALANLAR = [
  'faturaUuid', 'belgeNumarasi', 'faturaTarihi', 'saat', 'paraBirimi', 'dovzTLkur',
  'faturaTipi', 'hangiTip', 'vknTckn', 'aliciUnvan', 'aliciAdi', 'aliciSoyadi',
  'binaAdi', 'binaNo', 'kapiNo', 'kasabaKoy', 'vergiDairesi', 'ulke',
  'bulvarcaddesokak', 'irsaliyeNumarasi', 'irsaliyeTarihi', 'mahalleSemtIlce',
  'sehir', 'postaKodu', 'tel', 'fax', 'eposta', 'websitesi', 'iadeTable',
  'ihracKayitliKarsiBelgeNo', 'yatirimTesvikNumarasi', 'yatirimTesvikTarihi',
  'kdvOranKontrolMuafiyeti', 'vergiCesidi', 'malHizmetTable', 'tip', 'matrah',
  'malhizmetToplamTutari', 'toplamIskonto', 'hesaplanankdv', 'vergilerToplami',
  'vergilerDahilToplamTutar', 'odenecekTutar', 'not', 'siparisNumarasi',
  'siparisTarihi', 'fisNo', 'fisTarihi', 'fisSaati', 'fisTipi', 'zRaporNo', 'okcSeriNo',
] as const;

export const GIB_KALEM_ALANLARI = [
  'malHizmet', 'miktar', 'birim', 'birimFiyat', 'fiyat', 'iskontoOrani',
  'iskontoTutari', 'iskontoNedeni', 'malHizmetTutari', 'kdvOrani', 'vergiOrani',
  'kdvTutari', 'vergininKdvTutari', 'ozelMatrahTutari', 'hesaplananotvtevkifatakatkisi',
] as const;
