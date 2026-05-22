import { Injectable, Logger } from '@nestjs/common';
import * as JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

export interface KdvBreakdownItem {
  rate: number;          // %20, %10, %1 → 20, 10, 1
  base: number;          // matrah (KDV'siz)
  amount: number;        // bu orandaki KDV tutarı
}

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
  kdvBreakdown?: KdvBreakdownItem[];   // çoklu KDV oranı detayı (UBL TaxSubtotal)
  toplamTutar?: number;
  paraBirimi?: string;
  aciklama?: string;
  xmlContent: string;
  pdfBuffer?: Buffer;
  htmlContent?: string;
  zipFileName: string;
  sourcePath?: string;
}

@Injectable()
export class EarsivZipParserService {
  private readonly logger = new Logger(EarsivZipParserService.name);

  /**
   * Luca'dan inen e-arşiv ZIP'ini ayıkla.
   * Tipik içerik: birden fazla XML (UBL) + her XML için PDF.
   * Örnek: GIB202612345.xml, GIB202612345.pdf
   */
  async parseZip(buf: Buffer): Promise<ParsedEarsivFatura[] & { __entries?: string[]; __xmlCount?: number; __zipError?: string }> {
    const results: ParsedEarsivFatura[] = [];

    const xmlFiles: { name: string; fullPath: string; content: string }[] = [];
    const pdfFiles = new Map<string, { name: string; fullPath: string; buffer: Buffer }>();
    const htmlFiles = new Map<string, { name: string; fullPath: string; content: string }>();
    const allEntries: string[] = [];

    // Recursive: ZIP içindeki ZIP'leri de aç
    const processZipBuffer = async (zipBuf: Buffer, prefix = ''): Promise<void> => {
      let zip;
      try {
        zip = await JSZip.loadAsync(zipBuf);
      } catch (e: any) {
        this.logger.warn(`ZIP açma hatası (${prefix}): ${e.message}`);
        if (!prefix) {
          throw new Error(`ZIP dosyası açılamadı: ${e.message}`);
        }
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
          xmlFiles.push({ name: baseName, fullPath, content });
        } else if (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.xhtml')) {
          const content = await (file as any).async('text');
          htmlFiles.set(stem, { name: baseName, fullPath, content });
        } else if (lower.endsWith('.pdf')) {
          const pdfBuf = await (file as any).async('nodebuffer');
          pdfFiles.set(stem, { name: baseName, fullPath, buffer: pdfBuf });
        } else if (lower.endsWith('.zip')) {
          // Nested ZIP — recursively process
          const nestedBuf = await (file as any).async('nodebuffer');
          await processZipBuffer(nestedBuf, fullPath);
        } else {
          // Uzantısı belirsiz — XML olabilir mi kontrol et (ilk byte'lar)
          try {
            const raw = await (file as any).async('nodebuffer');
            if (this.looksLikePdf(raw)) {
              pdfFiles.set(stem, { name: baseName, fullPath, buffer: raw });
              this.logger.log(`Uzantisiz PDF olarak yorumlandi: ${fullPath}`);
              continue;
            }
            const content = raw.toString('utf8');
            if (content.trim().startsWith('<?xml') || content.includes('<Invoice') || content.includes('<CreditNote')) {
              xmlFiles.push({ name: baseName, fullPath, content });
              this.logger.log(`Uzantısız XML olarak yorumlandı: ${fullPath}`);
            } else if (this.looksLikeHtml(content)) {
              htmlFiles.set(stem, { name: baseName, fullPath, content });
              this.logger.log(`Uzantisiz HTML olarak yorumlandi: ${fullPath}`);
            }
          } catch {}
        }
      }
    };

    await processZipBuffer(buf);

    this.logger.log(`ZIP toplam entry: ${allEntries.length}, XML: ${xmlFiles.length}, HTML: ${htmlFiles.size}, PDF: ${pdfFiles.size}`);
    if (allEntries.length <= 20) {
      this.logger.log(`ZIP içerik listesi: ${allEntries.join(' | ')}`);
    } else {
      this.logger.log(`ZIP içerik (ilk 20): ${allEntries.slice(0, 20).join(' | ')}`);
    }

    const parseDiagnostics: string[] = [];

