import { MizanService } from './mizan.service';

// analyzeAccounts() DB-bagimli; prisma'yi minimal mock'la cagirip uretilen anomalileri yakalariz.
function makeService(hesaplar: any[], mizanInfo: any) {
  const captured: any[] = [];
  const prisma: any = {
    mizanHesap: { findMany: async () => hesaplar },
    mizanAnomali: {
      deleteMany: async () => ({}),
      createMany: async ({ data }: any) => { captured.push(...data); return { count: data.length }; },
    },
    mizan: { findUnique: async () => mizanInfo },
    taxpayer: { findUnique: async () => null },
    mizanDenetimKriteri: { findMany: async () => [] },
  };
  const service = new MizanService(prisma, null as any, null as any);
  return { service, captured };
}

function hesap(o: Partial<any>): any {
  return { hesapKodu: '', hesapAdi: '', seviye: 0, borcBakiye: 0, alacakBakiye: 0, borcToplami: 0, alacakToplami: 0, ...o };
}

describe('MizanService ozkaynak / sermaye anomalileri', () => {
  const interim = { id: 'm1', taxpayerId: 't1', donem: '2026-03', donemTipi: 'GECICI_Q1' };
  const yilSonu = { id: 'm1', taxpayerId: 't1', donem: '2026-12', donemTipi: 'YILLIK' };

  it('591 bakiye verirse donem zarari 580e devredilmemis uyarisi uretir', async () => {
    const { service, captured } = makeService(
      [hesap({ hesapKodu: '591', hesapAdi: 'Donem Net Zarari', borcBakiye: 5000 })],
      interim,
    );
    await service.analyzeAccounts('m1');
    expect(captured.map((a) => a.tip)).toContain('DONEM_ZARARI_DEVREDILMEMIS');
  });

  it('331 ozsermayenin 3 katini asarsa ortulu sermaye (KVK 12) uretir', async () => {
    const { service, captured } = makeService(
      [
        hesap({ hesapKodu: '500', hesapAdi: 'Sermaye', alacakBakiye: 10000 }),
        hesap({ hesapKodu: '331', hesapAdi: 'Ortaklara Borclar', alacakBakiye: 40000 }),
      ],
      interim,
    );
    await service.analyzeAccounts('m1');
    expect(captured.map((a) => a.tip)).toContain('ORTULU_SERMAYE_RISKI');
  });

  it('yil sonu ozsermaye sermayenin yarisinin altindaysa TTK 376 sermaye kaybi uretir', async () => {
    const { service, captured } = makeService(
      [
        hesap({ hesapKodu: '500', hesapAdi: 'Sermaye', alacakBakiye: 100000 }),
        hesap({ hesapKodu: '580', hesapAdi: 'Gecmis Yillar Zararlari', borcBakiye: 70000 }),
      ],
      yilSonu,
    );
    await service.analyzeAccounts('m1');
    const tips = captured.map((a) => a.tip);
    expect(tips).toContain('TTK376_SERMAYE_KAYBI');
    expect(tips).not.toContain('TTK376_TEKNIK_IFLAS');
  });

  it('yil sonu ozsermaye negatifse TTK 376 teknik iflas uretir', async () => {
    const { service, captured } = makeService(
      [
        hesap({ hesapKodu: '500', hesapAdi: 'Sermaye', alacakBakiye: 50000 }),
        hesap({ hesapKodu: '580', hesapAdi: 'Gecmis Yillar Zararlari', borcBakiye: 90000 }),
      ],
      yilSonu,
    );
    await service.analyzeAccounts('m1');
    expect(captured.map((a) => a.tip)).toContain('TTK376_TEKNIK_IFLAS');
  });

  it('580 ALACAK bakiye verirse ters bakiye (zarar hesabi borc bekler) uyarisi uretir', async () => {
    const { service, captured } = makeService(
      [hesap({ hesapKodu: '580', hesapAdi: 'Gecmis Yillar Zararlari', alacakBakiye: 5000 })],
      interim,
    );
    await service.analyzeAccounts('m1');
    const z = captured.find((a) => a.hesapKodu === '580' && a.tip === 'ZIT_BAKIYE');
    expect(z).toBeDefined();
    expect(z.mesaj).toContain('alacak bakiyesi var');
  });

  it('580 BORC bakiye (normal) verirse ters uyari URETMEZ', async () => {
    const { service, captured } = makeService(
      [hesap({ hesapKodu: '580', hesapAdi: 'Gecmis Yillar Zararlari', borcBakiye: 5000 })],
      interim,
    );
    await service.analyzeAccounts('m1');
    expect(captured.find((a) => a.hesapKodu === '580' && a.tip === 'ZIT_BAKIYE')).toBeUndefined();
  });

  it('hem 131 hem 331 bakiye verirse cift yonlu ortak cari uyarisi uretir', async () => {
    const { service, captured } = makeService(
      [
        hesap({ hesapKodu: '131', hesapAdi: 'Ortaklardan Alacaklar', borcBakiye: 5000 }),
        hesap({ hesapKodu: '331', hesapAdi: 'Ortaklara Borclar', alacakBakiye: 5000 }),
      ],
      interim,
    );
    await service.analyzeAccounts('m1');
    expect(captured.map((a) => a.tip)).toContain('ORTAK_CARI_CIFT_YONLU');
  });

  it('gecici donem sonunda 7xx net acik kalirsa (yansitma eksik) maliyet kapanmamis uyarisi uretir', async () => {
    const { service, captured } = makeService(
      [hesap({ hesapKodu: '740', hesapAdi: 'Hizmet Uretim Maliyeti', borcBakiye: 25000 })],
      interim,
    );
    await service.analyzeAccounts('m1');
    expect(captured.map((a) => a.tip)).toContain('MALIYET_KAPANMAMIS');
  });

  it('gider (740) ve yansitma (741) birbirini kapatiyorsa (net 0) maliyet uyarisi VERMEZ', async () => {
    const { service, captured } = makeService(
      [
        hesap({ hesapKodu: '740', hesapAdi: 'Hizmet Uretim Maliyeti', borcBakiye: 25000 }),
        hesap({ hesapKodu: '741', hesapAdi: 'Hizmet Uretim Maliyeti Yansitma', alacakBakiye: 25000 }),
      ],
      interim,
    );
    await service.analyzeAccounts('m1');
    expect(captured.map((a) => a.tip)).not.toContain('MALIYET_KAPANMAMIS');
  });

  it('saglikli ozkaynakta yeni ozkaynak uyarilari CIKMAZ', async () => {
    const { service, captured } = makeService(
      [
        hesap({ hesapKodu: '500', hesapAdi: 'Sermaye', alacakBakiye: 100000 }),
        hesap({ hesapKodu: '570', hesapAdi: 'Gecmis Yillar Karlari', alacakBakiye: 50000 }),
        hesap({ hesapKodu: '331', hesapAdi: 'Ortaklara Borclar', alacakBakiye: 10000 }),
      ],
      yilSonu,
    );
    await service.analyzeAccounts('m1');
    const tips = captured.map((a) => a.tip);
    expect(tips).not.toContain('ORTULU_SERMAYE_RISKI');
    expect(tips).not.toContain('TTK376_SERMAYE_KAYBI');
    expect(tips).not.toContain('TTK376_TEKNIK_IFLAS');
    expect(tips).not.toContain('DONEM_ZARARI_DEVREDILMEMIS');
    expect(tips).not.toContain('ORTAK_CARI_CIFT_YONLU');
  });
});
