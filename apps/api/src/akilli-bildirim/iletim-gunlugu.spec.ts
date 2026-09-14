/**
 * İLETİM GÜNLÜĞÜ — davranış kilidi (sahte prisma).
 *
 *  - documentDispatch satırı docRefs'teki HER belge için ayrı günlük satırına açılır (Beyanname/SGK/Tebligat/Ödeme Listesi).
 *  - communicationLog yalnız kalıplı GİDEN kayıtlarla katılır (Cari Kasa, portal mesajı); bot sohbeti dışarıda.
 *  - Test gönderimi "İletildi" SAYILMAZ; sanal WhatsApp kişileri (WHATSAPP-*) günlüğe girmez.
 *  - Süzgeçler, sıralama, sayfalama, özet, Excel başlıkları.
 */
import * as ExcelJS from 'exceljs';
import { IletimGunluguService } from './iletim-gunlugu.service';
import {
  EXCEL_BASLIKLARI, belgeAdi, dispatchSatirlari, gunlukExcel, gunlukSuz, iletisimHatasi, iletisimKonuSuzgeci, iletisimSatiri, sayfala, sorguCoz,
  type GunlukSatiri,
} from './iletim-gunlugu';

const AY = '2026-09';
const t = (g: number, ss: number, dd = 0) => new Date(2026, 8, g, ss, dd, 0);

const MUKELLEFLER = [
  { id: 't1', companyName: 'ÖZ ELA GIDA LTD', firstName: null, lastName: null, taxNumber: '1111' },
  { id: 't2', companyName: null, firstName: 'Erdoğan', lastName: 'Balçık', taxNumber: '2222' },
  { id: 'wa', companyName: 'Ofis Sahibi', firstName: null, lastName: null, taxNumber: 'WHATSAPP-05350000000' },
];

const DISPATCH = [
  // VERGI: iki beyanname, WhatsApp iletildi
  { id: 'd1', taxpayerId: 't1', kategori: 'VERGI', donem: '2026-07', channel: 'WHATSAPP', status: 'SENT', error: null, testMode: false, sentAt: t(12, 14, 20), createdAt: t(12, 14, 19), docRefs: ['b1', 'b2'] },
  // VERGI aynı demet e-posta: iletilemedi
  { id: 'd2', taxpayerId: 't1', kategori: 'VERGI', donem: '2026-07', channel: 'EMAIL', status: 'FAILED', error: 'ILETISIM-mükellefin e-postası yok', testMode: false, sentAt: null, createdAt: t(12, 14, 19), docRefs: ['b1', 'b2'] },
  // SGK tahakkuk + hizmet listesi
  { id: 'd3', taxpayerId: 't2', kategori: 'SGK', donem: '2026/07', channel: 'WHATSAPP', status: 'SENT', error: null, testMode: false, sentAt: t(3, 9, 5), createdAt: t(3, 9, 5), docRefs: ['p1', 'p2'] },
  // ETEBLIGAT test modu
  { id: 'd4', taxpayerId: 't2', kategori: 'ETEBLIGAT', donem: null, channel: 'WHATSAPP', status: 'SENT', error: null, testMode: true, sentAt: t(5, 10, 0), createdAt: t(5, 10, 0), docRefs: ['p3'] },
  // ODEME_LISTESI kalemli (yeni biçim)
  { id: 'd5', taxpayerId: 't1', kategori: 'ODEME_LISTESI', donem: '2026-09', channel: 'EMAIL', status: 'SENT', error: null, testMode: false, sentAt: t(10, 9, 30), createdAt: t(10, 9, 30), docRefs: [
    { key: 'VERGI|KDV1|2026-07|', tur: 'KDV1', donem: '2026-07', taksit: null, tutar: 1000 },
    { key: 'SGK|Tahakkuk Fişi|2026/07||80646-2026-7', tur: 'Tahakkuk Fişi', donem: '2026/07', taksit: null, tutar: 2000 },
  ] },
  // ODEME_LISTESI eski biçim (docRefs yok) → tek satır
  { id: 'd6', taxpayerId: 't2', kategori: 'ODEME_LISTESI', donem: '2026-09', channel: 'WHATSAPP', status: 'FAILED', error: 'mükellefin telefon numarası yok', testMode: false, sentAt: null, createdAt: t(10, 9, 31), docRefs: null },
  // Sanal WhatsApp kişisi → günlüğe girmez
  { id: 'd7', taxpayerId: 'wa', kategori: 'VERGI', donem: '2026-07', channel: 'WHATSAPP', status: 'SENT', error: null, testMode: false, sentAt: t(12, 15, 0), createdAt: t(12, 15, 0), docRefs: ['b1'] },
];

