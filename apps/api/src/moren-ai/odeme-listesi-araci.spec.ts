/**
 * WhatsApp botu — `get_my_odeme_listesi` veri aracı: mükellefe kilitli (taxpayerId sohbet bağlamından),
 * başka mükellef verisi dönmez, tutar + son gün + cetvel durumu verir. Kuru test: gerçek servis yerine sahte.
 */
import { ToolExecutorService } from './tool-executor.service';
import { TAXPAYER_READONLY_TOOL_NAMES } from './moren-ai.service';
import { MOREN_AI_TOOLS } from './tools';

function kur(list: jest.Mock, taxpayer: any = { id: 'TP1', companyName: 'ADEM CAN', isActive: true }) {
  const prisma: any = { taxpayer: { findFirst: jest.fn(async (q: any) => (q.where.id === taxpayer?.id ? taxpayer : null)) } };
  const moduleRef: any = { get: jest.fn(() => ({ list })) };
  return { svc: new ToolExecutorService(prisma, moduleRef), prisma, moduleRef };
}

describe('get_my_odeme_listesi', () => {
  it('araç tanımlı ve mükellef araç listesinde', () => {
    expect(MOREN_AI_TOOLS.find((t: any) => t.name === 'get_my_odeme_listesi')).toBeTruthy();
    expect(TAXPAYER_READONLY_TOOL_NAMES).toContain('get_my_odeme_listesi');
  });

  it('aktif mükellef bağlamı yoksa hata, veri çekilmez', async () => {
    const list = jest.fn();
    const { svc } = kur(list);
    const r = await svc.execute('get_my_odeme_listesi', {}, { tenantId: 'T1', taxpayerId: null });
    expect(r.error).toMatch(/mukellef baglami/);
    expect(list).not.toHaveBeenCalled();
  });

  it('yalnız KENDİ mükellef kimliğiyle list çağrılır; kalemler tutar + son gün + cetvel durumu ile döner', async () => {
    const list = jest.fn(async () => [
      {
        taxpayerId: 'TP1', unvan: 'ADEM CAN', toplam: 31323.82,
        satirlar: [
          { tur: 'KDV1', turAd: 'KDV Beyannamesi', kaynak: 'VERGI', grup: 'AYLIK', donem: '2026-07', sonGun: '28.8.2026', sonGunHam: '28.8.2026', sonGunIso: '2026-08-28', taksit: null, tutar: 7046.77 },
          { tur: 'Tahakkuk Fişi', turAd: 'SGK Prim Tahakkuku', kaynak: 'SGK', grup: 'SGK', donem: '2026/07', sonGun: '2.11.2026', sonGunHam: '31.10.2026', sonGunIso: '2026-11-02', taksit: null, tutar: 24277.05 },
        ],
        gonderim: { VERGI: { status: 'SENT', sentAt: 'x', kanallar: ['WHATSAPP'], test: false }, SGK: null },
      },
    ]);
    const { svc } = kur(list);
    const r = await svc.execute('get_my_odeme_listesi', { month: '2026-08' }, { tenantId: 'T1', taxpayerId: 'TP1' });
    expect(list).toHaveBeenCalledWith('T1', '2026-08', 'TP1');
    expect(r.ay).toBe('Ağustos 2026');
    expect(r.adet).toBe(2);
    // Dönem yazımı 069cfb9 (2026-09-14) ile '07/2026' oldu; bu satır eski biçimi bekliyordu (bayat test).
    expect(r.kalemler[0]).toMatchObject({ odeme: 'KDV Beyannamesi', donem: '07/2026', sonOdemeGunu: '2026-08-28', tutar: 7046.77 });
    expect(r.kalemler[1]).toMatchObject({ odeme: 'SGK Prim Tahakkuku', sonOdemeGunu: '2026-11-02', not: expect.stringMatching(/kaydirildi/) });
    expect(r.vergiToplam).toBe(7046.77);
    expect(r.sgkToplam).toBe(24277.05);
    expect(r.toplam).toBe(31323.82);
    expect(r.cetvelDurumu).toEqual({ vergi: 'gonderildi', sgk: 'henuz gonderilmedi' });
  });

  it('kalem yoksa açık not; başka mükellefin kimliği ile boş bağlam', async () => {
    const list = jest.fn(async () => []);
    const { svc } = kur(list);
    const r = await svc.execute('get_my_odeme_listesi', {}, { tenantId: 'T1', taxpayerId: 'TP1' });
    expect(r.adet).toBe(0);
    expect(r.not).toMatch(/odeme kalemi/);
    const baska = await svc.execute('get_my_odeme_listesi', {}, { tenantId: 'T1', taxpayerId: 'TP-BASKA' });
    expect(baska.error).toMatch(/mukellef baglami/);
  });
});
