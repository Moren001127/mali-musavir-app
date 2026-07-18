import * as AdmZip from 'adm-zip';
import { EFaturaAdapter, EFaturaCredentials, RawEFatura, DeltaState } from './efatura-adapter.interface';

/**
 * e-Logo (eLogo) Özel Entegratör — PostBox SOAP web servisi adapteri.
 *
 * Akış:
 *   Login → sessionID
 *   GetDocumentList → henüz alınmamış (Done işaretlenmemiş) belge UUID listesi
 *   GetDocumentData → UUID başına belge içeriği (base64; genelde ZIP içinde UBL-TR XML)
 *   GetDocumentDone → belgeyi "alındı" işaretle (delta ilerlemesi — tekrar gelmesin)
 *
 * Sayfalama: e-Logo GetDocumentList sayfa parametresi almaz; Done işaretlenmemiş
 * TÜM belgeleri döner (İzibiz'deki READ-işareti delta mantığının aynısı).
 * Bu adapter listeyi kendi içinde page/pageSize dilimleyerek sayfalama sağlar;
 * kalıcı ilerleme GetDocumentDone ile olur.
 *
 * ── CANLI DOĞRULAMA GEREKLİ — toplu liste ──────────────────────────────────
 * Aşağıdaki noktalar e-Logo resmî "Özel Entegratörlük Web Servisleri" dokümanından
 * (ve/veya canlı WSDL'den: <serviceUrl>?wsdl) teyit edilmeden canlıya güvenilmemeli:
 *  1. Varsayılan servis URL'i (DEFAULT_SERVICE_URL) ve test URL'i.
 *  2. SOAP namespace (tempuri.org — WCF varsayılanı) ve SOAPAction öneki
 *     (IPostBoxService sözleşme adı).
 *  3. Login parametre adları: userName / passWord (büyük-küçük harf dahil).
 *  4. GetDocumentList/GetDocumentData/GetDocumentDone parametre adları:
 *     sessionID, documentType, UUID.
 *  5. documentType değeri gelen e-fatura için 'EINVOICE'.
 *  6. GİDEN (OUT) fatura çekiminde kullanılacak documentType — dokümandan teyit
 *     edilmeden varsayılan YOK; config.outDocumentType girilmezse Türkçe hata atılır.
 *  7. GetDocumentList cevabındaki liste eleman etiketi (string / guid / DocumentInfo).
 *  8. GetDocumentData cevabındaki içerik etiketi (GetDocumentDataResult / binaryData).
 *  9. Oturum süresi (SESSION_TTL_MS) — dokümanda yazan gerçek süreye çekilmeli.
 * ───────────────────────────────────────────────────────────────────────────
 */

// CANLI DOĞRULAMA GEREKLİ: prod PostBox URL'i dokümandan teyit edilmeli.
const DEFAULT_SERVICE_URL = 'https://pb.elogo.com.tr/PostBoxService.svc';
// CANLI DOĞRULAMA GEREKLİ: WCF sözleşme adı (IPostBoxService) SOAPAction önekini belirler.
const SOAP_NS = 'http://tempuri.org/';
const SOAP_ACTION_PREFIX = 'http://tempuri.org/IPostBoxService/';
// CANLI DOĞRULAMA GEREKLİ: gelen e-fatura belge türü değeri.
const DOCUMENT_TYPE_IN = 'EINVOICE';
// CANLI DOĞRULAMA GEREKLİ: e-Logo oturum süresi dokümanda net değil — temkinli 20 dk.
const SESSION_TTL_MS = 20 * 60 * 1000;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** SOAP Fault varsa Türkçe, teşhis edilebilir hata fırlat */
function throwIfFault(xml: string, action: string): void {
  if (!/<(?:[^:>]+:)?Fault[\s>]/i.test(xml)) return;
  const reason =
    extractTag(xml, 'faultstring') ||
    extractTag(xml, 'Text') || // SOAP 1.2: <soap:Reason><soap:Text>
    extractTag(xml, 'Message') ||
    'fault metni okunamadi';
  throw new Error(`e-Logo SOAP ${action} fault: ${reason}`);
}