const LOG = [
  { id: 'c1', taxpayerId: 't1', channel: 'WHATSAPP', subject: 'Hesap Dökümü (ekstre PDF) — 01.01.2026 / 14.09.2026 Hesap Dökümü', content: 'x', occurredAt: t(14, 8, 4) },
  { id: 'c2', taxpayerId: 't2', channel: 'WHATSAPP', subject: 'Tahsilat hatırlatma - 2026-08 - Başarısız', content: 'x', occurredAt: t(2, 11, 0) },
  { id: 'c3', taxpayerId: 't2', channel: 'WHATSAPP', subject: 'WhatsApp portal medya (gonderilemedi)', content: 'x', occurredAt: t(6, 12, 0) },
  { id: 'c4', taxpayerId: 't1', channel: 'WHATSAPP', subject: '[TEST] Evrak hatırlatma — 2026/08 — Gönderildi · Hedef: 0535 · ilk hatırlatma', content: 'x', occurredAt: t(1, 9, 0) },
];

function sahtePrisma(opts: { dispatch?: any[]; log?: any[] } = {}) {
  return {
    documentDispatch: { findMany: jest.fn(async () => opts.dispatch ?? DISPATCH) },
    communicationLog: { findMany: jest.fn(async () => opts.log ?? LOG) },
    beyanKaydi: { findMany: jest.fn(async () => [{ id: 'b1', beyanTipi: 'KDV1', donem: '2026-07' }, { id: 'b2', beyanTipi: 'MUHSGK', donem: '2026-07' }]) },
    portalDocument: {
      findMany: jest.fn(async () => [
        { id: 'p1', title: 'SGK Tahakkuk Fişi', period: '2026/07', belgeTuru: 'SGK_TAHAKKUK', raw: {} },
        { id: 'p2', title: 'SGK Hizmet Listesi', period: '2026/07', belgeTuru: 'SGK_HIZMET_LISTESI', raw: {} },
        { id: 'p3', title: 'Vergi/Ceza İhbarnamesi', period: '2026/08', belgeTuru: 'E_TEBLIGAT', raw: { kurumAciklama: 'GİB' } },
      ]),
    },
    taxpayer: { findMany: jest.fn(async () => MUKELLEFLER) },
  } as any;
}

const servis = (prisma = sahtePrisma()) => new IletimGunluguService(prisma);
const sorgu = (ek: Record<string, unknown> = {}) => sorguCoz({ month: AY, pageSize: 100, ...ek });

