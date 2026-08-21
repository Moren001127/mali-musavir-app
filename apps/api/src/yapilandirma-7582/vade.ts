/**
 * VERGİ TÜRÜ + DÖNEM → VADE TARİHİ (SAF — ağ/DB yok).
 *
 * NEDEN GEREKLİ: Seri:B Sıra No:20 tebliği yalnızca **5/6/2026 (dahil) itibarıyla vadesi
 * gelmiş** borçları kapsıyor. GİB'in borç listesinde vade sütunu YOK; yalnız vergi türü
 * kodu ve dönem var. Bu modül aradaki köprüyü kurar.
 *
 * KAYNAK — GİB Vergi Takvimi (2026):
 *   • KDV (aylık)          : dönemi izleyen ayın 28'i
 *   • Muhtasar/MPHB        : dönemi izleyen ayın 26'sı (aylık da 3 aylık da aynı kural)
 *   • Geçici vergi         : dönemi izleyen 2. ayın 17'si
 *                            (2026/1. dönem 17.05.2026 Pazar → 18.05.2026'ya kaydı)
 *   • Yıllık gelir vergisi : izleyen yılın 31 Mart (1. taksit) ve 31 Temmuz (2. taksit)
 *   • Kurumlar vergisi     : izleyen yılın 30 Nisan (tek ödeme)
 *   • MTV                  : ilgili yılın 31 Ocak (1. taksit) ve 31 Temmuz (2. taksit)
 *
 * ⚠️ TÜRETİLEMEYENLER: trafik cezası, geçiş ücreti, usulsüzlük cezası, harçlar, idari para
 *    cezaları… Bunların vadesi TEBLİĞ/İHBARNAME tarihine bağlıdır, dönemden çıkmaz.
 *    Bu modül onlara vade UYDURMAZ; `kesinlik: 'YOK'` döner ve karar kullanıcıya bırakılır.
 *
 * ⚠️ İKİ TAKSİTLİ TÜRLER (MTV, yıllık gelir vergisi) tek satırda geliyor ama taksitleri
 *    5/6/2026 sınırının İKİ YANINA düşebiliyor. Bunlarda `kesinlik: 'KARISIK'` döner;
 *    tutarın ne kadarının kapsama gireceğine kullanıcı karar verir.
 *
 * ⚠️ RESMÎ TATİL KAYMASI HESABA KATILMAZ; yalnız hafta sonu kaydırması yapılır. Sınıra
 *    (5/6/2026) yakın hiçbir standart vade hafta sonu/tatil yüzünden taraf değiştirmiyor
 *    (en yakınları 28/05 ve 28/06), bu yüzden sonucu etkilemez.
 */

export type VadeKesinligi = 'KESIN' | 'TAHMIN' | 'KARISIK' | 'YOK';

export type VadeSonucu = {
  vade: string | null;        // YYYY-MM-DD
  ikinciVade?: string | null; // KARISIK türlerde 2. taksit
  kesinlik: VadeKesinligi;
  not: string;
};

/** Tebliğ kapsam sınırı: bu tarihe kadar (dahil) vadesi gelmiş borçlar. */
export const KAPSAM_SINIRI = '2026-06-05';

/**
 * TÜRKÇE METNİ SADELEŞTİRİR: harfleri ASCII'ye indirger ve küçültür.
 *
 * TUZAK (test 2026-08-21'de yakalandı): `toLocaleLowerCase('tr-TR')` büyük I harfini
 * NOKTASIZ ı yapar. "OZEL TUKETIM" → "ozel tuketım" olur ve "tuketim" kalıbı tutmaz.
 * Bu yüzden kalıp eşleştirmesi ASCII'ye indirgenmiş metin üzerinde yapılır.
 */
export function sadeTr(s: any): string {
  return String(s || '')
    .replace(/[İIı]/g, 'i')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[Üü]/g, 'u')
    .replace(/[Öö]/g, 'o')
    .replace(/[Çç]/g, 'c')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const gun = (y: number, a: number, g: number) => new Date(Date.UTC(y, a - 1, g));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Hafta sonuna denk gelen vade ertesi iş gününe kayar (6183/VUK genel kuralı). */
