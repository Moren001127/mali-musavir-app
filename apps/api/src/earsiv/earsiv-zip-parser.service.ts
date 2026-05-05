import { Injectable, Logger } from '@nestjs/common';
import * as JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

export interface ParsedEarsivFatura {
  faturaNo: string;
  faturaTarihi: Date;
  ettn?: string;
  satici?: string;
  saticiVergiNo?: string;
  alici?: string;
  aliciVergiNo?: string;
  matrah?: number;
  kdvTutari?: number;
  kdvOrani?: number;
  toplamTutar?: number;
  paraBirimi?: string;
  aciklama?: string;
  xmlContent: string;
  pdfBuffer?: Buffer;
  zipFileName: string;
}

@Injectable()
export class EarsivZipParserService {
  private readonly logger = new Logger(EarsivZipParserService.name);

  /**
   * Luca'dan inen e-arşiv ZIP'ini ayıkla.
   * Tipik içerik: birden fazla XML (UBL) + her XML için PDF.
   * Örnek: GIB202612345.xml, GIB202612345.pdf
   */
  async parseZip(buf: Buffer): Promise<ParsedEarsivFatura[]> {
    const results: ParsedEarsivFatura[] = [];

    const xmlFiles: { name: string; content: string }[] = [];
    const pdfFiles = new Map<string, Buffer>();
    const allEntries: string[] = [];

    // Recursive: ZIP içindeki ZIP'leri de aç
    const processZipBuffer = async (zipBuf: Buffer, prefix = ''): Promise<void> => {
      let zip;
      try {
        zip = await JSZip.loadAsync(zipBuf);
      } catch (e: any) {
        this.logger.warn(`ZIP açma hatası (${prefix}): ${e.message}`);
        return;
      }

      for (const [path, file] of Object.entries(zip.files)) {
        if ((file as any).dir) continue;
        const fullPath = prefix ? `${prefix}/${path}` : path;
        const lower = path.toLowerCase();
        const baseName = path.split('/').pop() || path;
        const stem = baseName.replace(/\.[^.]+$/, '');
        allEntries.push(`${fullPath} (${(file as any)._data?.uncompressedSize || '?'}B)`);

        if (lower.endsWith('.xml') || lower.endsWith('.ubl')) {
          const content = await (file as any).async('text');
          xmlFiles.push({ name: baseName, content });
        } else if (lower.endsWith('.pdf')) {
          const pdfBuf = await (file as any).async('nodebuffer');
          pdfFiles.set(stem, pdfBuf);
        } else if (lower.endsWith('.zip')) {
          // Nested ZIP — recursively process
          const nestedBuf = await (file as any).async('nodebuffer');
          await processZipBuffer(nestedBuf, fullPath);
        } else {
          // Uzantısı belirsiz — XML olabilir mi kontrol et (ilk byte'lar)
          try {
            const content = await (file as any).async('text');
            if (content.trim().startsWith('<?xml') || content.includes('<Invoice') || content.includes('<CreditNote')) {
              xmlFiles.push({ name: baseName, content });
              this.logger.log(`Uzantısız XML olarak yorumlandı: ${fullPath}`);
            }
          } catch {}
        }
      }
    };

    await processZipBuffer(buf);

    this.logger.log(`ZIP toplam entry: ${allEntries.length}, XML: ${xmlFiles.length}, PDF: ${pdfFiles.size}`);
    if (allEntries.length <= 20) {
      this.logger.log(`ZIP içerik listesi: ${allEntries.join(' | ')}`);
    } else {
      this.logger.log(`ZIP içerik (ilk 20): ${allEntries.slice(0, 20).join(' | ')}`);
    }

    for (const xml of xmlFiles) {
      try {
        const parsed = this.parseUblInvoice(xml.content);
        if (parsed) {
          const stem = xml.name.replace(/\.[^.]+$/, '');
          parsed.zipFileName = xml.name;
          parsed.pdfBuffer = pdfFiles.get(stem);
          results.push(parsed);
        } else {
          this.logger.warn(`XML parse: root tag bulunamadı (${xml.name}, ${xml.content.length} char, başı: ${xml.content.slice(0, 100)})`);
        }
      } catch (e: any) {
        this.logger.warn(`XML parse hata (${xml.name}): ${e.message}`);
      }
    }

    this.logger.log(`Parse sonuç: ${results.length} fatura çıkarıldı (${xmlFiles.length} XML'den)`);
    return results;
  }

