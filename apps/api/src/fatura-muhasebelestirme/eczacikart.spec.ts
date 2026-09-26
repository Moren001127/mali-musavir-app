/**
 * ECZACIKART (TEB Eczacı Kart — altyapı Kolaysoft "E-Dönüşüm Portal") adaptörü, 2026-09-22.
 *
 * Uçlar canlı portalden keşfedildi (kimliksiz: giriş formuna SAHTE kullanıcı yazılıp ağ izi okundu + paket çözüldü):
 *   giriş  POST /accounting/api/auth/signin {username,password} → data.token.accessToken (hasOtp=true ise SMS ister)
 *   liste  GET  /accounting/api/inbox/getInboxes?year=&month=&…&page=&size=&sort=receivedDate,desc  (Spring Page)
 *          (giden kutusu: /outbox/getOutboxes) — ilk sürümde denenen /{modul}/fetch uçları CANLIDA 404 verdi.
 *   belge  POST /accounting/api/{inbox|outbox}/downloadMedia/xml {documentUuid, year, month}
 * Gerçek hesap kimliğini Muzaffer Bey portalden girer; burada `fetch` sahtesiyle davranış kilitlenir.
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

const API = 'https://portal.eczacikartfatura.com/accounting/api';
const LISTE_YIL = '/inbox/getInboxes?year=2026&month=8&headerSearch=&notInList=false&documentIds=&multipleVkn=&chemistWarehouseFilter=ALL&page=0&size=100&sort=documentIssueDate,desc&isArchive=0';
const yanit = (body: any, init: { status?: number; xml?: string } = {}) => ({
  ok: (init.status ?? 200) < 400,
  status: init.status ?? 200,
  headers: { get: () => null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => Buffer.from(init.xml ?? (typeof body === 'string' ? body : JSON.stringify(body)), 'utf8'),
});
/** Portalın gerçek satır alanları: documentUuid (ETTN) · documentId (fatura no) · documentIssueDate. */
const satir = (uuid: string, no: string, tarih: string) => ({ documentUuid: uuid, documentId: no, documentIssueDate: tarih, sourceTitle: 'ECZA DEPOSU' });

