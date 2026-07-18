import { EFaturaAdapter, EFaturaCredentials, RawEFatura, DeltaState } from './efatura-adapter.interface';

const TEST_AUTH_URL = 'https://efaturatest.izibiz.com.tr/AuthenticationWS';
const TEST_INVOICE_URL = 'https://efaturatest.izibiz.com.tr/EInvoiceWS';
const PROD_AUTH_URL = 'https://efatura.izibiz.com.tr/AuthenticationWS';
const PROD_INVOICE_URL = 'https://efatura.izibiz.com.tr/EInvoiceWS';
const SESSION_TTL_MS = 7 * 60 * 60 * 1000; // 7 saat (8h expire'dan önce yenile)

/** Basit SOAP zarf — node-soap bağımlılığından kaçınmak için */
function soapEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:efat="http://schemas.xmlsoap.org/soap/encoding/">
  <soapenv:Header/>
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;
}

async function soapCall(url: string, action: string, bodyXml: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml;charset=UTF-8',
      SOAPAction: `"${action}"`,
    },
    body: soapEnvelope(bodyXml),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`İzibiz SOAP ${action} hatasi: ${res.status}`);
  return res.text();
}

function xmlEsc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
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

export class IzibizAdapter implements EFaturaAdapter {
  readonly provider = 'IZIBIZ';

  private isTest(credentials: EFaturaCredentials): boolean {
    const url = credentials.baseUrl || '';
    return !url || url.includes('test') || url.includes('efaturatest');
  }

  private authUrl(credentials: EFaturaCredentials): string {
    return this.isTest(credentials) ? TEST_AUTH_URL : PROD_AUTH_URL;
  }

  private invoiceUrl(credentials: EFaturaCredentials): string {
    return this.isTest(credentials) ? TEST_INVOICE_URL : PROD_INVOICE_URL;
  }

  private async login(credentials: EFaturaCredentials): Promise<string> {
    const xml = await soapCall(
      `${this.authUrl(credentials)}?wsdl`,
      'Login',
      `<Login xmlns="http://login.izibiz.com.tr">
        <REQUEST_HEADER><SESSION_ID></SESSION_ID><APPLICATION_NAME>moren-portal</APPLICATION_NAME></REQUEST_HEADER>
        <USER_NAME>${String(credentials.username ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</USER_NAME>
        <PASSWORD>${String(credentials.password ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</PASSWORD>
      </Login>`,
    );
    const sessionId = extractTag(xml, 'SESSION_ID');
    if (!sessionId) throw new Error('İzibiz login: SESSION_ID alinamadi');
    return sessionId;
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
      },
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
    const direction = opts.direction === 'OUT' ? 'OUT' : 'IN';
    // Not: İzibiz GetInvoice'ta sayfa parametresi yok; READ işareti delta'yı ilerletir.
    const pageSize = Math.min(opts.limit || 100, 100);

    const startDateStr = opts.startDate
      ? opts.startDate.toISOString().split('T')[0]
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDateStr = opts.endDate
      ? opts.endDate.toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const xml = await soapCall(
      `${this.invoiceUrl(credentials)}?wsdl`,
      'GetInvoice',
      `<GetInvoice xmlns="http://invoice.izibiz.com.tr">
        <REQUEST_HEADER><SESSION_ID>${sessionId}</SESSION_ID><APPLICATION_NAME>moren-portal</APPLICATION_NAME></REQUEST_HEADER>
        <INVOICE_SEARCH_KEY>
          <DIRECTION>${direction}</DIRECTION>
          <READ_INCLUDED>false</READ_INCLUDED>
          <HEADER_ONLY>N</HEADER_ONLY>
          <DATE_TYPE>CREATE</DATE_TYPE>
          <START_DATE>${startDateStr}</START_DATE>
          <END_DATE>${endDateStr}</END_DATE>
          <LIMIT>${pageSize}</LIMIT>
        </INVOICE_SEARCH_KEY>
      </GetInvoice>`,
    );

