/**
 * SGK Bildirge "çalışan var / yok" (2026-09-22) — sahte Prisma ile servis testi.
 *   cd apps/api && npx jest src/beyanname-takip/beyanname-takip.bildirge
 * Kural: SGK şifresi tanımlı ama o dönem personel çalıştırmayan mükellef "çalışan yok" işaretlenince o VERGİ DÖNEMİ
 * Verildi sayılır (BeyanDurumu BILDIRGE onaylandi + notlar CALISAN_YOK). Gerçek verilmiş kayıt ezilmez; geri alma
 * yalnız CALISAN_YOK notlu kaydı siler.
 */
import { BILDIRGE_CALISAN_YOK_NOTU, BeyannameTakipService, resolveBeyanState } from './beyanname-takip.service';

function sahtePrisma(mevcut: any | null) {
  const cagrilar: Record<string, any[]> = { upsert: [], delete: [] };
  const prisma: any = {
    taxpayer: { findFirst: jest.fn(async () => ({ id: 'tp1' })) },
    beyanDurumu: {
      findUnique: jest.fn(async () => mevcut),
      upsert: jest.fn(async (arg: any) => { cagrilar.upsert.push(arg); return { ...arg.create }; }),
      delete: jest.fn(async (arg: any) => { cagrilar.delete.push(arg); return mevcut; }),
    },
  };
  return { prisma, cagrilar };
}

describe('bildirgeCalisanDurumu', () => {
  it('çalışan yok → BILDIRGE + vergi dönemi için onaylandi + CALISAN_YOK notu yazar', async () => {
    const { prisma, cagrilar } = sahtePrisma(null);
    const svc = new BeyannameTakipService(prisma);
    const sonuc = await svc.bildirgeCalisanDurumu('t1', 'tp1', '2026-08', false);
    expect(sonuc).toEqual({ calisanYok: true, degisti: true });
    expect(cagrilar.upsert).toHaveLength(1);
    expect(cagrilar.upsert[0].create).toMatchObject({ tenantId: 't1', taxpayerId: 'tp1', beyanTipi: 'BILDIRGE', donem: '2026-08', durum: 'onaylandi', notlar: BILDIRGE_CALISAN_YOK_NOTU });
    expect(cagrilar.upsert[0].create.onayTarihi).toBeInstanceOf(Date);
  });

  it('gerçekten verilmiş (onaylandi, CALISAN_YOK değil) kaydı EZMEZ', async () => {
    const { prisma, cagrilar } = sahtePrisma({ durum: 'onaylandi', notlar: 'SGK tahakkuk fişi indirildi' });
    const svc = new BeyannameTakipService(prisma);
    const sonuc = await svc.bildirgeCalisanDurumu('t1', 'tp1', '2026-08', false);
    expect(sonuc.degisti).toBe(false);
    expect(sonuc.calisanYok).toBe(false);
    expect(sonuc.neden).toMatch(/verilmiş/);
    expect(cagrilar.upsert).toHaveLength(0);
  });

  it('çalışan var → yalnız CALISAN_YOK notlu kaydı siler', async () => {
    const { prisma, cagrilar } = sahtePrisma({ durum: 'onaylandi', notlar: BILDIRGE_CALISAN_YOK_NOTU });
    const svc = new BeyannameTakipService(prisma);
    const sonuc = await svc.bildirgeCalisanDurumu('t1', 'tp1', '2026-08', true);
    expect(sonuc).toEqual({ calisanYok: false, degisti: true });
    expect(cagrilar.delete).toHaveLength(1);
    expect(cagrilar.delete[0].where.tenantId_taxpayerId_beyanTipi_donem).toEqual({ tenantId: 't1', taxpayerId: 'tp1', beyanTipi: 'BILDIRGE', donem: '2026-08' });
  });

  it('çalışan var, işaret yokken → hiçbir şey silmez', async () => {
    const { prisma, cagrilar } = sahtePrisma({ durum: 'hatali', notlar: null });
    const svc = new BeyannameTakipService(prisma);
    const sonuc = await svc.bildirgeCalisanDurumu('t1', 'tp1', '2026-08', true);
    expect(sonuc).toEqual({ calisanYok: false, degisti: false });
    expect(cagrilar.delete).toHaveLength(0);
  });

  it('mükellef başka kiracıdaysa hata', async () => {
    const { prisma } = sahtePrisma(null);
    prisma.taxpayer.findFirst = jest.fn(async () => null);
    const svc = new BeyannameTakipService(prisma);
    await expect(svc.bildirgeCalisanDurumu('t1', 'tp1', '2026-08', false)).rejects.toThrow('Mükellef bulunamadı');
  });
});

describe('resolveBeyanState — CALISAN_YOK kaydı', () => {
  it('Eylül 2026 verilme döneminde Ağustos bildirgesi onaylandi (Verildi) sayılır, kayıt ekranda tanınır', () => {
    const kayit = { durum: 'onaylandi', notlar: BILDIRGE_CALISAN_YOK_NOTU, onayTarihi: new Date('2026-09-21T14:05:00Z'), updatedAt: new Date() };
    const durumIndex = new Map<string, any>([['tp1::BILDIRGE::2026-08', kayit]]);
    const r = resolveBeyanState(durumIndex, new Map(), 'tp1', 'BILDIRGE', 2026, 9, '2026-09', 'VERILME');
    expect(r.durum).toBe('onaylandi');
    expect(r.matchedDonem).toBe('2026-08');
    expect(r.durumKaydi?.notlar).toBe(BILDIRGE_CALISAN_YOK_NOTU);
  });
});
