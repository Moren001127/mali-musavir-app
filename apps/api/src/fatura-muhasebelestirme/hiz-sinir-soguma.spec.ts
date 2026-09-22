/**
 * Hız sınırı soğuması (2026-09-22) — Turkcell/isim360 429 kökü: inatla tekrar deneme cezayı uzatıyordu.
 * Ayrıca gece planı soğumadaki mükellefi atlamalı (gece-cekim.gecePlaniOlustur).
 */
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { gecePlaniOlustur } from './gece-cekim';
import {
  SOGUMA_ILK_MS,
  SOGUMA_TAVAN_MS,
  sogumaAtlaSebebi,
  sogumaBaslat,
  sogumaKalanDk,
  sogumaSuruyorMu,
  sogumaTemizle,
} from './hiz-sinir-soguma';

const T0 = new Date('2026-09-22T12:00:00.000Z');
const ileri = (dk: number) => new Date(T0.getTime() + dk * 60000);

describe('soğuma penceresi', () => {
  it('ilk 429 → 30 dk; üst üste 429 → katlanır; tavan 4 saat', () => {
    const ilk = sogumaBaslat(null, T0);
    expect(ilk.cooldownStreak).toBe(1);
    expect(Date.parse(String(ilk.cooldownUntil)) - T0.getTime()).toBe(SOGUMA_ILK_MS);

    const ikinci = sogumaBaslat(ilk, T0);
    expect(ikinci.cooldownStreak).toBe(2);
    expect(Date.parse(String(ikinci.cooldownUntil)) - T0.getTime()).toBe(SOGUMA_ILK_MS * 2);

    let d = ikinci;
    for (let i = 0; i < 8; i++) d = sogumaBaslat(d, T0);
    expect(Date.parse(String(d.cooldownUntil)) - T0.getTime()).toBe(SOGUMA_TAVAN_MS); // tavan
  });

  it('sürüyor mu / kalan dakika / atlama sebebi; bozuk değer çekimi engellemez', () => {
    const d = sogumaBaslat(null, T0); // 30 dk
    expect(sogumaSuruyorMu(d, ileri(10))).toBe(true);
    expect(sogumaKalanDk(d, ileri(10))).toBe(20);
    expect(sogumaAtlaSebebi(d, ileri(10))).toMatch(/20 dk kaldı/);

    expect(sogumaSuruyorMu(d, ileri(31))).toBe(false);
    expect(sogumaKalanDk(d, ileri(31))).toBe(0);
    expect(sogumaAtlaSebebi(d, ileri(31))).toBeNull();

    for (const bozuk of [null, undefined, {}, { cooldownUntil: '' }, { cooldownUntil: 'dün' }]) {
      expect(sogumaSuruyorMu(bozuk as any, T0)).toBe(false);
      expect(sogumaAtlaSebebi(bozuk as any, T0)).toBeNull();
    }
  });

  it('temiz çekim → seri sıfırlanır (bir sonraki 429 yine 30 dk)', () => {
    const temiz = sogumaTemizle();
    expect(temiz).toEqual({ cooldownUntil: null, cooldownStreak: 0 });
    expect(sogumaSuruyorMu(temiz, T0)).toBe(false);
    expect(Date.parse(String(sogumaBaslat(temiz, T0).cooldownUntil)) - T0.getTime()).toBe(SOGUMA_ILK_MS);
  });
});

describe('gece planı soğumaya uyar', () => {
  const baglanti = (cooldownUntil: string | null) => [
    {
      provider: 'TURKCELL',
      isActive: true,
      config: { taxpayers: { tp1: { talimat: true, saat: '02:00', ...(cooldownUntil ? { cooldownUntil } : {}) } } },
    },
  ];
  const saat02 = new Date('2026-09-22T23:05:00.000Z'); // İstanbul 02:05

  it('soğuma yokken plana girer; soğuma sürerken ATLANIR; bitince yine girer', () => {
    expect(gecePlaniOlustur(baglanti(null) as any, saat02).map((p) => p.taxpayerId)).toEqual(['tp1']);

    const sonra = new Date(saat02.getTime() + 60 * 60000).toISOString(); // 1 saat sonra bitecek soğuma
    expect(gecePlaniOlustur(baglanti(sonra) as any, saat02)).toEqual([]);

    const gecmis = new Date(saat02.getTime() - 60000).toISOString(); // 1 dk önce bitmiş
    expect(gecePlaniOlustur(baglanti(gecmis) as any, saat02).map((p) => p.taxpayerId)).toEqual(['tp1']);
  });
});

describe('soğuma kaydı (servis ↔ bağlantı satırı)', () => {
  const servis = (): any => {
    const s: any = Object.create(FaturaMuhasebelestirmeService.prototype);
    s.logger = { log() {}, warn() {}, error() {}, debug() {} };
    return s;
  };

  it('okuma: mükellefe özel soğuma alanları okunur, yoksa boş döner', () => {
    const s = servis();
    const row = { config: { taxpayers: { tp1: { cooldownUntil: '2026-09-22T13:00:00.000Z', cooldownStreak: 2 } } } };
    expect(s.sogumaOku(row, 'tp1')).toEqual({ cooldownUntil: '2026-09-22T13:00:00.000Z', cooldownStreak: 2 });
    expect(s.sogumaOku(row, 'baskaTp')).toEqual({ cooldownUntil: null, cooldownStreak: null });
    expect(s.sogumaOku(null, 'tp1')).toEqual({ cooldownUntil: null, cooldownStreak: null });
  });

  it('yazma: diğer mükellefin ve diğer alanların kaydı BOZULMAZ', async () => {
    const s = servis();
    const kayit: any = {
      config: {
        label: 'Turkcell e-Şirket',
        taxpayers: {
          tp1: { talimat: true, saat: '02:00', encryptedApiKey: 'X' },
          tp2: { talimat: false },
        },
      },
    };
    s.prisma = {
      integrationConnection: {
        findUnique: async () => ({ config: kayit.config }),
        update: async ({ data }: any) => { kayit.config = data.config; return kayit; },
      },
    };
    await s.sogumaYaz('conn1', 'tp1', { cooldownUntil: '2026-09-22T13:00:00.000Z', cooldownStreak: 1 });
    expect(kayit.config.label).toBe('Turkcell e-Şirket');
    expect(kayit.config.taxpayers.tp2).toEqual({ talimat: false });
    expect(kayit.config.taxpayers.tp1).toEqual({
      talimat: true, saat: '02:00', encryptedApiKey: 'X',
      cooldownUntil: '2026-09-22T13:00:00.000Z', cooldownStreak: 1,
    });

    await s.sogumaYaz('conn1', 'tp1', sogumaTemizle()); // temiz çekim → seri sıfırlanır, kimlik korunur
    expect(kayit.config.taxpayers.tp1).toMatchObject({ encryptedApiKey: 'X', cooldownUntil: null, cooldownStreak: 0 });
  });

  it('yazma: bağlantı satırı yoksa sessiz geçer (çekimi patlatmaz)', async () => {
    const s = servis();
    s.prisma = { integrationConnection: { findUnique: async () => null, update: async () => { throw new Error('çağrılmamalı'); } } };
    await expect(s.sogumaYaz('yok', 'tp1', sogumaTemizle())).resolves.toBeUndefined();
  });
});