    const invoiceBlocks = extractAll(xml, 'INVOICE');
    const invoices: RawEFatura[] = invoiceBlocks.map((block) => {
      const uuid = extractTag(block, 'UUID') || extractTag(block, 'ETTN') || '';
      const content = extractTag(block, 'CONTENT');
      let ublXmlRaw: string | null = null;
      if (content) {
        try {
          ublXmlRaw = Buffer.from(content, 'base64').toString('utf-8');
        } catch {
          /* ignore */
        }
      }
      return {
        uuid,
        ettn: extractTag(block, 'ETTN'),
        senderVkn: extractTag(block, 'SENDER_VKN') || extractTag(block, 'SENDER'),
        senderTitle: extractTag(block, 'SENDER_ALIAS') || extractTag(block, 'SENDER_TITLE'),
        receiverVkn: extractTag(block, 'RECEIVER_VKN') || extractTag(block, 'RECEIVER'),
        faturaNo: extractTag(block, 'ID') || extractTag(block, 'INVOICE_ID'),
        faturaDate: (() => {
          const d = extractTag(block, 'ISSUE_DATE') || extractTag(block, 'FATURA_TARIHI');
          return d ? new Date(d) : null;
        })(),
        matrah: null,
        kdv: null,
        toplam: (() => {
          const t = extractTag(block, 'PAYABLE_AMOUNT') || extractTag(block, 'TOPLAM_TUTAR');
          return t ? Number(t) : null;
        })(),
        paraBirimi: extractTag(block, 'DOCUMENT_CURRENCY_CODE') || 'TRY',
        direction: direction as 'IN' | 'OUT',
        invoiceProfile: extractTag(block, 'PROFILE_ID'),
        ublXmlRaw,
        rawJson: { blockRaw: block.substring(0, 500) },
      };
    });

    const lastCdate =
      invoiceBlocks.length > 0
        ? (extractTag(invoiceBlocks[invoiceBlocks.length - 1], 'CDATE') ?? null)
        : null;

    return {
      invoices,
      nextState: { ...newState, lastSyncAt: new Date(), lastCdate } as DeltaState,
      hasMore: invoices.length >= pageSize,
    };
  }

  async markAsTransferred(
    credentials: EFaturaCredentials,
    uuids: string[],
    deltaState?: DeltaState,
  ): Promise<void> {
    if (uuids.length === 0) return;
    const { sessionId } = await this.ensureSession(credentials, deltaState);
    const invoiceItems = uuids
      .map((u) => `<INVOICE><UUID>${xmlEsc(u)}</UUID><MARK><value>READ</value></MARK></INVOICE>`)
      .join('');
    await soapCall(
      `${this.invoiceUrl(credentials)}?wsdl`,
      'MarkInvoice',
      `<MarkInvoice xmlns="http://invoice.izibiz.com.tr">
        <REQUEST_HEADER><SESSION_ID>${sessionId}</SESSION_ID><APPLICATION_NAME>moren-portal</APPLICATION_NAME></REQUEST_HEADER>
        ${invoiceItems}
      </MarkInvoice>`,
    );
  }

  async downloadXml(
    credentials: EFaturaCredentials,
    uuid: string,
    deltaState?: DeltaState,
  ): Promise<string | null> {
    const { sessionId } = await this.ensureSession(credentials, deltaState);
    const xml = await soapCall(
      `${this.invoiceUrl(credentials)}?wsdl`,
      'GetInvoiceWithType',
      `<GetInvoiceWithType xmlns="http://invoice.izibiz.com.tr">
        <REQUEST_HEADER><SESSION_ID>${sessionId}</SESSION_ID><APPLICATION_NAME>moren-portal</APPLICATION_NAME></REQUEST_HEADER>
        <INVOICE_SEARCH_KEY>
          <UUID>${uuid}</UUID>
          <INVOICE_CONTENT_TYPE>XML</INVOICE_CONTENT_TYPE>
        </INVOICE_SEARCH_KEY>
      </GetInvoiceWithType>`,
    );
    const content = extractTag(xml, 'CONTENT');
    if (!content) return null;
    try {
      return Buffer.from(content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }
}
