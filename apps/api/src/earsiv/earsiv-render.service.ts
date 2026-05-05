import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

/**
 * UBL-TR e-Arşiv/e-Fatura faturalarını Türkçe görsel HTML'e çevirir.
 * GİB XSLT'sini dosyanın içinden çıkarmaya çalışır; başaramazsa sade Türkçe
 * fatura template'i ile render eder. Tek dokümanda yazdırılabilir.
 */

export interface RenderableFatura {
  id: string;
  faturaNo: string;
  faturaTarihi: Date | string;
  ettn?: string | null;
  satici?: string | null;
  saticiVergiNo?: string | null;
  alici?: string | null;
  aliciVergiNo?: string | null;
  matrah?: any;
  kdvTutari?: any;
  kdvOrani?: any;
  toplamTutar?: any;
  paraBirimi?: string | null;
  xmlContent?: string | null;
}

interface ParsedLine {
  sira: number;
  aciklama: string;
  miktar?: string;
  birim?: string;
  birimFiyat?: string;
  tutar?: string;
  kdvOrani?: string;
  kdvTutari?: string;
}

@Injectable()
export class EarsivRenderService {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    removeNSPrefix: true,
  });

  /** Birden fazla faturayı tek HTML belgesinde, page-break ile birleştirip yazdırılabilir döner */
  renderBulkHtml(faturas: RenderableFatura[], opts: { autoPrint?: boolean } = {}): string {
    const inner = faturas.map((f, idx) => this.renderInvoiceBody(f, idx > 0)).join('\n');
    return this.htmlShell(inner, opts.autoPrint !== false);
  }

  /** Tek fatura için tam HTML doküman */
  renderHtml(fatura: RenderableFatura, opts: { autoPrint?: boolean } = {}): string {
    return this.htmlShell(this.renderInvoiceBody(fatura, false), !!opts.autoPrint);
  }

  // ─── Private ────────────────────────────────────────────────────

  private htmlShell(body: string, autoPrint: boolean): string {
    const printScript = autoPrint
      ? `<script>window.addEventListener('load', () => { setTimeout(() => window.print(), 200); });</script>`
      : '';
    return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>e-Arşiv Fatura</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #111; background: #fff; font-size: 12px; }
  .page { width: 210mm; min-height: 297mm; padding: 14mm 16mm; margin: 0 auto; background: #fff; }
  .page + .page { page-break-before: always; }
  h1.title { font-size: 20px; margin: 0 0 4px 0; letter-spacing: 0.5px; }
  .subtitle { font-size: 11px; color: #666; margin-bottom: 16px; }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  table.meta td { padding: 6px 8px; border: 1px solid #999; vertical-align: top; }
  table.meta td.label { background: #f3f3f3; font-weight: 600; width: 25%; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; }
  table.lines th, table.lines td { border: 1px solid #999; padding: 5px 6px; text-align: left; }
  table.lines th { background: #f3f3f3; font-weight: 600; }
  table.lines td.right { text-align: right; }
  table.totals { width: 60%; margin-top: 14px; margin-left: auto; border-collapse: collapse; }
  table.totals td { padding: 6px 8px; border: 1px solid #999; }
  table.totals td.label { background: #f9f9f9; font-weight: 600; text-align: right; width: 60%; }
  table.totals td.value { text-align: right; font-variant-numeric: tabular-nums; }
  .grand { background: #e9d9b3 !important; font-size: 13px; }
  .small { font-size: 10px; color: #666; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #111; }
  .header .right { text-align: right; }
  .ettn { font-family: 'Courier New', monospace; font-size: 10px; word-break: break-all; }
  .badge { display: inline-block; padding: 2px 8px; border: 1px solid #111; border-radius: 3px; font-size: 10px; letter-spacing: 0.6px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 10mm 14mm; }
  }
</style>
${printScript}
</head>
<body>
${body}
</body>
</html>`;
  }

  private renderInvoiceBody(f: RenderableFatura, _pageBreak: boolean): string {
    const lines = this.extractLines(f.xmlContent || '');
    const tarih = this.fmtDate(f.faturaTarihi);
    const para = (f.paraBirimi || 'TRY').toUpperCase();
    const fmt = (v: any) => this.fmtMoney(v, para);
    const escape = (s?: string | null) => this.esc(s);

    const linesHtml = lines.length > 0
      ? `<table class="lines">
          <thead>
            <tr>
              <th style="width:38px">Sıra</th>
              <th>Mal/Hizmet</th>
              <th style="width:60px" class="right">Miktar</th>
              <th style="width:50px">Birim</th>
              <th style="width:90px" class="right">Birim Fiyat</th>
              <th style="width:60px" class="right">KDV %</th>
              <th style="width:90px" class="right">KDV Tutarı</th>
              <th style="width:100px" class="right">Tutar</th>
            </tr>
          </thead>
          <tbody>
            ${lines.map((l) => `
              <tr>
                <td>${l.sira}</td>
                <td>${escape(l.aciklama)}</td>
                <td class="right">${escape(l.miktar) || '-'}</td>
                <td>${escape(l.birim) || ''}</td>
                <td class="right">${l.birimFiyat ? fmt(l.birimFiyat) : '-'}</td>
                <td class="right">${l.kdvOrani ? `%${escape(l.kdvOrani)}` : '-'}</td>
                <td class="right">${l.kdvTutari ? fmt(l.kdvTutari) : '-'}</td>
                <td class="right">${l.tutar ? fmt(l.tutar) : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      : `<div class="small" style="margin: 10px 0; padding: 8px; background: #fafafa; border: 1px dashed #ccc;">
          Kalem detayı XML'den okunamadı — yalnızca özet tutarlar görüntüleniyor.
        </div>`;

    return `<section class="page">
      <div class="header">
        <div>
          <h1 class="title">${escape(f.satici) || 'Satıcı'}</h1>
          <div class="subtitle">VKN/TCKN: ${escape(f.saticiVergiNo) || '-'}</div>
        </div>
        <div class="right">
          <div class="badge">e-ARŞİV FATURA</div>
          <div class="subtitle" style="margin-top:6px">${tarih}</div>
        </div>
      </div>

      <table class="meta">
        <tr>
          <td class="label">Fatura No</td><td>${escape(f.faturaNo)}</td>
          <td class="label">Tarih</td><td>${tarih}</td>
        </tr>
        <tr>
          <td class="label">Alıcı</td><td colspan="3">${escape(f.alici) || '-'}</td>
        </tr>
        <tr>
          <td class="label">Alıcı VKN/TCKN</td><td>${escape(f.aliciVergiNo) || '-'}</td>
          <td class="label">Para Birimi</td><td>${para}</td>
        </tr>
        ${f.ettn ? `<tr><td class="label">ETTN</td><td colspan="3" class="ettn">${escape(f.ettn)}</td></tr>` : ''}
      </table>

      ${linesHtml}

      <table class="totals">
        <tr>
          <td class="label">Mal/Hizmet Toplam Tutarı</td>
          <td class="value">${fmt(f.matrah)}</td>
        </tr>
        <tr>
          <td class="label">Hesaplanan KDV${f.kdvOrani ? ` (%${escape(String(f.kdvOrani))})` : ''}</td>
          <td class="value">${fmt(f.kdvTutari)}</td>
        </tr>
        <tr class="grand">
          <td class="label">Vergiler Dahil Toplam</td>
          <td class="value">${fmt(f.toplamTutar)}</td>
        </tr>
      </table>
    </section>`;
  }

  private extractLines(xml: string): ParsedLine[] {
    if (!xml) return [];
    try {
      const j = this.parser.parse(xml);
      const root = j['Invoice'] || j['CreditNote'] || j['ApplicationResponse'];
      if (!root) return [];
      const linesNode = root['InvoiceLine'] || root['CreditNoteLine'] || root['Line'];
      if (!linesNode) return [];
      const arr: any[] = Array.isArray(linesNode) ? linesNode : [linesNode];
      return arr.map((ln, idx): ParsedLine => {
        const tax = this.firstObj(ln['TaxTotal']);
        const taxSubtotal = this.firstObj(tax?.['TaxSubtotal']);
        const taxCat = taxSubtotal?.['TaxCategory'];
        const item = ln['Item'];
        const price = ln['Price'];
        const invQty = ln['InvoicedQuantity'] || ln['CreditedQuantity'];
        return {
          sira: idx + 1,
          aciklama: this.text(item?.['Name']) || this.text(item?.['Description']) || '',
          miktar: this.text(invQty),
          birim: this.attr(invQty, '@unitCode') || '',
          birimFiyat: this.text(price?.['PriceAmount']),
          tutar: this.text(ln['LineExtensionAmount']),
          kdvOrani: this.text(taxCat?.['Percent']) || this.text(taxSubtotal?.['Percent']),
          kdvTutari: this.text(taxSubtotal?.['TaxAmount']),
        };
      });
    } catch {
      return [];
    }
  }

  private firstObj(v: any): any {
    if (!v) return undefined;
    return Array.isArray(v) ? v[0] : v;
  }
  private text(v: any): string | undefined {
    if (v == null) return undefined;
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      if (typeof v['#text'] === 'string' || typeof v['#text'] === 'number') return String(v['#text']);
      if (typeof v._ === 'string') return v._;
    }
    return undefined;
  }
  private attr(v: any, key: string): string | undefined {
    if (!v || typeof v !== 'object') return undefined;
    return v[key] != null ? String(v[key]) : undefined;
  }
  private esc(s?: string | null): string {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  private fmtDate(d: Date | string): string {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  private fmtMoney(v: any, currency = 'TRY'): string {
    const n = parseFloat(String(v ?? 0));
    if (!isFinite(n)) return '-';
    const formatted = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    return currency === 'TRY' ? `${formatted} ₺` : `${formatted} ${currency}`;
  }
}
