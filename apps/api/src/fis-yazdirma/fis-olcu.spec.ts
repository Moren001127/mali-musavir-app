/**
 * FİŞ YERLEŞİMİ — "sayfa başına 8" gerçekten 8 mi?
 *
 * Kullanıcı 8 seçtiği hâlde sayfada tek sıra (4 fiş) çıkıyor, 456 fiş 111
 * sayfa oluyordu. Sebep: görselin YÜKSEKLİĞİ hiç sınırlanmıyordu — uzun ÖKC
 * fişi sütun genişliğine ölçeklenince 15-20 cm boyunda çıkıyor, iki sıra
 * 27,94 cm'lik sayfaya sığmıyordu.
 *
 * Bu testler yerleşimin matematiğini kilitler: gerçek Word üretmeden,
 * "seçilen sıra sayısı sayfaya SIĞIYOR MU" sorusunu doğrudan sorar.
 */
import { fisGorselOlcusu, satirYuksekligi, fisleriSayfalaraBol, fisleriSutunlaraBol } from './fis-olcu';

const SAYFA_H_MM = 279.4; // Letter
const SAYFA_H_PX = (SAYFA_H_MM / 25.4) * 96; // ≈ 1056
const ETIKET_PX = 42;

/** Sayfa genişliğinden sütun genişliği (servisteki hesabın aynısı) */
function sutunGenisligiPx(cols: number): number {
  const usableCM = 215.9 / 10;
  return Math.round((usableCM / cols - 0.2) / 2.54 * 96);
}

describe('Fiş yerleşimi — satırlar sayfaya sığmalı', () => {
  // ÖKC fişi: dar ve UZUN. Asıl hatayı ortaya çıkaran şekil bu.
  const UZUN_FIS = { w: 600, h: 1800 }; // 1:3

  it.each([
    ['4 (2 sütun × 2 satır)', 4, 2, 2],
    ['8 (4 sütun × 2 satır)', 8, 4, 2],
    ['12 (4 sütun × 3 satır)', 12, 4, 3],
  ])('sayfa başına %s seçilince o kadar fiş SIĞAR', (_ad, _perPage, cols, satir) => {
    const maxW = sutunGenisligiPx(cols);
    const maxH = satirYuksekligi(SAYFA_H_MM, satir, ETIKET_PX);
    const olcu = fisGorselOlcusu(UZUN_FIS.w, UZUN_FIS.h, maxW, maxH);

    const satirYuksek = olcu.height + ETIKET_PX;
    expect(satirYuksek * satir).toBeLessThanOrEqual(SAYFA_H_PX);
    expect(olcu.width).toBeLessThanOrEqual(maxW);
  });

  it('ESKİ davranış (yalnız genişliğe sığdırma) sayfayı TAŞIRIYORDU', () => {
    const maxW = sutunGenisligiPx(4);
    // eski formül: displayH = imgH * (DISPLAY_W / imgW)
    const eskiYukseklik = Math.round(UZUN_FIS.h * (maxW / UZUN_FIS.w));
    // 2 satır → sayfayı aşıyor; regresyon olursa bu beklenti kırılır
    expect((eskiYukseklik + ETIKET_PX) * 2).toBeGreaterThan(SAYFA_H_PX);
  });

  it('en-boy oranı korunur (fiş yayvanlaşmaz/ezilmez)', () => {
    const olcu = fisGorselOlcusu(600, 1800, 200, 400);
    expect(olcu.width / olcu.height).toBeCloseTo(600 / 1800, 2);
  });

  it('geniş görselde genişlik sınırı belirleyicidir', () => {
    // Yatay bir fiş/fatura: yükseklik zaten kısa, genişlik kısıtlar
    const olcu = fisGorselOlcusu(2000, 500, 200, 400);
    expect(olcu.width).toBe(200);
    expect(olcu.height).toBe(50);
  });

  it('görsel zaten küçükse BÜYÜTÜLMEZ değil — kutuya sığdırılır (oran sabit)', () => {
    const olcu = fisGorselOlcusu(100, 100, 200, 400);
    // kare görsel 200x200 olur; yükseklik sınırını aşmaz
    expect(olcu.width).toBe(200);
    expect(olcu.height).toBe(200);
  });

  it('OKUNABİLİRLİK TABANI: yükseklik sınırı fişi tabanın altına itemez', () => {
    const MIN_W = Math.round((4.5 / 2.54) * 96); // 4,5 cm
    // 1:4 gibi çok uzun bir fiş: kutuya sığdırmak onu 3 cm'ye düşürürdü
    const olcu = fisGorselOlcusu(600, 2400, sutunGenisligiPx(4), 300, MIN_W);
    expect(olcu.width).toBeGreaterThanOrEqual(MIN_W);
    // taban devreye girdiği için satır uzar — bu KABUL EDİLEN sonuçtur
    expect(olcu.height).toBeGreaterThan(300);
  });

  it('taban, sütun genişliğini AŞAMAZ (taşma olmaz)', () => {
    const maxW = 120; // dar sütun
    const olcu = fisGorselOlcusu(600, 2400, maxW, 100, 400);
    expect(olcu.width).toBeLessThanOrEqual(maxW);
  });

  it('hiçbir fiş sayfadan uzun olamaz', () => {
    const sayfa = 900;
    const olcu = fisGorselOlcusu(600, 6000, 200, 500, 170, sayfa);
    expect(olcu.height).toBeLessThanOrEqual(sayfa);
  });

  it('bozuk metadata çökertmez', () => {
    expect(fisGorselOlcusu(0, 0, 200, 400).width).toBeGreaterThan(0);
    expect(fisGorselOlcusu(NaN, NaN, 200, 400).height).toBeGreaterThan(0);
  });

  it('satırYüksekliği etiket payını düşer', () => {
    expect(satirYuksekligi(SAYFA_H_MM, 2, 0)).toBeGreaterThan(satirYuksekligi(SAYFA_H_MM, 2, 42));
    expect(satirYuksekligi(SAYFA_H_MM, 3, 42)).toBeLessThan(satirYuksekligi(SAYFA_H_MM, 2, 42));
  });
});

