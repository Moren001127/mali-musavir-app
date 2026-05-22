import { api } from '@/lib/api';

type MoneyBucket = {
  base: number;
  vat: number;
  total: number;
  count: number;
};

type CounterpartyRow = MoneyBucket & {
  name: string;
  taxNo?: string | null;
};

type ControlSummary = {
  id: string;
  type: string;
  label: string;
  periodLabel: string;
  status: string;
  matched: number;
  partialMatch: number;
  unmatched: number;
  needsReview: number;
  rejected: number;
  totalRecords: number;
  totalImages: number;
  issueTotal: number;
  serialWarnings?: Array<{ message?: string; mesaj?: string } | string>;
};

export type KdvClientReport = {
  taxpayer: {
    id: string;
    name: string;
    taxNumber?: string | null;
    ledgerType?: string | null;
  };
  period: string;
  periodLabel: string;
  generatedAt: string;
  totals: {
    salesBase: number;
    salesVat: number;
    salesTotal: number;
    purchaseBase: number;
    purchaseVat: number;
    purchaseTotal: number;
    purchaseGoodsBase: number;
    purchaseGoodsVat: number;
    purchaseGoodsTotal: number;
    expensesBase: number;
    expensesVat: number;
    expensesTotal: number;
    unclassifiedPurchaseBase: number;
    unclassifiedPurchaseVat: number;
    unclassifiedPurchaseTotal: number;
    deductibleVat: number;
    calculatedVat: number;
    periodVatDifference: number;
    payableVat: number | null;
    carryForwardVat: number | null;
  };
  categoryRows: Array<MoneyBucket & {
    key: string;
    label: string;
    side: 'ALIS' | 'SATIS' | string;
    accountPrefixes: string[];
  }>;
  vatByRate: Array<MoneyBucket & {
    side: 'ALIS' | 'SATIS' | string;
    rate: number | null;
    label: string;
  }>;
  topSuppliers: CounterpartyRow[];
  topCustomers: CounterpartyRow[];
  quality: {
    invoiceCount: number;
    accountingDocCount: number;
    missingAccountCodeCount: number;
    unclassifiedCount: number;
    pendingReviewCount: number;
    validationIssueCount: number;
    sourceCounts?: {
      efatura?: number;
      earsiv?: number;
      purchase?: number;
      sales?: number;
    };
    statusCounts?: Record<string, number>;
  };
  controls: {
    purchase?: ControlSummary | null;
    sales?: ControlSummary | null;
    warnings: string[];
  };
  warnings: string[];
  assessment: string[];
};

export function fetchKdvClientReport(params: { taxpayerId: string; period: string }) {
  return api
    .get('/fatura-muhasebelestirme/kdv-client-report', { params })
    .then((r) => r.data as KdvClientReport);
}