function isGunu(d: Date): Date {
  const h = d.getUTCDay(); // 0 Pazar, 6 Cumartesi
  if (h === 6) return new Date(d.getTime() + 2 * 86400000);
  if (h === 0) return new Date(d.getTime() + 86400000);
  return d;
}

/** Ayın son gününü verir (31 Ocak, 30 Nisan gibi vadeler için). */
function ayinSonu(y: number, a: number): Date {
  return new Date(Date.UTC(y, a, 0));
}

/** "04/2026-06/2026" → { basY:2026, basA:4, bitY:2026, bitA:6 } */
export function donemCoz(donem: string): { basY: number; basA: number; bitY: number; bitA: number } | null {
  const p = String(donem || '').match(/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{4})/);
  if (p) {
    return { basA: +p[1], basY: +p[2], bitA: +p[3], bitY: +p[4] };
  }
  const tek = String(donem || '').match(/(\d{2})\/(\d{4})/);
  if (tek) return { basA: +tek[1], basY: +tek[2], bitA: +tek[1], bitY: +tek[2] };
  return null;
}

/** Vergi türü metninin başındaki GİB kodu ("0015 GERÇEK USULDE..." → "0015"). */
export function turKodu(vergiTuru: string): string {
  const m = String(vergiTuru || '').trim().match(/^(\d{4})/);
  return m ? m[1] : '';
}

/** Dönem bitişini izleyen N. ayın belirli gününe düşen vade. */
function izleyenAy(bitY: number, bitA: number, kacAy: number, ayinGunu: number): Date {
  const toplam = bitA + kacAy;
  const y = bitY + Math.floor((toplam - 1) / 12);
  const a = ((toplam - 1) % 12) + 1;
  return isGunu(gun(y, a, ayinGunu));
}

/**
 * VADE TESPİTİ.
 * @param vergiTuru GİB listesindeki ham metin ("0015 GERÇEK USULDE KATMA DEĞER VERGİSİ")
 * @param donem     "05/2026-05/2026" biçimi
 */
export function vadeBelirle(vergiTuru: string, donem: string): VadeSonucu {
  const kod = turKodu(vergiTuru);
  const d = donemCoz(donem);

  if (!kod) return { vade: null, kesinlik: 'YOK', not: 'Vergi türü kodu okunamadı' };
  if (!d) {
    return {
      vade: null, kesinlik: 'YOK',
      not: kod === '6183'
        ? 'Hâlihazırda tecilli borç — vadesi mevcut tecil planına bağlı'
        : 'Dönem okunamadı, vade türetilemez',
    };
  }

  switch (kod) {
    // ——— KDV: dönemi izleyen ayın 28'i ———
    case '0015':
      return { vade: iso(izleyenAy(d.bitY, d.bitA, 1, 28)), kesinlik: 'KESIN', not: 'KDV: dönemi izleyen ayın 28’i' };

    // ——— Muhtasar / MPHB: dönemi izleyen ayın 26'sı ———
    case '0003':
      return { vade: iso(izleyenAy(d.bitY, d.bitA, 1, 26)), kesinlik: 'KESIN', not: 'Muhtasar: dönemi izleyen ayın 26’sı' };

    // ——— Geçici vergi: dönemi izleyen 2. ayın 17'si ———
    case '0032':
    case '0033':
      return {
        vade: iso(izleyenAy(d.bitY, d.bitA, 2, 17)),
        kesinlik: 'KESIN',
        not: 'Geçici vergi: dönemi izleyen 2. ayın 17’si',
      };

    // ——— Yıllık gelir vergisi: izleyen yıl 31 Mart + 31 Temmuz ———
    case '0001': {
      const y = d.bitY + 1;
      return {
        vade: iso(isGunu(ayinSonu(y, 3))),
        ikinciVade: iso(isGunu(ayinSonu(y, 7))),
        kesinlik: 'KARISIK',
        not: `Yıllık gelir vergisi ${d.bitY}: 1. taksit 31.03.${y}, 2. taksit 31.07.${y} — tek satırda geldiği için ayrım kullanıcıya ait`,
      };
    }

    // ——— Kurumlar vergisi: izleyen yıl 30 Nisan (tek ödeme) ———
    case '0010': {
      const y = d.bitY + 1;
      return { vade: iso(isGunu(ayinSonu(y, 4))), kesinlik: 'KESIN', not: `Kurumlar vergisi ${d.bitY}: 30.04.${y}` };
    }

    // ——— MTV ve ek MTV: ilgili yıl 31 Ocak + 31 Temmuz ———
    case '9034':
    case '9434': {
      const y = d.bitY;
      return {
        vade: iso(isGunu(ayinSonu(y, 1))),
        ikinciVade: iso(isGunu(ayinSonu(y, 7))),
        kesinlik: 'KARISIK',
        not: `MTV ${y}: 1. taksit 31.01.${y}, 2. taksit 31.07.${y} — tek satırda geldiği için ayrım kullanıcıya ait`,
      };
    }

    // ——— Vadesi tebliğ/ihbarname tarihine bağlı olanlar: TÜRETİLEMEZ ———
    default:
      return {
        vade: null,
        kesinlik: 'YOK',
        not: 'Vadesi tebliğ/ihbarname tarihine bağlı (ceza, harç, geçiş ücreti vb.) — dönemden türetilemez',
      };
  }
}

