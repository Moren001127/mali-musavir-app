/**
 * GİB e-Arşiv AKTAR → OKU kancası (2026-09-15): portal aktarımı bitince oluşan belgeler okuma kuyruğuna verilir.
 * Canlı bulgu: ÖMER ÖZEN 42 satış belgesi "Kod eksik" bekliyordu — e-Fatura yolundaki otomatik okuma burada yoktu.
 * Servisin yalnız syncEarsivPortalDocumentsToAccounting metodu prototipten alınır; prisma/storage/import sahtedir.
 */
import { PortalAutomationService } from './portal-automation.service';

function kur() {
  const svc: any = Object.create(PortalAutomationService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  svc.prisma = {
    portalDocument: {
      findMany: async () => [
        { id: 'p1', taxpayerId: 't1', jobId: 'j1', title: 'GIB', referenceNo: 'GIB2026000000457', period: '2026-08', issuedAt: new Date('2026-08-03'), receivedAt: null, mimeType: 'application/json', sizeBytes: 10, storageKey: 'k1', raw: { row: {} } },
        { id: 'p2', taxpayerId: 't1', jobId: 'j1', title: 'GIB', referenceNo: 'GIB2026000000458', period: '2026-08', issuedAt: new Date('2026-08-03'), receivedAt: null, mimeType: 'application/json', sizeBytes: 10, storageKey: null, raw: { row: {} } }, // storageKey yok → atlanır
      ],
      update: async () => null,
    },
    invoiceAccountingDocument: { findFirst: async () => null, count: async () => 0 },
  };
  svc.storage = { getBuffer: async () => Buffer.from('{}') };
  svc.importEarsivPortalDocumentToAccounting = jest.fn(async () => ({ id: 'd1' }));
  svc.aktarSonrasiOkumaKancasi = null;
  return svc;
}

describe('syncEarsivPortalDocumentsToAccounting — aktar sonrası okuma', () => {
  it('kanca kayıtlıysa oluşan belge id\'leriyle çağrılır (storageKey\'siz satır atlanır)', async () => {
    const svc = kur();
    const kanca = jest.fn(async () => 1);
    svc.setAktarSonrasiOkumaKancasi(kanca);
    const r = await svc.syncEarsivPortalDocumentsToAccounting('ten', { taxpayerId: 't1', period: '2026-08' });
    expect(r).toMatchObject({ processed: 1, skipped: 1, okumaKuyruguna: 1 });
    await new Promise((res) => setTimeout(res, 0)); // void ile tetiklenen kanca
    expect(kanca).toHaveBeenCalledWith('ten', ['d1'], 'gib e-arşiv aktar');
  });

  it('kanca yoksa uyarı loglanır, aktarım yine tamamlanır', async () => {
    const svc = kur();
    const r = await svc.syncEarsivPortalDocumentsToAccounting('ten', { taxpayerId: 't1', period: '2026-08' });
    expect(r.okumaKuyruguna).toBe(1);
    expect(svc.logger.warn).toHaveBeenCalledWith(expect.stringContaining('kanca kayıtlı değil'));
  });
});
