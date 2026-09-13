// HESAP DAVRANIS DENETIMI — istatistik motoru.
//   Tek gecste her yaprak hesap icin: borc/alacak toplam+adet, ay serisi, hareket siniflari
//   (karsi hesaba gore), Mizan'dan acilis/kapanis. Kurallar bu baglam uzerinde calisir.
import type { ParsedEDefterFisLine } from '../edefter-fis-listesi-parser.service';
import type {
  Bulgu,
  DefterOzeti,
  DenetimBaglami,
  DenetimGirdisi,
  Hareket,
  HareketSinifi,
  HesapIstatistik,
  MizanHesabi,
} from './tipler';

// ---------------------------------------------------------------- metin yardimcilari
const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

export function normalizeMetin(value?: string | null): string {
  return String(value ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] || c)
    .replace(/[^a-z0-9%.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cari adi normalizasyonu: sirket turu / sektor eklerini at, ilk 2 anlamli kelimeyi al.
//   "ÖZTİRYAKİLER MADENİ EŞYA SAN. VE TİC. A.Ş." ve "ÖZTİRYAKİLER MADENİ" ayni anahtara duser.
const CARI_EK_KELIMELER = new Set([
  'ltd', 'sti', 'ltd.sti', 'a.s', 'as', 'a.s.', 'san', 'tic', 've', 'limited', 'sirketi', 'anonim', 'ticaret',
  'sanayi', 'ins', 'insaat', 'paz', 'pazarlama', 'ith', 'ihr', 'ithalat', 'ihracat', 'hizmetleri', 'hiz',
  'dis', 'ic', 'turizm', 'gida', 'tekstil', 'lojistik', 'nakliyat', 'nak', 'otomotiv', 'medikal', 'muh',
  'sti.', 'san.', 'tic.', 'ltd.', 'a.s.', 'koll', 'kollektif', 'komandit', 'kooperatifi', 'koop',
]);
export function normalizeCariAdi(value?: string | null): string {
  const tokens = normalizeMetin(value)
    .replace(/[.%]/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2 && !CARI_EK_KELIMELER.has(t));
  return tokens.slice(0, 2).join(' ');
}

export function isOpeningLikeText(value?: string | null): boolean {
  const text = normalizeMetin(value);
  return /(?:^|\s)a?cilis(?:\s+fisi|\s+kaydi)?(?:\s|$)/.test(text);
}
export function isClosingLikeText(value?: string | null): boolean {
  return /kapanis|donem sonu/.test(normalizeMetin(value));
}
export function satirMetni(row: ParsedEDefterFisLine): string {
  return normalizeMetin([row.fisTipi, row.belgeTuru, row.aciklama, row.hesapAdi].filter(Boolean).join(' '));
}

// ---------------------------------------------------------------- hesap kodu yardimcilari
export function anaKod(code?: string | null): string {
  return String(code || '').replace(/\D/g, '').slice(0, 3);
}
export function grupKod(code?: string | null): string {
  return anaKod(code).slice(0, 2);
}
export function sinifKod(code?: string | null): string {
  return anaKod(code).slice(0, 1);
}
// "120" on eki: 120, 120.01, 120.01.A001 eslesir; 1200 gibi farkli ana hesap eslesmez.
export function kodEslesir(code: string | null | undefined, prefix: string): boolean {
  const c = String(code || '').trim();
  if (!c) return false;
  if (c === prefix || c.startsWith(`${prefix}.`) || c.startsWith(`${prefix}-`)) return true;
  return prefix.length === 3 && anaKod(c) === prefix && /^\d{3}(?:\D|$)/.test(c);
}

// ---------------------------------------------------------------- tarih yardimcilari
const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export function ayAnahtari(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function ayAdi(ay: string): string {
  const [y, m] = ay.split('-').map(Number);
  if (!y || !m) return ay;
  return `${AY_ADLARI[m - 1] || ay} ${y}`;
}
export function ayEkle(ay: string, n: number): string {
  const [y, m] = ay.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return ayAnahtari(d);
}
export function aylarAraligi(range: { start: Date; end: Date } | null): string[] {
  if (!range) return [];
  const out: string[] = [];
  let cur = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1));
  const son = new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth(), 1));
  let guard = 0;
  while (cur <= son && guard++ < 24) {
    out.push(ayAnahtari(cur));
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return out;
}
export function gecerliTarih(d?: Date | null): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

