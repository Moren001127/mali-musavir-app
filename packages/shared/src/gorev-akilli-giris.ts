/**
 * Akıllı giriş ayrıştırıcısı — SAF fonksiyon, tarayıcı/DOM bağımlılığı yok.
 * "Öz Ela KDV kontrolü yarın 10:00" → başlık + tarih + saat + öncelik + kategori + mükellef.
 *
 * Kurallar (Türkçe, büyük/küçük harf duyarsız):
 *  - Tarih: bugün · yarın · öbür gün · pazartesi…pazar (bir sonraki) · "gelecek/haftaya pazartesi" (gelecek haftanın günü)
 *           · "15 eylül" · "15.09" / "15/09/2026" · "ayın 20'si" · "gelecek hafta" (gelecek pazartesi) · "3 gün sonra" · "ay sonu"
 *  - Saat:  "10:00" · "saat 14" · "saat 14.30" · "14'te" · "10.30'da" · sabah/öğlen/akşam (09:00/12:00/18:00)
 *  - Öncelik: acil/ivedi → ACİL; önemli → Yüksek; "düşük öncelik" → Düşük
 *  - Kategori: kdv → KDV Kontrol; beyanname → Beyanname; ekstre/banka → Banka; tahsilat → Tahsilat;
 *              evrak/belge/fatura → Evrak; bordro/sgk → Bordro/SGK; görüşme/toplantı/ara → Mükellef görüşmesi
 *  - Mükellef: listeden en iyi eşleşme; tek belirgin eşleşme yoksa adaylar döner (kullanıcı çipten seçer)
 *  - Tür: "not:" ile başlarsa NOT
 *
 * ORTAK PAKET (2026-09-14): portal (apps/web … gorevler/_components/akilli-giris.ts yeniden dışa aktarır) ve
 * WhatsApp botu (apps/api/src/whatsapp/gorev-whatsapp.service.ts) AYNI ayrıştırıcıyı kullanır.
 * Testi: node apps/web/scripts/akilli-giris-test.mjs (71 senaryo)
 */

/** Görev önceliği — apps/web/src/lib/tasks.ts `TaskPriority` ve Prisma `TaskPriority` enum'u ile birebir. */
export type GorevOncelik = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface MukellefSecenek {
  id: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  taxNumber?: string | null;
}

export interface MukellefAday {
  id: string;
  ad: string;
  /** eşleşen sözcük ağırlığı */
  puan: number;
  /** eşleşen / toplam ağırlık (0..1) */
  kapsam: number;
}

export interface AyristirmaSonucu {
  /** Tarih/saat/öncelik sözcükleri çıkarılmış başlık */
  baslik: string;
  /** YYYY-MM-DD */
  tarih: string | null;
  /** HH:mm */
  saat: string | null;
  oncelik: GorevOncelik | null;
  kategori: string | null;
  /** Emin olunan mükellef */
  mukellef: MukellefAday | null;
  /** Emin olunamayan durumda öneriler (en iyi ilk) */
  mukellefAdaylar: MukellefAday[];
  tur: 'GOREV' | 'NOT';
}

