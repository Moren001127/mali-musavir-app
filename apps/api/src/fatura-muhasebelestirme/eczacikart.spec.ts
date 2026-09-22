/**
 * ECZACIKART (TEB Eczacı Kart — altyapı Kolaysoft) adaptörü, 2026-09-22.
 * Gerçek hesap kimliği Muzaffer Bey tarafından portalden girilir; burada `fetch` sahteyle davranış kilitlenir:
 *  • OTP (SMS) istenirse NET hata — portal şifresiyle otomatik çekim yapılamaz, web servis hesabı gerekir.
 *  • Liste ucu adı kesin bilinmediği için aday uçlar sırayla denenir; ilk çalışan kullanılır.
 *  • Hiçbiri çalışmazsa denenen uçlar hata metninde görünür (kör kalma yok).
 */
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

function servis(): any {
  const s: any = Object.create(FaturaMuhasebelestirmeService.prototype);
  s.logger = { log() {}, warn() {}, error() {}, debug() {} };
  return s;
}

const cfg = {
  provider: 'ECZACIKART',
  label: 'Eczacıkart',
  baseUrl: 'https://portal.eczacikartfatura.com',
  username: '8680000000000',
  password: 'gizli',
} as any;

const opts = {
  taxpayer: { id: 'tp1', companyName: 'ECZANE' },
  direction: 'ALIS' as const,
  period: { donem: '2026-08', startDate: '2026-08-01', endDate: '2026-08-31' },
  limit: 5,
};

const yanit = (body: any, init: { status?: number; headers?: Record<string, string>; xml?: string } = {}) => ({
  ok: (init.status ?? 200) < 400,
  status: init.status ?? 200,
  headers: { get: (k: string) => (init.headers || {})[k.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => Buffer.from(init.xml ?? (typeof body === 'string' ? body : JSON.stringify(body)), 'utf8'),
});

describe('Eczacıkart adaptörü', () => {
  const eskiFetch = global.fetch;
  afterEach(() => { global.fetch = eskiFetch; });

  it('OTP istenirse net hata verir (portal şifresiyle çekim yapılamaz)', async () => {
    global.fetch = jest.fn(async () => yanit({ otpRequired: true, message: 'Doğrulama kodu gönderildi' })) as any;
    await expect(servis().fetchEczacikartInvoices(cfg, opts)).rejects.toThrow(/doğrulama kodu \(SMS\)|WEB SERVİS hesabı/i);
  });

  it('kullanıcı/şifre yoksa çekim başlamaz', async () => {
    global.fetch = jest.fn() as any;
    await expect(servis().fetchEczacikartInvoices({ ...cfg, password: '' }, opts)).rejects.toThrow(/kullanıcı adı \(GLN\) ve şifre/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('giriş → ilk çalışan liste ucu → belge indirme; payload externalId/xml dolu', async () => {
    const cagrilar: string[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      const u = String(url);
      cagrilar.push(`${init?.method || 'GET'} ${u.replace('https://portal.eczacikartfatura.com/accounting/api', '')}`);
      if (u.endsWith('/elektra/login')) return yanit({ token: 'abc123' }) as any;
      if (u.endsWith('/store/getInboxEInvoiceInfo')) return yanit('yok', { status: 404 }) as any; // ilk aday tutmaz
      if (u.endsWith('/eInvoiceInbox/list')) return yanit({ content: [{ id: 'u-1', invoiceNumber: 'ECZ2026000000001' }] }) as any;
      if (u.includes('/store/getInboxEInvoiceDocument/')) return yanit('', { xml: '<Invoice><ID>ECZ2026000000001</ID></Invoice>' }) as any;
      return yanit('bilinmeyen', { status: 404 }) as any;
    }) as any;

    const payloads = await servis().fetchEczacikartInvoices(cfg, opts);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ externalId: 'eczacikart:inbox:u-1', originalName: 'ECZ2026000000001.xml' });
    expect(payloads[0].xml).toContain('<Invoice>');
    expect(cagrilar[0]).toBe('POST /elektra/login');
    expect(cagrilar).toContain('POST /store/getInboxEInvoiceInfo');
    expect(cagrilar).toContain('POST /eInvoiceInbox/list');
  });

  it('hiçbir liste ucu çalışmazsa denenen uçlar hata metninde görünür', async () => {
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url);
      if (u.endsWith('/elektra/login')) return yanit({ token: 'abc' }) as any;
      return yanit('yok', { status: 404 }) as any;
    }) as any;
    await expect(servis().fetchEczacikartInvoices(cfg, opts)).rejects.toThrow(/denenen uçlar:.*getInboxEInvoiceInfo/s);
  });

  it('zaten çekilmiş fatura tekrar indirilmez (skip-existing)', async () => {
    let belgeIstegi = 0;
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url);
      if (u.endsWith('/elektra/login')) return yanit({ token: 'abc' }) as any;
      if (u.endsWith('/store/getInboxEInvoiceInfo')) return yanit({ content: [{ id: 'u-1', invoiceNumber: 'A1' }] }) as any;
      belgeIstegi++;
      return yanit('', { xml: '<Invoice/>' }) as any;
    }) as any;
    const payloads = await servis().fetchEczacikartInvoices(cfg, { ...opts, skipExistingExternalIds: new Set(['eczacikart:inbox:u-1']) });
    expect(payloads).toHaveLength(0);
    expect(belgeIstegi).toBe(0);
  });
});