export type KapsamDurumu = 'ICINDE' | 'DISINDA' | 'KISMEN' | 'BELIRSIZ';

/**
 * BORÇ SATIRI TEBLİĞ KAPSAMINDA MI?
 *
 * İKİ AYRI ELEME VAR, ikisi de geçilmeli:
 *  1. VADE: 5/6/2026 (dahil) itibarıyla gelmiş olmalı.
 *  2. TÜR : ÖTV ve **2026 yılı gelir/kurumlar vergisine mahsup edilecek geçici vergi**
 *           vadesi uygun olsa bile kapsam dışıdır.
 *
 * Vade türetilemiyorsa "BELİRSİZ" döner — kapsamda VARSAYILMAZ.
 */
export function kapsamDurumu(vergiTuru: string, donem: string): {
  durum: KapsamDurumu;
  vade: VadeSonucu;
  not: string;
} {
  const kod = turKodu(vergiTuru);
  const d = donemCoz(donem);
  const v = vadeBelirle(vergiTuru, donem);

  // ÖTV: tebliğ metninde açıkça hariç.
  if (sadeTr(vergiTuru).includes('ozel tuketim')) {
    return { durum: 'DISINDA', vade: v, not: 'ÖTV tebliğ kapsamı dışında' };
  }

  // 2026 yılına ait geçici vergi: gelir/kurumlar vergisine MAHSUP EDİLECEĞİ için hariç.
  //   2025 ve öncesi geçici vergide mahsup zaten yapılmıştır; o borçlar kapsama girer.
  if ((kod === '0032' || kod === '0033') && d && d.bitY >= 2026) {
    return {
      durum: 'DISINDA', vade: v,
      not: '2026 yılı gelir/kurumlar vergisine mahsup edilecek geçici vergi — tebliğ kapsamı dışında',
    };
  }

  if (v.kesinlik === 'YOK') {
    return { durum: 'BELIRSIZ', vade: v, not: v.not };
  }

  if (v.kesinlik === 'KARISIK') {
    const ilk = (v.vade || '') <= KAPSAM_SINIRI;
    const ikinci = (v.ikinciVade || '') <= KAPSAM_SINIRI;
    if (ilk && ikinci) return { durum: 'ICINDE', vade: v, not: 'Her iki taksitin de vadesi geçmiş' };
    if (!ilk && !ikinci) return { durum: 'DISINDA', vade: v, not: 'Her iki taksitin de vadesi 5/6/2026’dan sonra' };
    return {
      durum: 'KISMEN', vade: v,
      not: `1. taksit (${v.vade}) kapsamda, 2. taksit (${v.ikinciVade}) kapsam dışı — tutarın bölünmesi gerekir`,
    };
  }

  const icinde = (v.vade || '') <= KAPSAM_SINIRI;
  return {
    durum: icinde ? 'ICINDE' : 'DISINDA',
    vade: v,
    not: icinde ? `Vade ${v.vade} — kapsamda` : `Vade ${v.vade} — 5/6/2026’dan sonra, kapsam dışı`,
  };
}