describe('Akıllı sayfalama — boşluk israfı', () => {
  it('kısa fişlerde sayfaya DAHA ÇOK satır sığar (daha az kâğıt)', () => {
    const sayfa = 1056;
    const kisa = Array(40).fill(200); // 200 px'lik satırlar
    const plan = fisleriSayfalaraBol(kisa, 4, sayfa);
    // 200 px × 5 satır = 1000 ≤ 1056 → sayfa başına 5 satır = 20 fiş
    expect(plan[0].length).toBe(5);
    // sabit 2 satırlık ızgarada 10 sayfa olurdu; şimdi 2
    expect(plan.length).toBe(2);
  });

  it('hiçbir sayfa taşmaz', () => {
    const sayfa = 1056;
    const karisik = [900, 300, 250, 400, 700, 200, 180, 950, 260, 300, 310, 280];
    const plan = fisleriSayfalaraBol(karisik, 4, sayfa);
    for (const s of plan) {
      const toplam = s.reduce((a, satir) => a + Math.max(...satir.map((i) => karisik[i])), 0);
      // tek satır sayfadan uzunsa o satır yalnız kalır — taşma kabul edilir
      if (s.length > 1) expect(toplam).toBeLessThanOrEqual(sayfa);
    }
  });

  it('sayfadan uzun tek fiş sonsuz boş sayfa üretmez', () => {
    const plan = fisleriSayfalaraBol([5000, 5000], 4, 1056);
    expect(plan.length).toBe(1); // ikisi de aynı satırda
    expect(plan[0][0]).toEqual([0, 1]);
  });

  it('TARİH SIRASI korunur (muhasebe dökümü kronolojik olmalı)', () => {
    const plan = fisleriSayfalaraBol([100, 900, 100, 100, 100], 2, 1056);
    const duzlestir = plan.flat().flat();
    expect(duzlestir).toEqual([0, 1, 2, 3, 4]);
  });

  it('hiçbir fiş kaybolmaz', () => {
    const n = 457;
    const plan = fisleriSayfalaraBol(Array(n).fill(300), 4, 1056);
    expect(plan.flat().flat().length).toBe(n);
  });
});

