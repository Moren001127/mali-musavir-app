/**
 * get_kdv1_on_hazirlik aracı — KdvBeyannameService.kdv1OnHazirlik çıktısının ajan/bot için sadeleştirilmiş hali.
 *  - KDV Kontrol oturumu yoksa (her iki taraf kritik "verisi bulunamadı") → ok:false, error sabit, rakam yok
 *  - Oturum varsa → {ok, donem, sonuc, devreden{kaynak}, lucaKontrol, kdvKontrolVar, uyarilar}
 * Servis jest.mock ile sahte (xlsx/pdf-parse zinciri yüklenmez); Prisma yok.
 */
jest.mock('../kdv-beyanname/kdv-beyanname.service', () => ({ KdvBeyannameService: class KdvBeyannameService {} }));

import { ToolExecutorService } from './tool-executor.service';

function aracKur(kdv1OnHazirlik: (p: any) => Promise<any>) {
  const svc = { kdv1OnHazirlik };
  const moduleRef = { get: () => svc };
  const tool = new ToolExecutorService({} as any, moduleRef as any);
  return { tool, svc };
}

const ctx = { tenantId: 't1', userId: 'u1', taxpayerId: null };
const TAXPAYER = 'cmqgpx7xd0d7swns6sw3am42o';

const kontrolYok = (taraf: 'SATIS' | 'ALIS') => ({
  tur: 'kdv_kontrol',
  seviye: 'kritik',
  taraf,
  mesaj: 'Bu donem icin KDV Kontrol verisi bulunamadi; beyanname on hazirligi uretilemedi.',
});