const AYLAR = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
/** Pazar=0 … Cumartesi=6 (JS Date ile aynı). Uzun ad önce ki "pazartesi" "pazar"a, "cumartesi" "cuma"ya yenilmesin. */
const GUNLER: Array<[string, number]> = [
  ['pazartesi', 1],
  ['cumartesi', 6],
  ['çarşamba', 3],
  ['perşembe', 4],
  ['salı', 2],
  ['cuma', 5],
  ['pazar', 0],
];
/** Şirket türü sözcükleri (ASCII'ye indirgenmiş) — mükellef eşleştirmede ağırlık 0. */
const SIRKET_TURU = new Set(
  [
    'ltd', 'şti', 'a.ş', 'a.ş.', 'aş', 'anonim', 'limited', 'şirketi', 'şirket', 'san', 'tic', 've', 'sanayi', 'ticaret',
    'paz', 'pazarlama', 'ith', 'ihr', 'ithalat', 'ihracat', 'ltd.', 'şti.', 'san.', 'tic.', 'şahıs', 'işletmesi', 'firması',
  ].map((s) => s.toLocaleLowerCase('tr-TR').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')),
);

const KATEGORI_KURALLARI: Array<{ kategori: string; anahtarlar: string[] }> = [
  { kategori: 'BEYANNAME', anahtarlar: ['beyanname', 'beyan ', 'muhtasar', 'geçici vergi', 'kurumlar vergisi', 'gelir vergisi', 'damga vergisi', 'ba-bs', 'ba bs', 'form ba', 'form bs'] },
  { kategori: 'KDV_KONTROL', anahtarlar: ['kdv'] },
  { kategori: 'BORDRO', anahtarlar: ['bordro', 'sgk', 'maaş', 'işe giriş', 'işten çıkış', 'sigorta', 'aphb', 'muhsgk', 'puantaj'] },
  { kategori: 'BANKA', anahtarlar: ['ekstre', 'banka', 'hesap özeti', 'dekont'] },
  { kategori: 'TAHSILAT', anahtarlar: ['tahsilat', 'tahsil', 'alacak', 'borç', 'ücret al', 'ödeme al', 'ödeme iste'] },
  { kategori: 'EVRAK', anahtarlar: ['evrak', 'belge', 'fatura', 'fiş', 'makbuz', 'defter'] },
  { kategori: 'MUKELLEF', anahtarlar: ['görüş', 'toplantı', 'randevu', 'ziyaret', 'telefon', 'arama', ' ara ', 'bilgi ver', 'haber ver'] },
  { kategori: 'OFIS', anahtarlar: ['ofis', 'kira', 'aidat', 'kırtasiye'] },
];

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

export function kucult(s: string): string {
  return s.toLocaleLowerCase('tr-TR');
}

/** Türkçe harfleri ASCII'ye indirger (eşleştirme için). */
export function sadelestir(s: string): string {
  return kucult(s)
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u');
}

export function mukellefAdi(m: MukellefSecenek): string {
  return (m.companyName || `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.taxNumber || '').trim();
}

function isoGun(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${g}`;
}

function gunBasi(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function gunEkle(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function ayinSonGunu(yil: number, ay0: number): number {
  return new Date(yil, ay0 + 1, 0).getDate();
}

function ayEkle(d: Date, n: number): Date {
  const x = new Date(d);
  const gun = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  x.setDate(Math.min(gun, ayinSonGunu(x.getFullYear(), x.getMonth())));
  return x;
}

/** Bugün de dahil en yakın hedef hafta günü; bugünse gelecek hafta. */
function sonrakiHaftaGunu(bugun: Date, hedef: number, gelecekHafta: boolean): Date {
  if (gelecekHafta) {
    // Gelecek takvim haftasının (Pzt-Paz) o günü
    const isoBugun = bugun.getDay() === 0 ? 7 : bugun.getDay(); // Pzt=1 … Paz=7
    const isoHedef = hedef === 0 ? 7 : hedef;
    const gelecekPazartesi = gunEkle(bugun, 8 - isoBugun);
    return gunEkle(gelecekPazartesi, isoHedef - 1);
  }
  const fark = (hedef - bugun.getDay() + 7) % 7;
  return gunEkle(bugun, fark === 0 ? 7 : fark);
}

function saatBicimle(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Bir metin parçasını (indeks aralığı) boşlukla değiştirir — başlık temizliği için. */
function sil(metin: string, bas: number, son: number): string {
  return metin.slice(0, bas) + ' '.repeat(son - bas) + metin.slice(son);
}

/** JS'nin sözcük sınırı (backslash-b) yalnız ASCII'dir: "salı", "öbür" gibi Türkçe harfli sözcüklerde çalışmaz → kendi sınırımız. */
const HARF = 'a-z0-9çğıöşüâîû';
const B0 = `(?<![${HARF}])`;
const B1 = `(?![${HARF}])`;
/** Sözcük sınırlı Türkçe düzenli ifade. */
function sinirli(desen: string, bayrak = ''): RegExp {
  return new RegExp(`${B0}(?:${desen})${B1}`, bayrak);
}

function temizle(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Kategori
// ---------------------------------------------------------------------------

export function kategoriTahmin(metin: string): string | null {
  const t = ` ${kucult(metin)} `;
  for (const kural of KATEGORI_KURALLARI) {
    for (const a of kural.anahtarlar) {
      if (t.includes(a)) return kural.kategori;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mükellef eşleştirme
// ---------------------------------------------------------------------------

function sozcukler(s: string): string[] {
  return sadelestir(s)
    .replace(/['’`´]/g, "'")
    .split(/[\s,;:()"“”]+/)
    .map((p) => p.split("'")[0]) // "ela'nın" → "ela"
    .map((p) => p.replace(/[^a-z0-9.&-]/g, ''))
    .filter(Boolean);
}

function sozcukAgirligi(s: string): number {
  if (SIRKET_TURU.has(s)) return 0;
  return 1;
}

function sozcukEslesir(girdi: string, hedef: string): boolean {
  if (girdi === hedef) return true;
  // Türkçe ekler: "elanin" ⊃ "ela", "ozele" ⊃ "oz" değil (kısa sözcükte tam eşleşme şart)
  if (hedef.length >= 3 && girdi.length > hedef.length && girdi.startsWith(hedef)) return true;
  return false;
}

/**
 * Metindeki mükellefi bulur. Dönüş: emin olunan tek mükellef (mukellef) ya da adaylar.
 * Emin olma kuralı: en yüksek puan tek başına önde VE (puan ≥ 2 VEYA kapsam ≥ 0.5 ve eşleşen sözcük ≥ 4 harf).
 */
export function mukellefEslestir(metin: string, mukellefler: MukellefSecenek[]): { mukellef: MukellefAday | null; adaylar: MukellefAday[] } {
  const girdiler = sozcukler(metin);
  if (girdiler.length === 0 || mukellefler.length === 0) return { mukellef: null, adaylar: [] };
  const vknler = girdiler.filter((g) => /^\d{10,11}$/.test(g));

  const adaylar: Array<MukellefAday & { enUzunEslesme: number }> = [];
  for (const m of mukellefler) {
    const ad = mukellefAdi(m);
    if (!ad) continue;
    if (vknler.length && m.taxNumber && vknler.includes(String(m.taxNumber))) {
      adaylar.push({ id: m.id, ad, puan: 99, kapsam: 1, enUzunEslesme: 11 });
      continue;
    }
    const hedefler = sozcukler(ad);
    let toplam = 0;
    let eslesen = 0;
    let enUzun = 0;
    for (const h of hedefler) {
      const w = sozcukAgirligi(h);
      toplam += w;
      if (w === 0) continue;
      if (girdiler.some((g) => sozcukEslesir(g, h))) {
        eslesen += w;
        enUzun = Math.max(enUzun, h.length);
      }
    }
    if (eslesen <= 0) continue;
    adaylar.push({ id: m.id, ad, puan: eslesen, kapsam: toplam ? eslesen / toplam : 0, enUzunEslesme: enUzun });
  }
  adaylar.sort((a, b) => b.puan - a.puan || b.kapsam - a.kapsam || a.ad.localeCompare(b.ad, 'tr'));
  const liste = adaylar.slice(0, 6).map(({ enUzunEslesme: _e, ...r }) => r);
  if (adaylar.length === 0) return { mukellef: null, adaylar: [] };

  const [ilk, ikinci] = adaylar;
  const tekBasinaOnde = !ikinci || ikinci.puan < ilk.puan || (ikinci.puan === ilk.puan && ikinci.kapsam < ilk.kapsam && ilk.kapsam === 1);
  const yeterli = ilk.puan >= 2 || (ilk.kapsam >= 0.5 && ilk.enUzunEslesme >= 4);
  if (tekBasinaOnde && yeterli) return { mukellef: liste[0], adaylar: liste };
  return { mukellef: null, adaylar: liste };
}

// ---------------------------------------------------------------------------
// Ana ayrıştırıcı
// ---------------------------------------------------------------------------

const GUN_ADLARI = GUNLER.map((g) => g[0]).join('|');

export function ayristir(girdi: string, mukellefler: MukellefSecenek[] = [], simdi: Date = new Date()): AyristirmaSonucu {
  const bugun = gunBasi(simdi);
  let metin = girdi.replace(/\s+/g, ' ').trim();
  let tur: 'GOREV' | 'NOT' = 'GOREV';

  // Tür: "not:" ya da "not " ile başlıyorsa serbest not
  const notM = /^not\s*[:\-–]\s*/i.exec(metin) || /^not\s+/i.exec(metin);
  if (notM) {
    tur = 'NOT';
    metin = metin.slice(notM[0].length);
  }

  let tarih: Date | null = null;
  let saat: string | null = null;
  let oncelik: GorevOncelik | null = null;

  /** Küçük harfli kopya (tr-TR: uzunluk korunur) — indeksler orijinalle aynı. */
  const k = () => kucult(metin);

  // 1) "ayın 20'si" / "ayın 20sinde" / "ayın 20'sine"
  {
    const re = sinirli(String.raw`ay[ıi]n\s+(\d{1,2})\s*'?\s*(?:s[ıiuü]n?[dt]?[ea]?n?|[ıiuü]n?[dt]?[ea]?n?)?`);
    const m = re.exec(k());
    if (m) {
      const gun = Number(m[1]);
      if (gun >= 1 && gun <= 31) {
        let yil = bugun.getFullYear();
        let ay0 = bugun.getMonth();
        if (gun < bugun.getDate()) {
          ay0 += 1;
          if (ay0 > 11) { ay0 = 0; yil += 1; }
        }
        tarih = new Date(yil, ay0, Math.min(gun, ayinSonGunu(yil, ay0)));
        metin = sil(metin, m.index, m.index + m[0].length);
      }
    }
  }

  // 2) Noktalı/eğik tarih: 15.09 · 15/09 · 15.09.2026 · 15.09.26 (ay 1-12 değilse tarih değildir → saat olabilir)
  if (!tarih) {
    const re = new RegExp(String.raw`(?<![\d:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?!\s*:)(?:'?(?:de|da|te|ta|ye|ya|e|a))?${B1}`, 'g');
    let m: RegExpExecArray | null;
    const kk = k();
    while ((m = re.exec(kk))) {
      const gun = Number(m[1]);
      const ay = Number(m[2]);
      if (gun < 1 || gun > 31 || ay < 1 || ay > 12) continue;
      let yil = m[3] ? Number(m[3]) : bugun.getFullYear();
      if (m[3] && m[3].length === 2) yil = 2000 + yil;
      let d = new Date(yil, ay - 1, Math.min(gun, ayinSonGunu(yil, ay - 1)));
      if (!m[3] && d < bugun) d = new Date(yil + 1, ay - 1, Math.min(gun, ayinSonGunu(yil + 1, ay - 1)));
      tarih = d;
      metin = sil(metin, m.index, m.index + m[0].length);
      break;
    }
  }

  // 3) "15 eylül" / "15 eylül 2026" / "15 eylülde" / "15 eylül'e"
  if (!tarih) {
    const re = sinirli(String.raw`(\d{1,2})\s+(${AYLAR.join('|')})(?:\s+(\d{4}))?(?:'?(?:nde|nda|de|da|te|ta|ye|ya|e|a))?`);
    const m = re.exec(k());
    if (m) {
      const gun = Number(m[1]);
      const ay0 = AYLAR.indexOf(m[2]);
      if (gun >= 1 && gun <= 31 && ay0 >= 0) {
        let yil = m[3] ? Number(m[3]) : bugun.getFullYear();
        let d = new Date(yil, ay0, Math.min(gun, ayinSonGunu(yil, ay0)));
        if (!m[3] && d < bugun) { yil += 1; d = new Date(yil, ay0, Math.min(gun, ayinSonGunu(yil, ay0))); }
        tarih = d;
        metin = sil(metin, m.index, m.index + m[0].length);
      }
    }
  }

  // 4) Saat: "10:00" · "saat 14" · "saat 14.30" · "14'te" · "10.30'da" · "saat 10'da"
  {
    const denemeler: RegExp[] = [
      sinirli(String.raw`(?:saat\s*)?([01]?\d|2[0-3]):([0-5]\d)(?:'?(?:de|da|te|ta))?`),
      sinirli(String.raw`saat\s*([01]?\d|2[0-3])(?:[.:]([0-5]\d))?(?:'?(?:de|da|te|ta))?`),
      new RegExp(String.raw`(?<![\d.:])([01]?\d|2[0-3])(?:\.([0-5]\d))?'?(?:de|da|te|ta)${B1}`),
    ];
    for (const re of denemeler) {
      const m = re.exec(k());
      if (!m) continue;
      const h = Number(m[1]);
      const dk = m[2] ? Number(m[2]) : 0;
      saat = saatBicimle(h, dk);
      metin = sil(metin, m.index, m.index + m[0].length);
      break;
    }
  }

  // 5) Göreli sözcükler — ilk bulunan tarih olur, diğer tarih sözcükleri de başlıktan temizlenir
  const goreli: Array<[RegExp, (m: RegExpExecArray) => Date | null]> = [
    [sinirli('bugün(?:e|den)?'), () => bugun],
    [sinirli('yar[ıi]n(?:a|dan)?'), () => gunEkle(bugun, 1)],
    [sinirli(String.raw`öbür\s?gün(?:e)?|ertesi\s?gün(?:e)?`), () => gunEkle(bugun, 2)],
    [sinirli(String.raw`ay\s?sonu(?:na|nda)?`), () => new Date(bugun.getFullYear(), bugun.getMonth(), ayinSonGunu(bugun.getFullYear(), bugun.getMonth()))],
    [sinirli(String.raw`hafta\s?sonu(?:na|nda)?`), () => sonrakiHaftaGunu(bugun, 6, false)],
    [sinirli(String.raw`(\d+)\s+(gün|hafta|ay)\s+sonra`), (m) => {
      const n = Number(m[1]);
      if (m[2] === 'gün') return gunEkle(bugun, n);
      if (m[2] === 'hafta') return gunEkle(bugun, 7 * n);
      return ayEkle(bugun, n);
    }],
    [sinirli(String.raw`(?:gelecek|önümüzdeki)\s+ay(?:a)?`), () => ayEkle(bugun, 1)],
    [sinirli(String.raw`(?:gelecek|önümüzdeki|haftaya)\s+(?:hafta\s+)?(${GUN_ADLARI})(?:\s+günü)?(?:'?(?:ye|ya|e|a|na|ne))?`), (m) => {
      const g = GUNLER.find((x) => x[0] === m[1]);
      return g ? sonrakiHaftaGunu(bugun, g[1], true) : null;
    }],
    [sinirli(String.raw`(?:gelecek|önümüzdeki)\s+hafta(?:ya)?|haftaya`), () => sonrakiHaftaGunu(bugun, 1, true)],
    [sinirli(String.raw`(?:bu\s+)?(${GUN_ADLARI})(?:\s+günü)?(?:'?(?:ye|ya|e|a|na|ne))?`), (m) => {
      const g = GUNLER.find((x) => x[0] === m[1]);
      return g ? sonrakiHaftaGunu(bugun, g[1], false) : null;
    }],
  ];
  for (const [re, hesap] of goreli) {
    const m = re.exec(k());
    if (!m) continue;
    const d = hesap(m);
    if (!d) continue;
    if (!tarih) tarih = d;
    metin = sil(metin, m.index, m.index + m[0].length);
  }

  // 6) Gün içi ipuçları (saat verilmemişse)
  {
    const ipuclari: Array<[RegExp, string]> = [
      [sinirli('sabah(?:a|ları|leyin)?'), '09:00'],
      [sinirli('öğle(?:n|ye|ne|de|nde)?'), '12:00'],
      [sinirli('akşam(?:a|ları|üstü)?'), '18:00'],
    ];
    for (const [re, s] of ipuclari) {
      const m = re.exec(k());
      if (!m) continue;
      if (!saat) saat = s;
      metin = sil(metin, m.index, m.index + m[0].length);
      break;
    }
  }

  // 7) Öncelik
  {
    const kurallar: Array<[RegExp, GorevOncelik]> = [
      [sinirli(String.raw`düşük\s+öncelik(?:li)?|acele\s+yok`), 'LOW'],
      [new RegExp(`${B0}(?:acil(?:en|dir)?|ivedi(?:likle)?)${B1}|!{2,}`), 'URGENT'],
      [sinirli(String.raw`önemli(?:dir)?|yüksek\s+öncelik(?:li)?`), 'HIGH'],
    ];
    for (const [re, p] of kurallar) {
      const m = re.exec(k());
      if (!m) continue;
      oncelik = p;
      metin = sil(metin, m.index, m.index + m[0].length);
      break;
    }
  }

  const baslik = temizle(metin);
  const kategori = kategoriTahmin(baslik);
  const { mukellef, adaylar } = mukellefEslestir(baslik, mukellefler);

  return {
    baslik,
    tarih: tarih ? isoGun(tarih) : null,
    saat,
    oncelik,
    kategori,
    mukellef,
    mukellefAdaylar: adaylar,
    tur,
  };
}
