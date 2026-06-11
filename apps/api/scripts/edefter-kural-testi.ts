/**
 * e-Defter ön kontrol modülü kural regresyon testi (TÜM AKTİF kurallar).
 * Her kural için tetikleyici sentetik senaryo + "temiz defter" negatif kontrolü.
 * Çalıştır (apps/api içinden): npx ts-node -T scripts/edefter-kural-testi.ts
 * Beklenen çıktı: "SONUÇ: 49 geçti, 0 kaldı."
 */
import 'reflect-metadata';
import { EDefterControlService } from '../src/edefter-control/edefter-control.service';
import { ParsedEDefterFisLine } from '../src/edefter-control/edefter-fis-listesi-parser.service';

const svc: any = new (EDefterControlService as any)(null, null, null);
const Q1 = svc.donemToRange('2026-Q1', 'GECICI_Q1');
const YIL = svc.donemToRange('2025', 'YILLIK');

let idx = 0;
function satir(p: Partial<ParsedEDefterFisLine>): ParsedEDefterFisLine {
  idx += 1;
  return {
    rowIndex: idx,
    voucherKey: p.voucherKey || 'V' + idx,
    fisNo: p.fisNo ?? null,
    yevmiyeNo: p.yevmiyeNo ?? (p.voucherKey || 'V' + idx),
    fisTarihi: p.fisTarihi !== undefined ? p.fisTarihi : new Date(Date.UTC(2026, 1, 4)),
    fisTipi: p.fisTipi || 'MAHSUP',
    evrakNo: p.evrakNo ?? null,
    evrakTarihi: p.evrakTarihi ?? null,
    belgeTuru: p.belgeTuru ?? null,
    hesapKodu: p.hesapKodu ?? '',
    hesapAdi: p.hesapAdi || '',
    aciklama: p.aciklama || '',
    karsiHesap: null,
    vknTckn: p.vknTckn ?? null,
    borc: p.borc || 0,
    alacak: p.alacak || 0,
    rawData: null,
  } as ParsedEDefterFisLine;
}
const D = (y: number, m: number, g: number) => new Date(Date.UTC(y, m - 1, g));

type Senaryo = {
  ad: string;
  beklenen: string; // kategori
  beklenmeyenMi?: boolean; // true ise kategori OLMAMALI
  seviye?: string;
  donemTipi: 'GECICI_Q1' | 'YILLIK';
  rows: ParsedEDefterFisLine[];
};

const senaryolar: Senaryo[] = [];
function ekle(ad: string, beklenen: string, donemTipi: 'GECICI_Q1' | 'YILLIK', mk: () => ParsedEDefterFisLine[], seviye?: string, beklenmeyenMi?: boolean) {
  idx = 0;
  senaryolar.push({ ad, beklenen, donemTipi, rows: mk(), seviye, beklenmeyenMi });
}

// ── 1-3: satır/fiş bütünlüğü ─────────────────────────────────
ekle('Hesap kodu boş satır', 'HESAP_KODU_EKSIK', 'GECICI_Q1', () => [
  satir({ hesapKodu: '', borc: 100 }),
]);
ekle('Dönem dışı fiş tarihi (Mayıs, Q1 defterinde)', 'DONEM_DISI_TARIH', 'GECICI_Q1', () => [
  satir({ hesapKodu: '100.01', fisTarihi: D(2026, 5, 5), borc: 100 }),
]);
ekle('Dengesiz fiş (borç 100 / alacak 90)', 'FIS_DENGESIZ', 'GECICI_Q1', () => [
  satir({ voucherKey: 'F1', yevmiyeNo: '10', hesapKodu: '100.01', borc: 100 }),
  satir({ voucherKey: 'F1', yevmiyeNo: '10', hesapKodu: '320.01', alacak: 90 }),
]);
ekle('Defter geneli dengesiz', 'DEFTER_GENELI_DENGESIZ', 'GECICI_Q1', () => [
  satir({ hesapKodu: '100.01', borc: 100 }),
]);
ekle('Boş fiş (tüm satırlar 0)', 'BOS_FIS', 'GECICI_Q1', () => [
  satir({ voucherKey: 'B1', yevmiyeNo: '7', hesapKodu: '100.01', borc: 0 }),
  satir({ voucherKey: 'B1', yevmiyeNo: '7', hesapKodu: '320.01', alacak: 0 }),
]);
ekle('Tek satırlı fiş', 'TEK_SATIRLI_FIS', 'GECICI_Q1', () => [
  satir({ voucherKey: 'T1', yevmiyeNo: '8', hesapKodu: '100.01', borc: 100 }),
]);
ekle('Tarih okunamayan satır', 'FIS_TARIHI_PARSE_HATASI', 'GECICI_Q1', () => [
  satir({ hesapKodu: '100.01', fisTarihi: null as any, borc: 100 }),
]);

