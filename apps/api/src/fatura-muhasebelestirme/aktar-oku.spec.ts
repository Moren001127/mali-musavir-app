/**
 * AKTAR → OKU (2026-09-13): e-Fatura / GİB e-Arşiv aktarımı sonrası belgeler kalıcı kuyruğa AI_READ düşer.
 * Servisin yalnız `aktarSonrasiOkumaKuyruga` metodu prototipten alınır; prisma/kuyruk sahtedir (ağ/DB yok).
 */
jest.mock('./fatura-muhasebelestirme.service', () => jest.requireActual('./fatura-muhasebelestirme.service'));
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

function kur(docs: any[]) {
  const guncellemeler: any[] = [];
  const kuyruk: any[] = [];
  const svc: any = Object.create(FaturaMuhasebelestirmeService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  svc.prisma = {
    invoiceAccountingDocument: {
      findMany: async (q: any) => docs.filter((d) => q.where.id.in.includes(d.id) && q.where.status.in.includes(d.status)),
      updateMany: async (q: any) => { guncellemeler.push(q); return { count: q.where.id.in.length }; },
    },
  };
  svc.belgeKuyrugu = { topluKuyrugaAl: async (g: any[]) => { kuyruk.push(...g); return { eklenen: g.length, yukseltilen: 0, zatenKuyrukta: 0, bekleyen: g.length }; } };
  svc.uploadOcrQueue = [];
  svc.drainUploadedOcrQueue = jest.fn();
  return { svc, guncellemeler, kuyruk };
}

describe('aktarSonrasiOkumaKuyruga', () => {
  const envYedek = process.env.FM_AKTAR_OKU;
  afterEach(() => { if (envYedek === undefined) delete process.env.FM_AKTAR_OKU; else process.env.FM_AKTAR_OKU = envYedek; });

  it('okunmamış + onaysız belgeler AI_READ (öncelik 3) olarak kuyruğa girer, ocrStatus PENDING olur; okunmuş/onaylı atlanır', async () => {
    const { svc, guncellemeler, kuyruk } = kur([
      { id: 'a', taxpayerId: 't1', status: 'READY', ocrData: { source: 'provider-api' } },
      { id: 'b', taxpayerId: 't1', status: 'NEEDS_REVIEW', ocrData: { readMode: 'ubl-xml' } }, // zaten okunmuş
      { id: 'c', taxpayerId: 't1', status: 'APPROVED', ocrData: {} }, // onaylı — sorguya girmez
      { id: 'd', taxpayerId: 't2', status: 'READY', ocrData: null },
    ]);
    const n = await svc.aktarSonrasiOkumaKuyruga('ten', ['a', 'b', 'c', 'd', 'd', ''], 'e-fatura aktar');
    expect(n).toBe(2);
    expect(kuyruk.map((k) => [k.documentId, k.kind, k.priority, k.taxpayerId])).toEqual([['a', 'AI_READ', 3, 't1'], ['d', 'AI_READ', 3, 't2']]);
    expect(guncellemeler[0]).toEqual({ where: { id: { in: ['a', 'd'] }, tenantId: 'ten' }, data: { ocrStatus: 'PENDING' } });
  });

  it('FM_AKTAR_OKU=off → hiçbir şey yapmaz; boş liste → 0', async () => {
    const { svc, kuyruk } = kur([{ id: 'a', taxpayerId: 't1', status: 'READY', ocrData: {} }]);
    process.env.FM_AKTAR_OKU = 'off';
    expect(await svc.aktarSonrasiOkumaKuyruga('ten', ['a'], 'x')).toBe(0);
    expect(kuyruk).toHaveLength(0);
    delete process.env.FM_AKTAR_OKU;
    expect(await svc.aktarSonrasiOkumaKuyruga('ten', [], 'x')).toBe(0);
  });

  it('kalıcı kuyruk bağlı değilse bellek kuyruğuna düşer; DB hatası yutulur', async () => {
    const { svc } = kur([{ id: 'a', taxpayerId: 't1', status: 'READY', ocrData: {} }]);
    svc.belgeKuyrugu = null;
    expect(await svc.aktarSonrasiOkumaKuyruga('ten', ['a'], 'e-arşiv aktar')).toBe(1);
    expect(svc.uploadOcrQueue).toEqual([{ tenantId: 'ten', documentId: 'a', kind: 'ai-read' }]);
    expect(svc.drainUploadedOcrQueue).toHaveBeenCalled();
    svc.prisma.invoiceAccountingDocument.findMany = async () => { throw new Error('db yok'); };
    expect(await svc.aktarSonrasiOkumaKuyruga('ten', ['a'], 'x')).toBe(0);
  });
});