describe('get_kdv1_on_hazirlik', () => {
  it('parametre doğrulama: taxpayerId ve YYYY-MM dönem şart; "2026/8" normalize edilir', async () => {
    const cagrilar: any[] = [];
    const { tool } = aracKur(async (p) => {
      cagrilar.push(p);
      return { eksikVeriler: [kontrolYok('SATIS'), kontrolYok('ALIS')], devreden: { tutar: 0, kaynak: 'yok' } };
    });
    expect((await tool.execute('get_kdv1_on_hazirlik', { donem: '2026-08' }, ctx)).ok).toBe(false);
    expect((await tool.execute('get_kdv1_on_hazirlik', { taxpayerId: TAXPAYER, donem: 'Ağustos' }, ctx)).ok).toBe(false);
    expect(cagrilar).toHaveLength(0);

    await tool.execute('get_kdv1_on_hazirlik', { taxpayerId: TAXPAYER, donem: '2026/8' }, ctx);
    expect(cagrilar).toHaveLength(1);
    expect(cagrilar[0]).toEqual({ tenantId: 't1', mukellefId: TAXPAYER, donem: '2026-08', computePrevDevreden: true });
  });

  it('KDV Kontrol oturumu yoksa ok:false — rakam üretilmez, devreden kaynağı yine görünür', async () => {
    const { tool } = aracKur(async () => ({
      mukellefId: TAXPAYER,
      mukellefAd: 'FAMCOFFEE',
      donem: '2026-08',
      satis: { toplamMatrah: 0, toplamHesaplananKdv: 0, faturaAdet: 0, oranlar: [] },
      alis: { toplamMatrah: 0, toplamIndirilecekKdv: 0, faturaAdet: 0, oranlar: [] },
      devreden: { tutar: 1234.5, kaynak: 'beyanname_pdf', sonKayitDonem: '2026-07' },
      sonuc: { hesaplananKdv: 0, indirilecekKdv: 0, devredenKdv: 1234.5, odenecekKdv: 0, sonrakiAyaDevreden: 1234.5 },
      lucaKontrol: { mizanVar: false, uyarilar: [] },
      kaliteRapor: { uyarilar: [] },
      eksikVeriler: [kontrolYok('SATIS'), kontrolYok('ALIS')],
      veriGuveni: { seviye: 'eksik', puan: 0 },
    }));
    const r = await tool.execute('get_kdv1_on_hazirlik', { taxpayerId: TAXPAYER, donem: '2026-08' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('KDV Kontrol oturumu yok');
    expect(r.kdvKontrolVar).toBe(false);
    expect(r.sonuc).toBeUndefined();
    expect(r.devreden).toEqual({
      tutar: 1234.5,
      kaynak: 'beyanname_pdf',
      sonKayitDonem: '2026-07',
      kaynakAciklama: expect.stringContaining('Sonraki Döneme Devreden'),
    });
    expect(r.uyarilar.some((u: string) => /KDV Kontrol verisi bulunamad/.test(u))).toBe(true);
  });

  it('oturum varsa sadeleştirilmiş paket: sonuc, devreden, lucaKontrol, uyarilar (kritik/uyari + Luca + kalite)', async () => {
    const { tool } = aracKur(async () => ({
      mukellefId: TAXPAYER,
      mukellefAd: 'FAMCOFFEE',
      donem: '2026-08',
      satis: { toplamMatrah: 10000, toplamHesaplananKdv: 2000, faturaAdet: 3, oranlar: [{ oran: 20, matrah: 10000, kdv: 2000, adet: 3, kaynak: 'kdv_kontrol' }] },
      alis: {
        toplamMatrah: 4000,
        toplamIndirilecekKdv: 800,
        faturaAdet: 2,
        oranlar: [{ oran: 20, matrah: 4000, kdv: 800, adet: 2 }],
        tevkifatsiz: { matrah: 4000, kdv: 800, adet: 2 },
        tevkifatli: { matrah: 0, kdv: 0, adet: 0 },
      },
      devreden: { tutar: 300, kaynak: 'beyanname_pdf', sonKayitDonem: '2026-07' },
      sonuc: { hesaplananKdv: 2000, indirilecekKdv: 800, devredenKdv: 300, odenecekKdv: 900, sonrakiAyaDevreden: 0 },
      lucaKontrol: { mizanVar: true, luca391Bakiye: 2000, luca191Bakiye: 800.5, luca190Bakiye: 300, fark391: 0, fark191: -0.5, uyarilar: ['191 farkı 0,50 TL'] },
      kaliteRapor: { uyarilar: ['1 adet tevkifatlı alış OCR dışı'] },
      eksikVeriler: [
        { tur: 'kdv_kontrol', seviye: 'uyari', taraf: 'ALIS', belgeNo: 'ABC1', mesaj: 'KDV Kontrol kaydi NEEDS_REVIEW durumunda' },
        { tur: 'devreden_kdv', seviye: 'bilgi', taraf: 'GENEL', mesaj: 'bilgi satırı' },
      ],
      veriGuveni: { seviye: 'kontrol_gerekli', puan: 70 },
    }));
    const r = await tool.execute('get_kdv1_on_hazirlik', { taxpayerId: TAXPAYER, donem: '2026-08' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.donem).toBe('2026-08');
    expect(r.kdvKontrolVar).toBe(true);
    expect(r.hazirMi).toBe(false); // veri güveni kesin değil
    expect(r.sonuc).toEqual({ matrah: 10000, hesaplananKdv: 2000, indirilecekKdv: 800, devredenKdv: 300, odenecekKdv: 900, sonrakiAyaDevreden: 0 });
    expect(r.devreden.kaynak).toBe('beyanname_pdf');
    expect(r.satis.oranlar).toEqual([{ oran: 20, matrah: 10000, kdv: 2000, adet: 3 }]);
    expect(r.alis.tevkifatli).toEqual({ matrah: 0, kdv: 0, adet: 0 });
    expect(r.lucaKontrol).toMatchObject({ mizanVar: true, fark191: -0.5, luca190Bakiye: 300 });
    // uyarilar: bilgi seviyesi girmez; Luca + kalite etiketli girer
    expect(r.uyarilar).toEqual(['[ALIS] KDV Kontrol kaydi NEEDS_REVIEW durumunda', '[LUCA] 191 farkı 0,50 TL', '[KALİTE] 1 adet tevkifatlı alış OCR dışı']);
    expect(r.eksikVeriAdet).toBe(2);
  });

  it('servis çözülemezse ok:false, uydurma yok', async () => {
    const tool = new ToolExecutorService({} as any, { get: () => null } as any);
    const r = await tool.execute('get_kdv1_on_hazirlik', { taxpayerId: TAXPAYER, donem: '2026-08' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/kullanılamıyor/);
  });
});