// ── KDV ──────────────────────────────────────────────────────
ekle('Şubat 191 var, hiç tahakkuk yok', 'KDV_TAHAKKUK_EKSIK', 'GECICI_Q1', () => [
  satir({ voucherKey: 'A1', hesapKodu: '153.01', fisTarihi: D(2026, 2, 2), borc: 1000 }),
  satir({ voucherKey: 'A1', hesapKodu: '191.01', fisTarihi: D(2026, 2, 2), borc: 200 }),
  satir({ voucherKey: 'A1', hesapKodu: '320.01', fisTarihi: D(2026, 2, 2), alacak: 1200 }),
]);
ekle('Havada KDV (191/391 var, matrah-cari yok)', 'HAVADA_KDV_KAYDI', 'GECICI_Q1', () => [
  satir({ voucherKey: 'H1', hesapKodu: '191.01', hesapAdi: 'INDIRILECEK KDV', borc: 100 }),
  satir({ voucherKey: 'H1', hesapKodu: '391.01', hesapAdi: 'HESAPLANAN KDV', alacak: 100 }),
]);

// ── Kasa / tevsik ────────────────────────────────────────────
ekle('Günlük kasa 40.000 TL (banka bacağı yok)', 'KASA_GUNLUK_30000_TEVSIK_RISKI', 'GECICI_Q1', () => [
  satir({ voucherKey: 'K1', hesapKodu: '100.01', fisTarihi: D(2026, 2, 5), borc: 20000 }),
  satir({ voucherKey: 'K1', hesapKodu: '600.01', fisTarihi: D(2026, 2, 5), alacak: 20000 }),
  satir({ voucherKey: 'K2', hesapKodu: '100.01', fisTarihi: D(2026, 2, 5), borc: 20000 }),
  satir({ voucherKey: 'K2', hesapKodu: '600.01', fisTarihi: D(2026, 2, 5), alacak: 20000 }),
]);
ekle('Aynı gün aynı VKN 2 parça kasa toplam 32.000', 'KASA_TEVSIK_PARCALAMA', 'GECICI_Q1', () => [
  satir({ voucherKey: 'P1', hesapKodu: '100.01', fisTarihi: D(2026, 2, 6), vknTckn: '1234567890', borc: 16000 }),
  satir({ voucherKey: 'P1', hesapKodu: '600.01', fisTarihi: D(2026, 2, 6), alacak: 16000 }),
  satir({ voucherKey: 'P2', hesapKodu: '100.01', fisTarihi: D(2026, 2, 6), vknTckn: '1234567890', borc: 16000 }),
  satir({ voucherKey: 'P2', hesapKodu: '600.01', fisTarihi: D(2026, 2, 6), alacak: 16000 }),
]);

// ── Belge tarihleri ──────────────────────────────────────────
ekle('Belge tarihi fiş tarihinden sonra', 'BELGE_TARIHI_FIS_TARIHINDEN_SONRA', 'GECICI_Q1', () => [
  satir({ hesapKodu: '153.01', fisTarihi: D(2026, 2, 2), evrakTarihi: D(2026, 2, 10), borc: 100 }),
]);
ekle('Belge tarihi dönem bitişinden sonra', 'BELGE_TARIHI_DONEM_DISI', 'GECICI_Q1', () => [
  satir({ hesapKodu: '153.01', fisTarihi: D(2026, 3, 20), evrakTarihi: D(2026, 4, 15), borc: 100 }),
]);

