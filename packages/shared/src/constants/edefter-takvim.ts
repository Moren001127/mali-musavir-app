/**
 * e-Defter berat yükleme takvimi — 2026-09-22
 *
 * Dayanak: Elektronik Defter Genel Tebliği (Sıra No: 1) 4.3.4 fıkrası, Sıra No: 5 Tebliğ ile değişik
 * (Resmî Gazete 08.11.2024, 32716):
 *   • Aylık tercih: gelir vergisi mükellefi (şahıs) ilgili ayı takip eden DÖRDÜNCÜ ayın 10'u,
 *     diğer mükellefler (firma) dördüncü ayın 14'ü sonuna kadar.
 *   • Hesap döneminin son ayı (Aralık): şahıs → gelir vergisi beyannamesi ayını (Mart) takip eden ayın 10'u
 *     (10 Nisan); firma → kurumlar vergisi beyannamesi ayını (Nisan) takip eden ayın 14'ü (14 Mayıs).
 *   • Geçici vergi dönemi tercihi: şahıs → geçici vergi beyannamesi ayını takip eden ayın 10'u,
 *     firma → 14'ü. Beyan ayları Q1→Mayıs, Q2→Ağustos, Q3→Kasım → son günler Haziran / Eylül / Aralık.
 *     Son çeyrek (Eki–Ara): şahıs 10 Nisan, firma 14 Mayıs.
 *   • Süre hafta sonu / resmî tatile rastlarsa izleyen ilk iş günü (VUK 18).
 *   • GİB sirküler uzatmaları `UZATMALAR` tablosunda (özgün son gün → yeni son gün).
 *
 * Dönem anahtarları: aylık "YYYY-MM", üç aylık "YYYY-Qn" (n=1..4). Tarihler ISO gün "YYYY-MM-DD".
 * Tüm hesaplar takvim günü üzerinden (saat/dilim yok).
 */

export type EDefterTercih = 'AYLIK' | 'UCAYLIK';
export type EDefterMukellefTipi = 'SAHIS' | 'FIRMA';

/** Sirküler uzatmaları: özgün son gün (hafta sonu kaydırması SONRASI) → yeni son gün. Zincir olabilir. */
export const EDEFTER_UZATMALAR: Record<string, { yeni: string; kaynak: string }> = {
  // 2025
  '2025-04-10': { yeni: '2025-04-18', kaynak: 'VUK-186 (09.04.2025)' },
  '2025-05-12': { yeni: '2025-05-16', kaynak: 'GİB duyurusu (02.05.2025)' }, // 10 Mayıs 2025 Cmt → 12 Mayıs
  '2025-05-14': { yeni: '2025-05-16', kaynak: 'GİB duyurusu (02.05.2025)' },
  '2025-06-10': { yeni: '2025-06-16', kaynak: 'VUK-189 (03.06.2025)' },
  '2025-06-16': { yeni: '2025-06-23', kaynak: 'VUK-189 (03.06.2025)' }, // 14 Haziran 2025 Cmt → 16 Haziran
  // 2026
  '2026-05-11': { yeni: '2026-06-10', kaynak: 'VUK-198 (11.05.2026)' }, // 10 Mayıs 2026 Paz → 11 Mayıs
  '2026-05-14': { yeni: '2026-06-15', kaynak: 'VUK-198 (11.05.2026)' },
  '2026-06-10': { yeni: '2026-06-30', kaynak: 'VUK-202 (09.06.2026)' },
  '2026-06-15': { yeni: '2026-06-30', kaynak: 'VUK-202 (09.06.2026)' }, // 14 Haziran 2026 Paz → 15 Haziran
};

// Tatil tablosu ve iş günü kaydırması 2026-09-25'te `resmi-tatil.ts`e taşındı: aynı tablo
// `apps/api/src/schedule/is-gunu.ts` içinde de duruyordu ve kopyalar sapabiliyordu.
// `@mali-musavir/shared` kökü ikisini de dışarı verdiği için içe aktaranlar etkilenmiyor.
import { isoGun, isGununeKaydir } from './resmi-tatil';

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM" ay anahtarına n ay ekler. */
export function ayEkle(ayAnahtari: string, n: number): string {
  const [y, m] = ayAnahtari.split('-').map((x) => parseInt(x, 10));
  const toplam = y * 12 + (m - 1) + n;
  return `${Math.floor(toplam / 12)}-${pad((toplam % 12) + 1)}`;
}

export function ceyrekAnahtari(y: number, q: number): string {
  return `${y}-Q${q}`;
}