    let pdfMatched = 0;
    let htmlMatched = 0;
    const pdfTextCache = new Map<string, Promise<string>>();

    for (const [xmlIndex, xml] of xmlFiles.entries()) {
      try {
        const parsed = this.parseUblInvoice(xml.content);
        if (parsed) {
          parsed.zipFileName = xml.fullPath || xml.name;
          parsed.sourcePath = xml.fullPath;
          parsed.pdfBuffer = parsed.pdfBuffer || await this.matchPdfBuffer(parsed, xml.fullPath || xml.name, xmlFiles.length, pdfFiles, xmlIndex, pdfTextCache);
          if (parsed.pdfBuffer) pdfMatched++;
          parsed.htmlContent = parsed.htmlContent || this.matchHtmlContent(parsed, xml.fullPath || xml.name, xmlFiles.length, htmlFiles, xmlIndex);
          if (parsed.htmlContent) htmlMatched++;
          results.push(parsed);
          parseDiagnostics.push(`${xml.name}:OK(${parsed.faturaNo},pdf=${parsed.pdfBuffer ? 'Y' : 'N'},html=${parsed.htmlContent ? 'Y' : 'N'})`);
        } else {
          // FALLBACK 1: Top-level keys çıkar
          const topKeys = this.peekTopKeys(xml.content);
          // FALLBACK 2: Regex ile faturaNo/UUID çıkar — XML parser çuvallasa bile kayıt oluştur
          const fb = this.regexFallback(xml.content);
          if (fb) {
            fb.zipFileName = xml.fullPath || xml.name;
            fb.sourcePath = xml.fullPath;
            fb.pdfBuffer = fb.pdfBuffer || await this.matchPdfBuffer(fb, xml.fullPath || xml.name, xmlFiles.length, pdfFiles, xmlIndex, pdfTextCache);
            if (fb.pdfBuffer) pdfMatched++;
            fb.htmlContent = fb.htmlContent || this.matchHtmlContent(fb, xml.fullPath || xml.name, xmlFiles.length, htmlFiles, xmlIndex);
            if (fb.htmlContent) htmlMatched++;
            results.push(fb);
            parseDiagnostics.push(`${xml.name}:FALLBACK(${fb.faturaNo},pdf=${fb.pdfBuffer ? 'Y' : 'N'},html=${fb.htmlContent ? 'Y' : 'N'},keys=${topKeys})`);
          } else {
            parseDiagnostics.push(`${xml.name}:FAIL(keys=${topKeys},len=${xml.content.length})`);
          }
          this.logger.warn(`XML parse: root tag bulunamadı (${xml.name}, top-keys=${topKeys}, başı: ${xml.content.slice(0, 200).replace(/\s+/g, ' ')})`);
        }
      } catch (e: any) {
        // parseUblInvoice patladı — regex fallback DENE, kayıt kaybolmasın
        try {
          const fb = this.regexFallback(xml.content);
          if (fb) {
            fb.zipFileName = xml.fullPath || xml.name;
            fb.sourcePath = xml.fullPath;
            fb.pdfBuffer = fb.pdfBuffer || await this.matchPdfBuffer(fb, xml.fullPath || xml.name, xmlFiles.length, pdfFiles, xmlIndex, pdfTextCache);
            if (fb.pdfBuffer) pdfMatched++;
            fb.htmlContent = fb.htmlContent || this.matchHtmlContent(fb, xml.fullPath || xml.name, xmlFiles.length, htmlFiles, xmlIndex);
            if (fb.htmlContent) htmlMatched++;
            results.push(fb);
            parseDiagnostics.push(`${xml.name}:FALLBACK_AFTER_ERR(${fb.faturaNo},pdf=${fb.pdfBuffer ? 'Y' : 'N'},html=${fb.htmlContent ? 'Y' : 'N'},err=${e.message?.slice(0, 30)})`);
            continue;
          }
        } catch (e2: any) {}
        parseDiagnostics.push(`${xml.name}:ERR(${e.message?.slice(0, 50)})`);
        this.logger.warn(`XML parse hata (${xml.name}): ${e.message}`);
      }
    }

    this.logger.log(`Parse sonuç: ${results.length} fatura çıkarıldı (${xmlFiles.length} XML'den)`);

