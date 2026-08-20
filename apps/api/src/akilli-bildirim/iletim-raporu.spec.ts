/**
 * İLETİM RAPORU — davranış kilidi.
 *
 * Buradaki üç şey CANLI mükellefe belge gönderdiği için elle doğrulanamaz;
 * regresyonu ancak test yakalar:
 *
 *  1. "Başarısızları Yeniden Dene" düğmesi ASLA `force` göndermez. Eski hâlinde
 *     `force: true` vardı; bu, "bu belge zaten gönderildi" korumasını deliyor
 *     ve tek bir e-posta hatası yüzünden 40 günlük belgeyi mükellefe YENİDEN
 *     gönderebiliyordu.
 *  2. Test modunda yapılan gönderim "iletildi" SAYILMAZ — belge mükellefin
 *     eline geçmemiştir.
 *  3. Bir kategoride bir kanal başarısızsa hücre BAŞARISIZ gösterir. Eskiden
 *     "en iyi durum" gösteriliyordu; WhatsApp patlayıp e-posta gidince hücre
 *     ✓ oluyor, hata metni tamamen kayboluyordu.
 */
import { AkilliBildirimService } from './akilli-bildirim.service';

/** Sadece bu testlerin dokunduğu prisma yüzeyi taklit edilir. */
function sahtePrisma(opts: {
  dispatch?: any[];
  failed?: any[];
  taxpayers?: any[];
  settings?: any[];
} = {}) {
  const dispatch = opts.dispatch || [];
  return {
    documentDispatch: {
      findMany: jest.fn(async (q: any) => {
        // resendFailed yalnız FAILED sorgular; report() ay içindekilerin hepsini
        if (q?.where?.status === 'FAILED') return opts.failed || [];
        return dispatch;
      }),
    },
    taxpayer: { findMany: jest.fn(async () => opts.taxpayers || []) },
    beyanKaydi: { findMany: jest.fn(async () => []) },
    portalDocument: { findMany: jest.fn(async () => []) },
    smartDispatchSetting: { findMany: jest.fn(async () => opts.settings || []) },
  } as any;
}

function servis(prisma: any) {
  const s = new AkilliBildirimService(
    prisma,
    {} as any, // storage
    {} as any, // whatsapp
    {} as any, // email
    {} as any, // shortLink
  );
  // todaySummary ayrı bir sorgu kümesi; bu testlerin konusu değil
  (s as any).todaySummary = jest.fn(async () => ({}));
  (s as any).getSettings = jest.fn(async () => prisma.smartDispatchSetting.findMany());
  return s;
}

describe('İletim Raporu — yeniden deneme güvenliği', () => {
  it('resendFailed force GÖNDERMEZ (gönderilmiş belge tekrar gitmez)', async () => {
    const prisma = sahtePrisma({
      failed: [{ taxpayerId: 't1', kategori: 'SGK' }],
    });
    const s = servis(prisma);
    const cagrilar: any[] = [];
    (s as any).runKategori = jest.fn(async (_t: string, k: string, o: any) => {
      cagrilar.push({ kategori: k, opts: o });
      return { ok: true };
    });

    await s.resendFailed('tenant', '2026-08');

    expect(cagrilar).toHaveLength(1);
    expect(cagrilar[0].opts.force).toBeUndefined();
    expect(cagrilar[0].opts.taxpayerId).toBe('t1');
  });

  it('pencere 40 gün değil, raporun baktığı ay kadardır', async () => {
    const prisma = sahtePrisma({ failed: [{ taxpayerId: 't1', kategori: 'VERGI' }] });
    const s = servis(prisma);
    let gecenOpts: any = null;
    (s as any).runKategori = jest.fn(async (_t: string, _k: string, o: any) => {
      gecenOpts = o;
      return { ok: true };
    });

    await s.resendFailed('tenant', '2026-08');

    // 40 gün = 960 saat. Ağustos'un en uzun hâli bile 744 saattir.
    expect(gecenOpts.sinceHours).toBeLessThan(24 * 32);
    expect(gecenOpts.sinceHours).toBeGreaterThan(0);
  });

  it('ayarı olmayan kategori "denendi" sayılmaz, atlanan olarak raporlanır', async () => {
    const prisma = sahtePrisma({
      failed: [
        { taxpayerId: 't1', kategori: 'SGK' },
        { taxpayerId: 't2', kategori: 'ODEME_LISTESI' },
      ],
    });
    const s = servis(prisma);
    (s as any).runKategori = jest.fn(async (_t: string, k: string) =>
      k === 'ODEME_LISTESI' ? { ok: false, error: 'ayar yok' } : { ok: true },
    );

    const r: any = await s.resendFailed('tenant', '2026-08');

    expect(r.denenen).toBe(1);
    expect(r.atlanan).toBe(1);
  });
});