// ── Yevmiye numaralama ───────────────────────────────────────
ekle('Yevmiye no mükerrer (farklı tarih/fiş)', 'YEVMIYE_NO_MUKERRER', 'GECICI_Q1', () => [
  satir({ voucherKey: 'Y1', yevmiyeNo: '5', hesapKodu: '100.01', fisTarihi: D(2026, 2, 3), borc: 10 }),
  satir({ voucherKey: 'Y2', yevmiyeNo: '5', hesapKodu: '100.01', fisTarihi: D(2026, 2, 9), borc: 10 }),
]);
ekle('Yevmiye no atlama (1,2,5)', 'YEVMIYE_NO_ATLAMA', 'GECICI_Q1', () => [
  satir({ voucherKey: 'Y1', yevmiyeNo: '1', hesapKodu: '100.01', borc: 10 }),
  satir({ voucherKey: 'Y2', yevmiyeNo: '2', hesapKodu: '100.01', borc: 10 }),
  satir({ voucherKey: 'Y3', yevmiyeNo: '5', hesapKodu: '100.01', borc: 10 }),
]);
ekle('Yevmiye tarih sırası bozuk', 'YEVMIYE_TARIH_SIRASI', 'GECICI_Q1', () => [
  satir({ voucherKey: 'Y1', yevmiyeNo: '1', hesapKodu: '100.01', fisTarihi: D(2026, 2, 10), borc: 10 }),
  satir({ voucherKey: 'Y2', yevmiyeNo: '2', hesapKodu: '100.01', fisTarihi: D(2026, 2, 5), borc: 10 }),
]);

// ── VKN / mükerrer ───────────────────────────────────────────
ekle('VKN format hatalı (5 hane)', 'VKN_FORMAT_HATALI', 'GECICI_Q1', () => [
  satir({ hesapKodu: '320.01', vknTckn: '12345', alacak: 100 }),
]);
ekle('VKN algoritması tutmayan (1234567891)', 'VKN_ALGORITMA_HATALI', 'GECICI_Q1', () => [
  satir({ hesapKodu: '320.01', vknTckn: '1234567891', alacak: 100 }),
]);
ekle('Gerçek mükerrer fatura (belge+VKN+tutar 2 fişte)', 'GERCEK_MUKERRER_FATURA', 'GECICI_Q1', () => [
  satir({ voucherKey: 'M1', hesapKodu: '153.01', evrakNo: 'FT2026000123', vknTckn: '1234567890', borc: 1000 }),
  satir({ voucherKey: 'M2', hesapKodu: '153.01', evrakNo: 'FT2026000123', vknTckn: '1234567890', borc: 1000 }),
]);
ekle('Aynı gün aynı tutar aynı taraf (60.000 TL x2)', 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF', 'GECICI_Q1', () => [
  satir({ voucherKey: 'G1', hesapKodu: '600.01', fisTarihi: D(2026, 2, 10), vknTckn: '1234567890', alacak: 60000 }),
  satir({ voucherKey: 'G2', hesapKodu: '600.01', fisTarihi: D(2026, 2, 10), vknTckn: '1234567890', alacak: 60000 }),
]);

// ── Cari / banka / diğer bakiyeler ───────────────────────────
ekle('120 ters (alacak) bakiye', 'CARI_TERS_BAKIYE_120', 'GECICI_Q1', () => [
  satir({ hesapKodu: '120.01', alacak: 6000 }),
]);
ekle('320 ters (borç) bakiye', 'CARI_TERS_BAKIYE_320', 'GECICI_Q1', () => [
  satir({ hesapKodu: '320.01', borc: 6000 }),
]);
ekle('102 banka eksi bakiye', 'BANKA_EKSI_BAKIYE_102', 'GECICI_Q1', () => [
  satir({ hesapKodu: '102.01', alacak: 5000 }),
]);
ekle('108 POS bakiyesi', 'POS_VALOR_108_BAKIYE', 'GECICI_Q1', () => [
  satir({ hesapKodu: '108.01', borc: 6000 }),
]);
ekle('689 KKEG hareketi', 'KKEG_689_KONTROL', 'GECICI_Q1', () => [
  satir({ hesapKodu: '689.01', borc: 2000 }),
]);
ekle('131 ortaklardan alacak 150.000', 'ORTAK_ALACAK_FAIZ_RISKI', 'GECICI_Q1', () => [
  satir({ hesapKodu: '131.01', borc: 150000 }),
]);
ekle('159 avans kapanmamış', 'AVANS_KAPANMAMIS_159', 'GECICI_Q1', () => [
  satir({ hesapKodu: '159.01', borc: 20000 }),
]);
ekle('340 avans kapanmamış', 'AVANS_KAPANMAMIS_340', 'GECICI_Q1', () => [
  satir({ hesapKodu: '340.01', alacak: 20000 }),
]);
ekle('121 çek/senet bakiyesi', 'CEK_SENET_BAKIYE_121', 'GECICI_Q1', () => [
  satir({ hesapKodu: '121.01', borc: 2000 }),
]);
ekle('Yüksek tutar açıklamasız (60.000)', 'YUKSEK_TUTAR_ACIKLAMA_EKSIK', 'GECICI_Q1', () => [
  satir({ hesapKodu: '102.01', borc: 60000, aciklama: '' }),
]);