describe('Eczacıkart adaptörü', () => {
  const eskiFetch = global.fetch;
  afterEach(() => { global.fetch = eskiFetch; });

  it('kullanıcı/şifre yoksa hiç istek atılmaz', async () => {
    global.fetch = jest.fn() as any;
    await expect(servis().fetchEczacikartInvoices({ ...cfg, password: '' }, opts)).rejects.toThrow(/kullanıcı adı \(GLN\) ve şifre/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('hatalı kimlikte portalın kendi metni hataya taşınır', async () => {
    global.fetch = jest.fn(async () => yanit('Kullanıcı Adı veya Şifre hatalı', { status: 401 })) as any;
    await expect(servis().fetchEczacikartInvoices(cfg, opts)).rejects.toThrow(/Kullanıcı Adı veya Şifre hatalı/);
  });

  it('iki adımlı doğrulama açıksa NET hata verir (otomatik çekim yapılamaz)', async () => {
    global.fetch = jest.fn(async () => yanit({ hasOtp: true, twoStepType: 'CODE', referenceCode: 'R1' })) as any;
    await expect(servis().fetchEczacikartInvoices(cfg, opts)).rejects.toThrow(/İKİ ADIMLI DOĞRULAMA/);
  });

  it('giriş → getInboxes → downloadMedia/xml: Bearer taşınır, payload dolu', async () => {
    const cagrilar: string[] = [];
    let yetki = '';
    global.fetch = jest.fn(async (url: any, init: any) => {
      const u = String(url).replace(API, '');
      cagrilar.push(`${init?.method || 'GET'} ${u}`);
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT123' } }) as any;
      yetki = init?.headers?.Authorization || '';
      if (u.startsWith('/inbox/getInboxes')) {
        if (!u.includes('page=0')) return yanit({ content: [] }) as any; // sonraki sayfalar boş
        return yanit({ content: [satir('u-1', 'ECZ2026000000001', '2026-08-15')], totalElements: 1 }) as any;
      }
      if (u === '/inbox/downloadMedia/xml') {
        expect(JSON.parse(init.body)).toEqual({ documentUuid: 'u-1', year: 2026, month: 8 });
        return yanit('', { xml: '<Invoice><ID>ECZ2026000000001</ID></Invoice>' }) as any;
      }
      return yanit('yok', { status: 404 }) as any;
    }) as any;

    const payloads = await servis().fetchEczacikartInvoices(cfg, opts);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ externalId: 'eczacikart:inbox:u-1', originalName: 'ECZ2026000000001.xml' });
    expect(payloads[0].xml).toContain('<Invoice>');
    expect(yetki).toBe('Bearer JWT123');
    expect(cagrilar[0]).toBe('POST /auth/signin');
    expect(cagrilar[1]).toBe(`GET ${LISTE_YIL}`);
    expect(cagrilar).toContain('POST /inbox/downloadMedia/xml');
  });

  it('önce DÖNEM AYI gönderilir; 0 satır dönerse eski yedek ay=12 denenir', async () => {
    const cagrilar: string[] = [];
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      cagrilar.push(u);
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      if (u.startsWith('/inbox/getInboxes')) {
        if (u.includes('month=8')) return yanit({ content: [], totalElements: 0 }) as any;
        return yanit({ content: u.includes('page=0') ? [satir('u-9', 'A9', '2026-08-02')] : [] }) as any;
      }
      if (u === '/inbox/downloadMedia/xml') return yanit('', { xml: '<Invoice/>' }) as any;
      return yanit('yok', { status: 404 }) as any;
    }) as any;
    const payloads = await servis().fetchEczacikartInvoices(cfg, opts);
    expect(payloads).toHaveLength(1);
    expect(cagrilar[1]).toContain('month=8');
    expect(cagrilar[2]).toContain('month=12');
  });

  it('dönem ayı satır döndürürse ay=12 HİÇ denenmez', async () => {
    const cagrilar: string[] = [];
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      cagrilar.push(u);
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      if (u.startsWith('/inbox/getInboxes')) return yanit({ content: u.includes('page=0') ? [satir('u-1', 'A1', '2026-08-02')] : [] }) as any;
      return yanit('', { xml: '<Invoice/>' }) as any;
    }) as any;
    await servis().fetchEczacikartInvoices(cfg, opts);
    expect(cagrilar.some((u) => u.includes('month=12'))).toBe(false);
  });

  it('arşiv klasörü (isArchive=1) de taranır; tekrarlar ETTN ile ayıklanır', async () => {
    const indirilen: string[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      const u = String(url).replace(API, '');
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      if (u.startsWith('/inbox/getInboxes')) {
        if (!u.includes('page=0')) return yanit({ content: [] }) as any;
        return u.includes('isArchive=1')
          ? yanit({ content: [satir('ortak', 'O1', '2026-08-05'), satir('arsivde', 'R1', '2026-08-06')] }) as any
          : yanit({ content: [satir('ortak', 'O1', '2026-08-05')] }) as any;
      }
      indirilen.push(JSON.parse(init.body).documentUuid);
      return yanit('', { xml: '<Invoice/>' }) as any;
    }) as any;
    const payloads = await servis().fetchEczacikartInvoices(cfg, opts);
    expect(payloads.map((p: any) => p.externalId).sort()).toEqual(['eczacikart:inbox:arsivde', 'eczacikart:inbox:ortak']);
    expect(indirilen).toEqual(['ortak', 'arsivde']);
  });

  it('ARŞİV klasörünün 2. sayfası hata verirse normal klasörün belgeleri KORUNUR + uyarı', async () => {
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      if (u.startsWith('/inbox/getInboxes')) {
        if (u.includes('isArchive=1')) {
          if (u.includes('page=1')) return yanit('Sunucu hatası', { status: 500 }) as any;
          return yanit({ content: Array.from({ length: 100 }, (_, i) => satir(`ar-${i}`, `R${i}`, '2026-08-21')) }) as any;
        }
        return yanit({ content: u.includes('page=0') ? [satir('normal', 'N1', '2026-08-03')] : [] }) as any;
      }
      return yanit('', { xml: '<Invoice/>' }) as any;
    }) as any;
    const progress: any = {};
    // Arşivin 1. sayfası zaten çekilmiş sayılır (indirme/bekleme yok → test hızlı); 2. sayfa HTTP 500.
    const zatenVar = new Set(Array.from({ length: 100 }, (_, i) => `eczacikart:inbox:ar-${i}`));
    const payloads = await servis().fetchEczacikartInvoices(cfg, { ...opts, limit: 500, progress, skipExistingExternalIds: zatenVar });
    expect(payloads.map((p: any) => p.externalId)).toEqual(['eczacikart:inbox:normal']);
    expect(progress.uyarilar).toEqual(expect.arrayContaining([expect.stringMatching(/arşiv klasörü 2\. sayfada sorgulanamadı \(HTTP 500\)/)]));
  });

  it('sonraki sayfa hata verirse sessizce bitmez, HATA fırlatır', async () => {
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      if (u.startsWith('/inbox/getInboxes')) {
        if (u.includes('page=1')) return yanit('Sunucu hatası', { status: 500 }) as any;
        const dolu = Array.from({ length: 100 }, (_, i) => satir(`u-${i}`, `A${i}`, '2026-08-20'));
        return yanit({ content: dolu }) as any;
      }
      return yanit('', { xml: '<Invoice/>' }) as any;
    }) as any;
    await expect(servis().fetchEczacikartInvoices(cfg, { ...opts, limit: 500, skipExistingExternalIds: new Set(Array.from({ length: 100 }, (_, i) => `eczacikart:inbox:u-${i}`)) }))
      .rejects.toThrow(/2\. sayfada kesildi \(HTTP 500\)/);
  });

  it('indirilemeyen belge sayısı UYARI olarak döner', async () => {
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      if (u.startsWith('/inbox/getInboxes')) {
        return yanit({ content: u.includes('page=0') && u.includes('isArchive=0') ? [satir('iyi', 'I1', '2026-08-03'), satir('kotu', 'K1', '2026-08-04')] : [] }) as any;
      }
      if (u === '/inbox/downloadMedia/xml') return yanit('', { xml: '<Invoice/>' }) as any;
      return yanit('yok', { status: 404 }) as any;
    }) as any;
    const orj = global.fetch as any;
    global.fetch = jest.fn(async (url: any, init: any) => {
      if (String(url).endsWith('/downloadMedia/xml') && JSON.parse(init.body).documentUuid === 'kotu') return yanit('hata', { status: 500 }) as any;
      return orj(url, init);
    }) as any;
    const progress: any = {};
    const payloads = await servis().fetchEczacikartInvoices(cfg, { ...opts, progress });
    expect(payloads).toHaveLength(1);
    expect(progress.uyarilar).toHaveLength(1);
    expect(progress.uyarilar[0]).toMatch(/1 belge indirilemedi.*K1 \(HTTP 500\)/);
  });

  it('liste adresi yanıt vermezse anlaşılır mesaj: "adresi yanıt vermiyor (HTTP x)"', async () => {
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      return yanit('Bad Request', { status: 400 }) as any;
    }) as any;
    await expect(servis().fetchEczacikartInvoices(cfg, opts)).rejects.toThrow(/Eczacıkart fatura listesi adresi yanıt vermiyor \(HTTP 400\)/);
  });

  it('dönem dışı satırlar: yeniler atlanır, eskiye düşünce çekim durur', async () => {
    let belgeIstegi = 0;
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      if (u.startsWith('/inbox/getInboxes')) {
        return yanit({ content: [
          satir('yeni', 'Y1', '2026-09-03'),   // dönemden YENİ → atlanır
          satir('icinde', 'I1', '15.08.2026'), // nokta biçimli tarih de okunur
          satir('eski', 'E1', '2026-07-30'),   // dönemden ESKİ → dur
          satir('sonra', 'S1', '2026-08-20'),  // durduktan sonrası alınmaz
        ] }) as any;
      }
      belgeIstegi++;
      return yanit('', { xml: '<Invoice/>' }) as any;
    }) as any;
    const payloads = await servis().fetchEczacikartInvoices(cfg, opts);
    expect(payloads.map((p: any) => p.externalId)).toEqual(['eczacikart:inbox:icinde']);
    expect(belgeIstegi).toBe(1);
  });

  it('liste ucu çalışmazsa denenen uçlar hata metninde görünür', async () => {
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      return yanit('yok', { status: 404 }) as any;
    }) as any;
    await expect(servis().fetchEczacikartInvoices(cfg, opts)).rejects.toThrow(/denenen uçlar:.*kalıp1\(ay=8\)=404.*kalıp5\(ay=12\)=404/s);
  });

  it('portal 400 verirse sonraki parametre kalıbı denenir; sunucunun metni hataya taşınır', async () => {
    const cagrilar: string[] = [];
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      cagrilar.push(u);
      // 1. ve 2. kalıp reddedilsin, 3. (yalın) kalıp çalışsın
      if (u.includes('sort=documentIssueDate')) return yanit('Unknown sort property', { status: 400 }) as any;
      if (u.startsWith('/inbox/getInboxes')) return yanit({ content: u.includes('page=0') ? [satir('u-3', 'A3', '2026-08-07')] : [] }) as any;
      return yanit('', { xml: '<Invoice/>' }) as any;
    }) as any;
    const payloads = await servis().fetchEczacikartInvoices(cfg, opts);
    expect(payloads).toHaveLength(1);
    expect(cagrilar.some((u) => u.includes('sort=documentIssueDate'))).toBe(true);
    expect(cagrilar.some((u) => u.includes('sort=receivedDate'))).toBe(true);
  });

  it('zaten çekilmiş fatura tekrar indirilmez (skip-existing)', async () => {
    let belgeIstegi = 0;
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url).replace(API, '');
      if (u === '/auth/signin') return yanit({ token: { accessToken: 'JWT' } }) as any;
      if (u.startsWith('/inbox/getInboxes')) return yanit({ content: u.includes('page=0') ? [satir('u-1', 'A1', '2026-08-10')] : [] }) as any;
      belgeIstegi++;
      return yanit('', { xml: '<Invoice/>' }) as any;
    }) as any;
    const payloads = await servis().fetchEczacikartInvoices(cfg, { ...opts, skipExistingExternalIds: new Set(['eczacikart:inbox:u-1']) });
    expect(payloads).toHaveLength(0);
    expect(belgeIstegi).toBe(0);
  });

  it('portal kimlik kontrolü: eksik alan NET sebep döndürür, tam kimlik geçer', () => {
    const s: any = servis();
    const tam = { provider: 'ECZACIKART', username: '8680000000000', password: 'x', baseUrl: 'https://portal.eczacikartfatura.com', note: '' };
    expect(s.providerCredentialProblem({ ...tam, password: '' })).toMatch(/GLN/);
    expect(s.providerCredentialProblem({ ...tam, username: '' })).toMatch(/GLN/);
    expect(s.providerCredentialProblem(tam)).toBeNull();
    expect(s.providerCredentialProblem({ ...tam, note: '__inactive__' })).toMatch(/pasif/i);
  });
});