// ---------------------------------------------------------------- bicimleme
export function fmtTL(value: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
export function fmtTarih(value: Date): string {
  return `${String(value.getUTCDate()).padStart(2, '0')}.${String(value.getUTCMonth() + 1).padStart(2, '0')}.${value.getUTCFullYear()}`;
}
export function yuzde(pay: number, payda: number): string {
  if (payda <= 0) return '0';
  return ((pay / payda) * 100).toFixed(0);
}
export function kisaAd(ad?: string | null, max = 34): string {
  const t = String(ad || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
export function hesapEtiketi(h: { kod: string; ad: string }): string {
  return h.ad ? `${h.kod} ${kisaAd(h.ad)}` : h.kod;
}

// ---------------------------------------------------------------- karsi hesap siniflandirma
// Para hesaplari: kasa, banka, cek, POS, diger hazir degerler
export const PARA_HESAPLARI = new Set(['100', '101', '102', '103', '108', '109']);
// Odeme sayilan karsi hesaplar (para + ortak/personel/diger borc + pesin vergi mahsubu + yapilandirma)
export const ODEME_KARSI = new Set([
  ...PARA_HESAPLARI, '131', '132', '133', '135', '136', '195', '196', '331', '332', '333', '336', '193', '368', '371', '309',
]);
// Tahsilat sayilan karsi hesaplar (para + cek/senet + ortak + alinan avans mahsubu)
export const TAHSILAT_KARSI = new Set([
  ...PARA_HESAPLARI, '121', '122', '126', '131', '132', '133', '135', '136', '331', '332', '333', '336', '340', '159',
]);
const IADE_KARSI_ALACAK = new Set(['600', '601', '602', '610', '611', '612', '391']); // 120 alacak → satis iadesi/iptali
const IADE_KARSI_BORC_PREFIX = ['150', '151', '152', '153', '157', '158', '191', '25', '26', '7']; // 320 borc → alis iadesi
const CARI_MAHSUP = new Set(['120', '121', '122', '127', '128', '129', '220', '320', '321', '322', '329', '420', '336', '159', '340']);

function karsiIcerir(karsi: Set<string>, kume: Set<string>): boolean {
  for (const k of karsi) if (kume.has(k)) return true;
  return false;
}
function karsiPrefix(karsi: Set<string>, prefixler: string[]): boolean {
  for (const k of karsi) for (const p of prefixler) if (k.startsWith(p)) return true;
  return false;
}
function karsiGelirGider(karsi: Set<string>): boolean {
  for (const k of karsi) if (/^[67]/.test(k)) return true;
  return false;
}

export function hareketSinifla(ana: string, taraf: 'BORC' | 'ALACAK', karsi: Set<string>, ayniTaraf: Set<string> = new Set()): HareketSinifi {
  const sinif = ana.slice(0, 1);
  // Alacak hesaplari (12x/13x/22x/23x) ve stok/avans gibi aktifler
  if (sinif === '1' || sinif === '2') {
    if (taraf === 'ALACAK') {
      if (karsiIcerir(karsi, IADE_KARSI_ALACAK)) return 'IADE';
      if (karsiIcerir(karsi, TAHSILAT_KARSI)) return 'TAHSILAT';
      if (karsiIcerir(karsi, CARI_MAHSUP)) return 'MAHSUP';
      if (karsiGelirGider(karsi)) return 'DUZELTME';
      return 'DIGER';
    }
    // BORC: faturalandirma (600/391 karsi) ya da para girisi (banka → 120 iade odemesi)
    if (karsiGelirGider(karsi) || karsi.has('391')) return 'FATURA';
    if (karsiIcerir(karsi, TAHSILAT_KARSI)) return 'ODEME';
    if (karsiIcerir(karsi, CARI_MAHSUP)) return 'MAHSUP';
    return 'DIGER';
  }
  // Borc hesaplari (3xx/4xx): alacak = tahakkuk/faturalandirma, borc = odeme
  if (sinif === '3' || sinif === '4') {
    if (taraf === 'BORC') {
      if (karsiPrefix(karsi, IADE_KARSI_BORC_PREFIX) && !karsiIcerir(karsi, ODEME_KARSI)) {
        // 320 borc karsisinda stok/gider var → alis iadesi. 36x borc karsisinda 7xx → tesvik/duzeltme.
        return ana.startsWith('32') ? 'IADE' : 'DUZELTME';
      }
      if (karsiIcerir(karsi, ODEME_KARSI)) return 'ODEME';
      if (karsiIcerir(karsi, CARI_MAHSUP)) return 'MAHSUP';
      if (karsiGelirGider(karsi)) return 'DUZELTME';
      // Tahakkuk fisinin icindeki borc satiri (orn. bordro fisinde 361 borc = SGK tesviki): ayni tarafta
      //   gider (7xx) var, karsi tarafta para yok → odeme degil, duzeltme.
      if (karsiGelirGider(ayniTaraf)) return 'DUZELTME';
      return 'DIGER';
    }
    // ALACAK
    if (karsiGelirGider(karsi) || karsiPrefix(karsi, ['15', '19', '25', '26', '335', '191', '391'])) {
      return ana.startsWith('32') ? 'FATURA' : 'TAHAKKUK';
    }
    if (karsiIcerir(karsi, PARA_HESAPLARI)) return 'TAHSILAT';
    if (karsiIcerir(karsi, CARI_MAHSUP)) return 'MAHSUP';
    return 'DIGER';
  }
  return 'DIGER';
}

// ---------------------------------------------------------------- baglam kurulumu
export function baglamKur(girdi: DenetimGirdisi): DenetimBaglami {
  const rows = girdi.rows;
  const fisler = new Map<string, ParsedEDefterFisLine[]>();
  for (const r of rows) {
    if (!fisler.has(r.voucherKey)) fisler.set(r.voucherKey, []);
    fisler.get(r.voucherKey)!.push(r);
  }

  // Her fis icin borc/alacak tarafindaki ana kod kumeleri (karsi hesap hesaplamasi icin)
  const fisBorcKodlari = new Map<string, Set<string>>();
  const fisAlacakKodlari = new Map<string, Set<string>>();
  for (const [key, grup] of fisler.entries()) {
    const b = new Set<string>();
    const a = new Set<string>();
    for (const r of grup) {
      const ana = anaKod(r.hesapKodu);
      if (!ana) continue;
      if (Number(r.borc || 0) > 0) b.add(ana);
      if (Number(r.alacak || 0) > 0) a.add(ana);
    }
    fisBorcKodlari.set(key, b);
    fisAlacakKodlari.set(key, a);
  }

  const hesaplar = new Map<string, HesapIstatistik>();
  const hesapAl = (r: ParsedEDefterFisLine): HesapIstatistik | null => {
    const kod = String(r.hesapKodu || '').trim();
    if (!kod) return null;
    let h = hesaplar.get(kod);
    if (!h) {
      const ana = anaKod(kod);
      h = {
        kod,
        ad: String(r.hesapAdi || '').trim(),
        ana,
        grup: ana.slice(0, 2),
        sinif: ana.slice(0, 1),
        hareketler: [],
        borc: 0,
        alacak: 0,
        borcAdet: 0,
        alacakAdet: 0,
        net: 0,
        tarihsizAdet: 0,
        aylar: new Map(),
        ilkSatir: r,
        mizanKapanis: null,
        mizanBorcToplam: null,
        mizanAlacakToplam: null,
        acilis: null,
        kapanis: null,
      };
      hesaplar.set(kod, h);
    } else if (!h.ad && r.hesapAdi) {
      h.ad = String(r.hesapAdi).trim();
    }
    return h;
  };

  for (const r of rows) {
    const h = hesapAl(r);
    if (!h) continue;
    const borc = Number(r.borc || 0);
    const alacak = Number(r.alacak || 0);
    const tarih = gecerliTarih(r.fisTarihi) ? r.fisTarihi : null;
    const ay = tarih ? ayAnahtari(tarih) : null;
    const ekle = (taraf: 'BORC' | 'ALACAK', tutar: number) => {
      if (tutar <= 0) return;
      // Karsi taraf: fisin diger tarafindaki ana kodlar (kendi ana kodu haric — 120→120 virman MAHSUP sayilsin diye
      //   ayni ana kod karsi tarafta baska bir yaprak hesapla varsa tutulur).
      const kaynak = taraf === 'BORC' ? fisAlacakKodlari.get(r.voucherKey) : fisBorcKodlari.get(r.voucherKey);
      const ayniTaraf = taraf === 'BORC' ? fisBorcKodlari.get(r.voucherKey) : fisAlacakKodlari.get(r.voucherKey);
      const karsi = new Set<string>(kaynak || []);
      const hareket: Hareket = {
        satir: r,
        taraf,
        tutar,
        ay,
        tarih,
        karsi,
        sinif: hareketSinifla(h.ana, taraf, karsi, ayniTaraf || new Set()),
      };
      h.hareketler.push(hareket);
      if (taraf === 'BORC') { h.borc += tutar; h.borcAdet += 1; } else { h.alacak += tutar; h.alacakAdet += 1; }
      if (!ay) { h.tarihsizAdet += 1; return; }
      let ayIst = h.aylar.get(ay);
      if (!ayIst) { ayIst = { ay, borc: 0, alacak: 0, borcAdet: 0, alacakAdet: 0 }; h.aylar.set(ay, ayIst); }
      if (taraf === 'BORC') { ayIst.borc += tutar; ayIst.borcAdet += 1; } else { ayIst.alacak += tutar; ayIst.alacakAdet += 1; }
    };
    ekle('BORC', borc);
    ekle('ALACAK', alacak);
  }

  // Tarih sirali hareketler + net
  for (const h of hesaplar.values()) {
    h.hareketler.sort((x, y) => {
      const tx = x.tarih ? x.tarih.getTime() : Number.MAX_SAFE_INTEGER;
      const ty = y.tarih ? y.tarih.getTime() : Number.MAX_SAFE_INTEGER;
      if (tx !== ty) return tx - ty;
      return x.satir.rowIndex - y.satir.rowIndex;
    });
    h.net = h.borc - h.alacak;
  }

  // Mizan: yaprak kodlar; hareketli hesaplara kapanis/acilis, hareketsizlere ayri liste
  const mizanHesaplari = new Map<string, MizanHesabi>();
  const mizan = girdi.mizan;
  if (mizan?.found && mizan.bakiyeByCode.size) {
    const kodlar = [...mizan.bakiyeByCode.keys()];
    // Yaprak = altinda baska kod olmayan. Luca Mizan'i ust seviyeleri noktasiz verir (1 → 10 → 100 → 100.01 →
    //   100.01.001): "10", "100"un; "1" de "10"un ebeveynidir. Noktali seviyede ise "100.01" → "100.01.001".
    const ebeveynMi = (c: string) =>
      kodlar.some((o) => o !== c && o.startsWith(c) && (o[c.length] === '.' || /^\d+$/.test(c)));
    const yaprakMi = (c: string) => !ebeveynMi(c);
    for (const c of kodlar) {
      if (!yaprakMi(c)) continue;
      const kapanis = mizan.bakiyeByCode.get(c) || 0;
      const toplam = mizan.toplamByCode?.get(c);
      const h = hesaplar.get(c);
      if (h) {
        h.mizanKapanis = kapanis;
        h.mizanBorcToplam = toplam ? toplam.borc : null;
        h.mizanAlacakToplam = toplam ? toplam.alacak : null;
        h.acilis = kapanis - h.net;
        h.kapanis = kapanis;
        if (!h.ad && toplam?.ad) h.ad = toplam.ad;
      }
      mizanHesaplari.set(c, {
        kod: c,
        ad: toplam?.ad || h?.ad || '',
        ana: anaKod(c),
        kapanis,
        borcToplam: toplam ? toplam.borc : null,
        alacakToplam: toplam ? toplam.alacak : null,
      });
    }
    // Not: Mizan'da yalnizca ara seviyeye kadar gelen kodlar (orn "120.01") fis listesindeki yaprakla
    //   ("120.01.A001") eslesmez → o hesabin kapanisi bilinmez, acilis null kalir (kurallar bunu tolere eder).
  }

  // Acilis fisi defterde varsa kumulatif hareket = mutlak bakiye (acilis 0, kesin) — Mizan'a gerek yok.
  const acilisFisiVeride = rows.some((r) => isOpeningLikeText(satirMetni(r)));
  if (acilisFisiVeride) {
    for (const h of hesaplar.values()) {
      if (h.acilis == null) { h.acilis = 0; h.kapanis = h.net; }
    }
  }

  const aylar = aylarAraligi(girdi.range);
  const donemTipi = String(girdi.donemTipi || '').toUpperCase();
  let satisFisSayisi = 0;
  let alisFisSayisi = 0;
  for (const grup of fisler.values()) {
    if (grup.some((r) => /^60[012]/.test(anaKod(r.hesapKodu)) && Number(r.alacak || 0) > 0)) satisFisSayisi += 1;
    if (grup.some((r) => /^(15[0-9]|7)/.test(anaKod(r.hesapKodu)) && Number(r.borc || 0) > 0)) alisFisSayisi += 1;
  }
  const ozet: DefterOzeti = {
    aylar,
    aySayisi: aylar.length,
    isYillik: donemTipi === 'YILLIK',
    acilisFisiVeride,
    mizanVar: Boolean(mizan?.found && mizan.bakiyeByCode.size),
    kasaHareketVar: [...hesaplar.values()].some((h) => h.ana === '100'),
    bankaHareketVar: [...hesaplar.values()].some((h) => h.ana === '102'),
    satisFisSayisi,
    alisFisSayisi,
    bordroVar: [...hesaplar.values()].some((h) => h.ana === '335' || h.ana === '361'),
    toplamSatir: rows.length,
    toplamFis: fisler.size,
  };

  return { hesaplar, mizanHesaplari, ozet, girdi, fisler };
}

// ---------------------------------------------------------------- bulgu yardimcilari
export function hesaplarAna(b: DenetimBaglami, ana: string): HesapIstatistik[] {
  return [...b.hesaplar.values()].filter((h) => h.ana === ana);
}
export function hesaplarPrefix(b: DenetimBaglami, re: RegExp): HesapIstatistik[] {
  return [...b.hesaplar.values()].filter((h) => re.test(h.ana));
}
export function sinifToplam(h: HesapIstatistik, taraf: 'BORC' | 'ALACAK', siniflar: HareketSinifi[]): { tutar: number; adet: number } {
  let tutar = 0;
  let adet = 0;
  for (const m of h.hareketler) {
    if (m.taraf !== taraf || !siniflar.includes(m.sinif)) continue;
    tutar += m.tutar;
    adet += 1;
  }
  return { tutar, adet };
}
export function capa(h: HesapIstatistik): Pick<Bulgu, 'voucherKey' | 'rowIndex' | 'hesapKodu'> {
  return { voucherKey: h.ilkSatir.voucherKey, rowIndex: h.ilkSatir.rowIndex, hesapKodu: h.kod };
}

// Ust sinir: bulgulari |detail.tutar|'a gore buyukten kucuge sirala, ilk n'i tut, kalani tek ozet satiri yap.
export function ustSinirla(bulgular: Bulgu[], n: number, ozet: (kalan: number, toplam: number) => string, kod: string): Bulgu[] {
  if (bulgular.length <= n) return bulgular;
  const sirali = [...bulgular].sort((a, b) => Math.abs(Number(b.detail?.tutar || 0)) - Math.abs(Number(a.detail?.tutar || 0)));
  const kalan = sirali.length - n;
  return [
    ...sirali.slice(0, n),
    {
      severity: 'INFO',
      category: kod,
      message: ozet(kalan, sirali.length),
      detail: { ozet: true, kalan, toplam: sirali.length },
    },
  ];
}