// ── Bordro / stopaj ──────────────────────────────────────────
ekle('Bordro: 335 var 361 yok', 'BORDRO_TAHAKKUK_EKSIK', 'GECICI_Q1', () => [
  satir({ voucherKey: 'BR1', hesapKodu: '770.01', fisTarihi: D(2026, 2, 28), aciklama: 'Subat maas bordro', borc: 10000 }),
  satir({ voucherKey: 'BR1', hesapKodu: '335.01', fisTarihi: D(2026, 2, 28), aciklama: 'net ucret', alacak: 10000 }),
]);
ekle('Kira gideri var, stopaj yok', 'KIRA_STOPAJI_EKSIK', 'GECICI_Q1', () => [
  satir({ hesapKodu: '770.02', aciklama: 'isyeri kira gideri', borc: 10000 }),
]);
ekle('Kira stopajı oranı %5 (beklenen %20)', 'KIRA_STOPAJI_ORAN', 'GECICI_Q1', () => [
  satir({ voucherKey: 'KR1', hesapKodu: '770.02', aciklama: 'isyeri kira gideri', borc: 10000 }),
  satir({ voucherKey: 'KR1', hesapKodu: '360.01.006', aciklama: 'kira stopaj', alacak: 500 }),
]);
ekle('Müşavir ödemesi var, SMM stopajı yok', 'SMM_STOPAJI_KONTROL', 'GECICI_Q1', () => [
  satir({ hesapKodu: '740.01', aciklama: 'muhasebe musavir ucreti', borc: 5000 }),
]);
ekle('Personel ücreti var, damga vergisi yok', 'DAMGA_VERGISI_KONTROL', 'GECICI_Q1', () => [
  satir({ voucherKey: 'DG1', hesapKodu: '770.01', aciklama: 'maas tahakkuku', borc: 10000 }),
  satir({ voucherKey: 'DG1', hesapKodu: '335.01', aciklama: 'personel maas', alacak: 9000 }),
  satir({ voucherKey: 'DG1', hesapKodu: '361.01', aciklama: 'sgk primi', alacak: 1000 }),
]);

// ── Yıllık kurallar ──────────────────────────────────────────
ekle('Yıllık: açılış fişi yok', 'ACILIS_FISI_YOK', 'YILLIK', () => [
  satir({ hesapKodu: '100.01', fisTarihi: D(2025, 3, 1), borc: 100 }),
]);
ekle('Yıllık: açılış fişinde 7xx hesap', 'ACILIS_FISINDE_GELIR_GIDER', 'YILLIK', () => [
  satir({ hesapKodu: '770.01', aciklama: 'ACILIS FISI', fisTarihi: D(2025, 1, 1), borc: 50 }),
]);
ekle('Yıllık: 6xx var 690 kapanış yok', 'YILLIK_KAPANIS_690_EKSIK', 'YILLIK', () => [
  satir({ hesapKodu: '600.01', aciklama: 'ACILIS FISI', fisTarihi: D(2025, 1, 1), alacak: 1000 }),
]);
ekle('Yıllık: 191 dönem sonu sıfırlanmamış', 'DONEM_SONU_191_BAKIYE', 'YILLIK', () => [
  satir({ hesapKodu: '191.01', aciklama: 'ACILIS FISI', fisTarihi: D(2025, 1, 1), borc: 500 }),
]);
ekle('Yıllık: sabit kıymet var amortisman yok', 'YILSONU_AMORTISMAN_EKSIK', 'YILLIK', () => [
  satir({ hesapKodu: '255.01', aciklama: 'ACILIS FISI', fisTarihi: D(2025, 1, 1), borc: 10000 }),
]);
ekle('Yıllık: 690 kâr var 370/371 yok', 'VERGI_KARSILIGI_370_YOK', 'YILLIK', () => [
  satir({ hesapKodu: '690', aciklama: 'ACILIS FISI', fisTarihi: D(2025, 12, 31), alacak: 5000 }),
]);

