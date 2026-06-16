import { EFaturaAdapter, EFaturaCredentials, RawEFatura, DeltaState } from './efatura-adapter.interface';

const DEFAULT_BASE = 'https://efatura.uyumsoft.com.tr/services/Integration';
const SESSION_TTL_MS = 7 * 60 * 60 * 1000;

async function uyumsoftSoap(url: string, action: string, bodyXml: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml;charset=UTF-8',
      SOAPAction: `"${action}"`,
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>${bodyXml}</soapenv:Body>
</soapenv:Envelope>`,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Uyumsoft SOAP ${action} hatasi: ${res.status}`);
  return res.text();
}

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'gi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

export class UyumsoftAdapter implements EFaturaAdapter {
  readonly provider = 'UYUMSOFT';

  private serviceUrl(credentials: EFaturaCredentials): string {
    return credentials.baseUrl || DEFAULT_BASE;
  }

  private async login(credentials: EFaturaCredentials): Promise<string> {
    const xml = await uyumsoftSoap(
      this.serviceUrl(credentials),
      'Login',
      `<Login xmlns="http://uyumsoft.com.tr">
        <request>
          <UserName>${credentials.username}</UserName>
          <Password>${credentials.password}</Password>
        </request>
      </Login>`,
    );
    const token =
      extractTag(xml, 'SessionId') || extractTag(xml, 'Token') || extractTag(xml, 'Result');
    if (!token) throw new Error('Uyumsoft login: session token alinamadi');
    return token;
  }

  private async ensureSession(
    credentials: EFaturaCredentials,
    state?: DeltaState,
  ): Promise<{ sessionId: string; newState: DeltaState }> {
    const now = Date.now();
    if (state?.sessionId && state.sessionExpiresAt && state.sessionExpiresAt.getTime() > now) {
      return { sessionId: state.sessionId, newState: state };
    }
    const sessionId = await this.login(credentials);
    return {
      sessionId,
      newState: {
        ...state,
        sessionId,
        sessionExpiresAt: new Date(now + SESSION_TTL_MS),
      } as DeltaState,
    };
  }

  async fetchInvoices(
    credentials: EFaturaCredentials,
    opts: {
      direction?: 'IN' | 'OUT';
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      deltaState?: DeltaState;
    },
  ): Promise<{ invoices: RawEFatura[]; nextState: DeltaState; hasMore: boolean }> {
    const { sessionId, newState } = await this.ensureSession(credentials, opts.deltaState);
    const isGelen = opts.direction !== 'OUT';

    const startDateStr =
      opts.startDate?.toISOString() ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDateStr = opts.endDate?.toISOString() || new Date().toISOString();

    const methodName = isGelen ? 'GetInboxInvoiceList' : 'GetOutboxInvoiceList';
    const xml = await uyumsoftSoap(
      this.serviceUrl(credentials),
      methodName,
      `<${methodName} xmlns="http://uyumsoft.com.tr">
        <request>
          <SessionInfo><SessionId>${sessionId}</SessionId></SessionInfo>
          <OnlyNewestInvoices>true</OnlyNewestInvoices>
          <PageIndex>0</PageIndex>
          <PageSize>${Math.min(opts.limit || 100, 100)}</PageSize>
          <CreateStartDate>${startDateStr}</CreateStartDate>
          <CreateEndDate>${endDateStr}</CreateEndDate>
        </request>
      </${methodName}>`,
    );

    const itemTag = isGelen ? 'InboxInvoiceListItem' : 'OutboxInvoiceListItem';
    const invoiceBlocks = extractAll(xml, itemTag);
    const ids: string[] = [];

    const invoices: RawEFatura[] = invoiceBlocks.map((block) => {
      const invoiceId = extractTag(block, 'InvoiceId') || extractTag(block, 'Id') || '';
      ids.push(invoiceId);
      return {
        uuid: extractTag(block, 'UUID') || extractTag(block, 'Uuid') || invoiceId,
        ettn: extractTag(block, 'ETTN') || null,
        senderVkn: extractTag(block, 'SenderVkn') || extractTag(block, 'Sender') || null,
        senderTitle: extractTag(block, 'SenderTitle') || null,
        receiverVkn: extractTag(block, 'ReceiverVkn') || extractTag(block, 'Receiver') || null,
        faturaNo: extractTag(block, 'InvoiceNumber') || extractTag(block, 'InvoiceId') || null,
        faturaDate: (() => {
          const d = extractTag(block, 'InvoiceDate');
          return d ? new Date(d) : null;
        })(),
        matrah: null,
        kdv: null,
        toplam: (() => {
          const t = extractTag(block, 'PayableAmount') || extractTag(block, 'TotalAmount');
          return t ? Number(t) : null;
        })(),
        paraBirimi: extractTag(block, 'CurrencyCode') || 'TRY',
        direction: isGelen ? 'IN' : 'OUT',
        invoiceProfile: extractTag(block, 'ProfileId') || null,
        rawJson: { invoiceId, blockRaw: block.substring(0, 400) },
      };
    });

    return {
      invoices,
      nextState: { ...newState, lastSyncAt: new Date() } as DeltaState,
      hasMore: invoices.length >= 100,
    };
  }

  async markAsTransferred(
    credentials: EFaturaCredentials,
    ids: string[],
    deltaState?: DeltaState,
  ): Promise<void> {
    if (ids.length === 0) return;
    const { sessionId } = await this.ensureSession(credentials, deltaState);
    const idsXml = ids.map((id) => `<string>${id}</string>`).join('');
    await uyumsoftSoap(
      this.serviceUrl(credentials),
      'SetInvoicesTaken',
      `<SetInvoicesTaken xmlns="http://uyumsoft.com.tr">
        <request>
          <SessionInfo><SessionId>${sessionId}</SessionId></SessionInfo>
          <InvoiceIds>${idsXml}</InvoiceIds>
        </request>
      </SetInvoicesTaken>`,
    );
  }

  async downloadXml(
    credentials: EFaturaCredentials,
    invoiceId: string,
    deltaState?: DeltaState,
  ): Promise<string | null> {
    const { sessionId } = await this.ensureSession(credentials, deltaState);
    const xml = await uyumsoftSoap(
      this.serviceUrl(credentials),
      'GetInboxInvoiceData',
      `<GetInboxInvoiceData xmlns="http://uyumsoft.com.tr">
        <request>
          <SessionInfo><SessionId>${sessionId}</SessionId></SessionInfo>
          <InvoiceId>${invoiceId}</InvoiceId>
        </request>
      </GetInboxInvoiceData>`,
    );
    const content = extractTag(xml, 'InvoiceData') || extractTag(xml, 'Content');
    if (!content) return null;
    try {
      return Buffer.from(content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }
}