describe('İletim Günlüğü — kaynak birleşimi', () => {
  it('docRefs belge başına satıra açılır; adlar okunur', async () => {
    const y = await servis().liste('tenant', sorgu());
    const adlar = y.satirlar.map((s) => `${s.belgeTuru}|${s.belgeAdi}|${s.kanal}|${s.durum}`);
    expect(adlar).toEqual(expect.arrayContaining([
      'Beyanname|KDV1 2026/07|WhatsApp|İletildi',
      'Beyanname|MUHSGK 2026/07|WhatsApp|İletildi',
      'Beyanname|KDV1 2026/07|Mail|İletilemedi',
      'Beyanname|MUHSGK 2026/07|Mail|İletilemedi',
      'SGK|Tahakkuk Fişi 2026/07|WhatsApp|İletildi',
      'SGK|Hizmet Listesi 2026/07|WhatsApp|İletildi',
      'Tebligat|Vergi/Ceza İhbarnamesi — GİB|WhatsApp|Test',
      'Ödeme Listesi|KDV Beyannamesi Temmuz 2026|Mail|İletildi',
      'Ödeme Listesi|SGK Prim Tahakkuku Temmuz 2026|Mail|İletildi',
      'Ödeme Listesi|Ödeme Listesi Eylül 2026|WhatsApp|İletilemedi',
    ]));
    // 2+2+2+1+2+1 dispatch + 4 log = 14; sanal kişi (d7) yok
    expect(y.toplam).toBe(14);
    expect(y.satirlar.some((s) => s.taxpayerId === 'wa')).toBe(false);
  });

  it('communicationLog: Cari Kasa / Mesaj sınıflaması, başarısız ve test ayrımı', async () => {
    const y = await servis().liste('tenant', sorgu());
    const bul = (id: string) => y.satirlar.find((s) => s.id === `cl:${id}`)!;
    expect(bul('c1')).toMatchObject({ belgeTuru: 'Cari Kasa', belgeAdi: '01.01.2026 / 14.09.2026 Hesap Dökümü', durum: 'İletildi', unvan: 'ÖZ ELA GIDA LTD' });
    expect(bul('c2')).toMatchObject({ belgeTuru: 'Cari Kasa', belgeAdi: 'Tahsilat hatırlatma - 2026-08', durum: 'İletilemedi', unvan: 'Erdoğan Balçık' });
    expect(bul('c3')).toMatchObject({ belgeTuru: 'Mesaj', belgeAdi: 'Portal WhatsApp dosyası', durum: 'İletilemedi' });
    expect(bul('c4')).toMatchObject({ belgeTuru: 'Mesaj', belgeAdi: 'Evrak hatırlatma — 2026/08', durum: 'Test', test: true });
  });

  it('bot sohbeti / gelen mesaj kalıp dışı → null; DB süzgeci kural tablosundan türer', () => {
    for (const konu of ['WhatsApp owner gelen mesaj', 'WhatsApp bot cevabı (MOREN AI)', 'WhatsApp gelen kayitsiz numara mesaji', 'WhatsApp owner sabah brifingi', 'WhatsApp mukellef belge cevabi'])
      expect(iletisimSatiri({ id: 'x', taxpayerId: 't1', channel: 'WHATSAPP', subject: konu, occurredAt: t(1, 1) }, 'A')).toBeNull();
    // PHONE/MEETING gibi kanallar günlük değil
    expect(iletisimSatiri({ id: 'x', taxpayerId: 't1', channel: 'PHONE', subject: 'Hesap Dökümü (ekstre PDF) — x', occurredAt: t(1, 1) }, 'A')).toBeNull();
    const suzgec = iletisimKonuSuzgeci();
    expect(suzgec).toEqual(expect.arrayContaining([{ subject: { startsWith: 'Hesap Dökümü' } }, { subject: { endsWith: 'bilgilendirmesi' } }]));
    expect(iletisimHatasi('WhatsApp bot cevabi (gonderilemedi - master switch veya hata)')).toBe('master switch veya hata');
    expect(iletisimHatasi('Evrak hatırlatma — 2026/08 — Başarısız · Hedef: (yok) · telefon yok')).toBe('Hedef: (yok) · telefon yok');
  });

  it('hata metni ILETISIM- ön ekinden arınır; docRefs id bulunamazsa kategori adı yazılır', () => {
    const ctx = { unvan: () => 'A', beyanlar: new Map(), belgeler: new Map() };
    const r = dispatchSatirlari({ id: 'd', taxpayerId: 't1', kategori: 'VERGI', channel: 'EMAIL', status: 'FAILED', error: 'ILETISIM-mükellefin e-postası yok', createdAt: t(1, 1), docRefs: ['yok1', 'yok2'] }, ctx);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ belgeAdi: 'Beyanname (2 belge)', hata: 'mükellefin e-postası yok', durum: 'İletilemedi', kanal: 'Mail' });
    // aynı dönemde iki SGK fişi → tek satır "(2 belge)"
    const belgeler = new Map([['s1', { id: 's1', title: 'SGK Tahakkuk Fişi', period: '2026/07', belgeTuru: 'SGK_TAHAKKUK' }], ['s2', { id: 's2', title: 'SGK Tahakkuk Fişi', period: '2026/07', belgeTuru: 'SGK_TAHAKKUK' }]]);
    const sgk = dispatchSatirlari({ id: 'd', taxpayerId: 't1', kategori: 'SGK', channel: 'WHATSAPP', status: 'SENT', sentAt: t(1, 1), docRefs: ['s1', 's2'] }, { ...ctx, belgeler });
    expect(sgk.map((x) => x.belgeAdi)).toEqual(['Tahakkuk Fişi 2026/07 (2 belge)']);
    expect(belgeAdi('ODEME_LISTESI', { key: 'VERGI|GELIR|2025-YIL|1/2', tur: 'GELIR', donem: '2025-YIL', taksit: '1/2', tutar: 1 }, ctx)).toBe('Yıllık Gelir Vergisi 1. Taksit 2025 Yılı');
  });
});