async function elogoSoap(url: string, action: string, bodyXml: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        SOAPAction: `"${SOAP_ACTION_PREFIX}${action}"`,
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>${bodyXml}</soapenv:Body>
</soapenv:Envelope>`,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err: any) {
    throw new Error(`e-Logo SOAP ${action} ağ hatası (${url}): ${err?.message || err}`);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // WCF fault'lar çoğunlukla HTTP 500 ile gelir — gövdedeki fault metnini de ekle
    const fault = extractTag(text, 'faultstring') || extractTag(text, 'Text') || '';
    throw new Error(
      `e-Logo SOAP ${action} hatası: HTTP ${res.status}${fault ? ` — ${fault}` : ''}`,
    );
  }
  throwIfFault(text, action);
  return text;
}

/**
 * GetDocumentData içeriği çöz: base64 → (ZIP ise ilk .xml girdisi) → UBL XML string.
 * e-Logo belge içeriğini genellikle ZIP paketli döndürür; düz XML gelirse onu da kabul et.
 */
function decodeDocumentData(base64: string): string | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
  if (buf.length === 0) return null;
  // ZIP imzası: PK\x03\x04
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    try {
      const zip = new AdmZip(buf);
      const entries = zip.getEntries().filter((e) => !e.isDirectory);
      const xmlEntry =
        entries.find((e) => /\.xml$/i.test(e.entryName)) || entries[0];
      if (!xmlEntry) return null;
      return xmlEntry.getData().toString('utf-8');
    } catch {
      return null;
    }
  }
  const text = buf.toString('utf-8');
  return text.trimStart().startsWith('<') ? text : null;
}

/** UBL-TR Invoice XML'inden özet alanları çıkar */
function parseUblSummary(ubl: string): {
  faturaNo: string | null;
  faturaDate: Date | null;
  senderVkn: string | null;
  senderTitle: string | null;
  receiverVkn: string | null;
  matrah: number | null;
  kdv: number | null;
  toplam: number | null;
  paraBirimi: string;
  invoiceProfile: string | null;
  ettn: string | null;
} {
  const partyVkn = (block: string | null): string | null => {
    if (!block) return null;
    const m = block.match(/<(?:[^:>]+:)?ID[^>]*schemeID="(?:VKN|TCKN)"[^>]*>([^<]+)/i);
    return m ? m[1].trim() : null;
  };
  const partyTitle = (block: string | null): string | null => {
    if (!block) return null;
    const nameBlock = extractTag(block, 'PartyName');
    return (nameBlock && extractTag(nameBlock, 'Name')) || null;
  };
  const num = (s: string | null): number | null => {
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const supplier = extractTag(ubl, 'AccountingSupplierParty');
  const customer = extractTag(ubl, 'AccountingCustomerParty');
  const totals = extractTag(ubl, 'LegalMonetaryTotal');
  const taxTotal = extractTag(ubl, 'TaxTotal');
  const issueDate = extractTag(ubl, 'IssueDate');
  return {
    faturaNo: extractTag(ubl, 'ID'), // Invoice kökündeki ilk cbc:ID = fatura numarası
    faturaDate: issueDate ? new Date(issueDate) : null,
    senderVkn: partyVkn(supplier),
    senderTitle: partyTitle(supplier),
    receiverVkn: partyVkn(customer),
    matrah: num(totals ? extractTag(totals, 'TaxExclusiveAmount') : null),
    kdv: num(taxTotal ? extractTag(taxTotal, 'TaxAmount') : null),
    toplam: num(totals ? extractTag(totals, 'PayableAmount') : null),
    paraBirimi: extractTag(ubl, 'DocumentCurrencyCode') || 'TRY',
    invoiceProfile: extractTag(ubl, 'ProfileID'),
    ettn: extractTag(ubl, 'UUID'),
  };
}

export class ElogoAdapter implements EFaturaAdapter {
  readonly provider = 'ELOGO';

  private serviceUrl(credentials: EFaturaCredentials): string {
    // config'ten serviceUrl ya da baseUrl ile ezilebilir; yoksa prod varsayılanı
    return credentials.serviceUrl || credentials.baseUrl || DEFAULT_SERVICE_URL;
  }

  /** Yön → e-Logo documentType. Giden için doğrulanmış varsayılan yok (bkz. üstteki liste, madde 6). */
  private documentType(credentials: EFaturaCredentials, direction: 'IN' | 'OUT'): string {
    if (direction === 'IN') return credentials.inDocumentType || DOCUMENT_TYPE_IN;
    const out = credentials.outDocumentType;
    if (!out) {
      throw new Error(
        'e-Logo GİDEN fatura çekimi: documentType değeri e-Logo dokümanından teyit edilmeden ' +
          'varsayılan konmadı (CANLI DOĞRULAMA GEREKLİ). Bağlantı config\'ine outDocumentType girin.',
      );
    }
    return out;
  }

  private async login(credentials: EFaturaCredentials): Promise<string> {
    if (!credentials.username || !credentials.password) {
      throw new Error('e-Logo login: kullanıcı adı/şifre boş — bağlantı config\'ini kontrol edin');
    }
    const xml = await elogoSoap(
      this.serviceUrl(credentials),
      'Login',
      // CANLI DOĞRULAMA GEREKLİ: parametre adları userName/passWord (WCF camelCase) dokümandan teyit edilmeli.
      `<Login xmlns="${SOAP_NS}">
        <userName>${xmlEsc(credentials.username)}</userName>
        <passWord>${xmlEsc(credentials.password)}</passWord>
      </Login>`,
    );
    const loginResult = extractTag(xml, 'LoginResult');
    const sessionId = extractTag(xml, 'sessionID') || extractTag(xml, 'SessionID');
    if ((loginResult && /^false$/i.test(loginResult)) || !sessionId) {
      throw new Error(
        `e-Logo login başarısız: sessionID alınamadı (LoginResult=${loginResult ?? 'yok'}). ` +
          'Kullanıcı adı/şifre ve servis URL\'ini kontrol edin.',
      );
    }
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
      } as DeltaState,
    };
  }

  /** Done işaretlenmemiş belge UUID listesini çek */
  private async getDocumentList(
    credentials: EFaturaCredentials,
    sessionId: string,
    documentType: string,
  ): Promise<string[]> {
    const xml = await elogoSoap(
      this.serviceUrl(credentials),
      'GetDocumentList',
      // CANLI DOĞRULAMA GEREKLİ: parametre adları sessionID/documentType dokümandan teyit edilmeli.
      `<GetDocumentList xmlns="${SOAP_NS}">
        <sessionID>${xmlEsc(sessionId)}</sessionID>
        <documentType>${xmlEsc(documentType)}</documentType>
      </GetDocumentList>`,
    );
    // CANLI DOĞRULAMA GEREKLİ: liste eleman etiketi — WCF ArrayOfstring (<a:string>),
    // bazı sürümlerde <guid> ya da <DocumentInfo><UUID> olabilir; üçü de denenir.
    const infoBlocks = extractAll(xml, 'DocumentInfo');
    if (infoBlocks.length > 0) {
      return infoBlocks
        .map((b) => extractTag(b, 'UUID') || extractTag(b, 'Uuid') || '')
        .filter((u) => GUID_RE.test(u));
    }
    const candidates = [...extractAll(xml, 'string'), ...extractAll(xml, 'guid')];
    return candidates.filter((u) => GUID_RE.test(u));
  }

  /** Tek belgenin içeriğini (UBL XML) indir */
  private async getDocumentData(
    credentials: EFaturaCredentials,
    sessionId: string,
    documentType: string,
    uuid: string,
  ): Promise<string | null> {
    const xml = await elogoSoap(
      this.serviceUrl(credentials),
      'GetDocumentData',
      // CANLI DOĞRULAMA GEREKLİ: parametre adı UUID (paramUUID/uuid olabilir) dokümandan teyit edilmeli.
      `<GetDocumentData xmlns="${SOAP_NS}">
        <sessionID>${xmlEsc(sessionId)}</sessionID>
        <UUID>${xmlEsc(uuid)}</UUID>
        <documentType>${xmlEsc(documentType)}</documentType>
      </GetDocumentData>`,
    );
    // CANLI DOĞRULAMA GEREKLİ: içerik etiketi — GetDocumentDataResult ya da binaryData.
    const content =
      extractTag(xml, 'GetDocumentDataResult') ||
      extractTag(xml, 'binaryData') ||
      extractTag(xml, 'Content');
    if (!content) return null;
    return decodeDocumentData(content);
  }

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
    const { sessionId, newState } = await this.ensureSession(credentials, opts.deltaState);
    const direction: 'IN' | 'OUT' = opts.direction === 'OUT' ? 'OUT' : 'IN';
    const documentType = this.documentType(credentials, direction);
    const page = Math.max(0, opts.page || 0);
    const pageSize = Math.min(opts.limit || 50, 100);

    // Not: e-Logo listesi tarih filtresi almaz — Done işaretlenmemiş her şey gelir.
    // startDate/endDate ile daraltma, belge indirildikten sonra UBL IssueDate üzerinden yapılır.
    const allUuids = await this.getDocumentList(credentials, sessionId, documentType);
    const pageUuids = allUuids.slice(page * pageSize, (page + 1) * pageSize);

    const invoices: RawEFatura[] = [];
    const docErrors: string[] = [];
    for (const uuid of pageUuids) {
      try {
        const ubl = await this.getDocumentData(credentials, sessionId, documentType, uuid);
        if (!ubl) {
          docErrors.push(`${uuid}: belge içeriği boş/çözülemedi`);
          continue; // Done işaretlenmez → sonraki sync'te tekrar denenir
        }
        const s = parseUblSummary(ubl);
        // Tarih filtresi (varsa) — aralık dışındaki belge listede kalsın diye atlanır
        if (s.faturaDate) {
          if (opts.startDate && s.faturaDate < opts.startDate) continue;
          if (opts.endDate && s.faturaDate > opts.endDate) continue;
        }
        invoices.push({
          uuid,
          ettn: s.ettn || uuid,
          senderVkn: s.senderVkn,
          senderTitle: s.senderTitle,
          receiverVkn: s.receiverVkn,
          faturaNo: s.faturaNo,
          faturaDate: s.faturaDate,
          matrah: s.matrah,
          kdv: s.kdv,
          toplam: s.toplam,
          paraBirimi: s.paraBirimi,
          direction,
          invoiceProfile: s.invoiceProfile,
          ublXmlRaw: ubl,
          markId: uuid, // GetDocumentDone UUID bekler
          rawJson: { documentType },
        });
      } catch (err: any) {
        docErrors.push(`${uuid}: ${err?.message || err}`);
      }
    }

    // Sayfadaki HER belge hata verdiyse sessizce boş dönme — teşhis edilebilir hata fırlat
    if (pageUuids.length > 0 && invoices.length === 0 && docErrors.length === pageUuids.length) {
      throw new Error(
        `e-Logo GetDocumentData: sayfadaki ${pageUuids.length} belgenin tamamı indirilemedi. ` +
          `İlk hata: ${docErrors[0]}`,
      );
    }

    return {
      invoices,
      nextState: { ...newState, lastSyncAt: new Date() } as DeltaState,
      hasMore: allUuids.length > (page + 1) * pageSize,
    };
  }

  /**
   * GetDocumentDone — belgeler "alındı" işaretlenir, sonraki GetDocumentList'te gelmez.
   * e-Logo'da toplu uç yok (bilgimize göre) — UUID başına tek çağrı.
   */
  async markAsTransferred(
    credentials: EFaturaCredentials,
    uuids: string[],
    deltaState?: DeltaState,
  ): Promise<void> {
    if (uuids.length === 0) return;
    const { sessionId } = await this.ensureSession(credentials, deltaState);
    // Yönü bilmiyoruz — mark listesi her iki yönden gelebilir; documentType olarak
    // gelen türü kullanılır (giden çekimi outDocumentType doğrulanınca ayrışacak).
    const documentType = credentials.inDocumentType || DOCUMENT_TYPE_IN;
    const errors: string[] = [];
    for (const uuid of uuids) {
      try {
        await elogoSoap(
          this.serviceUrl(credentials),
          'GetDocumentDone',
          // CANLI DOĞRULAMA GEREKLİ: parametre adları sessionID/UUID/documentType dokümandan teyit edilmeli.
          `<GetDocumentDone xmlns="${SOAP_NS}">
            <sessionID>${xmlEsc(sessionId)}</sessionID>
            <UUID>${xmlEsc(uuid)}</UUID>
            <documentType>${xmlEsc(documentType)}</documentType>
          </GetDocumentDone>`,
        );
      } catch (err: any) {
        errors.push(`${uuid}: ${err?.message || err}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `e-Logo GetDocumentDone: ${errors.length}/${uuids.length} belge işaretlenemedi — ${errors[0]}`,
      );
    }
  }

  async downloadXml(
    credentials: EFaturaCredentials,
    uuid: string,
    deltaState?: DeltaState,
  ): Promise<string | null> {
    const { sessionId } = await this.ensureSession(credentials, deltaState);
    const documentType = credentials.inDocumentType || DOCUMENT_TYPE_IN;
    return this.getDocumentData(credentials, sessionId, documentType, uuid);
  }
}