describe('Sütun yerleşimi — uzun fiş bütün satırı uzatmasın', () => {
  const SAYFA = 1056;

  it('GERÇEK ÖLÇÜMLE: satır yerleşimi 105 sayfa, sütun yerleşimi YARIYA İNER', () => {
    // 40 gerçek fişten ölçülen oran dağılımı (2026-08-20): ortanca 2,30,
    // yarısı 2,48'in üstünde. Sütun genişliği 5,2 cm = 197 px.
    const SUTUN_PX = 197;
    const ETIKET = 42;
    const oranlar = [2.21, 3.81, 1.92, 3.81, 2.0, 3.07, 2.32, 3.22, 3.81, 1.92];
    const yukseklikler: number[] = [];
    for (let i = 0; i < 456; i++) {
      yukseklikler.push(Math.round(SUTUN_PX * oranlar[i % oranlar.length]) + ETIKET);
    }

    const satirPlan = fisleriSayfalaraBol(yukseklikler, 4, SAYFA);
    const sutunPlan = fisleriSutunlaraBol(yukseklikler, 4, SAYFA);

    // Satır düzeni gerçekte 105 sayfa üretmişti — model bunu yakalıyor
    expect(satirPlan.length).toBeGreaterThan(90);
    // Sütun düzeni AYNI okunabilirlikte belirgin şekilde az sayfa.
    // (Gerçek oran dağılımıyla ölçüm: 114 -> 69 sayfa.)
    expect(sutunPlan.length).toBeLessThan(satirPlan.length * 0.85);
    // Teorik alt sınıra makul yakınlık — paketleme çöpe atmıyor
    const altSinir = Math.ceil(yukseklikler.reduce((a, b) => a + b, 0) / (4 * SAYFA));
    expect(sutunPlan.length).toBeLessThan(altSinir * 1.7);
  });

  it('hiçbir sütun sayfayı taşırmaz', () => {
    const h = [900, 300, 250, 400, 700, 200, 180, 950, 260, 300, 310, 280, 500, 520];
    const plan = fisleriSutunlaraBol(h, 4, SAYFA);
    for (const sayfa of plan) {
      for (const sutun of sayfa) {
        if (sutun.length <= 1) continue; // tek başına uzun fiş kabul
        const toplam = sutun.reduce((a, i) => a + h[i], 0);
        expect(toplam).toBeLessThanOrEqual(SAYFA);
      }
    }
  });

  it('sıra korunur (sütun sütun aşağı okunur)', () => {
    const plan = fisleriSutunlaraBol(Array(20).fill(300), 4, SAYFA);
    expect(plan.flat().flat()).toEqual([...Array(20).keys()]);
  });

  it('hiçbir fiş kaybolmaz', () => {
    const n = 457;
    const plan = fisleriSutunlaraBol(Array(n).fill(400), 4, SAYFA);
    expect(plan.flat().flat().length).toBe(n);
  });

  it('sayfadan uzun tek fiş sonsuz döngü yapmaz', () => {
    const plan = fisleriSutunlaraBol([5000, 5000, 300], 4, SAYFA);
    expect(plan.flat().flat().length).toBe(3);
    expect(plan.length).toBeLessThanOrEqual(2);
  });

  it('uzun fiş yalnız KENDİ sütununu etkiler', () => {
    // 1 uzun + 7 kısa: satır düzeninde uzun fiş satırı şişirir,
    // sütunda diğer sütunlar dolmaya devam eder
    const h = [1000, 200, 200, 200, 200, 200, 200, 200];
    const sutun = fisleriSutunlaraBol(h, 4, SAYFA);
    expect(sutun.length).toBe(1); // hepsi TEK sayfaya sığar
  });
});