/** ONAY sütununda çıplak sayı görünmesin: sağlayıcı sayı kodu döndürürse kendi açıklama metni kullanılır. */
describe('sağlayıcı durumu (sayı kodu → metin)', () => {
  const durum = (item: any) => servis().providerStatusFromListItem(item);

  it('Turkcell: status=60 + message → mesaj metni kullanılır (ekranda "60" yazmaz)', () => {
    expect(durum({ status: 60, message: 'ZARF BASARIYLA ISLENDI' })).toEqual({ approval: 'ZARF BASARIYLA ISLENDI', iptal: null });
  });

  it('sayı kodu var ama mesaj yoksa "Durum <kod>" yazılır', () => {
    expect(durum({ status: 60 })).toEqual({ approval: 'Durum 60', iptal: null });
  });

  it('metinsel durum alanı varsa o kazanır; iptal bayrağı korunur', () => {
    expect(durum({ statusText: 'Onaylandı', status: 60, message: 'ZARF BASARIYLA ISLENDI' })).toEqual({ approval: 'Onaylandı', iptal: null });
    expect(durum({ status: 'Reddedildi' })).toEqual({ approval: 'Reddedildi', iptal: null });
    expect(durum({ status: 60, message: 'ZARF BASARIYLA ISLENDI', isCancelled: true })).toEqual({ approval: 'ZARF BASARIYLA ISLENDI', iptal: 'Iptal' });
  });

  it('durum yoksa null (boş rozet) döner', () => {
    expect(durum({ invoiceNumber: 'A1' })).toBeNull();
    expect(durum(null)).toBeNull();
  });
});