describe('İletim Raporu — sayaçların doğruluğu', () => {
  const tp = [{ id: 't1', companyName: 'ÖRNEK LTD', firstName: null, lastName: null }];

  it('test modundaki gönderim "iletildi" sayılmaz', async () => {
    const prisma = sahtePrisma({
      dispatch: [
        { taxpayerId: 't1', kategori: 'SGK', status: 'SENT', channel: 'WHATSAPP', testMode: true, error: null },
      ],
      taxpayers: tp,
    });
    const r: any = await servis(prisma).report('tenant', '2026-08');

    expect(r.totals.sent).toBe(0);
    expect(r.totals.testGonderim).toBe(1);
    expect(r.taxpayers[0].SGK.testMode).toBe(true);
  });

  it('bir kanal başarısızsa hücre BAŞARISIZ kalır, hata metni silinmez', async () => {
    const prisma = sahtePrisma({
      dispatch: [
        { taxpayerId: 't1', kategori: 'VERGI', status: 'SENT', channel: 'EMAIL', testMode: false, error: null },
        { taxpayerId: 't1', kategori: 'VERGI', status: 'FAILED', channel: 'WHATSAPP', testMode: false, error: 'ILETISIM-mükellefin telefon numarası yok' },
      ],
      taxpayers: tp,
    });
    const r: any = await servis(prisma).report('tenant', '2026-08');

    expect(r.taxpayers[0].VERGI.status).toBe('FAILED');
    expect(r.taxpayers[0].VERGI.error).toContain('telefon');
    // iki kanal da izlenebilir kalmalı
    expect(r.taxpayers[0].VERGI.kanallar).toHaveLength(2);
    expect(r.totals.sent).toBe(1);
    expect(r.totals.failed).toBe(1);
  });

  it('iletişim eksiği sabit koddan sayılır (serbest metinden değil)', async () => {
    const prisma = sahtePrisma({
      dispatch: [
        { taxpayerId: 't1', kategori: 'SGK', status: 'FAILED', channel: 'WHATSAPP', testMode: false, error: 'ILETISIM-mükellefin telefon numarası yok' },
        { taxpayerId: 't1', kategori: 'ETEBLIGAT', status: 'FAILED', channel: 'EMAIL', testMode: false, error: 'SMTP bağlantısı kurulamadı' },
      ],
      taxpayers: tp,
    });
    const r: any = await servis(prisma).report('tenant', '2026-08');

    expect(r.totals.failed).toBe(2);
    // badContact, failed'in ALT KÜMESİ — toplanmaz
    expect(r.totals.badContact).toBe(1);
  });
});

describe('İletim Raporu — hiç denenmemişler görünür', () => {
  it('belgesi olup gönderim kaydı olmayan mükellef tabloya "BEKLIYOR" olarak girer', async () => {
    const prisma = sahtePrisma({
      dispatch: [],
      taxpayers: [],
      settings: [{ kategori: 'SGK', enabled: true, whatsapp: true, email: false, excludedTaxpayerIds: [] }],
    });
    prisma.portalDocument.findMany = jest.fn(async () => [
      { taxpayerId: 't9', belgeTuru: 'SGK_TAHAKKUK' },
    ]);
    prisma.taxpayer.findMany = jest.fn(async () => [
      { id: 't9', companyName: 'GÖRÜNMEYEN LTD', phone: '05550000000', phones: [], email: null, emails: [], isActive: true },
    ]);

    const r: any = await servis(prisma).report('tenant', '2026-08');

    expect(r.totals.bekleyen).toBe(1);
    const satir = r.taxpayers.find((x: any) => x.taxpayerId === 't9');
    expect(satir).toBeTruthy();
    expect(satir.SGK.status).toBe('BEKLIYOR');
    expect(satir.SGK.error).toBe('henüz denenmedi');
  });

  it('kategori kapalıysa sebep bunu söyler', async () => {
    const prisma = sahtePrisma({
      dispatch: [],
      taxpayers: [],
      settings: [{ kategori: 'SGK', enabled: false, whatsapp: true, email: false, excludedTaxpayerIds: [] }],
    });
    prisma.portalDocument.findMany = jest.fn(async () => [{ taxpayerId: 't9', belgeTuru: 'SGK_TAHAKKUK' }]);
    prisma.taxpayer.findMany = jest.fn(async () => [
      { id: 't9', companyName: 'KAPALI LTD', phone: '05550000000', phones: [], email: null, emails: [], isActive: true },
    ]);

    const r: any = await servis(prisma).report('tenant', '2026-08');
    expect(r.taxpayers[0].SGK.error).toContain('kategori kapalı');
  });

  it('telefonu olmayan mükellefin sebebi "telefon numarası yok" olur', async () => {
    const prisma = sahtePrisma({
      dispatch: [],
      taxpayers: [],
      settings: [{ kategori: 'SGK', enabled: true, whatsapp: true, email: false, excludedTaxpayerIds: [] }],
    });
    prisma.portalDocument.findMany = jest.fn(async () => [{ taxpayerId: 't9', belgeTuru: 'SGK_TAHAKKUK' }]);
    prisma.taxpayer.findMany = jest.fn(async () => [
      { id: 't9', companyName: 'TELEFONSUZ LTD', phone: null, phones: [], email: null, emails: [], isActive: true },
    ]);

    const r: any = await servis(prisma).report('tenant', '2026-08');
    expect(r.taxpayers[0].SGK.error).toBe('telefon numarası yok');
  });

  it('gönderim kaydı olan mükellef "bekliyor" sayılmaz', async () => {
    const prisma = sahtePrisma({
      dispatch: [{ taxpayerId: 't9', kategori: 'SGK', status: 'SENT', channel: 'WHATSAPP', testMode: false, error: null }],
      taxpayers: [{ id: 't9', companyName: 'GİTMİŞ LTD', firstName: null, lastName: null }],
      settings: [{ kategori: 'SGK', enabled: true, whatsapp: true, email: false, excludedTaxpayerIds: [] }],
    });
    prisma.portalDocument.findMany = jest.fn(async () => [{ taxpayerId: 't9', belgeTuru: 'SGK_TAHAKKUK' }]);

    const r: any = await servis(prisma).report('tenant', '2026-08');
    expect(r.totals.bekleyen).toBe(0);
    expect(r.taxpayers[0].SGK.status).toBe('SENT');
  });
});