export function buildKdvClientReportHtml(report: KdvClientReport, logoUrl?: string) {
  const totals = report.totals;
  const differenceTone = totals.periodVatDifference > 0 ? 'warn' : totals.periodVatDifference < 0 ? 'good' : 'neutral';
  const differenceLabel = totals.periodVatDifference > 0
    ? 'Ödeme yönü'
    : totals.periodVatDifference < 0
      ? 'Devreden yönü'
      : 'Dengede';
  const generatedAt = formatReportDate(report.generatedAt);
  const warningRows = [...new Set([...(report.warnings || []), ...(report.controls?.warnings || [])])].slice(0, 6);

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title></title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin:0; background:#f3efe7; color:#1c1917; font-family:Inter, Arial, sans-serif; font-size:10.5px; }
    .page { width:210mm; min-height:297mm; margin:28px auto; background:#fff; border:1px solid #e7dac0; box-shadow:0 18px 48px rgba(45,35,18,.15); padding:15mm 12mm 11mm; position:relative; overflow:hidden; }
    .page:before { content:""; position:absolute; inset:0 0 auto 0; height:7px; background:linear-gradient(90deg,#1f1a12,#d4b876,#1f1a12); }
    .letterhead { display:flex; align-items:center; justify-content:space-between; gap:18px; border-bottom:2px solid #d4b876; padding-bottom:11px; }
    .office-logo { width:126px; height:auto; display:block; }
    .logo-fallback { color:#8a6f35; font-weight:900; font-size:17px; letter-spacing:.08em; }
    .report-label { text-align:right; color:#8a6f35; font-weight:900; letter-spacing:.12em; text-transform:uppercase; font-size:10px; }
    .report-sub { margin-top:5px; color:#6b6258; font-size:9px; font-weight:700; }
    .subject { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin:17px 0 11px; }
    h1 { margin:0; font-size:24px; line-height:1.08; color:#17130d; letter-spacing:0; }
    h2 { margin:0 0 7px; font-size:10px; color:#7b5d24; text-transform:uppercase; letter-spacing:.12em; }
    .meta { color:#6b6258; font-weight:700; line-height:1.45; }
    .highlights { display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; margin:10px 0 11px; }
    .highlight { border:1px solid #e6d5ad; border-radius:8px; padding:9px 9px; background:#fffaf0; min-height:53px; }
    .highlight span { display:block; color:#7b6f62; font-size:8.4px; text-transform:uppercase; letter-spacing:.08em; font-weight:900; margin-bottom:5px; }
    .highlight strong { display:block; color:#17130d; font-size:15px; line-height:1.05; font-weight:900; font-variant-numeric:tabular-nums; }
    .highlight.good strong { color:#087f5b; }
    .highlight.warn strong { color:#9a5b00; }
    .highlight.bad strong { color:#b91c1c; }
    .grid-two { display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:start; }
    .section { margin-top:10px; break-inside:avoid; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; border:1px solid #d7c8a8; border-radius:8px; overflow:hidden; }
    th { background:#251f14; color:#fff8e6; font-size:8.2px; text-transform:uppercase; letter-spacing:.07em; padding:6px 7px; text-align:right; border-bottom:1px solid #b99b58; }
    th:first-child { text-align:left; }
    td { border-bottom:1px solid #ded4c2; border-left:1px solid #e7dece; padding:5px 7px; text-align:right; font-size:9.7px; font-weight:760; font-variant-numeric:tabular-nums; vertical-align:top; }
    td:first-child { border-left:0; text-align:left; color:#3f3a33; font-weight:800; overflow-wrap:anywhere; }
    tbody tr:nth-child(even) td { background:#fcfaf5; }
    .muted { color:#7c746b; font-weight:650; }
    .pill-list { display:grid; grid-template-columns:repeat(3, 1fr); gap:7px; }
    .pill { border:1px solid #eadbb8; border-radius:8px; background:#fffdf7; padding:7px 8px; min-height:42px; }
    .pill span { display:block; color:#7c746b; font-size:8px; text-transform:uppercase; letter-spacing:.07em; font-weight:900; margin-bottom:4px; }
    .pill strong { display:block; color:#17130d; font-size:13px; font-weight:900; font-variant-numeric:tabular-nums; }
    .assessment { border:1px solid #d7bd75; border-radius:9px; padding:9px 10px; background:#fffaf0; }
    .assessment ul, .warnings ul { margin:0; padding:0; list-style:none; display:grid; grid-template-columns:1fr 1fr; gap:6px 8px; }
    .assessment li, .warnings li { border:1px solid #eadbb8; border-radius:8px; background:#fffdf7; padding:6px 7px; line-height:1.24; font-weight:650; color:#3f3a33; }
    .warnings li { border-color:#f4d58a; background:#fff8e4; color:#5f4721; }
    .signoff { display:flex; justify-content:flex-end; margin-top:13mm; break-inside:avoid; }
    .signoff-inner { min-width:66mm; text-align:center; padding-top:6px; border-top:1px solid #d7bd75; }
    .signoff-name { font-family:"Segoe Script","Brush Script MT","Lucida Handwriting",cursive; font-size:24px; line-height:1; font-weight:650; color:#202020; transform:rotate(-1deg); }
    .signoff-title { margin-top:3px; font-family:Georgia,"Times New Roman",serif; font-size:11px; line-height:1.1; font-style:italic; color:#7b5d24; }
    @media print {
      html, body { width:210mm; min-height:297mm; }
      body { background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .page { width:210mm; min-height:297mm; margin:0; border:0; box-shadow:none; padding:9mm 9mm 8mm; }
      .page:before { display:none; }
      .office-logo { width:114px; }
      h1 { font-size:22px; }
      .highlights { gap:6px; }
      .highlight { padding:7px; min-height:47px; }
      .highlight strong { font-size:13.5px; }
      .section { margin-top:8px; }
      th { padding:5px 6px; font-size:7.7px; }
      td { padding:4px 6px; font-size:8.9px; line-height:1.16; }
      .pill { padding:5px 6px; min-height:36px; }
      .assessment li, .warnings li { padding:5px 6px; font-size:8.9px; }
      .signoff { margin-top:9mm; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="letterhead">
      <div>
        ${logoUrl ? `<img class="office-logo" src="${escapeReportHtml(logoUrl)}" alt="Moren Mali Müşavirlik" onerror="this.style.display='none';this.nextElementSibling.style.display='block';" />` : ''}
        <span class="logo-fallback" style="${logoUrl ? 'display:none' : 'display:block'}">MOREN MALİ MÜŞAVİRLİK</span>
      </div>
      <div>
        <div class="report-label">KDV Mükellef Çıktısı</div>
        <div class="report-sub">${escapeReportHtml(generatedAt)}</div>
      </div>
    </section>

    <section class="subject">
      <div>
        <h1>${escapeReportHtml(report.taxpayer.name || 'Mükellef')}</h1>
        <div class="meta">${report.taxpayer.taxNumber ? `Vergi No: ${escapeReportHtml(report.taxpayer.taxNumber)} · ` : ''}${escapeReportHtml(report.periodLabel)} KDV Durumu</div>
      </div>
      <div class="meta">Fatura kayıtlarına göre hazırlanmıştır.</div>
    </section>

    <section class="highlights">
      ${highlight('Hesaplanan KDV', `${fmtTRY(totals.calculatedVat)} TL`, 'neutral')}
      ${highlight('İndirilecek KDV', `${fmtTRY(totals.deductibleVat)} TL`, 'neutral')}
      ${highlight(differenceLabel, `${fmtTRY(Math.abs(totals.periodVatDifference))} TL`, differenceTone)}
      ${highlight('Fatura Adedi', String(report.quality.invoiceCount || 0), 'neutral')}
    </section>

    <section class="section">
      <h2>Alış, Masraf ve Satış Özeti</h2>
      <table>
        <thead><tr><th>Kalem</th><th>Matrah</th><th>KDV</th><th>Toplam</th><th>Adet</th></tr></thead>
        <tbody>
          ${report.categoryRows.map((row) => `<tr><td>${escapeReportHtml(row.label)}</td><td>${fmtTRY(row.base)}</td><td>${fmtTRY(row.vat)}</td><td>${fmtTRY(row.total)}</td><td>${row.count}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>

    <section class="section grid-two">
      <div>
        <h2>KDV Oran Kırılımı</h2>
        <table>
          <thead><tr><th>Yön / Oran</th><th>Matrah</th><th>KDV</th><th>Adet</th></tr></thead>
          <tbody>
            ${emptyRows(report.vatByRate, 4, 'KDV oran kırılımı yok.')}
            ${report.vatByRate.map((row) => `<tr><td>${sideLabel(row.side)} ${escapeReportHtml(row.label)}</td><td>${fmtTRY(row.base)}</td><td>${fmtTRY(row.vat)}</td><td>${row.count}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div>
        <h2>Belge Kalitesi</h2>
        <div class="pill-list">
          ${pill('E-Fatura', String(report.quality.sourceCounts?.efatura || 0))}
          ${pill('E-Arşiv', String(report.quality.sourceCounts?.earsiv || 0))}
          ${pill('Muhasebe Belgesi', String(report.quality.accountingDocCount || 0))}
          ${pill('İnceleme Bekleyen', String(report.quality.pendingReviewCount || 0))}
          ${pill('Kod Eksiği', String(report.quality.missingAccountCodeCount || 0))}
          ${pill('Sınıflandırma', String(report.quality.unclassifiedCount || 0))}
        </div>
      </div>
    </section>

    <section class="section grid-two">
      ${counterpartyTable('En Yüksek Alış Yapılan Firmalar', report.topSuppliers, 'Satıcı bulunamadı.')}
      ${counterpartyTable('En Yüksek Satış Yapılan Firmalar', report.topCustomers, 'Alıcı bulunamadı.')}
    </section>

    <section class="section">
      <h2>KDV Kontrol Özeti</h2>
      <table>
        <thead><tr><th>Kontrol</th><th>Tam</th><th>İnceleme</th><th>Hatalı</th><th>Kayıt</th></tr></thead>
        <tbody>
          ${controlRows([report.controls?.purchase, report.controls?.sales])}
        </tbody>
      </table>
    </section>

    ${warningRows.length ? `<section class="section warnings"><h2>Dikkat Noktaları</h2><ul>${warningRows.map((line) => `<li>${escapeReportHtml(line)}</li>`).join('')}</ul></section>` : ''}

    <section class="section assessment">
      <h2>Değerlendirme ve Mükellef Notu</h2>
      <ul>${(report.assessment || []).map((line) => `<li>${formatAssessmentLine(line)}</li>`).join('')}</ul>
    </section>

    <section class="signoff" aria-label="Meslek mensubu">
      <div class="signoff-inner">
        <div class="signoff-name">Muzaffer Ören</div>
        <div class="signoff-title">Serbest Muhasebeci Mali Müşavir</div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function highlight(label: string, value: string, tone: 'good' | 'neutral' | 'warn' | 'bad') {
  return `<div class="highlight ${tone}"><span>${escapeReportHtml(label)}</span><strong>${escapeReportHtml(value)}</strong></div>`;
}

function pill(label: string, value: string) {
  return `<div class="pill"><span>${escapeReportHtml(label)}</span><strong>${escapeReportHtml(value)}</strong></div>`;
}

function counterpartyTable(title: string, rows: CounterpartyRow[], emptyText: string) {
  return `<div>
    <h2>${escapeReportHtml(title)}</h2>
    <table>
      <thead><tr><th>Firma</th><th>Matrah</th><th>KDV</th><th>Toplam</th></tr></thead>
      <tbody>
        ${emptyRows(rows, 4, emptyText)}
        ${rows.map((row) => `<tr><td>${escapeReportHtml(row.name)}${row.taxNo ? `<div class="muted">${escapeReportHtml(row.taxNo)}</div>` : ''}</td><td>${fmtTRY(row.base)}</td><td>${fmtTRY(row.vat)}</td><td>${fmtTRY(row.total)}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function controlRows(rows: Array<ControlSummary | null | undefined>) {
  const present = rows.filter(Boolean) as ControlSummary[];
  if (!present.length) return '<tr><td colspan="5">KDV kontrol oturumu bulunamadı.</td></tr>';
  return present.map((row) => {
    const review = (row.partialMatch || 0) + (row.needsReview || 0);
    const faulty = (row.unmatched || 0) + (row.rejected || 0);
    return `<tr><td>${escapeReportHtml(row.label)}<div class="muted">${escapeReportHtml(row.periodLabel || '')}</div></td><td>${row.matched || 0}</td><td>${review}</td><td>${faulty}</td><td>${row.totalRecords || row.totalImages || 0}</td></tr>`;
  }).join('');
}

function emptyRows(rows: unknown[] | undefined, colspan: number, text: string) {
  return rows && rows.length ? '' : `<tr><td colspan="${colspan}">${escapeReportHtml(text)}</td></tr>`;
}

function sideLabel(side: string) {
  return side === 'SATIS' ? 'Satış' : 'Alış';
}

function formatAssessmentLine(line: string) {
  const idx = line.indexOf(':');
  if (idx <= 0) return escapeReportHtml(line);
  return `<strong>${escapeReportHtml(line.slice(0, idx))}:</strong> ${escapeReportHtml(line.slice(idx + 1).trim())}`;
}

function formatReportDate(value: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString('tr-TR');
  return date.toLocaleDateString('tr-TR');
}

function fmtTRY(value: number | string | null | undefined) {
  const n = typeof value === 'string' ? Number(value) : Number(value || 0);
  if (!Number.isFinite(n)) return '0,00';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeReportHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