// ── İstatistik katmanı ───────────────────────────────────────
ekle('Benford sapması (850 satır, hepsi 9 ile başlıyor)', 'BENFORD_SAPMA', 'GECICI_Q1', () => {
  const rows: ParsedEDefterFisLine[] = [];
  for (let i = 0; i < 850; i++) {
    rows.push(satir({ voucherKey: 'BF' + i, yevmiyeNo: String(1000 + i), hesapKodu: '600.01', fisTarihi: D(2026, 2, 3), alacak: 9001 + i }));
  }
  return rows;
});
ekle('Yuvarlak tutar yığılması (100 satır x 5.000 TL)', 'YUVARLAK_TUTAR_YIGILMASI', 'GECICI_Q1', () => {
  const rows: ParsedEDefterFisLine[] = [];
  for (let i = 0; i < 100; i++) {
    rows.push(satir({ voucherKey: 'YV' + i, yevmiyeNo: String(2000 + i), hesapKodu: '740.01', aciklama: 'malzeme', fisTarihi: D(2026, 2, 3), borc: 5000 }));
  }
  return rows;
});
ekle('Hafta sonu kayıtları (6/10 fiş cumartesi)', 'HAFTA_SONU_KAYDI', 'GECICI_Q1', () => {
  const rows: ParsedEDefterFisLine[] = [];
  for (let i = 0; i < 6; i++) rows.push(satir({ voucherKey: 'HS' + i, yevmiyeNo: String(3000 + i), hesapKodu: '100.01', fisTarihi: D(2026, 2, 7), borc: 10 }));
  for (let i = 0; i < 4; i++) rows.push(satir({ voucherKey: 'HI' + i, yevmiyeNo: String(3100 + i), hesapKodu: '100.01', fisTarihi: D(2026, 2, 4), borc: 10 }));
  return rows;
});
ekle('Şüpheli açıklama (sehven/düzeltme)', 'SUPHELI_ACIKLAMA', 'GECICI_Q1', () => [
  satir({ hesapKodu: '100.01', aciklama: 'sehven kayit duzeltme', borc: 100 }),
]);

