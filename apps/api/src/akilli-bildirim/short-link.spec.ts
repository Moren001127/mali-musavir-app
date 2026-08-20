/**
 * KISA BELGE LİNKİ — ömür kilidi.
 *
 * Bu uç KİMLİKSİZDİR: `/b/:token` adresini eline geçiren herkes belgeyi açar
 * (tek koruma dakikada 100 istek sınırı). Ömür bu yüzden bilinçli bir karardır,
 * rastgele bir sayı değil. Testler iki şeyi kilitler:
 *   1. Ömür TEK YERDE tanımlıdır ve çağıranlar onu kısaltmaz. Önceden dört ayrı
 *      çağrı elle `7` geçiyordu; biri unutulsa fark edilmezdi.
 *   2. Süresi dolmuş link AÇILMAZ. Süre uzatıldı diye bu kontrolün kazara
 *      kalkması, geçmişteki tüm belgeleri süresiz açık bırakırdı.
 */
import { NotFoundException } from '@nestjs/common';
import { ShortLinkService, ShortLinkController, KISA_LINK_OMRU_GUN } from './short-link.controller';

function sahtePrisma() {
  const yazilan: any[] = [];
  return {
    yazilan,
    shortLink: {
      create: jest.fn(async ({ data }: any) => {
        yazilan.push(data);
        return data;
      }),
      findUnique: jest.fn(),
    },
  } as any;
}

describe('Kısa belge linki — ömür', () => {
  it('varsayılan ömür 1 yıldır ve tek yerden gelir', async () => {
    const prisma = sahtePrisma();
    const svc = new ShortLinkService(prisma);

    await svc.create('tenant', 'depo/anahtar.pdf', 'Beyanname.pdf');

    expect(KISA_LINK_OMRU_GUN).toBe(365);
    const d = prisma.yazilan[0];
    const gun = (d.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(gun).toBeGreaterThan(364);
    expect(gun).toBeLessThanOrEqual(365);
  });

  it('token tahmin edilemeyecek kadar uzundur', async () => {
    const prisma = sahtePrisma();
    await new ShortLinkService(prisma).create('tenant', 'k', 'a.pdf');
    // 6 bayt rastgele → base64url 8 karakter (48 bit)
    expect(prisma.yazilan[0].token).toHaveLength(8);
  });

  it('süresi dolmuş link AÇILMAZ', async () => {
    const prisma = sahtePrisma();
    prisma.shortLink.findUnique = jest.fn(async () => ({
      storageKey: 'k',
      filename: 'a.pdf',
      expiresAt: new Date(Date.now() - 1000), // 1 saniye önce doldu
    }));
    const ctrl = new ShortLinkController(prisma, {} as any);

    await expect(ctrl.open('abc12345', {} as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('geçerli link belgeye yönlendirir', async () => {
    const prisma = sahtePrisma();
    prisma.shortLink.findUnique = jest.fn(async () => ({
      storageKey: 'depo/anahtar.pdf',
      filename: 'Beyanname.pdf',
      expiresAt: new Date(Date.now() + 86_400_000),
    }));
    const storage = { getPresignedInlineUrl: jest.fn(async () => 'https://depo/imzali') } as any;
    const ctrl = new ShortLinkController(prisma, storage);
    const res = { redirect: jest.fn() } as any;

    await ctrl.open('abc12345', res);

    expect(res.redirect).toHaveBeenCalledWith(302, 'https://depo/imzali');
  });

  it('.pdf uzantısı token’dan temizlenir (WhatsApp bazı linklere ekliyor)', async () => {
    const prisma = sahtePrisma();
    prisma.shortLink.findUnique = jest.fn(async () => null);
    const ctrl = new ShortLinkController(prisma, {} as any);

    await expect(ctrl.open('abc12345.pdf', {} as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.shortLink.findUnique).toHaveBeenCalledWith({ where: { token: 'abc12345' } });
  });
});