/** Dönem anahtarını çözer: aylık {y,m} ya da üç aylık {y,q}. Geçersizse null. */
export function donemCoz(donem: string): { tur: 'AY'; y: number; m: number } | { tur: 'CEYREK'; y: number; q: number } | null {
  let mm = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(donem);
  if (mm) return { tur: 'AY', y: +mm[1], m: +mm[2] };
  mm = /^(\d{4})-Q([1-4])$/.exec(donem);
  if (mm) return { tur: 'CEYREK', y: +mm[1], q: +mm[2] };
  return null;
}

/** Dönemin kapsadığı aylar: "2026-Q2" → ["2026-04","2026-05","2026-06"]; "2026-05" → ["2026-05"]. */
export function donemAylari(donem: string): string[] {
  const c = donemCoz(donem);
  if (!c) return [];
  if (c.tur === 'AY') return [`${c.y}-${pad(c.m)}`];
  const ilk = (c.q - 1) * 3 + 1;
  return [ilk, ilk + 1, ilk + 2].map((m) => `${c.y}-${pad(m)}`);
}

/** Tebliğdeki özgün son gün (kaydırma ve uzatma ÖNCESİ). */
export function tebligSonGunu(donem: string, tercih: EDefterTercih, tip: EDefterMukellefTipi): string | null {
  const c = donemCoz(donem);
  if (!c) return null;
  const gun = tip === 'FIRMA' ? 14 : 10;
  if (c.tur === 'AY') {
    if (tercih !== 'AYLIK') return null;
    if (c.m === 12) return tip === 'FIRMA' ? isoGun(c.y + 1, 5, 14) : isoGun(c.y + 1, 4, 10);
    const hedef = ayEkle(`${c.y}-${pad(c.m)}`, 4);
    const [hy, hm] = hedef.split('-').map((x) => parseInt(x, 10));
    return isoGun(hy, hm, gun);
  }
  if (tercih !== 'UCAYLIK') return null;
  switch (c.q) {
    case 1: return isoGun(c.y, 6, gun);
    case 2: return isoGun(c.y, 9, gun);
    case 3: return isoGun(c.y, 12, gun);
    default: return tip === 'FIRMA' ? isoGun(c.y + 1, 5, 14) : isoGun(c.y + 1, 4, 10);
  }
}

export interface EDefterSonGunBilgisi {
  donem: string;
  tercih: EDefterTercih;
  tip: EDefterMukellefTipi;
  /** Tebliğdeki özgün gün (10/14) */
  tebligTarihi: string;
  /** Hafta sonu/tatil kaydırması + sirküler uzatması işlenmiş GEÇERLİ son gün */
  sonGun: string;
  uzatildi: boolean;
  uzatmaKaynagi: string | null;
}

/** Geçerli son gün: tebliğ günü → iş gününe kaydır → sirküler uzatması (zincirli) → iş gününe kaydır. */
export function eDefterSonGun(donem: string, tercih: EDefterTercih, tip: EDefterMukellefTipi): EDefterSonGunBilgisi | null {
  const teblig = tebligSonGunu(donem, tercih, tip);
  if (!teblig) return null;
  let sonGun = isGununeKaydir(teblig);
  let uzatildi = false;
  let kaynak: string | null = null;
  for (let i = 0; i < 5; i++) {
    const u = EDEFTER_UZATMALAR[sonGun];
    if (!u || u.yeni <= sonGun) break;
    sonGun = isGununeKaydir(u.yeni);
    uzatildi = true;
    kaynak = u.kaynak;
  }
  return { donem, tercih, tip, tebligTarihi: teblig, sonGun, uzatildi, uzatmaKaynagi: kaynak };
}

/** Geçerli son günün ayı ("YYYY-MM") = beyanname takibindeki "verilme dönemi". */
export function eDefterVerilmeAyi(donem: string, tercih: EDefterTercih, tip: EDefterMukellefTipi): string | null {
  const b = eDefterSonGun(donem, tercih, tip);
  return b ? b.sonGun.slice(0, 7) : null;
}

/**
 * Verilme ayında ("YYYY-MM") son günü olan dönemler. Ör. 2026-09 → aylık "2026-05", üç aylık "2026-Q2";
 * 2026-06 → aylık ["2026-01","2026-02"] (uzatma) + üç aylık "2026-Q1"; firma 2026-05 → ["2025-12","2026-01"]…
 * `baslangic` ("YYYY-MM"): e-Defter mükellefiyetinin başladığı ay — öncesindeki dönemler elenir.
 */
