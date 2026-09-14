/**
 * Mükellef portalı — ödeme cetveli ucu: mükellef YALNIZ kendi satırlarını görür (taxpayerId JWT'den),
 * telefon/e-posta gibi iletişim alanları dışarı çıkmaz, ay verilmezse içinde bulunulan ay.
 */
import { TaxpayerPortalService } from './taxpayer-portal.service';

function servis(list: jest.Mock | null) {
  const aylikOdeme = list ? { list } : undefined;
  return new TaxpayerPortalService({} as any, {} as any, {} as any, {} as any, {} as any, undefined, aylikOdeme as any);
}

describe('TaxpayerPortalService.getOdemeCetveli', () => {
  it('AylikOdemeService.list mükellefe kilitli çağrılır; satırlar + toplam + gönderim döner', async () => {
    const list = jest.fn(async () => [
      {
        taxpayerId: 'TP1', unvan: 'ADEM CAN', phone: '9055', email: 'x@y.z', toplam: 100,
        satirlar: [{ tur: 'KDV1', turAd: 'KDV Beyannamesi', kaynak: 'VERGI', grup: 'AYLIK', donem: '2026-07', sonGun: '28.8.2026', sonGunHam: '28.8.2026', sonGunIso: '2026-08-28', taksit: null, tutar: 100 }],
        gonderim: { VERGI: { status: 'SENT', sentAt: 'x', kanallar: ['WHATSAPP'], test: false }, SGK: null },
      },
    ]);
    const r = await servis(list).getOdemeCetveli('TP1', 'T1', '2026-08');
    expect(list).toHaveBeenCalledWith('T1', '2026-08', 'TP1');
    expect(r).toEqual({
      month: '2026-08',
      ayAdi: 'Ağustos 2026',
      unvan: 'ADEM CAN',
      satirlar: expect.any(Array),
      toplam: 100,
      gonderim: { VERGI: { status: 'SENT', sentAt: 'x', kanallar: ['WHATSAPP'], test: false }, SGK: null },
    });
    expect(r).not.toHaveProperty('phone');
    expect(r).not.toHaveProperty('email');
  });

  it('kalem yoksa boş cetvel; geçersiz ay → içinde bulunulan ay', async () => {
    const list = jest.fn(async () => []);
    const r = await servis(list).getOdemeCetveli('TP1', 'T1', 'bozuk');
    const now = new Date();
    expect(r.month).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    expect(r.satirlar).toEqual([]);
    expect(r.toplam).toBe(0);
    expect(r.gonderim).toEqual({ VERGI: null, SGK: null });
  });

  it('servis bağlı değilse 503', async () => {
    await expect(servis(null).getOdemeCetveli('TP1', 'T1', '2026-08')).rejects.toThrow(/kullanılamıyor/);
  });
});