// ── Düzeltme doğrulaması (Fix 1) ─────────────────────────────
ekle('FIX1: Şubat tahakkuku 26.03te kesilmiş → INFO olmalı', 'KDV_TAHAKKUK_EKSIK', 'GECICI_Q1', () => [
  satir({ voucherKey: 'A1', hesapKodu: '153.01', fisTarihi: D(2026, 2, 2), borc: 1000 }),
  satir({ voucherKey: 'A1', hesapKodu: '191.01', fisTarihi: D(2026, 2, 2), borc: 200 }),
  satir({ voucherKey: 'A1', hesapKodu: '320.01', fisTarihi: D(2026, 2, 2), alacak: 1200 }),
  satir({ voucherKey: 'TAH', hesapKodu: '190.01', hesapAdi: 'DEVREDEN KDV', aciklama: 'SUBAT KDV TAHAKKUK', fisTarihi: D(2026, 3, 26), borc: 200 }),
  satir({ voucherKey: 'TAH', hesapKodu: '191.01', hesapAdi: 'INDIRILECEK KDV', aciklama: 'SUBAT KDV TAHAKKUK', fisTarihi: D(2026, 3, 26), alacak: 200 }),
], 'INFO');
ekle('FIX1 regresyon: 28.02 tahakkuk → uyarı yok', 'KDV_TAHAKKUK_EKSIK', 'GECICI_Q1', () => [
  satir({ voucherKey: 'A1', hesapKodu: '153.01', fisTarihi: D(2026, 2, 2), borc: 1000 }),
  satir({ voucherKey: 'A1', hesapKodu: '191.01', fisTarihi: D(2026, 2, 2), borc: 200 }),
  satir({ voucherKey: 'A1', hesapKodu: '320.01', fisTarihi: D(2026, 2, 2), alacak: 1200 }),
  satir({ voucherKey: 'TAH', hesapKodu: '190.01', hesapAdi: 'DEVREDEN KDV', aciklama: 'SUBAT KDV TAHAKKUK', fisTarihi: D(2026, 2, 28), borc: 200 }),
  satir({ voucherKey: 'TAH', hesapKodu: '191.01', hesapAdi: 'INDIRILECEK KDV', aciklama: 'SUBAT KDV TAHAKKUK', fisTarihi: D(2026, 2, 28), alacak: 200 }),
], undefined, true);
// FIX4 (gercek İLGİ OTO vakasi 2026-06-11): tahakkuk AY-SONU tarihine (31.03 = takip
// eden ayin sonu) kesilmis -> nextAccrual ay-sonu filtresi onu KACIRIR. Ama aciklamada
// "SUBAT" yazili -> aciklamadan taninmali -> WARN degil INFO. (FIX1 ile ayni; tek fark
// tarih 26.03 yerine 31.03.) Luca Detay Fis Listesi fis tarihi yerine evrak tarihi
// (28.02 -> 31.03) verince olusan yanlis "bulunamadi" uyarisini onler.
ekle('FIX4: Şubat tahakkuku 31.03 (ay sonu) + açıklama "Şubat" → INFO', 'KDV_TAHAKKUK_EKSIK', 'GECICI_Q1', () => [
  satir({ voucherKey: 'A1', hesapKodu: '153.01', fisTarihi: D(2026, 2, 2), borc: 1000 }),
  satir({ voucherKey: 'A1', hesapKodu: '191.01', fisTarihi: D(2026, 2, 2), borc: 200 }),
  satir({ voucherKey: 'A1', hesapKodu: '320.01', fisTarihi: D(2026, 2, 2), alacak: 1200 }),
  satir({ voucherKey: 'TAH', hesapKodu: '190.01', hesapAdi: 'DEVREDEN KDV', aciklama: 'SUBAT AYI KDV TAHAKKUK', fisTarihi: D(2026, 3, 31), borc: 200 }),
  satir({ voucherKey: 'TAH', hesapKodu: '191.01', hesapAdi: 'INDIRILECEK KDV', aciklama: 'SUBAT AYI KDV TAHAKKUK', fisTarihi: D(2026, 3, 31), alacak: 200 }),
], 'INFO');

// ── Düzeltme doğrulaması (Fix 3) ─────────────────────────────
// İade fişi (391 borç, fiş tipi Mahsup) artık tahakkuk fişi SANILMAMALI:
// Şubat'ta yalnız iade fişi + alış varsa KDV_TAHAKKUK_EKSIK yine çıkmalı.
ekle('FIX3: iade fişi tahakkuk sanılmasın (Şubat uyarısı çıkmalı)', 'KDV_TAHAKKUK_EKSIK', 'GECICI_Q1', () => [
  satir({ voucherKey: 'A1', hesapKodu: '153.01', fisTarihi: D(2026, 2, 2), borc: 1000 }),
  satir({ voucherKey: 'A1', hesapKodu: '191.01', fisTarihi: D(2026, 2, 2), borc: 200 }),
  satir({ voucherKey: 'A1', hesapKodu: '320.01', fisTarihi: D(2026, 2, 2), alacak: 1200 }),
  satir({ voucherKey: 'IADE', fisTipi: 'MAHSUP', hesapKodu: '610.01', aciklama: 'satis iade', fisTarihi: D(2026, 2, 15), borc: 100 }),
  satir({ voucherKey: 'IADE', fisTipi: 'MAHSUP', hesapKodu: '391.01', aciklama: 'satis iade', fisTarihi: D(2026, 2, 15), borc: 20 }),
  satir({ voucherKey: 'IADE', fisTipi: 'MAHSUP', hesapKodu: '120.01', aciklama: 'satis iade', fisTarihi: D(2026, 2, 15), alacak: 120 }),
]);