describe('İletim Günlüğü — süzgeç / sıralama / sayfalama / özet', () => {
  it('varsayılan en yeni üstte; sira=asc tersine çevirir', async () => {
    const y = await servis().liste('tenant', sorgu());
    const zamanlar = y.satirlar.map((s) => new Date(s.tarih).getTime());
    expect(zamanlar).toEqual([...zamanlar].sort((a, b) => b - a));
    const a = await servis().liste('tenant', sorgu({ sira: 'asc' }));
    expect(a.satirlar[0].id).toBe('cl:c4');
  });

  it('mükellef / belge türü / kanal / durum / arama süzgeçleri', async () => {
    const s = servis();
    expect((await s.liste('tenant', sorgu({ taxpayerId: 't2' }))).satirlar.every((x) => x.taxpayerId === 't2')).toBe(true);
    const sgk = await s.liste('tenant', sorgu({ belgeTuru: 'SGK' }));
    expect(sgk.toplam).toBe(2);
    const mail = await s.liste('tenant', sorgu({ kanal: 'EMAIL' }));
    expect(mail.toplam).toBe(4);
    expect(mail.satirlar.every((x) => x.kanal === 'Mail')).toBe(true);
    const iletilmeyen = await s.liste('tenant', sorgu({ durum: 'iletilmeyen' }));
    expect(iletilmeyen.toplam).toBe(5); // 2 beyanname e-posta + ödeme listesi eski biçim + tahsilat + portal medya
    expect(iletilmeyen.satirlar.every((x) => x.durum === 'İletilemedi')).toBe(true);
    const iletilen = await s.liste('tenant', sorgu({ durum: 'iletilen' }));
    expect(iletilen.satirlar.every((x) => x.durum === 'İletildi')).toBe(true);
    expect(iletilen.satirlar.some((x) => x.test)).toBe(false); // test gönderimi iletilen SAYILMAZ
    const ara = await s.liste('tenant', sorgu({ q: 'kdv1' }));
    expect(ara.toplam).toBe(2);
    const araUnvan = await s.liste('tenant', sorgu({ q: 'balçık' }));
    expect(araUnvan.satirlar.every((x) => x.unvan === 'Erdoğan Balçık')).toBe(true);
    // geçersiz belge türü / kanal yok sayılır
    expect(sorguCoz({ belgeTuru: 'Saçma', kanal: 'FAKS', durum: 'x', page: '0', pageSize: '9999' })).toMatchObject({ belgeTuru: '', kanal: '', durum: 'tumu', page: 1, pageSize: 500 });
  });

  it('sayfalama: toplam süzgeçli sayı, sayfa aşımı son sayfaya iner', async () => {
    const s = servis();
    const p2 = await s.liste('tenant', sorgu({ page: 2, pageSize: 5 }));
    expect(p2).toMatchObject({ toplam: 14, sayfa: 2, sayfaBoyutu: 5 });
    expect(p2.satirlar).toHaveLength(5);
    const hepsi = await s.liste('tenant', sorgu({ pageSize: 100 }));
    expect(p2.satirlar.map((x) => x.id)).toEqual(hepsi.satirlar.slice(5, 10).map((x) => x.id));
    const p9 = await s.liste('tenant', sorgu({ page: 9, pageSize: 5 }));
    expect(p9.sayfa).toBe(3);
    expect(p9.satirlar).toHaveLength(4);
    expect(sayfala([1, 2, 3], 2, 2)).toEqual({ sayfa: 2, satirlar: [3] });
  });

  it('özet süzülmüş kümeye göre; yenidenDenenecek yalnız Vergi/SGK/e-Tebligat FAILED çiftleri', async () => {
    const y = await servis().liste('tenant', sorgu());
    // İletildi: 2 (KDV1,MUHSGK wa) + 2 SGK + 2 ödeme + ekstre = 7; İletilemedi: 5; Test: tebligat + evrak = 2
    expect(y.ozet).toEqual({ iletilen: 7, iletilemeyen: 5, test: 2, yenidenDenenecek: 1 });
    const mail = await servis().liste('tenant', sorgu({ kanal: 'EMAIL' }));
    expect(mail.ozet).toMatchObject({ iletilen: 2, iletilemeyen: 2, test: 0, yenidenDenenecek: 1 });
  });

  it('sorgu ay aralığı prisma where\'e sentAt ?? createdAt mantığıyla gider', async () => {
    const prisma = sahtePrisma();
    await servis(prisma).liste('tenant', sorgu());
    const where = prisma.documentDispatch.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('tenant');
    expect(where.OR[0].sentAt.gte).toEqual(new Date(2026, 8, 1));
    expect(where.OR[0].sentAt.lt).toEqual(new Date(2026, 9, 1));
    expect(where.OR[1]).toMatchObject({ sentAt: null });
    const logWhere = prisma.communicationLog.findMany.mock.calls[0][0].where;
    expect(logWhere.channel).toEqual({ in: ['WHATSAPP', 'EMAIL'] });
    expect(logWhere.taxpayer).toEqual({ tenantId: 'tenant' });
    expect(logWhere.OR.length).toBeGreaterThan(5);
  });
});