  /**
   * UBL 2.1 Invoice XML'ini parse et.
   */
  private parseUblInvoice(xml: string): ParsedEarsivFatura | null {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      removeNSPrefix: false,
    });
    const j = parser.parse(xml);

    // Hem Invoice hem CreditNote için root key bul
    const root = j['Invoice'] || j['CreditNote'] || j['ApplicationResponse'];
    if (!root) return null;

    const get = (path: string[]): any => {
      let cur = root;
      for (const p of path) {
        if (!cur) return undefined;
        cur = cur[p] || cur[`cbc:${p}`] || cur[`cac:${p}`];
      }
      return cur;
    };

    const txt = (v: any): string | undefined => {
      if (v == null) return undefined;
      if (typeof v === 'string' || typeof v === 'number') return String(v);
      if (typeof v === 'object') return v['#text'] || v['_'] || undefined;
      return undefined;
    };

    const num = (v: any): number | undefined => {
      const s = txt(v);
      if (!s) return undefined;
      const n = parseFloat(s.replace(',', '.'));
      return isFinite(n) ? n : undefined;
    };

    const faturaNo = txt(get(['ID'])) || txt(get(['cbc:ID'])) || '';
    const ettn = txt(get(['UUID'])) || txt(get(['cbc:UUID']));
    const issueDateRaw = txt(get(['IssueDate'])) || txt(get(['cbc:IssueDate']));
    let faturaTarihi = new Date();
    if (issueDateRaw) {
      const d = new Date(issueDateRaw);
      if (!isNaN(d.getTime())) faturaTarihi = d;
    }

    // Satıcı (AccountingSupplierParty)
    const supplier = get(['AccountingSupplierParty', 'Party'])
      || get(['cac:AccountingSupplierParty', 'cac:Party']);
    const satici = txt(supplier?.['PartyName']?.['Name'])
      || txt(supplier?.['cac:PartyName']?.['cbc:Name'])
      || txt(supplier?.['PartyLegalEntity']?.['RegistrationName'])
      || txt(supplier?.['cac:PartyLegalEntity']?.['cbc:RegistrationName']);
    const saticiVergiNo = txt(supplier?.['PartyTaxScheme']?.['CompanyID'])
      || txt(supplier?.['cac:PartyTaxScheme']?.['cbc:CompanyID'])
      || txt(supplier?.['PartyIdentification']?.['ID'])
      || txt(supplier?.['cac:PartyIdentification']?.['cbc:ID']);

    // Alıcı (AccountingCustomerParty)
    const customer = get(['AccountingCustomerParty', 'Party'])
      || get(['cac:AccountingCustomerParty', 'cac:Party']);
    const alici = txt(customer?.['PartyName']?.['Name'])
      || txt(customer?.['cac:PartyName']?.['cbc:Name'])
      || txt(customer?.['PartyLegalEntity']?.['RegistrationName'])
      || txt(customer?.['cac:PartyLegalEntity']?.['cbc:RegistrationName']);
    const aliciVergiNo = txt(customer?.['PartyTaxScheme']?.['CompanyID'])
      || txt(customer?.['cac:PartyTaxScheme']?.['cbc:CompanyID'])
      || txt(customer?.['PartyIdentification']?.['ID'])
      || txt(customer?.['cac:PartyIdentification']?.['cbc:ID']);

    // Tutarlar (LegalMonetaryTotal)
    const monetaryTotal = get(['LegalMonetaryTotal']) || get(['cac:LegalMonetaryTotal']);
    const matrah = num(monetaryTotal?.['LineExtensionAmount'])
      ?? num(monetaryTotal?.['cbc:LineExtensionAmount'])
      ?? num(monetaryTotal?.['TaxExclusiveAmount'])
      ?? num(monetaryTotal?.['cbc:TaxExclusiveAmount']);
    const toplamTutar = num(monetaryTotal?.['PayableAmount'])
      ?? num(monetaryTotal?.['cbc:PayableAmount'])
      ?? num(monetaryTotal?.['TaxInclusiveAmount'])
      ?? num(monetaryTotal?.['cbc:TaxInclusiveAmount']);

    // KDV (TaxTotal)
    const taxTotal = get(['TaxTotal']) || get(['cac:TaxTotal']);
    const kdvTutari = num(taxTotal?.['TaxAmount'])
      ?? num(taxTotal?.['cbc:TaxAmount']);

    // Para birimi
    const paraBirimi = txt(get(['DocumentCurrencyCode']))
      || txt(get(['cbc:DocumentCurrencyCode']))
      || 'TRY';

    return {
      faturaNo: faturaNo || 'BILINMIYOR',
      faturaTarihi,
      ettn,
      satici,
      saticiVergiNo,
      alici,
      aliciVergiNo,
      matrah,
      kdvTutari,
      kdvOrani: matrah && kdvTutari ? Math.round((kdvTutari / matrah) * 100) : undefined,
      toplamTutar,
      paraBirimi: paraBirimi === 'TRY' ? 'TL' : paraBirimi,
      xmlContent: xml,
      zipFileName: '',
    };
  }
}