export function eDefterAyindaBeklenenDonemler(
  verilmeAy: string,
  tercih: EDefterTercih,
  tip: EDefterMukellefTipi,
  baslangic?: string | null,
): EDefterSonGunBilgisi[] {
  const sonuc: EDefterSonGunBilgisi[] = [];
  const bas = baslangic && /^\d{4}-\d{2}$/.test(baslangic) ? baslangic : null;
  if (tercih === 'AYLIK') {
    for (let geri = 1; geri <= 24; geri++) {
      const donem = ayEkle(verilmeAy, -geri);
      if (bas && donem < bas) continue;
      const b = eDefterSonGun(donem, 'AYLIK', tip);
      if (b && b.sonGun.slice(0, 7) === verilmeAy) sonuc.push(b);
    }
  } else {
    const [vy] = verilmeAy.split('-').map((x) => parseInt(x, 10));
    for (let y = vy - 2; y <= vy; y++) {
      for (let q = 1; q <= 4; q++) {
        const donem = ceyrekAnahtari(y, q);
        const aylar = donemAylari(donem);
        if (bas && aylar[aylar.length - 1] < bas) continue;
        const b = eDefterSonGun(donem, 'UCAYLIK', tip);
        if (b && b.sonGun.slice(0, 7) === verilmeAy) sonuc.push(b);
      }
    }
  }
  return sonuc.sort((a, b) => (a.donem < b.donem ? -1 : 1));
}

/**
 * "Vergi dönemi" görünümü: seçilen ayın dönemi. Aylık → aynı ay; üç aylık → yalnız çeyrek son aylarında (3/6/9/12)
 * o çeyrek, diğer aylarda null (KDV üç aylık ile aynı mantık).
 */
export function eDefterVergiDonemi(vergiAy: string, tercih: EDefterTercih): string | null {
  const [y, m] = vergiAy.split('-').map((x) => parseInt(x, 10));
  if (!y || !m) return null;
  if (tercih === 'AYLIK') return `${y}-${pad(m)}`;
  return m % 3 === 0 ? ceyrekAnahtari(y, m / 3) : null;
}

/**
 * Gece sorgusunda hangi dönemlerin beratları sorgulanır: bu ay ve bir önceki ay son günü olan dönemler
 * (geç yüklemeler de yakalansın). Üç aylık mükellefte yükleme ayı dışında boş döner (Hattat kuralı).
 * Dönüş: e-Defter uygulamasının istediği aylar ("YYYY-MM"), tekrarsız, artan.
 */
export function eDefterGeceSorguAylari(
  bugun: string,
  tercih: EDefterTercih,
  tip: EDefterMukellefTipi,
  baslangic?: string | null,
): string[] {
  const buAy = bugun.slice(0, 7);
  const donemler = [
    ...eDefterAyindaBeklenenDonemler(buAy, tercih, tip, baslangic),
    ...eDefterAyindaBeklenenDonemler(ayEkle(buAy, -1), tercih, tip, baslangic),
  ];
  const aylar = new Set<string>();
  for (const d of donemler) for (const a of donemAylari(d.donem)) aylar.add(a);
  return Array.from(aylar).sort();
}

/** Mükellef türü → e-Defter takvimi tipi. Gerçek kişi = şahıs (10'u), tüzel kişi = firma (14'ü). */
export function eDefterMukellefTipi(taxpayerType: string | null | undefined, incomeTaxType?: string | null): EDefterMukellefTipi {
  if (taxpayerType === 'TUZEL_KISI') return 'FIRMA';
  if (taxpayerType === 'GERCEK_KISI') return 'SAHIS';
  return incomeTaxType === 'KURUMLAR' ? 'FIRMA' : 'SAHIS';
}

const AYLAR_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const CEYREK_TR = ['Oca–Mar', 'Nis–Haz', 'Tem–Eyl', 'Eki–Ara'];

/** "2026-05" → "Mayıs 2026", "2026-Q2" → "Nis–Haz 2026" */
export function eDefterDonemEtiketi(donem: string): string {
  const c = donemCoz(donem);
  if (!c) return donem;
  return c.tur === 'AY' ? `${AYLAR_TR[c.m - 1]} ${c.y}` : `${CEYREK_TR[c.q - 1]} ${c.y}`;
}

// isoGunuBicimle artık resmi-tatil.ts'te; yukarıdaki `export { ... } from` ile aynen dışarı veriliyor.
