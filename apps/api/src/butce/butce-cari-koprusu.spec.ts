import { ButceService } from './butce.service';

/**
 * CARİ KASA ↔ KİŞİSEL BÜTÇE KÖPRÜSÜ — sessizce bozulabilecek üç kural.
 *
 * Bu üç kuralın ortak özelliği şu: bozulduklarında ekran hata vermez, yalnız
 * rakam yanlış çıkar ve fark aylar sonra anlaşılır. Bu yüzden her biri ayrı
 * ayrı kilitleniyor.
 *   1) BEYAZ LİSTE — yalnız `source` boş tahsilat akar. Kural "neyi dışla"
 *      diye yazılırsa yarın eklenen aktarım kaynağı sessizce içeri sızar.
 *   2) KESİM TARİHİ — açılış tarihi olmayan hesaba bağlanma reddedilir; yoksa
 *      yılların tahsilatı açılış bakiyesinin üstüne ikinci kez eklenir.
 *   3) ÇİFT SAYIM KİLİDİ — "Müşavirlik Ücreti" geliri elle girilemez.
 */

const KIMLIK = { tenantId: 'kiracı-1', userId: 'kullanici-1' };

/** Servisi sahte veritabanıyla kurar — Nest kabı ve gerçek Prisma gerekmez. */
const servisKur = (db: any) => new ButceService(db as any, {} as any);

describe('köprü — beyaz liste', () => {
  const servis: any = servisKur({});

  it('yalnız source boş tahsilatı alır', () => {
    const w = servis.aktarilabilirTahsilatWhere('kiracı-1', ['ofis-1']);
    expect(w.source).toBeNull();
    expect(w.tip).toBe('TAHSILAT');
    expect(w.accountId).toEqual({ in: ['ofis-1'] });
  });

  it('kesim tarihi verilince tarih alt sınırı koyar', () => {
    const kesim = new Date('2026-08-01T00:00:00.000Z');
    const w = servis.aktarilabilirTahsilatWhere('kiracı-1', ['ofis-1'], kesim);
    expect(w.tarih).toEqual({ gte: kesim });
  });

  it('kesim tarihi yoksa tarih süzgeci HİÇ konmaz (çağıran akışı kapatmalı)', () => {
    const w = servis.aktarilabilirTahsilatWhere('kiracı-1', ['ofis-1'], null);
    expect(w.tarih).toBeUndefined();
  });
});

describe('köprü — kesim tarihi zorunluluğu', () => {
  const koprukur = (acilisTarihi: Date | null) =>
    servisKur({
      officeFinancialAccount: {
        findFirst: async () => ({ id: 'ofis-1', name: 'Ziraat' }),
        update: async ({ data }: any) => ({ id: 'ofis-1', ...data }),
      },
      butceBankaHesap: {
        findFirst: async () => ({ id: 'butce-1', ad: 'Ofis hesabı', acilisTarihi }),
      },
    }) as any;

  it('açılış tarihi olmayan bütçe hesabına bağlanmayı reddeder', async () => {
    await expect(koprukur(null).ofisHesapEslestir(KIMLIK, 'ofis-1', 'butce-1')).rejects.toThrow(
      /açılış tarihini girin/,
    );
  });

  it('açılış tarihi varsa bağlar', async () => {
    const s = koprukur(new Date('2026-08-01'));
    await expect(s.ofisHesapEslestir(KIMLIK, 'ofis-1', 'butce-1')).resolves.toEqual({
      ok: true,
      eslesti: true,
    });
  });

  it('boş hedefle bağı koparır — bütçe hesabına hiç bakmadan', async () => {
    const s = servisKur({
      officeFinancialAccount: {
        findFirst: async () => ({ id: 'ofis-1', name: 'Ziraat' }),
        update: async () => ({ id: 'ofis-1' }),
      },
      butceBankaHesap: {
        findFirst: async () => {
          throw new Error('bağ koparılırken bütçe hesabına bakılmamalı');
        },
      },
    }) as any;
    await expect(s.ofisHesapEslestir(KIMLIK, 'ofis-1', null)).resolves.toEqual({
      ok: true,
      eslesti: false,
    });
  });
});

describe('köprü — çift sayım kilidi', () => {
  const kilitli = (ad: string) =>
    servisKur({ butceKategori: { findFirst: async () => ({ ad }) } }) as any;

  it('Müşavirlik Ücreti kategorisine elle GELİR girilemez', async () => {
    await expect(
      kilitli('Müşavirlik Ücreti').gelirKilidiKontrol(KIMLIK, 'GELIR', 'kat-1'),
    ).rejects.toThrow(/çift sayılır/);
  });

  it('aynı kategori GİDER tarafında serbesttir', async () => {
    await expect(
      kilitli('Müşavirlik Ücreti').gelirKilidiKontrol(KIMLIK, 'GIDER', 'kat-1'),
    ).resolves.toBeUndefined();
  });

  it('diğer gelir kategorileri açık kalır', async () => {
    await expect(
      kilitli('Kira Geliri').gelirKilidiKontrol(KIMLIK, 'GELIR', 'kat-2'),
    ).resolves.toBeUndefined();
  });

  it('kategorisiz gelir engellenmez', async () => {
    const s = servisKur({
      butceKategori: {
        findFirst: async () => {
          throw new Error('kategori yoksa sorgu hiç atılmamalı');
        },
      },
    }) as any;
    await expect(s.gelirKilidiKontrol(KIMLIK, 'GELIR', null)).resolves.toBeUndefined();
  });
});
