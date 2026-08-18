import { ButceService } from './butce.service';

/**
 * TAHSİLAT ↔ BÜTÇE HESABI — sessizce bozulabilecek üç kural.
 *
 * Üçünün ortak özelliği: bozulduklarında ekran hata vermez, yalnız rakam
 * yanlış çıkar ve fark aylar sonra anlaşılır.
 *   1) BEYAZ LİSTE — yalnız `source` boş tahsilat akar. Kural "neyi dışla" diye
 *      yazılırsa yarın eklenen aktarım kaynağı sessizce içeri sızar.
 *   2) KESİM TARİHİ — tahsilata açılan hesapta açılış tarihi zorunlu; yoksa
 *      yılların tahsilatı açılış bakiyesinin üstüne ikinci kez eklenir.
 *   3) ÇİFT SAYIM KİLİDİ — "Müşavirlik Ücreti" geliri elle girilemez.
 */

const KIMLIK = { tenantId: 'kiracı-1', userId: 'kullanici-1' };

/** Servisi sahte veritabanıyla kurar — Nest kabı ve gerçek Prisma gerekmez. */
const servisKur = (db: any) => new ButceService(db as any, {} as any);

describe('tahsilat — beyaz liste', () => {
  const servis: any = servisKur({});

  it('yalnız source boş tahsilatı alır ve tek hesaba bakar', () => {
    const w = servis.aktarilabilirTahsilatWhere('kiracı-1', 'hesap-1');
    expect(w.source).toBeNull();
    expect(w.tip).toBe('TAHSILAT');
    // Ofis hesabı dolayımı kalktı: doğrudan bütçe hesabının kimliği
    expect(w.accountId).toBe('hesap-1');
  });

  it('kesim tarihi verilince tarih alt sınırı koyar', () => {
    const kesim = new Date('2026-08-01T00:00:00.000Z');
    const w = servis.aktarilabilirTahsilatWhere('kiracı-1', 'hesap-1', kesim);
    expect(w.tarih).toEqual({ gte: kesim });
  });

  it('kesim tarihi yoksa tarih süzgeci HİÇ konmaz (çağıran akışı kapatmalı)', () => {
    const w = servis.aktarilabilirTahsilatWhere('kiracı-1', 'hesap-1', null);
    expect(w.tarih).toBeUndefined();
  });
});

describe('tahsilat — kesim tarihi zorunluluğu', () => {
  const kaydeden = () => {
    const yazilan: any[] = [];
    const servis: any = servisKur({
      butceBankaHesap: {
        create: async ({ data }: any) => {
          yazilan.push(data);
          return { id: 'yeni-1', ...data };
        },
      },
      // bankaHesapNormalize'ın sorguları
      butceIslem: { aggregate: async () => ({ _sum: { tutar: 0 } }) },
      butceOdeme: { aggregate: async () => ({ _sum: { tutar: 0 } }) },
      cariHareket: { aggregate: async () => ({ _sum: { tutar: 0 } }) },
    });
    return { servis, yazilan };
  };

  const govde = (ekle: any) => ({
    ad: 'Ofis hesabı',
    bankaAdi: 'Ziraat',
    ...ekle,
  });

  it('tahsilata açık hesapta açılış tarihi yoksa reddeder', async () => {
    const { servis } = kaydeden();
    await expect(
      servis.bankaHesapKaydet(KIMLIK, govde({ tahsilataAcik: true })),
    ).rejects.toThrow(/açılış tarihini girin/);
  });

  it('açılış tarihi varsa tahsilata açık hesabı kaydeder', async () => {
    const { servis, yazilan } = kaydeden();
    await servis.bankaHesapKaydet(
      KIMLIK,
      govde({ tahsilataAcik: true, acilisTarihi: '2026-08-17' }),
    );
    expect(yazilan[0].tahsilataAcik).toBe(true);
  });

  it('tahsilata kapalı hesap açılış tarihi olmadan da kaydedilir', async () => {
    const { servis, yazilan } = kaydeden();
    await servis.bankaHesapKaydet(KIMLIK, govde({}));
    expect(yazilan[0].tahsilataAcik).toBe(false);
    expect(yazilan[0].acilisTarihi).toBeNull();
  });
});

describe('tahsilat — sayaçlar karışmasın', () => {
  it('kasaya giren tahsilatı "hesabı seçilmemiş" saymaz', async () => {
    // GERÇEK HATA (2026-08-18): kasa süzgeci iki şart ararken bu sayaç yalnız
    // accountId'ye bakıyordu. Nakit tahsilat hem kasa bakiyesine giriyor hem
    // "bakiyeye eklenmedi" uyarısı veriyordu — ekranda apaçık çelişki.
    let hesapsizWhere: any = null;
    const servis: any = servisKur({
      cariHareket: {
        aggregate: async ({ where }: any) => {
          if (where.source === null) hesapsizWhere = where;
          return { _count: { _all: 0 }, _sum: { tutar: 0 } };
        },
      },
    });
    await servis.tahsilatOzeti(KIMLIK);
    expect(hesapsizWhere.odemeYontemi).toEqual({ not: 'NAKIT' });
  });

  it('düzeltilebilir eksik ile arşivi AYRI sayar', async () => {
    const sorgular: any[] = [];
    const servis: any = servisKur({
      cariHareket: {
        aggregate: async ({ where }: any) => {
          sorgular.push(where);
          // İlki hesabı seçilmemiş, ikincisi arşiv
          return where.source === null
            ? { _count: { _all: 2 }, _sum: { tutar: 500 } }
            : { _count: { _all: 600 }, _sum: { tutar: 3494600.05 } };
        },
      },
    });
    const ozet = await servis.tahsilatOzeti(KIMLIK);
    expect(ozet.hesabiSecilmemis).toEqual({ adet: 2, toplam: 500 });
    expect(ozet.arsiv).toEqual({ adet: 600, toplam: 3494600.05 });
    // Arşiv sorgusu source DOLU olanları arar; ikisi aynı süzgeci kullanırsa
    // biri diğerini gizler (bir kez böyle bir gerileme yaşandı).
    expect(sorgular[0].accountId).toBeNull();
    expect(sorgular[1].source).toEqual({ not: null });
  });
});

describe('nakit kasa — hesap ile kasa karışmasın', () => {
  const servis: any = servisKur({});

  it('kasa süzgeci İKİ şartı birden arar', () => {
    const w = servis.nakitTahsilatWhere('kiracı-1');
    expect(w.accountId).toBeNull();
    // odemeYontemi şartı düşerse, hesabı YANLIŞLIKLA seçilmemiş tahsilat da
    // kasaya girer ve "hesabı seçilmemiş" uyarısı sessizce kaybolur.
    expect(w.odemeYontemi).toBe('NAKIT');
    expect(w.source).toBeNull();
  });

  it('kasa süzgecinde tarih sınırı YOK (kasanın açılış tarihi yok)', () => {
    expect((servis.nakitTahsilatWhere('kiracı-1') as any).tarih).toBeUndefined();
  });

  it('hesaplı tahsilat süzgeci kasayı içine almaz', () => {
    const w = servis.aktarilabilirTahsilatWhere('kiracı-1', 'hesap-1');
    expect(w.accountId).toBe('hesap-1');
    expect((w as any).odemeYontemi).toBeUndefined();
  });
});

describe('gelir — çift sayım kilidi', () => {
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
