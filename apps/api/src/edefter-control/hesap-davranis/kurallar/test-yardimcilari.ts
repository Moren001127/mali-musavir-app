// Test yardimcilari (spec dosyalari paylasir; testRegex'e girmez).
import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import type { MizanBaglami } from '../tipler';

export const d = (v: string) => new Date(`${v}T00:00:00.000Z`);
export const Q2 = { start: d('2026-04-01'), end: d('2026-06-30') };
export const YIL = { start: d('2026-01-01'), end: d('2026-12-31') };

let sayac = 0;
export function satir(o: Partial<ParsedEDefterFisLine>): ParsedEDefterFisLine {
  sayac += 1;
  return {
    rowIndex: sayac,
    voucherKey: `v${sayac}`,
    fisNo: String(sayac),
    yevmiyeNo: String(sayac),
    fisTarihi: d('2026-04-15'),
    fisTipi: null,
    evrakNo: `E${sayac}`,
    evrakTarihi: null,
    belgeTuru: null,
    hesapKodu: '100.01.001',
    hesapAdi: 'KASA',
    aciklama: 'islem',
    karsiHesap: null,
    vknTckn: null,
    borc: 0,
    alacak: 0,
    rawData: {},
    ...o,
  };
}

// Satis faturasi: 120 borc / 600 + 391 alacak
export function satisFaturasi(key: string, tarih: string, cari: string, ad: string, matrah: number, kdv = matrah * 0.2) {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: cari, hesapAdi: ad, borc: matrah + kdv }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '600.01.001', hesapAdi: 'SATISLAR', alacak: matrah }),
    ...(kdv > 0 ? [satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '391.01.001', hesapAdi: 'HESAPLANAN KDV', alacak: kdv })] : []),
  ];
}
// Tahsilat: 102 borc / 120 alacak
export function tahsilat(key: string, tarih: string, cari: string, ad: string, tutar: number, para = '102.01.001') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: para, hesapAdi: para.startsWith('100') ? 'KASA' : 'BANKA', borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: cari, hesapAdi: ad, alacak: tutar }),
  ];
}
// Alis faturasi: 153 + 191 borc / 320 alacak
export function alisFaturasi(key: string, tarih: string, cari: string, ad: string, matrah: number, stok = '153.01.001', kdvOran = 0.2) {
  const kdv = matrah * kdvOran;
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: stok, hesapAdi: 'TICARI MALLAR', borc: matrah }),
    ...(kdv > 0 ? [satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '191.01.001', hesapAdi: 'INDIRILECEK KDV', borc: kdv })] : []),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: cari, hesapAdi: ad, alacak: matrah + kdv }),
  ];
}
// Gider faturasi: 7xx + 191 borc / 320 alacak
export function giderFaturasi(key: string, tarih: string, giderHesap: string, giderAd: string, matrah: number, aciklama = 'gider', cari = '320.01.G001', kdvOran = 0.2) {
  const kdv = matrah * kdvOran;
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: giderHesap, hesapAdi: giderAd, aciklama, borc: matrah }),
    ...(kdv > 0 ? [satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '191.01.001', hesapAdi: 'INDIRILECEK KDV', aciklama, borc: kdv })] : []),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: cari, hesapAdi: 'SATICI', aciklama, alacak: matrah + kdv }),
  ];
}
// Odeme: cari borc / 102 alacak
export function odeme(key: string, tarih: string, hesap: string, ad: string, tutar: number, para = '102.01.001') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: hesap, hesapAdi: ad, borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: para, hesapAdi: para.startsWith('100') ? 'KASA' : 'BANKA', alacak: tutar }),
  ];
}
export const bankaOdeme = odeme;

// KDV tahakkuku: 391 borc / 191 alacak / 360 alacak (odenecek) ya da 190 borc (devreden)
export function kdvTahakkuk(key: string, tarih: string, hesaplanan: number, indirilecek: number) {
  const fark = hesaplanan - indirilecek;
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '391.01.001', hesapAdi: 'HESAPLANAN KDV', aciklama: 'KDV tahakkuk', borc: hesaplanan }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '191.01.001', hesapAdi: 'INDIRILECEK KDV', aciklama: 'KDV tahakkuk', alacak: indirilecek }),
    fark >= 0
      ? satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '360.01.001', hesapAdi: 'ODENECEK KDV', aciklama: 'KDV tahakkuk', alacak: fark })
      : satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '190.01.001', hesapAdi: 'DEVREDEN KDV', aciklama: 'KDV tahakkuk', borc: -fark }),
  ];
}

// Bordro fisi: 740 borc brut+isveren, 335 net, 361 SGK, 360 GV, (361 borc tesvik / 602 alacak)
export function bordroFisi(key: string, tarih: string, brut = 100_000, net = 70_000, sgk = 25_000, gv = 5_000, tesvik = 3_000) {
  const rows = [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '740.02.001', hesapAdi: 'PERSONEL GIDERI', aciklama: 'Personel fisi', borc: brut }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '335.01.001', hesapAdi: 'PERSONELE BORCLAR', aciklama: 'Personel fisi', alacak: net }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '361.01.001', hesapAdi: 'SSK PRIMI', aciklama: 'Personel fisi', alacak: sgk }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '360.01.003', hesapAdi: 'GELIR VERGISI', aciklama: 'Personel fisi', alacak: gv }),
  ];
  if (tesvik > 0) {
    rows.push(satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '361.01.001', hesapAdi: 'SSK PRIMI', aciklama: 'Personel fisi', borc: tesvik }));
    rows.push(satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '602.01.001', hesapAdi: 'SGK TESVIKI', aciklama: 'Personel fisi', alacak: tesvik }));
  }
  return rows;
}

// Mizan baglami: kod → bakiye (borc pozitif, alacak negatif); istege bagli toplam/ad
export function mizan(kayitlar: Record<string, number | { bakiye: number; borc?: number; alacak?: number; ad?: string }>): MizanBaglami {
  const bakiyeByCode = new Map<string, number>();
  const toplamByCode = new Map<string, { borc: number; alacak: number; ad: string }>();
  for (const [kod, raw] of Object.entries(kayitlar)) {
    const v = typeof raw === 'number' ? { bakiye: raw } : raw;
    bakiyeByCode.set(kod, v.bakiye);
    toplamByCode.set(kod, { borc: v.borc ?? Math.max(v.bakiye, 0), alacak: v.alacak ?? Math.max(-v.bakiye, 0), ad: v.ad || kod });
  }
  return { found: true, bakiyeByCode, toplamByCode };
}