    // Meta bilgileri results array'ine ek property olarak attach et
    (results as any).__entries = allEntries;
    (results as any).__xmlCount = xmlFiles.length;
    (results as any).__pdfCount = pdfFiles.size;
    (results as any).__pdfMatched = pdfMatched;
    (results as any).__htmlCount = htmlFiles.size;
    (results as any).__htmlMatched = htmlMatched;
    (results as any).__totalEntries = allEntries.length;
    (results as any).__diagnostics = parseDiagnostics;

    return results;
  }

  private normalizeFileKey(value?: string | null): string {
    return String(value || '')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private looksLikePdf(buffer: Buffer): boolean {
    return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }

  private looksLikeHtml(content: string): boolean {
    const head = String(content || '').trim().slice(0, 1000).toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html') || /<body[\s>]/i.test(head);
  }

  private extractEmbeddedOriginalDocument(xml: string): { pdfBuffer?: Buffer; htmlContent?: string } {
    const out: { pdfBuffer?: Buffer; htmlContent?: string } = {};
    const re = /<(?:[a-z0-9_-]+:)?EmbeddedDocumentBinaryObject\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?EmbeddedDocumentBinaryObject>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml))) {
      const attrs = match[1] || '';
      const context = xml.slice(Math.max(0, match.index - 800), match.index + 200).toLowerCase();
      const marker = `${attrs} ${context}`.toLowerCase();
      if (/xslt|xsl|stylesheet|style\s*sheet/.test(marker)) continue;

      const mime = (attrs.match(/\bmimeCode=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
      const fileName = (attrs.match(/\bfilename=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
      const raw = String(match[2] || '')
        .replace(/<!\[CDATA\[/gi, '')
        .replace(/\]\]>/g, '')
        .replace(/\s+/g, '')
        .trim();
      if (!raw) continue;

      let buf: Buffer;
      try {
        buf = Buffer.from(raw, 'base64');
      } catch {
        continue;
      }
      if (!buf.length) continue;

      if (!out.pdfBuffer && (mime.includes('pdf') || fileName.endsWith('.pdf') || this.looksLikePdf(buf))) {
        if (this.looksLikePdf(buf)) out.pdfBuffer = buf;
        continue;
      }

      if (!out.htmlContent && (mime.includes('html') || fileName.endsWith('.html') || fileName.endsWith('.htm'))) {
        const html = buf.toString('utf8');
        if (this.looksLikeHtml(html)) out.htmlContent = html;
        continue;
      }

      if (!out.htmlContent) {
        const text = buf.toString('utf8');
        if (this.looksLikeHtml(text)) out.htmlContent = text;
      }
    }
    return out;
  }

  private entryDir(value?: string | null): string {
    const normalized = String(value || '').replace(/\\/g, '/');
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(0, index) : '';
  }

  private async pdfTextFor(
    cacheKey: string,
    buffer: Buffer,
    cache: Map<string, Promise<string>>,
  ): Promise<string> {
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, (async () => {
        try {
          const pdfParse = require('pdf-parse');
          const result = await pdfParse(buffer, { max: 2 });
          return String(result?.text || '');
        } catch {
          return '';
        }
      })());
    }
    return cache.get(cacheKey)!;
  }

  private async matchPdfBuffer(
    parsed: Pick<ParsedEarsivFatura, 'faturaNo' | 'ettn'>,
    xmlName: string,
    xmlCount: number,
    pdfFiles: Map<string, { name: string; fullPath: string; buffer: Buffer }>,
    xmlIndex?: number,
    pdfTextCache = new Map<string, Promise<string>>(),
  ): Promise<Buffer | undefined> {
    if (!pdfFiles.size) return undefined;

    const pdfEntries = [...pdfFiles.entries()];
    if (xmlCount === 1 && pdfEntries.length === 1) return pdfEntries[0][1].buffer;

    const candidates = [
      parsed.faturaNo,
      parsed.ettn,
      xmlName,
      xmlName.replace(/\.[^.]+$/, ''),
    ]
      .map((v) => this.normalizeFileKey(v))
      .filter(Boolean);

    for (const candidate of candidates) {
      const exact = pdfEntries.find(([stem, pdf]) =>
        this.normalizeFileKey(stem) === candidate ||
        this.normalizeFileKey(pdf.name) === candidate ||
        this.normalizeFileKey(pdf.fullPath) === candidate,
      );
      if (exact) return exact[1].buffer;
    }

    for (const candidate of candidates) {
      const fuzzy = pdfEntries.find(([stem, pdf]) => {
        const keys = [stem, pdf.name, pdf.fullPath].map((v) => this.normalizeFileKey(v));
        return keys.some((key) => key.includes(candidate) || candidate.includes(key));
      });
      if (fuzzy) return fuzzy[1].buffer;
    }

    const xmlDir = this.entryDir(xmlName);
    if (xmlDir) {
      const sameDir = pdfEntries.filter(([, pdf]) => this.entryDir(pdf.fullPath) === xmlDir);
      if (sameDir.length === 1) return sameDir[0][1].buffer;
    }

    const contentCandidates = [parsed.faturaNo, parsed.ettn]
      .map((v) => this.normalizeFileKey(v))
      .filter(Boolean);
    if (contentCandidates.length && pdfEntries.length <= 300) {
      for (const [stem, pdf] of pdfEntries) {
        const cacheKey = `${stem}:${pdf.fullPath}`;
        const text = this.normalizeFileKey(await this.pdfTextFor(cacheKey, pdf.buffer, pdfTextCache));
        if (text && contentCandidates.some((candidate) => text.includes(candidate))) {
          return pdf.buffer;
        }
      }
    }

    // Luca bazen XML/PDF dosyalarına belge no taşımayan sıra bazlı ad verir.
    // Sayılar birebir eşitse aynı sıradaki PDF'i orijinal görüntü olarak eşle.
    if (xmlCount === pdfEntries.length && xmlIndex !== undefined && pdfEntries[xmlIndex]) {
      return pdfEntries[xmlIndex][1].buffer;
    }

    return undefined;
  }

  private matchHtmlContent(
    parsed: Pick<ParsedEarsivFatura, 'faturaNo' | 'ettn'>,
    xmlName: string,
    xmlCount: number,
    htmlFiles: Map<string, { name: string; fullPath: string; content: string }>,
    xmlIndex?: number,
  ): string | undefined {
    if (!htmlFiles.size) return undefined;

    const htmlEntries = [...htmlFiles.entries()].filter(([, html]) => html.content.trim().length > 0);
    if (!htmlEntries.length) return undefined;
    if (xmlCount === 1 && htmlEntries.length === 1) return htmlEntries[0][1].content;

    const candidates = [
      parsed.faturaNo,
      parsed.ettn,
      xmlName,
      xmlName.replace(/\.[^.]+$/, ''),
    ]
      .map((v) => this.normalizeFileKey(v))
      .filter(Boolean);

    for (const candidate of candidates) {
      const exact = htmlEntries.find(([stem, html]) =>
        this.normalizeFileKey(stem) === candidate ||
        this.normalizeFileKey(html.name) === candidate ||
        this.normalizeFileKey(html.fullPath) === candidate,
      );
      if (exact) return exact[1].content;
    }

    for (const candidate of candidates) {
      const fuzzy = htmlEntries.find(([stem, html]) => {
        const keys = [stem, html.name, html.fullPath].map((v) => this.normalizeFileKey(v));
        return keys.some((key) => key.includes(candidate) || candidate.includes(key));
      });
      if (fuzzy) return fuzzy[1].content;
    }

    const xmlDir = this.entryDir(xmlName);
    if (xmlDir) {
      const sameDir = htmlEntries.filter(([, html]) => this.entryDir(html.fullPath) === xmlDir);
      if (sameDir.length === 1) return sameDir[0][1].content;
    }

    const contentCandidates = [parsed.faturaNo, parsed.ettn]
      .map((v) => this.normalizeFileKey(v))
      .filter(Boolean);
    for (const [, html] of htmlEntries) {
      const text = this.normalizeFileKey(html.content);
      if (text && contentCandidates.some((candidate) => text.includes(candidate))) {
        return html.content;
      }
    }

    if (xmlCount === htmlEntries.length && xmlIndex !== undefined && htmlEntries[xmlIndex]) {
      return htmlEntries[xmlIndex][1].content;
    }

    return undefined;
  }

  /**
   * XML'in top-level key'lerini hızlıca çıkar (debug için).
   */
  private peekTopKeys(xml: string): string {
    try {
      const p = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
      const j = p.parse(xml);
      return Object.keys(j).slice(0, 5).join('|');
    } catch {
      return '?';
    }
  }

  /**
   * XML parser çuvallarsa regex ile temel alanları çıkar — kayıt kaybolmasın.
   * UBL Invoice XML'inde <cbc:ID>...</cbc:ID> ve <cbc:UUID>...</cbc:UUID> her zaman var.
   */
  private regexFallback(xml: string): ParsedEarsivFatura | null {
    // ID veya cbc:ID veya başka prefix
    const idMatch = xml.match(/<(?:[a-z0-9]+:)?ID[^>]*>([^<]+)<\/(?:[a-z0-9]+:)?ID>/i);
    const uuidMatch = xml.match(/<(?:[a-z0-9]+:)?UUID[^>]*>([^<]+)<\/(?:[a-z0-9]+:)?UUID>/i);
    const dateMatch = xml.match(/<(?:[a-z0-9]+:)?IssueDate[^>]*>([^<]+)<\/(?:[a-z0-9]+:)?IssueDate>/i);
    const payableMatch = xml.match(/<(?:[a-z0-9]+:)?PayableAmount[^>]*>([\d.,]+)</i);
    const taxInclusiveMatch = xml.match(/<(?:[a-z0-9]+:)?TaxInclusiveAmount[^>]*>([\d.,]+)</i);
    const taxExclusiveMatch = xml.match(/<(?:[a-z0-9]+:)?TaxExclusiveAmount[^>]*>([\d.,]+)</i);
    const taxMatch = xml.match(/<(?:[a-z0-9]+:)?TaxAmount[^>]*>([\d.,]+)</i);
    const lineExtMatch = xml.match(/<(?:[a-z0-9]+:)?LineExtensionAmount[^>]*>([\d.,]+)</i);

    if (!idMatch && !uuidMatch) return null;

    const num = (s?: string) => {
      if (!s) return undefined;
      const n = parseFloat(s.replace(',', '.'));
      return isFinite(n) ? n : undefined;
    };

    let faturaTarihi = new Date();
    if (dateMatch) {
      const d = new Date(dateMatch[1]);
      if (!isNaN(d.getTime())) faturaTarihi = d;
    }

    // Türk muhasebe görünümü: matrah = TaxExclusiveAmount (indirimler düşülmüş, KDV'siz);
    // toplam = TaxInclusiveAmount (KDV dahil brüt). PayableAmount tevkifat/öndepoziti
    // düştüğü için "genel toplam" amacıyla yanıltıcı.
    const matrah = num(taxExclusiveMatch?.[1]) ?? num(lineExtMatch?.[1]);
    const kdvTutari = num(taxMatch?.[1]);
    const toplamTutar = num(taxInclusiveMatch?.[1]) ?? num(payableMatch?.[1]);
    const embedded = this.extractEmbeddedOriginalDocument(xml);

    return {
      faturaNo: idMatch?.[1]?.trim() || uuidMatch?.[1]?.trim() || 'BILINMIYOR',
      faturaTarihi,
      ettn: uuidMatch?.[1]?.trim(),
      matrah,
      kdvTutari,
      kdvOrani: matrah && kdvTutari ? Math.round((kdvTutari / matrah) * 100) : undefined,
      toplamTutar,
      paraBirimi: 'TL',
      xmlContent: xml,
      pdfBuffer: embedded.pdfBuffer,
      htmlContent: embedded.htmlContent,
      zipFileName: '',
    };
  }

  /**
   * UBL 2.1 Invoice XML'ini parse et.
   */
  private parseUblInvoice(xml: string): ParsedEarsivFatura | null {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      removeNSPrefix: true, // ← namespace prefix'leri (cbc:, cac:, n0:, ubl:) at — UBL parse için kritik
    });
    const j = parser.parse(xml);

    // Hem Invoice hem CreditNote için root key bul.
    // Bazı XML'lerin <?xml...> sonrası başka envelope'u olabilir, key'leri tara.
    const findRoot = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return null;
      for (const k of Object.keys(obj)) {
        if (/^(Invoice|CreditNote|ApplicationResponse|DespatchAdvice)$/i.test(k)) {
          return obj[k];
        }
      }
      // ilk objektif key'i de kontrol et (tek seviyeli envelope)
      for (const k of Object.keys(obj)) {
        if (typeof obj[k] === 'object' && obj[k] !== null) {
          const inner = findRoot(obj[k]);
          if (inner) return inner;
        }
      }
      return null;
    };

    const root = findRoot(j);
    if (!root) {
      this.logger.warn(`UBL root tag bulunamadı, top-level keys: ${Object.keys(j).join(',')}`);
      return null;
    }

    // removeNSPrefix:true sayesinde artık tüm key'ler prefix'siz (Invoice, ID, vb.)
    const get = (path: string[]): any => {
      let cur = root;
      for (const p of path) {
        if (!cur) return undefined;
        cur = cur[p];
      }
      return cur;
    };

    const txt = (v: any): string | undefined => {
      if (v == null) return undefined;
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      if (Array.isArray(v)) return txt(v[0]); // ilk elemanı dene
      if (typeof v === 'object') {
        const t = v['#text'] ?? v['_'];
        if (typeof t === 'string') return t;
        if (typeof t === 'number') return String(t);
        return undefined;
      }
      return undefined;
    };

    const digits = (value: any): string | undefined => {
      const cleaned = String(value || '').replace(/\D/g, '');
      return cleaned.length === 10 || cleaned.length === 11 ? cleaned : undefined;
    };

    const asArray = (value: any): any[] => {
      if (value == null) return [];
      return Array.isArray(value) ? value : [value];
    };

    const idText = (node: any): string | undefined => {
      if (node == null) return undefined;
      if (typeof node === 'string' || typeof node === 'number') return String(node);
      return txt(node?.ID) || txt(node?.CompanyID) || txt(node);
    };

    const idScheme = (node: any): string => String(
      node?.ID?.['@schemeID'] ||
      node?.CompanyID?.['@schemeID'] ||
      node?.['@schemeID'] ||
      '',
    ).toUpperCase();

    const taxNoFromParty = (party: any): string | undefined => {
      const nodes = [
        ...asArray(party?.PartyTaxScheme),
        ...asArray(party?.PartyIdentification),
        ...asArray(party?.PartyLegalEntity),
      ];
      for (const node of nodes) {
        const scheme = idScheme(node);
        const no = digits(idText(node));
        if (no && (scheme === 'VKN' || scheme === 'TCKN')) return no;
      }
      for (const node of nodes) {
        const no = digits(idText(node));
        if (no) return no;
      }
      return undefined;
    };

    const taxNoFromXmlBlock = (tagName: string): string | undefined => {
      const block = xml.match(new RegExp(`<[^>]*${tagName}[^>]*>([\\s\\S]*?)<\\/[^>]*${tagName}>`, 'i'))?.[1] || '';
      if (!block) return undefined;
      const withScheme = block.match(/<[^>]*(?:ID|CompanyID)[^>]*schemeID=["'](?:VKN|TCKN)["'][^>]*>\s*(\d{10,11})\s*<\//i);
      if (withScheme?.[1]) return withScheme[1];
      const companyId = block.match(/<[^>]*CompanyID[^>]*>\s*(\d{10,11})\s*<\//i);
      if (companyId?.[1]) return companyId[1];
      return undefined;
    };

    const num = (v: any): number | undefined => {
      const s = txt(v);
      if (typeof s !== 'string') return undefined; // ← KRİTİK GUARD
      const n = parseFloat(s.replace(',', '.'));
      return isFinite(n) ? n : undefined;
    };

    const faturaNo = txt(get(['ID'])) || '';
    const ettn = txt(get(['UUID']));
    const issueDateRaw = txt(get(['IssueDate']));
    let faturaTarihi = new Date();
    if (issueDateRaw) {
      const d = new Date(issueDateRaw);
      if (!isNaN(d.getTime())) faturaTarihi = d;
    }

    // Satıcı
    const supplier = get(['AccountingSupplierParty', 'Party']);
    const satici = txt(supplier?.['PartyName']?.['Name'])
      || txt(supplier?.['PartyLegalEntity']?.['RegistrationName']);
    const saticiVergiNo = taxNoFromParty(supplier)
      || taxNoFromXmlBlock('AccountingSupplierParty');

    // Alıcı
    const customer = get(['AccountingCustomerParty', 'Party']);
    const alici = txt(customer?.['PartyName']?.['Name'])
      || txt(customer?.['PartyLegalEntity']?.['RegistrationName']);
    const aliciVergiNo = taxNoFromParty(customer)
      || taxNoFromXmlBlock('AccountingCustomerParty');

    // Tutarlar — TaxExclusive ve TaxInclusive AYNI seviyede (KDV'siz / KDV dahil)
    // ki matrah + KDV = toplam tutmasın diye değil, TUTSUN diye.
    // LineExtensionAmount indirimden önce, PayableAmount tevkifat/öndepozit sonrası
    // → ikisini ana alan olarak kullanmak matematiği bozuyor.
    const monetaryTotal = get(['LegalMonetaryTotal']);
    const matrah = num(monetaryTotal?.['TaxExclusiveAmount'])
      ?? num(monetaryTotal?.['LineExtensionAmount']);
    const toplamTutar = num(monetaryTotal?.['TaxInclusiveAmount'])
      ?? num(monetaryTotal?.['PayableAmount']);

    // KDV — TaxTotal array veya tek obje olabilir; içinde TaxSubtotal'lar oran-bazlı detay
    const taxTotalRaw = get(['TaxTotal']);
    const taxTotalList: any[] = Array.isArray(taxTotalRaw)
      ? taxTotalRaw
      : (taxTotalRaw ? [taxTotalRaw] : []);

    // Tüm TaxSubtotal'ları topla — birden fazla KDV oranı olabilir (gıda %1 + diğer %20)
    const breakdown: KdvBreakdownItem[] = [];
    let kdvTutariToplam = 0;
    for (const tt of taxTotalList) {
      const subtotalRaw = tt?.['TaxSubtotal'];
      const subtotalList: any[] = Array.isArray(subtotalRaw)
        ? subtotalRaw
        : (subtotalRaw ? [subtotalRaw] : []);

      for (const st of subtotalList) {
        const base = num(st?.['TaxableAmount']);
        const amount = num(st?.['TaxAmount']);
        // Oran TaxCategory.Percent altında veya doğrudan Percent olabilir
        const ratePct =
          num(st?.['TaxCategory']?.['Percent']) ??
          num(st?.['Percent']) ??
          (base && amount ? Math.round((amount / base) * 100) : undefined);

        // Sadece anlamlı satırları al (KDV > 0 veya base > 0)
        if (base !== undefined || amount !== undefined) {
          breakdown.push({
            rate: ratePct ?? 0,
            base: base ?? 0,
            amount: amount ?? 0,
          });
          if (amount) kdvTutariToplam += amount;
        }
      }
      // TaxSubtotal yoksa ama TaxAmount toplam varsa onu kullan
      if (subtotalList.length === 0) {
        const totalTax = num(tt?.['TaxAmount']);
        if (totalTax) kdvTutariToplam += totalTax;
      }
    }

    // Geriye uyumluluk için tek-değer toplamlar
    const kdvTutari = kdvTutariToplam > 0
      ? kdvTutariToplam
      : num(taxTotalList[0]?.['TaxAmount']);

    // Para birimi
    const paraBirimi = txt(get(['DocumentCurrencyCode'])) || 'TRY';

    // Tek oran ise eski kdvOrani değerini de set et
    const kdvOraniTek = breakdown.length === 1
      ? breakdown[0].rate
      : (matrah && kdvTutari ? Math.round((kdvTutari / matrah) * 100) : undefined);
    const embedded = this.extractEmbeddedOriginalDocument(xml);

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
      kdvOrani: kdvOraniTek,
      kdvBreakdown: breakdown.length > 0 ? breakdown : undefined,
      toplamTutar,
      paraBirimi: paraBirimi === 'TRY' ? 'TL' : paraBirimi,
      xmlContent: xml,
      pdfBuffer: embedded.pdfBuffer,
      htmlContent: embedded.htmlContent,
      zipFileName: '',
    };
  }
}
