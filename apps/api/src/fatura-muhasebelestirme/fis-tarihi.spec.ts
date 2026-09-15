/**
 * FİŞ / GÖRSEL TARİH SEÇİMİ (2026-09-15, ÖZ ELA bulgusu):
 *  OCR motorunun yedek tarih deseni satır sonunu aşıyordu — "ADA NO:7 8⏎04 08 2026" → 07.08.2004, "ADA NO:6-5⏎22 08 2026" → 22.05.2008.
 *  ŞEKERCİ PETROL fişleri 2004/2008 tarihiyle Ağustos listesinden düşmüştü (Mihsap 56 / portal 46).
 *  Kural: motor tarihi makulse VE metinde tek satırda görünüyorsa motor; aksi halde metinden tek satırlık GG AA YYYY.
 */
jest.mock('./fatura-muhasebelestirme.service', () => jest.requireActual('./fatura-muhasebelestirme.service'));
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

const svc: any = Object.create(FaturaMuhasebelestirmeService.prototype);
svc.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

const SEYITLER = `SEYITLER PETROL TICARET LTD ŞTI.
TEL:02127715900
MERSIS NO:0767 0600 0610 0014
LISANS NO: BAY/941 -54/09985
TIC SIC NO:617542
ADA NO:7 8
04 08 2026
06:08
FIŞ NO: 0011
34LAM223
61,710 LT X 81,02
TOPLAM
*5.000,00
Z NO: 1.209`;

const SEKERCI = `Şekerci petrol ürünleri tekstil
MERSIS NO:0801-0079-5140 0039
LISANS NO: BAY/939-82/45461
TIC SIC NO:275461-5
ADA NO:6-5
22 08 2026
07:16
FIŞ NO: 0004
Shell Card: 70044104646952714
Aylık islem ToplamI: 7567,80
Z NO: 1.351`;

const EFATURA = `Tel: Fax:
Sipariş Tarihi: 20-08-2026
Fatura Tarihi:
31-08-2026
Düzenleme Tarihi: 31-08-2026
ETTN: 2941bd5e-daaa-45d4-8400-97ae135e2def
Ödenecek Tutar
83.052,20 TL`;

describe('fisTarihiMetinden — tek satırlık GG AA YYYY', () => {
  it('ŞEKERCİ/SEYİTLER fişi: boşluklu tarih satırı okunur, MERSIS/LİSANS/ADA NO satırları tarih sanılmaz', () => {
    expect(svc.fisTarihiMetinden(SEYITLER)).toBe('04.08.2026');
    expect(svc.fisTarihiMetinden(SEKERCI)).toBe('22.08.2026');
  });
  it('e-Fatura metni: "Fatura/Düzenleme Tarihi" etiketli satır öncelikli; Sipariş Tarihi atlanır', () => {
    expect(svc.fisTarihiMetinden(EFATURA)).toBe('31.08.2026');
  });
  it('etiketsiz metinde ilk makul tarih; 2 haneli yıl / makul dışı yıl kabul edilmez', () => {
    expect(svc.fisTarihiMetinden('X 12/03/26 Y\nTOPLAM 5,00\n15.03.2026 12:00')).toBe('15.03.2026');
    expect(svc.fisTarihiMetinden('07.08.2004\n31.10.2724')).toBeNull();
    expect(svc.fisTarihiMetinden('')).toBeNull();
  });
});

describe('fisTarihiSec — motor tarihi + metin doğrulaması', () => {
  it('motorun satır-aşan çöp tarihi (07.08.2004 / 22.05.2008) metindeki gerçek tarihle değiştirilir', () => {
    expect(svc.fisTarihiSec('07.08.2004', SEYITLER)).toBe('04.08.2026');
    expect(svc.fisTarihiSec('22.05.2008', SEKERCI)).toBe('22.08.2026');
  });
  it('motor tarihi makul ve metinde tek satırda görünüyorsa motor korunur (etiket puanlaması bozulmaz)', () => {
    expect(svc.fisTarihiSec('31.08.2026', EFATURA)).toBe('31.08.2026');
    // motor sipariş tarihini seçmiş olsa bile metinde tek satırda var → motor tarihine dokunulmaz (motorun puanlaması)
    expect(svc.fisTarihiSec('20.08.2026', EFATURA)).toBe('20.08.2026');
  });
  it('motor makul ama metinde YOK (uydurulmuş) → metinden; motor yok ve metin de yoksa null', () => {
    expect(svc.fisTarihiSec('25.05.2025', SEKERCI)).toBe('22.08.2026');
    expect(svc.fisTarihiSec(null, 'TOPLAM 5,00')).toBeNull();
    expect(svc.fisTarihiSec('01.01.2026', 'TOPLAM 5,00')).toBe('01.01.2026'); // metinden tarih çıkmadı → motor
  });
});

describe('makulTarih — dönem dışı okuma çöpü', () => {
  it('2015..gelecek yıl arası kabul, 1904/2004/2724 red', () => {
    expect(svc.makulTarih(new Date('2026-08-04T00:00:00Z'))?.toISOString().slice(0, 10)).toBe('2026-08-04');
    expect(svc.makulTarih(new Date('2004-08-07T00:00:00Z'))).toBeNull();
    expect(svc.makulTarih(new Date('2724-10-30T00:00:00Z'))).toBeNull();
    expect(svc.makulTarih(null)).toBeNull();
    expect(svc.makulTarih(new Date('bozuk'))).toBeNull();
  });
});
