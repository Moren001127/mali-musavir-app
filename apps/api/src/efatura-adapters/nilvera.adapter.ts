import { EFaturaAdapter, EFaturaCredentials, RawEFatura, DeltaState } from './efatura-adapter.interface';

const DEFAULT_BASE = 'https://api.nilvera.com';

function nilveraHeaders(credentials: EFaturaCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${credentials.apiKey}`,
    'Content-Type': 'application/json',
  };
}

function parseNilveraDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function mapNilveraInvoice(item: any, direction: 'IN' | 'OUT'): RawEFatura {
  return {
    uuid: item.uuid || item.UUID || item.id,
    ettn: item.ettn || item.ETTN || null,
    senderVkn: item.senderTaxNumber || item.SenderTaxNumber || null,
    senderTitle: item.senderTitle || item.SenderTitle || null,
    receiverVkn: item.receiverTaxNumber || item.ReceiverTaxNumber || null,
    faturaNo: item.invoiceId || item.InvoiceId || null,
    faturaDate: parseNilveraDate(item.issueDate || item.IssueDate),
    matrah: item.taxExclusiveAmount != null ? Number(item.taxExclusiveAmount) : null,
    kdv: item.taxAmount != null ? Number(item.taxAmount) : null,
    toplam: item.payableAmount != null ? Number(item.payableAmount) : null,
    paraBirimi: item.documentCurrencyCode || 'TRY',
    direction,
    invoiceProfile: item.invoiceTypeCode || null,
    rawJson: item,
  };
}

export class NilveraAdapter implements EFaturaAdapter {
  readonly provider = 'NILVERA';

  async fetchInvoices(
    credentials: EFaturaCredentials,
    opts: {
      direction?: 'IN' | 'OUT';
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      page?: number;
      deltaState?: DeltaState;
    },
  ): Promise<{ invoices: RawEFatura[]; nextState: DeltaState; hasMore: boolean }> {
    const base = credentials.baseUrl || DEFAULT_BASE;
    const direction = opts.direction === 'OUT' ? 'OUT' : 'IN';
    const endpoint = direction === 'OUT' ? '/einvoice/Sales' : '/einvoice/Purchase';
    const pageSize = Math.min(opts.limit || 100, 100);

    const params = new URLSearchParams({
      IsTransfer: 'false', // sadece aktarılmamışları getir
      DateFilterType: 'CreatedDate', // güvenilir delta için
      Page: String(Math.max(0, opts.page || 0) + 1), // Nilvera 1-tabanlı
      PageSize: String(pageSize),
    });

    if (opts.startDate) {
      params.set('StartDate', opts.startDate.toISOString().split('T')[0]);
    }
    if (opts.endDate) {
      params.set('EndDate', opts.endDate.toISOString().split('T')[0]);
    }

    const res = await fetch(`${base}${endpoint}?${params}`, {
      headers: nilveraHeaders(credentials),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`Nilvera ${direction} fetch hatasi: ${res.status} ${await res.text()}`);
    }

    const body = await res.json();
    const items: any[] = Array.isArray(body) ? body : (body.data || body.items || body.result || []);
    const invoices = items.map((item) => mapNilveraInvoice(item, direction));

    return {
      invoices,
      nextState: {
        lastSyncAt: new Date(),
      } as DeltaState,
      hasMore: invoices.length >= pageSize,
    };
  }

  async markAsTransferred(credentials: EFaturaCredentials, uuids: string[]): Promise<void> {
    if (uuids.length === 0) return;
    const base = credentials.baseUrl || DEFAULT_BASE;
    await fetch(`${base}/einvoice/Purchase/Operation/Transferred`, {
      method: 'PUT',
      headers: nilveraHeaders(credentials),
      body: JSON.stringify(uuids),
      signal: AbortSignal.timeout(15_000),
    });
  }

  async downloadXml(credentials: EFaturaCredentials, uuid: string): Promise<string | null> {
    const base = credentials.baseUrl || DEFAULT_BASE;
    const res = await fetch(`${base}/einvoice/Purchase/${uuid}/xml`, {
      headers: nilveraHeaders(credentials),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return res.text();
  }
}