// ── Negatif kontrol: temiz defter → 0 bulgu ──────────────────
function temizDefter(): ParsedEDefterFisLine[] {
  idx = 0;
  const rows: ParsedEDefterFisLine[] = [];
  let yev = 1;
  for (const ay of [1, 2, 3]) {
    const t = D(2026, ay, 10);
    const aTah = D(2026, ay, ay === 1 ? 31 : ay === 2 ? 28 : 31);
    const ak = 'AL' + ay, sk = 'SA' + ay, tk = 'TA' + ay;
    const y1 = String(yev++), y2 = String(yev++), y3 = String(yev++);
    rows.push(
      satir({ voucherKey: ak, yevmiyeNo: y1, hesapKodu: '153.01', fisTarihi: t, evrakNo: 'ALF202600000' + ay, evrakTarihi: t, vknTckn: '1234567890', aciklama: 'mal alimi faturasi', borc: 1000 }),
      satir({ voucherKey: ak, yevmiyeNo: y1, hesapKodu: '191.01', fisTarihi: t, evrakNo: 'ALF202600000' + ay, evrakTarihi: t, vknTckn: '1234567890', aciklama: 'mal alimi faturasi', borc: 200 }),
      satir({ voucherKey: ak, yevmiyeNo: y1, hesapKodu: '320.01', fisTarihi: t, evrakNo: 'ALF202600000' + ay, evrakTarihi: t, vknTckn: '1234567890', aciklama: 'mal alimi faturasi', alacak: 1200 }),
      satir({ voucherKey: sk, yevmiyeNo: y2, hesapKodu: '120.01', fisTarihi: t, evrakNo: 'STF202600000' + ay, evrakTarihi: t, vknTckn: '1234567890', aciklama: 'mal satisi faturasi', borc: 1416 }),
      satir({ voucherKey: sk, yevmiyeNo: y2, hesapKodu: '600.01', fisTarihi: t, evrakNo: 'STF202600000' + ay, evrakTarihi: t, vknTckn: '1234567890', aciklama: 'mal satisi faturasi', alacak: 1180 }),
      satir({ voucherKey: sk, yevmiyeNo: y2, hesapKodu: '391.01', fisTarihi: t, evrakNo: 'STF202600000' + ay, evrakTarihi: t, vknTckn: '1234567890', aciklama: 'mal satisi faturasi', alacak: 236 }),
      satir({ voucherKey: tk, yevmiyeNo: y3, hesapKodu: '391.01', fisTarihi: aTah, aciklama: 'KDV tahakkuk mahsup', borc: 236 }),
      satir({ voucherKey: tk, yevmiyeNo: y3, hesapKodu: '191.01', fisTarihi: aTah, aciklama: 'KDV tahakkuk mahsup', alacak: 200 }),
      satir({ voucherKey: tk, yevmiyeNo: y3, hesapKodu: '360.02', fisTarihi: aTah, aciklama: 'KDV tahakkuk mahsup odenecek kdv', alacak: 36 }),
    );
  }
  return rows;
}

// ── Çalıştır ─────────────────────────────────────────────────
let pass = 0, fail = 0;
const failList: string[] = [];
for (const s of senaryolar) {
  const range = s.donemTipi === 'YILLIK' ? YIL : Q1;
  const findings = svc.analyze(s.rows, range, s.donemTipi);
  const hits = findings.filter((f: any) => f.category === s.beklenen);
  let ok: boolean;
  let detay = '';
  if (s.beklenmeyenMi) {
    ok = hits.length === 0;
    if (!ok) detay = ` (beklenmiyordu ama ${hits.length} adet çıktı)`;
  } else if (s.seviye) {
    ok = hits.length > 0 && hits.every((h: any) => h.severity === s.seviye);
    if (!ok) detay = hits.length ? ` (seviye ${hits.map((h: any) => h.severity).join(',')}, beklenen ${s.seviye})` : ' (hiç tetiklenmedi)';
  } else {
    ok = hits.length > 0;
    if (!ok) detay = ' (hiç tetiklenmedi)';
  }
  if (ok) { pass++; console.log(`PASS  ${s.beklenen.padEnd(36)} ${s.ad}`); }
  else { fail++; failList.push(s.ad); console.log(`FAIL  ${s.beklenen.padEnd(36)} ${s.ad}${detay}`); }
}

const temiz = svc.analyze(temizDefter(), Q1, 'GECICI_Q1');
if (temiz.length === 0) { pass++; console.log('PASS  TEMIZ_DEFTER                          0 bulgu'); }
else {
  fail++;
  console.log(`FAIL  TEMIZ_DEFTER: ${temiz.length} beklenmedik bulgu:`);
  for (const f of temiz) console.log(`   - [${f.severity}] ${f.category}: ${f.message}`);
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı.${fail ? ' Kalanlar: ' + failList.join(' | ') : ''}`);