describe('İletim Günlüğü — Excel', () => {
  it('başlıklar ve satırlar; süzgeç uygulanır, sayfalama uygulanmaz', async () => {
    const buf = await servis().excel('tenant', sorgu({ kanal: 'EMAIL', pageSize: 1 }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('İletim Günlüğü');
    const basliklar = (ws.getRow(2).values as any[]).slice(1);
    expect(basliklar).toEqual(EXCEL_BASLIKLARI);
    expect(ws.rowCount).toBe(2 + 4);
    const ilk = (ws.getRow(3).values as any[]).slice(1);
    expect(ilk[1]).toBe('ÖZ ELA GIDA LTD');
    expect(ilk[4]).toBe('Mail');
    expect(String(ilk[0])).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  it('boş günlük de geçerli xlsx üretir', async () => {
    const satirlar: GunlukSatiri[] = [];
    const buf = await gunlukExcel(satirlar, AY);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(wb.worksheets[0].rowCount).toBe(2);
    expect(String((wb.worksheets[0].getRow(1).values as any[])[1])).toContain('Eylül 2026');
  });

  it('gunlukSuz saf: test satırı ne iletilen ne iletilmeyen', () => {
    const s: GunlukSatiri = { id: 'x', tarih: t(1, 1).toISOString(), taxpayerId: 't1', unvan: 'A', belgeTuru: 'SGK', belgeAdi: 'B', kanal: 'WhatsApp', durum: 'Test', hata: null, test: true };
    expect(gunlukSuz([s], sorgu({ durum: 'iletilen' }))).toHaveLength(0);
    expect(gunlukSuz([s], sorgu({ durum: 'iletilmeyen' }))).toHaveLength(0);
    expect(gunlukSuz([s], sorgu({ durum: 'tumu' }))).toHaveLength(1);
  });
});
