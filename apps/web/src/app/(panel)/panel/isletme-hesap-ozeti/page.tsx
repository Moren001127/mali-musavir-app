'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LucaInlineCaptchaPanel } from '@/components/luca/LucaInlineCaptchaPanel';
import { MaliYorumKutusu } from '@/components/MaliYorumKutusu';
import {
  isletmeHesapOzetiApi,
  fmtTRY,
  type IhoYil,
  type IsletmeHesapOzeti,
  type IhoManuelPayload,
} from '@/lib/isletme-hesap-ozeti';
import { toast } from 'sonner';
import {
  Search, ChevronDown, Users, Loader2, Sparkles, Download,
  Lock, Unlock, BookOpen, Save, Trash2,
  TrendingUp, Package, Calculator, CloudDownload, KeyRound, Printer,
} from 'lucide-react';

/* ─── İHO Görsel Teması — Brifing Kartı estetiğine yakın
 * Sayılar: Fraunces serif lider font, büyük tabular-nums
 * Oranlar: alttan altın rozet, daha okunaklı
 * Section: altın gradient hairline başlık
 * Pozitif/negatif vurgular netleştirildi
 * ─────────────────────────────────────────────────────── */
const GOLD = '#d4b876';
const GOLD_DARK = '#b8a06f';
// Daha açık tablo zemini — okunaklılık için
const TABLE_SURFACE = '#181613';
const TABLE_SURFACE_ALT = '#1d1a16';
const TABLE_HEADER_BG = '#221d16';
const TABLE_SECTION_BG = '#1d1a16';
// Çizgiler Gelir Tablosu ile aynı netlikte (kullanıcı: gelir tablosundaki gibi olsun)
const GRID_LINE = 'rgba(245,240,230,0.24)';
const GRID_LINE_STRONG = 'rgba(212,184,118,0.50)';
const REPORT_TEXT = 'rgba(250,250,249,0.95)';
const REPORT_MUTED = 'rgba(231,229,228,0.78)';
const REPORT_DIM = 'rgba(214,211,209,0.45)';
const AMOUNT_TEXT = '#f3eee6';
const AMOUNT_ACCENT = '#ead18a';
const PROFIT_TEXT = '#86efac';
const LOSS_TEXT = '#f87171';
const RATIO_TEXT = GOLD;
const RATIO_LOSS = '#fca5a5';
const MANUAL_TEXT = '#ead18a';
const MANUAL_BORDER = 'rgba(212,184,118,0.55)';
// Tek satır rengi — alacalı görünüm yok, sade
const MANUAL_ROW_BG = 'transparent';
const TOTAL_ROW_BG = 'rgba(212,184,118,0.04)';
// Rakamlar için: temiz sans-serif tabular — rapor ekranlarıyla aynı okunur çizgi
const NUM_FONT = "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SERIF_FONT = "'Fraunces', 'Georgia', serif"; // sadece section başlıkları için
const REPORT_TABLE_STYLE: React.CSSProperties = {
  tableLayout: 'fixed',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontVariantNumeric: 'tabular-nums',
};

type Taxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
};

function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

const DONEM_ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
const DONEM_FULL: Record<number, string> = {
  1: '1. Dönem (Oca-Mar)',
  2: '2. Dönem (Nis-Haz)',
  3: '3. Dönem (Tem-Eyl)',
  4: '4. Dönem (Eki-Ara)',
};

type ManuelField =
  | 'satisHasilati'
  | 'digerGelir'
  | 'malAlisi'
  | 'donemBasiStok'
  | 'kalanStok'
  | 'satilanMalMaliyeti'
  | 'donemIciGiderler'
  | 'gecmisYilZarari'
  | 'oncekiOdenenGecVergi';

const MANUEL_FIELDS: ManuelField[] = [
  'satisHasilati',
  'digerGelir',
  'malAlisi',
  'donemBasiStok',
  'kalanStok',
  'satilanMalMaliyeti',
  'donemIciGiderler',
  'gecmisYilZarari',
  'oncekiOdenenGecVergi',
];

/* ─── TR-locale number formatting ─── */
function formatTR(n: number): string {
  if (!isFinite(n)) return '0,00';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseTR(s: string): number {
  if (!s) return 0;
  // TR: "1.234.567,89" → 1234567.89
  const cleaned = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

type IhoClientReportRow = {
  label: string;
  values: number[];
  kind?: 'profit' | 'manual' | 'tax' | 'neutral';
};

type IhoClientReportRatio = {
  label: string;
  value: string;
  tone: 'good' | 'neutral' | 'warn' | 'bad';
};

type IhoClientReportHighlight = {
  label: string;
  value: string;
  tone: 'good' | 'neutral' | 'warn' | 'bad';
};

function escapeHtml(v: string | number | null | undefined): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildIhoClientReportHtml({
  taxpayerName,
  taxNumber,
  year,
  periodLabels,
  logoUrl,
  rows,
  ratios,
  highlights,
  assessment,
  generatedAt,
}: {
  taxpayerName: string;
  taxNumber?: string;
  year: number;
  periodLabels: string[];
  logoUrl?: string;
  rows: IhoClientReportRow[];
  ratios: IhoClientReportRatio[];
  highlights: IhoClientReportHighlight[];
  assessment: string[];
  generatedAt: string;
}) {
  const toneStyles: Record<IhoClientReportRatio['tone'], string> = {
    good: 'color:#087f5b;border-color:#a7f3d0;background:#ecfdf5;',
    neutral: 'color:#525252;border-color:#e5e5e5;background:#fafafa;',
    warn: 'color:#9a5b00;border-color:#fde68a;background:#fffbeb;',
    bad: 'color:#b91c1c;border-color:#fecaca;background:#fef2f2;',
  };
  const rowClass = (kind?: IhoClientReportRow['kind']) =>
    kind === 'profit' ? 'report-profit' : kind === 'manual' ? 'report-manual' : kind === 'tax' ? 'report-tax' : '';
  const escapedLogoUrl = logoUrl ? escapeHtml(logoUrl) : '';
  const ratioColumns = Math.min(Math.max(ratios.length, 1), 4);
  const subjectGap = rows.length >= 16 ? '28px' : rows.length >= 13 ? '36px' : '44px';
  const signoffGap = rows.length >= 16 ? '10mm' : rows.length >= 13 ? '16mm' : '20mm';
  const highlightClass = (tone: IhoClientReportHighlight['tone']) =>
    tone === 'good' ? 'highlight-good' : tone === 'bad' ? 'highlight-bad' : tone === 'warn' ? 'highlight-warn' : 'highlight-neutral';

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title></title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1c1917; background: #f2eee5; font-family: Inter, Arial, sans-serif; font-size: 10.5px; }
    .page { width: 210mm; min-height:277mm; margin: 32px auto; background:#fff; padding: 18mm 13mm 12mm; border:1px solid #e8dcc1; box-shadow:0 18px 48px rgba(45,35,18,.16); position:relative; overflow:hidden; display:flex; flex-direction:column; }
    .page:before { content:""; position:absolute; inset:0 0 auto 0; height:8px; background:linear-gradient(90deg,#1f1a12,#d4b876,#1f1a12); }
    .letterhead { display:flex; align-items:center; justify-content:space-between; gap: 18px; border-bottom: 2px solid #d4b876; padding: 0 0 12px; }
    .office-logo { width:128px; height:auto; display:block; }
    .logo-fallback { color:#8a6f35; font-weight:900; font-size:18px; letter-spacing:.08em; }
    .report-label { text-align:right; color:#8a6f35; font-weight:900; letter-spacing:.12em; text-transform:uppercase; font-size:10px; padding-top:4px; }
    .report-sub { margin-top:5px; color:#6b6258; font-size:9px; font-weight:700; letter-spacing:.04em; }
    .subject { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; margin:20px 0 12px; }
    h1 { margin: 0; font-size: 25px; line-height: 1.08; letter-spacing: 0; color:#17130d; }
    .meta { color:#6b6258; font-weight: 700; line-height: 1.5; }
    .highlights { list-style:none; margin:12px 0; padding:10px 12px; display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px 18px; border:1px solid #d7bd75; border-radius:10px; background:#fff9ea; }
    .highlights li { position:relative; padding-left:14px; color:#2a2114; font-size:12px; line-height:1.2; }
    .highlights li:before { content:""; position:absolute; left:0; top:.42em; width:6px; height:6px; border-radius:999px; background:#b88a2f; }
    .highlights strong { font-weight:900; color:#5f4721; }
    .highlights b { font-size:16px; line-height:1; font-weight:900; font-variant-numeric:tabular-nums; color:#1f1a12; margin-left:4px; }
    .highlights .highlight-good b { color:#087f5b; }
    .highlights .highlight-bad b { color:#b91c1c; }
    .highlights .highlight-warn b { color:#9a5b00; }
    .ratios { display:grid; grid-template-columns: repeat(${ratioColumns}, 1fr); gap: 8px; margin: 12px 0 13px; }
    .ratio { border:1px solid #e5e5e5; border-radius: 9px; padding: 9px 10px; min-height: 52px; box-shadow:inset 0 1px 0 rgba(255,255,255,.8); }
    .ratio span { display:block; color:#78716c; font-size:8.5px; text-transform:uppercase; letter-spacing:.08em; font-weight:900; margin-bottom:5px; }
    .ratio strong { font-size:18px; line-height:1; letter-spacing:0; font-variant-numeric: tabular-nums; }
    table { width:100%; border-collapse: collapse; table-layout: fixed; margin-top: 8px; border:1px solid #d7c8a8; border-radius:9px; overflow:hidden; }
    th { background:#251f14; color:#fff8e6; font-size:9px; text-transform:uppercase; letter-spacing:.08em; padding:8px 9px; text-align:right; border-bottom:1px solid #b99b58; }
    th:first-child { text-align:left; width: 35%; }
    th + th { border-left:1px solid rgba(255,248,230,.24); }
    td { border-bottom:1px solid #d9cfbd; padding:6px 9px; text-align:right; font-size:10.8px; font-weight:760; font-variant-numeric: tabular-nums; }
    td + td { border-left:1px solid #e0d6c2; }
    td:first-child { text-align:left; color:#3f3a33; font-weight:750; }
    tbody tr:nth-child(even) td { background:#fcfaf5; }
    tr.report-profit td { color:#087f5b; }
    tr.report-profit td:first-child { color:#14532d; }
    tr.report-manual td:first-child { color:#8a6f35; }
    tr.report-tax td { color:#5f4d20; }
    .assessment { margin-top: 12px; border: 1px solid #d7bd75; border-radius: 10px; padding: 10px 12px; background:#fffaf0; }
    .assessment h2 { margin:0 0 8px; font-size: 10px; text-transform:uppercase; letter-spacing:.12em; color:#7b5d24; }
    .assessment ul { margin:0; padding:0; list-style:none; display:grid; grid-template-columns:1fr 1fr; gap:7px 10px; }
    .assessment li { line-height:1.32; color:#3f3a33; font-weight:650; padding:8px 9px; border:1px solid #eadbb8; border-radius:8px; background:#fffdf7; }
    .assessment li:last-child:nth-child(odd) { grid-column:1 / -1; }
    .assessment li strong { display:block; margin-bottom:2px; color:#17130d; font-size:9.5px; text-transform:uppercase; letter-spacing:.07em; }
    .assessment li span { display:block; }
    .signoff { display:flex; justify-content:flex-end; margin-top:16px; padding-top:6px; break-inside:avoid; }
    .signoff-inner { min-width:270px; text-align:center; padding-top:8px; border-top:1px solid #d7bd75; }
    .signoff-name { font-family:"Segoe Script","Brush Script MT","Lucida Handwriting",cursive; font-size:26px; line-height:1; font-weight:650; color:#202020; transform:rotate(-1deg); }
    .signoff-title { margin-top:4px; font-family:Georgia,"Times New Roman",serif; font-size:12px; line-height:1.1; font-style:italic; color:#7b5d24; letter-spacing:.01em; }
    @media print {
      html, body { width:210mm; height:297mm; overflow:hidden; }
      body { background:#fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { width:210mm; height:297mm; min-height:0; margin:0; padding:9mm 9mm 7mm; border:0; box-shadow:none; display:block; overflow:hidden; page-break-before:avoid; page-break-after:avoid; break-before:avoid; break-after:avoid; }
      .page:before { display:none; }
      .letterhead { padding-bottom:12px; }
      .office-logo { width:116px; }
      .report-label { font-size:9.5px; }
      .report-sub { font-size:8.5px; }
      .subject { margin:${subjectGap} 0 10px; }
      h1 { font-size:24px; }
      .meta { font-size:9.5px; }
      .highlights { margin:9px 0; padding:8px 10px; }
      .highlights li { font-size:11.4px; }
      .highlights b { font-size:15px; }
      .ratios { margin:9px 0 10px; gap:7px; }
      .ratio { min-height:44px; padding:7.5px 9px; }
      .ratio strong { font-size:16px; }
      table { margin-top:7px; }
      th { padding:6px 7px; font-size:8.5px; }
      td { padding:4.2px 7px; font-size:9.7px; line-height:1.18; }
      .assessment { margin-top:10px; padding:8px 9px; border-radius:8px; }
      .assessment h2 { margin-bottom:6px; font-size:9.2px; }
      .assessment ul { gap:7px 8px; }
      .assessment li { padding:6px 8px; line-height:1.22; font-size:9.5px; }
      .assessment li strong { font-size:8.7px; }
      .signoff { position:static; margin-top:${signoffGap}; padding-top:0; display:flex; justify-content:flex-end; }
      .signoff-inner { min-width:66mm; padding-top:5px; }
      .signoff-name { font-size:23px; }
      .signoff-title { margin-top:2px; font-size:10.5px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="letterhead">
      <div>
        ${escapedLogoUrl ? `<img class="office-logo" src="${escapedLogoUrl}" alt="Moren Mali Müşavirlik" onerror="this.style.display='none';this.nextElementSibling.style.display='block';" />` : ''}
        <span class="logo-fallback" style="${escapedLogoUrl ? 'display:none' : 'display:block'}">MOREN MALİ MÜŞAVİRLİK</span>
      </div>
      <div>
        <div class="report-label">İşletme Hesap Özeti</div>
        <div class="report-sub">${escapeHtml(generatedAt)}</div>
      </div>
    </section>
    <section class="subject">
      <div>
        <h1>${escapeHtml(taxpayerName)}</h1>
        <div class="meta">${taxNumber ? `Vergi No: ${escapeHtml(taxNumber)} · ` : ''}${year} İşletme Hesap Özeti</div>
      </div>
    </section>
    <ul class="highlights">
      ${highlights.map((h) => `<li class="${highlightClass(h.tone)}"><strong>${escapeHtml(h.label)}:</strong><b>${escapeHtml(h.value)}</b></li>`).join('')}
    </ul>
    <section class="ratios">
      ${ratios.map((r) => `<div class="ratio" style="${toneStyles[r.tone]}"><span>${escapeHtml(r.label)}</span><strong>${escapeHtml(r.value)}</strong></div>`).join('')}
    </section>
    <table>
      <thead>
        <tr>
          <th>Kalem</th>
          ${periodLabels.map((p) => `<th>${escapeHtml(p)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `<tr class="${rowClass(r.kind)}"><td>${escapeHtml(r.label)}</td>${r.values.map((v) => `<td>${escapeHtml(formatTR(v))}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
    <section class="assessment">
      <h2>Değerlendirme, Öngörü ve Dikkat Noktaları</h2>
      <ul>${assessment.map((line) => {
        const idx = line.indexOf(':');
        if (idx <= 0) return `<li><span>${escapeHtml(line)}</span></li>`;
        return `<li><strong>${escapeHtml(line.slice(0, idx))}</strong><span>${escapeHtml(line.slice(idx + 1).trim())}</span></li>`;
      }).join('')}</ul>
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

/* ─── Smart number input — TR locale formatting ─── */
function NumInput({
  value,
  onChange,
  disabled,
  placeholder = '0,00',
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState<string>(value ? formatTR(value) : '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value ? formatTR(value) : '');
  }, [value, focused]);

  const inputColor = value ? AMOUNT_TEXT : REPORT_DIM;
  const inputWeight = value ? 650 : 600;

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        // Edit modunda raw göster
        setText(value ? String(value).replace('.', ',') : '');
        e.target.select();
      }}
      onBlur={() => {
        setFocused(false);
        const n = parseTR(text);
        onChange(n);
        setText(formatTR(n));
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="num-input w-full px-2.5 py-1 text-center tabular-nums transition-all focus:outline-none"
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: focused ? `1px solid ${GRID_LINE_STRONG}` : '1px solid transparent',
        color: inputColor,
        fontFamily: NUM_FONT,
        fontSize: 15,
        fontVariantNumeric: 'tabular-nums',
        colorScheme: 'dark',
        fontWeight: inputWeight,
        letterSpacing: 0,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !focused) (e.currentTarget as HTMLInputElement).style.borderBottom = `1px solid ${GRID_LINE}`;
      }}
      onMouseLeave={(e) => {
        if (!disabled && !focused) (e.currentTarget as HTMLInputElement).style.borderBottom = '1px solid transparent';
      }}
    />
  );
}

export default function IsletmeHesapOzetiPage() {
  const qc = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [yil, setYil] = useState<number>(currentYear);
  const [search, setSearch] = useState('');
  const [tpDropdownOpen, setTpDropdownOpen] = useState(false);

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
    staleTime: 10 * 60 * 1000, // 10 dk cache — taxpayer listesi nadiren değişir
  });

  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const { data: yilData, isLoading } = useQuery<IhoYil>({
    queryKey: ['iho-yil', taxpayerId, yil],
    queryFn: () => isletmeHesapOzetiApi.getYil(taxpayerId, yil),
    enabled: !!taxpayerId && !!yil,
    // v1.36.58: Firma değiştirme hızlandırması
    staleTime: 5 * 60 * 1000, // 5 dk: aynı firma+yıl tekrar açılırsa anında gelir
    placeholderData: (prev: any) => prev, // yeni firma yüklenirken eski veri ekranda kalır → blank screen yok
  });

  const olusturYilMutation = useMutation({
    mutationFn: () => isletmeHesapOzetiApi.olusturYil({ taxpayerId, yil }),
    onSuccess: () => {
      toast.success(`${yil} yılı için 4 dönem boş kayıt açıldı`);
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hata'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; payload: IhoManuelPayload }) =>
      isletmeHesapOzetiApi.updateManuel(data.id, data.payload),
    onSuccess: () => {
      toast.success('Kaydedildi');
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hata'),
  });

  const lockMutation = useMutation({
    mutationFn: (id: string) => isletmeHesapOzetiApi.lock(id),
    onSuccess: () => {
      toast.success('Kesin kayda alındı');
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
  });
  const unlockMutation = useMutation({
    mutationFn: (data: { id: string; reason: string }) =>
      isletmeHesapOzetiApi.unlock(data.id, data.reason),
    onSuccess: () => {
      toast.success('Kilit açıldı');
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => isletmeHesapOzetiApi.remove(id),
    onSuccess: () => {
      toast.success('Silindi');
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
  });

  // Luca çekim — her dönem için ayrı job state
  const [lucaJobs, setLucaJobs] = useState<Record<number, { jobId: string; status: string; message?: string } | null>>({});

  const lucaCekMutation = useMutation({
    mutationFn: (id: string) => isletmeHesapOzetiApi.lucaCek(id),
    onSuccess: (data, _id) => {
      const donem = data.donem;
      setLucaJobs((prev) => ({ ...prev, [donem]: { jobId: data.jobId, status: 'pending', message: data.message } }));
      toast.info(data.message);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Luca çekim başlatılamadı'),
  });

  const cancelLucaJobsMut = useMutation({
    mutationFn: async () => {
      const jobs = Object.values(lucaJobs).filter(Boolean) as Array<{ jobId: string }>;
      await Promise.allSettled(jobs.map((job) => isletmeHesapOzetiApi.cancelLucaJob(job.jobId)));
    },
    onSuccess: () => {
      toast.info('Luca çekimi iptal edildi');
      setLucaJobs({});
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Luca işlemi iptal edilemedi'),
  });

  // Job polling — her açık job'u 4 saniyede bir sorgula
  useEffect(() => {
    const activeJobs = Object.entries(lucaJobs).filter(([, j]) => j && (j.status === 'pending' || j.status === 'running'));
    if (activeJobs.length === 0) return;

    const interval = setInterval(async () => {
      for (const [donemStr, j] of activeJobs) {
        if (!j) continue;
        try {
          const updated = await isletmeHesapOzetiApi.getLucaJob(j.jobId);
          if (updated.status !== j.status) {
            setLucaJobs((prev) => ({
              ...prev,
              [Number(donemStr)]: { ...j, status: updated.status, message: updated.errorMsg || undefined },
            }));
            if (updated.status === 'done') {
              toast.success(`${donemStr}. dönem Luca'dan çekildi`);
              qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
              // Job'u listeden 5sn sonra temizle
              setTimeout(() => setLucaJobs((p) => ({ ...p, [Number(donemStr)]: null })), 5000);
            } else if (updated.status === 'failed') {
              toast.error(`${donemStr}. dönem çekim başarısız: ${updated.errorMsg || ''}`);
              setTimeout(() => setLucaJobs((p) => ({ ...p, [Number(donemStr)]: null })), 8000);
            }
          }
        } catch {
          // ignore polling errors
        }
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [lucaJobs, qc, taxpayerId, yil]);


  async function indirExcel() {
    if (!taxpayerId) return;
    try {
      const buf = await isletmeHesapOzetiApi.exportYil(taxpayerId, yil);
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `isletme-hesap-ozeti-${yil}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Excel indirilemedi');
    }
  }

  const filteredTp = taxpayers.filter((t) =>
    !search ? true : taxpayerName(t).toLowerCase().includes(search.toLowerCase()) ||
      (t.taxNumber || '').includes(search),
  );

  const tersDonemler = [4, 3, 2, 1];
  const hicKayitYok = !!yilData && yilData.ceyrekler.every((c) => !c);
  const activeLucaJobIds = Object.values(lucaJobs).filter(Boolean).map((job: any) => job.jobId);

  return (
    <div className="financial-report-readable space-y-4">
      {/* Header — Fiş Yazdırma imzası: kart + üst renk şeridi + radial parıltı + degrade ikon kutusu */}
      <div
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: 'rgba(255,255,255,0.06)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' }}
        />
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <Sparkles size={10} className="inline mr-1" /> Mali Rapor
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-3.5">
            <span
              className="grid place-items-center rounded-xl flex-shrink-0"
              style={{ width: 46, height: 46, background: 'linear-gradient(135deg, #d4b876, #b8a06f)', boxShadow: '0 8px 22px rgba(212,184,118,0.32)' }}
            >
              <BookOpen size={24} style={{ color: '#1a1410' }} />
            </span>
            <div className="min-w-0">
              <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.05 }}>
                İşletme Hesap Özeti
              </h1>
              <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                Luca'dan otomatik çekim · sadece Satılan Malın Maliyeti ve Geçmiş Yıl Zararı manuel girilir
              </p>
            </div>
          </div>
          {taxpayerId && !hicKayitYok && (
            <button
              onClick={indirExcel}
              className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm text-stone-100 hover:bg-white/10 ml-auto flex-shrink-0"
            >
              <Download className="h-4 w-4" /> Excel
            </button>
          )}
        </div>
      </div>

      <LucaInlineCaptchaPanel
        jobIds={activeLucaJobIds}
        color={GOLD}
        onCancel={() => cancelLucaJobsMut.mutate()}
      />

      {/* CANLI JOB DURUMU — her aktif job için son log satırı + spinner */}
      {Object.entries(lucaJobs).filter(([, j]) => j).length > 0 && (
        <div
          className="rounded-xl border p-3 text-sm space-y-2"
          style={{
            background: 'rgba(212,184,118,0.04)',
            borderColor: 'rgba(212,184,118,0.18)',
          }}
        >
          <div className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: GOLD }}>
            Luca İşlem Durumu
          </div>
          {Object.entries(lucaJobs)
            .filter(([, j]) => j)
            .map(([donemStr, j]) => {
              if (!j) return null;
              const donem = Number(donemStr);
              const jobMessage = String(j.message || '');
              const isWaitingSecurityCode = /captcha|g[uü]venlik kodu|kod portalda/i.test(jobMessage);
              const statusColor =
                isWaitingSecurityCode ? '#f59e0b'
                : j.status === 'done' ? '#22c55e'
                : j.status === 'failed' ? '#ef4444'
                : j.status === 'running' ? '#60a5fa'
                : '#f59e0b';
              const statusText =
                isWaitingSecurityCode ? 'Kod Bekliyor'
                : j.status === 'done' ? 'Tamamlandı'
                : j.status === 'failed' ? 'Hata'
                : j.status === 'running' ? 'Çalışıyor'
                : 'Sırada';
              // errorMsg satırlarından son [META] olmayan satırı al
              const rawLastLine = jobMessage
                .split('\n')
                .filter((l) => l.trim() && !l.startsWith('[META]'))
                .slice(-1)[0] || (j.status === 'pending' ? 'Local agent bekleniyor...' : '');
              const lastLine = isWaitingSecurityCode
                ? 'Luca güvenlik kodu bekliyor; üstteki Luca panelinden kodu girin.'
                : rawLastLine;
              const isActive = j.status === 'pending' || j.status === 'running';
              return (
                <div key={donemStr} className="flex items-center gap-2">
                  {isWaitingSecurityCode ? (
                    <KeyRound size={12} style={{ color: statusColor }} />
                  ) : isActive ? (
                    <Loader2 size={12} className="animate-spin" style={{ color: statusColor }} />
                  ) : (
                    <span style={{ color: statusColor, fontSize: 14 }}>
                      {j.status === 'done' ? '✓' : j.status === 'failed' ? '✗' : '·'}
                    </span>
                  )}
                  <span className="font-semibold" style={{ color: GOLD, minWidth: 70 }}>
                    {donem}. dönem
                  </span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={{ background: `${statusColor}22`, color: statusColor }}
                  >
                    {statusText}
                  </span>
                  <span
                    className="font-mono text-xs flex-1 truncate"
                    style={{ color: 'rgba(250,250,249,0.65)' }}
                    title={lastLine}
                  >
                    {lastLine}
                  </span>
                </div>
              );
            })}
        </div>
      )}

      <div
        className="rounded-xl border border-white/10 p-4"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[300px]">
            <label className="mb-1 block text-xs text-stone-500">Mükellef</label>
            <button
              onClick={() => setTpDropdownOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-stone-100"
            >
              <span className="flex items-center gap-2 truncate">
                <Users className="h-4 w-4 text-stone-500" />
                <span className={selectedTp ? 'text-stone-100' : 'text-stone-500'}>
                  {selectedTp ? taxpayerName(selectedTp) : 'Mükellef seç…'}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-stone-500" />
            </button>
            {tpDropdownOpen && (
              <div
                className="absolute top-full left-0 z-10 mt-1 max-h-72 w-full overflow-auto rounded-md shadow-lg"
                style={{
                  background: '#12100c',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <div
                  className="sticky top-0 border-b border-white/5 p-2"
                  style={{ background: '#12100c' }}
                >
                  <div className="relative">
                    <Search className="absolute left-2 top-2 h-4 w-4 text-stone-500" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Ad / VKN ara…"
                      className="w-full rounded py-1.5 pl-8 pr-2 text-sm text-stone-100 outline-none placeholder:text-stone-500"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    />
                  </div>
                </div>
                {filteredTp.length === 0 && (
                  <div className="p-4 text-center text-sm text-stone-500">Sonuç yok</div>
                )}
                {filteredTp.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTaxpayerId(t.id);
                      setTpDropdownOpen(false);
                      setSearch('');
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                  >
                    <div className="font-medium text-stone-100">{taxpayerName(t)}</div>
                    {t.taxNumber && (
                      <div className="text-xs text-stone-500">VKN/TCKN: {t.taxNumber}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-stone-500">Yıl</label>
            <select
              value={yil}
              onChange={(e) => setYil(Number(e.target.value))}
              className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-stone-100"
            >
              {Array.from({ length: 6 }).map((_, i) => {
                const y = currentYear - i;
                return (
                  <option key={y} value={y}>
                    {y}
                  </option>
                );
              })}
            </select>
          </div>

          {taxpayerId && hicKayitYok && (
            <button
              onClick={() => olusturYilMutation.mutate()}
              disabled={olusturYilMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200 ring-1 ring-amber-400/40 hover:bg-amber-500/15 disabled:opacity-50"
            >
              {olusturYilMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {yil} Yılını Başlat (4 Dönem Aç)
            </button>
          )}

          {taxpayerId && !hicKayitYok && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('iho-print'))}
              className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-bold"
              style={{
                background: 'rgba(212,184,118,0.12)',
                border: '1px solid rgba(212,184,118,0.32)',
                color: AMOUNT_ACCENT,
              }}
            >
              <Printer className="h-4 w-4" />
              Mükellef Çıktısı
            </button>
          )}
        </div>
      </div>

      {!taxpayerId ? (
        <div
          className="rounded-xl border border-white/10 p-12 text-center text-sm text-stone-500"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          Görüntülemek için mükellef seçin.
        </div>
      ) : isLoading ? (
        <div
          className="rounded-xl border border-white/10 p-12 text-center"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-stone-500" />
        </div>
      ) : hicKayitYok ? (
        <div
          className="rounded-xl border border-white/10 p-12 text-center text-sm text-stone-500"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          {yil} yılı için henüz kayıt açılmamış. Yukarıdaki "Yılı Başlat" butonuyla 4 dönem boş kayıtları
          oluşturup tutarları manuel girebilirsin.
        </div>
      ) : (
        <KarsilastirmaTablosu
          yilData={yilData!}
          tersDonemler={tersDonemler}
          onUpdate={(id, payload) => updateMutation.mutate({ id, payload })}
          onLock={(id) => lockMutation.mutate(id)}
          onUnlock={(id) => {
            const reason = window.prompt('Kilidi açma gerekçesi?');
            if (reason) unlockMutation.mutate({ id, reason });
          }}
          onDelete={(id) => {
            if (window.confirm('Bu dönem kaydı silinsin mi?')) deleteMutation.mutate(id);
          }}
          onLucaCek={(donem) => {
            const c = yilData?.ceyrekler?.[donem - 1];
            if (!c) return;
            const onay = window.confirm(
              `Luca'dan ${donem}. dönem İşletme Defteri çekilecek.\n\n` +
                `Güvenlik kodu gerekirse portal içindeki Luca Oturum Yöneticisi'nde gösterilecek.\n\n` +
                `Başlatılsın mı?`,
            );
            if (onay) lucaCekMutation.mutate(c.id);
          }}
          onLucaCancel={(donem, jobId) => {
            isletmeHesapOzetiApi.cancelLucaJob(jobId)
              .then(() => {
                setLucaJobs((prev) => ({ ...prev, [donem]: null }));
                toast.info(`${donem}. dönem Luca çekimi iptal edildi`);
              })
              .catch((e: any) => toast.error(e?.response?.data?.message || 'İptal edilemedi'));
          }}
          lucaJobs={lucaJobs}
        />
      )}

      {taxpayerId && yilData && (
        <MaliYorumKutusu kaynak="IHO" kaynakId={`${taxpayerId}:${yil}`} accent="#5bb9b0" />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   KARŞILAŞTIRMA TABLOSU
═══════════════════════════════════════════════════════ */
function KarsilastirmaTablosu({
  yilData,
  tersDonemler,
  onUpdate,
  onLock,
  onUnlock,
  onDelete,
  onLucaCek,
  onLucaCancel,
  lucaJobs,
}: {
  yilData: IhoYil;
  tersDonemler: number[];
  onUpdate: (id: string, payload: IhoManuelPayload) => void;
  onLock: (id: string) => void;
  onUnlock: (id: string) => void;
  onDelete: (id: string) => void;
  onLucaCek: (donem: number) => void;
  onLucaCancel: (donem: number, jobId: string) => void;
  lucaJobs: Record<number, { jobId: string; status: string; message?: string } | null>;
}) {
  const yil = yilData?.yil;

  // Local draft — kullanıcı input'lara yazdıkça burada tutulur
  const [drafts, setDrafts] = useState<Record<number, Partial<Record<ManuelField, number>>>>({});

  useEffect(() => {
    const next: Record<number, Partial<Record<ManuelField, number>>> = {};
    for (let d = 1; d <= 4; d++) {
      const c = yilData?.ceyrekler?.[d - 1];
      if (c) {
        next[d] = {
          satisHasilati: Number(c.satisHasilati || 0),
          digerGelir: Number(c.digerGelir || 0),
          malAlisi: Number(c.malAlisi || 0),
          donemBasiStok: Number(c.donemBasiStok || 0),
          kalanStok: Number(c.kalanStok || 0),
          satilanMalMaliyeti: Number(c.satilanMalMaliyeti || 0),
          donemIciGiderler: Number(c.donemIciGiderler || 0),
          gecmisYilZarari: Number(c.gecmisYilZarari || 0),
          oncekiOdenenGecVergi: Number(c.oncekiOdenenGecVergi || 0),
        };
      }
    }
    setDrafts(next);
  }, [yilData]);

  // SMM ↔ Kalan Stok bağlama: kullanıcı SMM girince Kalan Stok auto, tersi de
  function setField(donem: number, field: ManuelField, val: number) {
    setDrafts((prev) => {
      const cur = { ...(prev[donem] || {}) };
      cur[field] = val;
      // Toplam stok = donemBasiStok + malAlisi
      const dbs = Number(cur.donemBasiStok || 0);
      const ma = Number(cur.malAlisi || 0);
      const toplam = dbs + ma;
      if (field === 'satilanMalMaliyeti') {
        cur.kalanStok = Math.round((toplam - val) * 100) / 100;
      } else if (field === 'kalanStok') {
        cur.satilanMalMaliyeti = Math.round((toplam - val) * 100) / 100;
      } else if (field === 'malAlisi' || field === 'donemBasiStok') {
        // Toplam değişti → mevcut kalanStok'a göre SMM yenilenir
        const kalan = Number(cur.kalanStok || 0);
        cur.satilanMalMaliyeti = Math.round((toplam - kalan) * 100) / 100;
      }
      return { ...prev, [donem]: cur };
    });
  }

  function saveDraft(donem: number) {
    const c = yilData?.ceyrekler?.[donem - 1];
    if (!c) return;
    const d = drafts[donem] || {};
    const payload: IhoManuelPayload = {};
    for (const f of MANUEL_FIELDS) {
      const newV = Number(d[f] || 0);
      const oldV = Number((c as any)[f] || 0);
      if (newV !== oldV) (payload as any)[f] = newV;
    }
    if (Object.keys(payload).length === 0) {
      toast.info('Değişiklik yok');
      return;
    }
    onUpdate(c.id, payload);
  }

  // Bir dönemin draft değerini getir (yoksa DB değerine düş)
  const draftVal = (donem: number, field: ManuelField): number => {
    const d = drafts[donem];
    if (d && field in d) return Number(d[field] || 0);
    const c = yilData?.ceyrekler?.[donem - 1];
    return c ? Number((c as any)[field] || 0) : 0;
  };

  // Toplam stok ve diğer türetilen değerler — draft'tan canlı hesapla
  const liveCalc = (donem: number) => {
    const dbs = draftVal(donem, 'donemBasiStok');
    const ma = draftVal(donem, 'malAlisi');
    const toplam = dbs + ma;
    const smm = draftVal(donem, 'satilanMalMaliyeti');
    const sat = draftVal(donem, 'satisHasilati');
    const dg = draftVal(donem, 'digerGelir');
    const toplamSat = sat + dg;
    const netSat = toplamSat - smm;
    const giderler = draftVal(donem, 'donemIciGiderler');
    const donemKar = netSat - giderler;
    const gyz = draftVal(donem, 'gecmisYilZarari');
    const matrah = Math.max(0, donemKar - gyz);
    const hesGV = matrah * 0.15;
    const oncOd = draftVal(donem, 'oncekiOdenenGecVergi');
    const odenecek = Math.max(0, hesGV - oncOd);
    return { toplam, smm, netSat, donemKar, matrah, hesGV, odenecek, sat, giderler };
  };

  // Yüzde hesaplayıcı (satışa oranla)
  const oran = (v: number, base: number): string => {
    if (!base || base === 0) return '—';
    const pct = (v / base) * 100;
    if (Math.abs(pct) > 9999) return '—';
    return `%${pct.toFixed(1).replace('.', ',')}`;
  };

  const COL_WIDTH = `${76 / tersDonemler.length}%`;

  // Gelir tablosuyla aynı altın renk
  const GOLD = '#d4b876';

  // Dönem aralık metinleri
  const DONEM_RANGE: Record<number, string> = {
    1: 'Ocak – Mart',
    2: 'Nisan – Haziran',
    3: 'Temmuz – Eylül',
    4: 'Ekim – Aralık',
  };

  const hasClientPeriodMovement = (donem: number): boolean => {
    const lc = liveCalc(donem);
    return [
      draftVal(donem, 'satisHasilati'),
      draftVal(donem, 'digerGelir'),
      draftVal(donem, 'malAlisi'),
      draftVal(donem, 'donemBasiStok'),
      draftVal(donem, 'kalanStok'),
      lc.smm,
      lc.netSat,
      lc.giderler,
      lc.donemKar,
      lc.matrah,
      lc.hesGV,
      lc.odenecek,
    ].some((v) => Math.abs(Number(v) || 0) > 0.004);
  };

  const clientReportPeriods = tersDonemler.filter((d) => !!yilData?.ceyrekler?.[d - 1] && hasClientPeriodMovement(d));

  const reportOran = (value: number, base: number): string => {
    if (!base) return '—';
    const pct = (value / base) * 100;
    if (!isFinite(pct) || Math.abs(pct) > 9999) return '—';
    return `%${pct.toFixed(1).replace('.', ',')}`;
  };

  const hasMovement = (values: number[]) => values.some((v) => Math.abs(Number(v) || 0) > 0.004);

  const buildClientRows = (): IhoClientReportRow[] => {
    const values = (fn: (donem: number) => number) => clientReportPeriods.map((d) => fn(d));
    const rows: IhoClientReportRow[] = [
      { label: 'Dönem İçi Satışlar', values: values((d) => draftVal(d, 'satisHasilati')) },
      { label: 'Diğer Gelirler', values: values((d) => draftVal(d, 'digerGelir')) },
      { label: 'Satılan Malın Maliyeti (-)', values: values((d) => liveCalc(d).smm), kind: 'manual' },
      { label: 'Brüt Satış Karı', values: values((d) => liveCalc(d).netSat), kind: 'profit' },
      { label: 'Dönem İçi Giderler (-)', values: values((d) => liveCalc(d).giderler) },
      { label: 'Dönem Karı', values: values((d) => liveCalc(d).donemKar), kind: 'profit' },
      { label: 'Satın Alınan Mal Bedeli', values: values((d) => draftVal(d, 'malAlisi')) },
      { label: 'Dönem Başı Stok', values: values((d) => draftVal(d, 'donemBasiStok')) },
      { label: 'Toplam Stok', values: values((d) => liveCalc(d).toplam) },
      { label: 'Kalan Stok (sayım)', values: values((d) => draftVal(d, 'kalanStok')) },
      { label: 'Geçmiş Yıl Zararı (-)', values: values((d) => draftVal(d, 'gecmisYilZarari')), kind: 'manual' },
      { label: 'Geçici Vergi Matrahı', values: values((d) => liveCalc(d).matrah), kind: 'tax' },
      { label: 'Hesaplanan Geçici Vergi %15', values: values((d) => liveCalc(d).hesGV), kind: 'tax' },
      { label: 'Önceki Dönem Ödenen Geçici Vergi (-)', values: values((d) => draftVal(d, 'oncekiOdenenGecVergi')), kind: 'tax' },
      { label: 'Ödenecek Geçici Vergi', values: values((d) => liveCalc(d).odenecek), kind: 'tax' },
    ];

    return rows.filter((row) => hasMovement(row.values));
  };

  const buildClientSummary = (): { ratios: IhoClientReportRatio[]; highlights: IhoClientReportHighlight[]; assessment: string[] } => {
    const totals = clientReportPeriods.reduce(
      (acc, d) => {
        const lc = liveCalc(d);
        acc.sat += draftVal(d, 'satisHasilati');
        acc.digerGelir += draftVal(d, 'digerGelir');
        acc.smm += lc.smm;
        acc.brutKar += lc.netSat;
        acc.giderler += lc.giderler;
        acc.donemKar += lc.donemKar;
        acc.odenecek += lc.odenecek;
        acc.kalanStok += draftVal(d, 'kalanStok');
        return acc;
      },
      { sat: 0, digerGelir: 0, smm: 0, brutKar: 0, giderler: 0, donemKar: 0, odenecek: 0, kalanStok: 0 },
    );
    const ciro = totals.sat + totals.digerGelir;
    const ratios: IhoClientReportRatio[] = [
      { label: 'Brüt Kar Marjı', value: reportOran(totals.brutKar, ciro), tone: totals.brutKar >= 0 ? 'good' : 'bad' },
      { label: 'Dönem Kar Marjı', value: reportOran(totals.donemKar, ciro), tone: totals.donemKar >= 0 ? 'good' : 'bad' },
      { label: 'SMM / Ciro', value: reportOran(totals.smm, ciro), tone: ciro && totals.smm > ciro * 0.75 ? 'warn' : 'neutral' },
      { label: 'Gider / Ciro', value: reportOran(totals.giderler, ciro), tone: ciro && totals.giderler > ciro * 0.2 ? 'warn' : 'neutral' },
    ];
    const visibleRatios = ratios.filter((r) => r.value !== '—');
    const highlights: IhoClientReportHighlight[] = [
      {
        label: totals.donemKar >= 0 ? 'Çıkan kâr' : 'Çıkan zarar',
        value: `${formatTR(Math.abs(totals.donemKar))} TL`,
        tone: totals.donemKar >= 0 ? 'good' : 'bad',
      },
      {
        label: 'Ödenecek vergi',
        value: `${formatTR(totals.odenecek)} TL`,
        tone: totals.odenecek > 0 ? 'warn' : 'neutral',
      },
    ];

    const smmRatio = reportOran(totals.smm, ciro);
    const giderRatio = reportOran(totals.giderler, ciro);
    const karRatio = reportOran(totals.donemKar, ciro);
    const karMarginValue = ciro ? (totals.donemKar / ciro) * 100 : 0;
    const reportPeriodText = clientReportPeriods.length === 1
      ? `${DONEM_ROMAN[clientReportPeriods[0]]}. dönem`
      : 'seçili dönemler';
    const profitAssessment = totals.donemKar >= 0
      ? karMarginValue >= 15
        ? `Dönem ${formatTR(totals.donemKar)} kâr ile kapanıyor; ${karRatio} kazanç oranı işletme için güçlü bir sonuçtur.`
        : `Dönem ${formatTR(totals.donemKar)} kâr ile kapanıyor; ${karRatio} kazanç oranı korunmalı, küçük maliyet artışları bile takip edilmelidir.`
      : `Dönem ${formatTR(Math.abs(totals.donemKar))} zarar ile kapanıyor; maliyet, gider ve fiyatlama birlikte yeniden incelenmelidir.`;
    const costAssessment = totals.smm === 0
      ? 'Mal maliyeti sıfır görünüyor; alış ve stok kayıtları tamamlanmadan kâr olduğundan yüksek çıkabilir.'
      : totals.smm > ciro * 0.75
      ? `Satılan malların maliyeti ${formatTR(totals.smm)} ve ciroya oranı ${smmRatio}; bu seviye kârı baskılar.`
      : `Satılan malların maliyeti ${formatTR(totals.smm)} ve ciroya oranı ${smmRatio}; stok sayımıyla teyit edilirse görünüm sağlıklıdır.`;
    const expenseAssessment = totals.giderler
      ? totals.giderler > ciro * 0.2
        ? `Genel giderler ${formatTR(totals.giderler)} ve ciroya oranı ${giderRatio}; gider artışı kârlılığı zayıflatabilir.`
        : `Genel giderler ${formatTR(totals.giderler)} ve ciroya oranı ${giderRatio}; bu seviye kârlılığı destekliyor.`
      : 'Genel gider hareketi görünmüyor; eksik gider kaydı olup olmadığı kontrol edilmelidir.';
    const taxAssessment = totals.odenecek > 0
      ? `Bu tabloya göre ${formatTR(totals.odenecek)} TL geçici vergi karşılığı ayrılması gerekir.`
      : 'Bu tabloya göre ödenecek geçici vergi görünmüyor; önceki dönem mahsupları ve zarar kayıtları kontrol edilmelidir.';
    const forecastAssessment = totals.donemKar >= 0
      ? 'Satışlar korunup stok, maliyet ve giderler düzenli izlenirse dönem sonu kârlılığı daha güvenli yönetilir.'
      : 'Zarar eğilimi sürerse fiyatlama, alış maliyeti ve gider planı gecikmeden yeniden düzenlenmelidir.';
    const assessment = !ciro
      ? [
          'Bu yıl için satış hareketi görünmüyor.',
          'Mükellefe göndermeden önce Luca aktarımı, satış, alış ve stok bilgilerinin tamamlandığını kontrol etmek iyi olur.',
        ]
      : [
          `Genel tablo: ${reportPeriodText} için toplam gelir ${formatTR(ciro)}. Bu tutar işletmenin dönem içi iş hacmini gösterir.`,
          `Kârlılık: ${profitAssessment}`,
          `Maliyet ve stok: ${costAssessment}`,
          `Gider disiplini: ${expenseAssessment}`,
          `Vergi hazırlığı: ${taxAssessment}`,
          `Öngörü: ${forecastAssessment}`,
        ];

    return { ratios: visibleRatios, highlights, assessment };
  };

  const handleClientOutput = () => {
    if (!clientReportPeriods.length) {
      toast.error('Önce işletme hesap özeti dönem kaydı oluşturun');
      return;
    }

    const rows = buildClientRows();
    if (!rows.length) {
      toast.info('Çıktıya yansıyacak hareket bulunmuyor');
      return;
    }

    const { ratios, highlights, assessment } = buildClientSummary();
    const taxpayer = yilData.taxpayer as Taxpayer | null | undefined;
    const reportHtml = buildIhoClientReportHtml({
      taxpayerName: taxpayer ? taxpayerName(taxpayer) : 'Mükellef',
      taxNumber: taxpayer?.taxNumber || '',
      year: yil,
      logoUrl: `${window.location.origin}/brand/moren-logo-gold.png`,
      periodLabels: clientReportPeriods.map((d) => `${DONEM_ROMAN[d]}. Dönem`),
      rows,
      ratios,
      highlights,
      assessment,
      generatedAt: new Date().toLocaleDateString('tr-TR'),
    });

    const printWindow = window.open('', '_blank', 'width=960,height=720');
    if (!printWindow) {
      toast.error('Çıktı penceresi açılamadı. Tarayıcı pop-up iznini kontrol edin.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(reportHtml);
    printWindow.document.close();
    printWindow.focus();
    printWindow.document.title = '';
    setTimeout(() => {
      printWindow.document.title = '';
      printWindow.print();
    }, 750);
  };

  // "Mükellef Çıktısı" butonu artık ÜST seçici satırında (ana bileşen); buradan
  // window olayı ile tetiklenir — böylece butonla tablo arası boşluk kalkar.
  const printRef = useRef(handleClientOutput);
  printRef.current = handleClientOutput;
  useEffect(() => {
    const h = () => printRef.current();
    window.addEventListener('iho-print', h);
    return () => window.removeEventListener('iho-print', h);
  }, []);

  return (
    <div>
      {/* v1.36.26: Dönem Aksiyonları + KAR/ZARAR ÖZETİ tek bağlı blok — boşluk yok */}
      <div className="space-y-0">
      {/* Üst dönem barı — tablonun sütun genişlikleriyle birebir hizalı */}
      <div
        className="rounded-t-xl overflow-hidden"
        style={{
          background: TABLE_HEADER_BG,
          borderTop: `1px solid ${GRID_LINE_STRONG}`,
          borderLeft: `1px solid ${GRID_LINE_STRONG}`,
          borderRight: `1px solid ${GRID_LINE_STRONG}`,
          // Alt kenar çizgisi — dikey sütun ayraçları buraya oturup birleşsin
          // (yoksa çizgiler boşlukta asılı kalıp "kopuk" görünüyordu, kullanıcı bildirimi).
          borderBottom: `1px solid ${GRID_LINE_STRONG}`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div
          className="grid"
          style={{
            // Tablo colgroup ile aynı: 34% boş + 4 dönem × COL_WIDTH
            gridTemplateColumns: `24% repeat(${tersDonemler.length}, ${COL_WIDTH})`,
          }}
        >
          {/* Sol AÇIKLAMA placeholder — tablonun ilk kolonuyla aynı genişlik */}
          <div
            className="px-3 py-3 flex items-center"
            style={{ borderRight: `1px solid ${GRID_LINE_STRONG}` }}
          >
            <span
              className="text-[10px] uppercase font-bold tracking-[.18em]"
              style={{ color: 'rgba(250,250,249,0.4)' }}
            >
              Dönem Aksiyonları
            </span>
          </div>
          {tersDonemler.map((d, idx) => {
            const c = yilData?.ceyrekler?.[d - 1];
            const locked = !!c?.locked;
            const job = lucaJobs[d];
            const fetching = job?.status === 'pending' || job?.status === 'running';
            const isLast = idx === tersDonemler.length - 1;
            return (
              <div
                key={d}
                className="px-3 py-3 text-center"
                style={{
                  background: locked ? 'rgba(212,184,118,0.10)' : 'transparent',
                  borderRight: !isLast ? `1px solid ${GRID_LINE_STRONG}` : 'none',
                }}
              >
                {/* Dönem başlığı */}
                <div
                  style={{
                    color: c ? GOLD : 'rgba(250,250,249,0.4)',
                    fontFamily: 'Fraunces, serif',
                    fontWeight: 600,
                    fontSize: 14,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {yil} · {DONEM_ROMAN[d]}. DÖNEM
                </div>
                <div
                  className="mt-0.5"
                  style={{
                    fontSize: 11,
                    color: c ? 'rgba(250,250,249,0.55)' : 'rgba(250,250,249,0.3)',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                  }}
                >
                  {DONEM_RANGE[d]}
                </div>

                {/* Locked rozet */}
                {locked && (
                  <span
                    className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(212,184,118,0.16)', color: AMOUNT_ACCENT, border: `1px solid ${GRID_LINE}` }}
                  >
                    <Lock size={9} /> KESİN
                  </span>
                )}

                {/* Aksiyon butonları — v1.36.22 tutarlı boyut + ortalı */}
                <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
                  {!locked && (
                    <button
                      onClick={() => {
                        if (fetching && job?.jobId) {
                          onLucaCancel(d, job.jobId);
                        } else {
                          onLucaCek(d);
                        }
                      }}
                      title={fetching ? 'Bu döneme ait Luca çekimini iptal et' : "Luca'dan İşletme Defteri Excel'i çek"}
                      className="inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded"
                      style={{
                        background: fetching ? 'rgba(239,68,68,0.12)' : 'rgba(184,160,111,0.12)',
                        color: fetching ? '#fca5a5' : GOLD,
                        border: `1px solid ${fetching ? 'rgba(239,68,68,0.35)' : 'rgba(184,160,111,0.3)'}`,
                        height: 28,
                        padding: '0 10px',
                        minWidth: 100,
                      }}
                    >
                      {fetching ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CloudDownload className="h-3 w-3" />
                      )}
                      {fetching ? 'İptal Et' : "Luca'dan Çek"}
                    </button>
                  )}
                  {c && !locked && (
                    <>
                      <button
                        onClick={() => onLock(c.id)}
                        title="Kesin kayda al"
                        className="inline-flex items-center justify-center text-[11px] font-semibold rounded"
                        style={{
                          background: 'rgba(184,160,111,0.12)',
                          color: GOLD,
                          border: '1px solid rgba(184,160,111,0.3)',
                          height: 28,
                          padding: '0 10px',
                          minWidth: 88,
                        }}
                      >
                        Kesin Kayıt
                      </button>
                      <button
                        onClick={() => onDelete(c.id)}
                        title="İçerikleri temizle (kayıt kalır)"
                        className="inline-flex items-center justify-center rounded"
                        style={{
                          background: 'rgba(244,63,94,0.1)',
                          color: '#f43f5e',
                          border: '1px solid rgba(244,63,94,0.25)',
                          height: 28,
                          width: 28,
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  {locked && (
                    <button
                      onClick={() => onUnlock(c!.id)}
                      title="Kilidi aç (ADMIN)"
                      className="inline-flex items-center justify-center text-[11px] font-semibold rounded"
                      style={{
                        background: 'rgba(244,63,94,0.12)',
                        color: '#f43f5e',
                        border: '1px solid rgba(244,63,94,0.3)',
                        height: 28,
                        padding: '0 10px',
                        minWidth: 80,
                      }}
                    >
                      Kilidi Aç
                    </button>
                  )}
                  {!c && (
                    <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.3)' }}>
                      Veri yok
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          BLOK 1 — KAR/ZARAR ÖZETİ
      ═══════════════════════════════════════════ */}
      <BlockCard
        title="KAR / ZARAR ÖZETİ"
        icon={<TrendingUp className="h-4 w-4" />}
        accent="emerald"
        attached
      >
        <table className="w-full text-sm" style={REPORT_TABLE_STYLE}>
          <colgroup>
            <col style={{ width: '24%' }} />
            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          {/* v1.36.25: thead kaldirildi - boş yeşil çizgi yapıyordu, başlık direkt tablo */}
          <tbody>
            <Row
              label="DÖNEM İÇİ SATIŞLAR"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'satisHasilati')}
                  onChange={(n) => setField(d, 'satisHasilati', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
              bold
            />
            <Row
              label="SATILAN MALIN MALİYETİ (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'satilanMalMaliyeti')}
                  onChange={(n) => setField(d, 'satilanMalMaliyeti', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.smm, lc.sat);
              })}
              raw
              manuel
            />
            <Row
              label="BRÜT SATIŞ KARI"
              hint="(Satışlar − SMM)"
              cols={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return formatTR(lc.netSat);
              })}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.netSat, lc.sat);
              })}
              calc
              bold
              profit
              hl="bg-emerald-500/100/10"
            />
            <Row
              label="DÖNEM İÇİ GİDERLER (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'donemIciGiderler')}
                  onChange={(n) => setField(d, 'donemIciGiderler', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.giderler, lc.sat);
              })}
              raw
            />
            <Row
              label="DÖNEM KARI"
              cols={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return formatTR(lc.donemKar);
              })}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.donemKar, lc.sat);
              })}
              calc
              raw
              bold
              profit
              hl="bg-amber-500/10"
            />
          </tbody>
        </table>
      </BlockCard>
      </div>{/* /space-y-0 — Dönem Aksiyonları + KAR/ZARAR ÖZETİ tek bağlı blok bitti */}

      {/* ═══════════════════════════════════════════
          BLOK 2 — STOK HAREKETİ
      ═══════════════════════════════════════════ */}
      <BlockCard
        title="STOK HAREKETİ"
        icon={<Package className="h-4 w-4" />}
        accent="amber"
      >
        <table className="w-full text-sm" style={REPORT_TABLE_STYLE}>
          <colgroup>
            <col style={{ width: '24%' }} />
            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          <tbody>
            <Row
              label="SATIN ALINAN MAL BEDELİ"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'malAlisi')}
                  onChange={(n) => setField(d, 'malAlisi', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
            />
            <Row
              label="DÖNEM BAŞI STOK"
              hint="(2-4. dönem önceki kalandan otomatik)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'donemBasiStok')}
                  onChange={(n) => setField(d, 'donemBasiStok', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
            />
            <Row
              label="TOPLAM STOK"
              hint="(= Dönem Başı + Satın Alınan)"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).toplam))}
              calc
              bold
            />
            <Row
              label="SATILAN MALIN MALİYETİ"
              hint="(= Toplam − Kalan)"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).smm))}
              calc
            />
            <Row
              label="KALAN STOK (sayım)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'kalanStok')}
                  onChange={(n) => setField(d, 'kalanStok', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
            />
          </tbody>
        </table>
      </BlockCard>

      <BlockCard
        title="GEÇİCİ VERGİ HESAPLAMASI"
        icon={<Calculator className="h-4 w-4" />}
        accent="indigo"
      >
        <table className="w-full text-sm" style={REPORT_TABLE_STYLE}>
          <colgroup>
            <col style={{ width: '24%' }} />
            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          <tbody>
            <Row
              label="DÖNEM KARI"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).donemKar))}
              calc
              bold
              profit
            />
            <Row
              label="GEÇMİŞ YIL ZARARI (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'gecmisYilZarari')}
                  onChange={(n) => setField(d, 'gecmisYilZarari', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
              manuel
            />
            <Row
              label="GEÇİCİ VERGİ MATRAHI"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).matrah))}
              calc
              bold
            />
            <Row
              label="HESAPLANAN GEÇİCİ VERGİ %15"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).hesGV))}
              calc
            />
            <Row
              label="ÖNCEKİ DÖNEM ÖDENEN GEÇİCİ VERGİ (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'oncekiOdenenGecVergi')}
                  onChange={(n) => setField(d, 'oncekiOdenenGecVergi', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
            />
            <Row
              label="ÖDENECEK GEÇİCİ VERGİ"
              cols={tersDonemler.map((d) => (
                <span key={d} className="text-base font-bold" style={{ color: AMOUNT_ACCENT }}>
                  {formatTR(liveCalc(d).odenecek)}
                </span>
              ))}
              raw
              bold
              hl="bg-indigo-500/20"
            />
          </tbody>
        </table>
      </BlockCard>

      {/* v1.36.70: DÖNEM AKSİYONLARI — üst tablonun sütun genişlikleriyle BİREBİR aynı grid.
          Her buton kendi sütunu içinde kalır, yan sütuna taşmaz. */}
      <div
        className="grid rounded-xl py-3 mt-3 items-center"
        style={{
          // Üst tablo ile aynı: 24% etiket + N × COL_WIDTH (her dönem 19%)
          gridTemplateColumns: `24% repeat(${tersDonemler.length}, ${COL_WIDTH})`,
          background: 'linear-gradient(135deg, rgba(212,184,118,0.08), rgba(212,184,118,0.02))',
          border: '1px solid rgba(212,184,118,0.25)',
        }}
      >
        <div
          className="flex items-center px-3 text-[11px] font-bold uppercase tracking-[.08em]"
          style={{ color: 'rgba(212,184,118,0.85)' }}
        >
          DÖNEM AKSİYONLARI
        </div>
        {tersDonemler.map((d) => {
          const c = yilData?.ceyrekler?.[d - 1];
          // Her butonu kendi sütun hücresine sar — px-2 hücre içi soluk + buton sütun sınırını geçmez.
          if (!c) {
            return <div key={d} className="px-2" />;
          }
          if (c.locked) {
            return (
              <div key={d} className="px-2 flex items-center justify-center">
                <div
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11.5px] font-semibold whitespace-nowrap w-full"
                  style={{
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(245,158,11,0.06))',
                    color: '#fbbf24',
                    border: '1px solid rgba(245,158,11,0.35)',
                  }}
                  title={`${DONEM_ROMAN[d]}. Dönem kesin kayıtla kilitlendi`}
                >
                  <Lock className="h-3 w-3 shrink-0" />
                  <span className="truncate">{DONEM_ROMAN[d]}. Kilitli</span>
                </div>
              </div>
            );
          }
          return (
            <div key={d} className="px-2 flex items-center justify-center">
              <button
                onClick={() => saveDraft(d)}
                className="inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[12.5px] font-medium transition-all whitespace-nowrap w-full"
                style={{
                  background: 'rgba(244,63,94,0.06)',
                  color: '#fafaf9',
                  border: '1px solid rgba(244,63,94,0.20)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(244,63,94,0.12)';
                  e.currentTarget.style.borderColor = 'rgba(244,63,94,0.35)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(244,63,94,0.06)';
                  e.currentTarget.style.borderColor = 'rgba(244,63,94,0.20)';
                }}
                title={`${DONEM_ROMAN[d]}. Dönem manuel düzeltmelerini kaydet`}
              >
                <Save className="h-4 w-4 shrink-0" style={{ color: 'rgba(250,250,249,0.85)' }} />
                <span className="truncate">{DONEM_ROMAN[d]}. Dönemi Kaydet</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BlockCard({
  title,
  icon,
  accent,
  children,
  attached,
}: {
  title: string;
  icon: React.ReactNode;
  accent: 'emerald' | 'amber' | 'indigo';
  children: React.ReactNode;
  attached?: boolean; // v1.36.26: üstteki kutuya bitişikse top-rounded ve top-border kaldır
}) {
  const accentColors: Record<string, { headerBg: string; border: string; text: string; iconBg: string; iconText: string }> = {
    emerald: {
      headerBg: TABLE_HEADER_BG,
      border: GRID_LINE_STRONG,
      text: AMOUNT_ACCENT,
      iconBg: 'rgba(212,184,118,0.16)',
      iconText: AMOUNT_ACCENT,
    },
    amber: {
      headerBg: TABLE_HEADER_BG,
      border: GRID_LINE_STRONG,
      text: AMOUNT_ACCENT,
      iconBg: 'rgba(212,184,118,0.16)',
      iconText: AMOUNT_ACCENT,
    },
    indigo: {
      headerBg: TABLE_HEADER_BG,
      border: GRID_LINE_STRONG,
      text: AMOUNT_ACCENT,
      iconBg: 'rgba(212,184,118,0.16)',
      iconText: AMOUNT_ACCENT,
    },
  };
  const c = accentColors[accent];
  return (
    <div
      className={`overflow-hidden relative ${attached ? 'rounded-b-2xl' : 'rounded-2xl'}`}
      style={{
        background: TABLE_SURFACE,
        borderLeft: `1px solid ${c.border}`,
        borderRight: `1px solid ${c.border}`,
        borderBottom: `1px solid ${c.border}`,
        borderTop: attached ? 'none' : `1px solid ${c.border}`,
        boxShadow: '0 10px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      {/* Üst altın hairline — Brifing kartı deseni */}
      {!attached && (
        <span
          className="absolute top-0 left-6 right-6 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
            opacity: 0.55,
          }}
        />
      )}
      <div
        className="flex items-center gap-3 px-5 py-3"
        style={{
          background: attached ? TABLE_SECTION_BG : c.headerBg,
          borderBottom: `1px solid ${c.border}`,
        }}
      >
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
          style={{
            background: c.iconBg,
            color: c.iconText,
            border: `1px solid ${GRID_LINE_STRONG}`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          {icon}
        </span>
        <h2
          className="text-[11px] font-bold uppercase"
          style={{
            color: c.text,
            letterSpacing: '0.18em',
            fontFamily: NUM_FONT,
            fontWeight: 700,
          }}
        >
          {title}
        </h2>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Row({
  label,
  cols,
  ratios,
  bold,
  hl,
  hint,
  calc,
  raw,
  manuel,
  profit,
}: {
  label: string;
  cols: React.ReactNode[];
  ratios?: string[];
  bold?: boolean;
  hl?: string;
  hint?: string;
  calc?: boolean;
  raw?: boolean;
  manuel?: boolean; // v1.36.30: manuel giriş satırı — altın tint vurgu
  profit?: boolean;
}) {
  // Oran rengi: pozitif altın, negatif soluk kırmızı, sıfır gri
  const ratioColor = (r: string): string => {
    if (!r || r === '—') return REPORT_DIM;
    const isNeg = r.includes('-');
    const num = parseFloat(r.replace(/[%,\s]/g, '').replace(',', '.')) || 0;
    if (isNeg) return RATIO_LOSS;
    if (num === 0) return REPORT_DIM;
    return RATIO_TEXT;
  };

  const rowBg = manuel ? MANUAL_ROW_BG : hl || calc ? TOTAL_ROW_BG : 'transparent';

  return (
    <tr
      style={{ background: rowBg, transition: 'background-color 120ms' }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(212,184,118,0.03)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.background = rowBg;
      }}
    >
      <td
        className="px-5 py-3"
        style={{
          color: manuel ? MANUAL_TEXT : bold ? REPORT_TEXT : REPORT_MUTED,
          borderTop: `1px solid ${GRID_LINE}`,
          borderRight: `1px solid ${GRID_LINE}`,
          borderLeft: manuel ? `3px solid ${MANUAL_BORDER}` : `1px solid transparent`,
          background: 'transparent',
          lineHeight: 1.25,
          fontFamily: NUM_FONT,
          fontSize: bold ? 12.5 : 12,
          fontWeight: bold ? 700 : 600,
          letterSpacing: bold ? '0.04em' : '0.01em',
          textTransform: bold ? 'uppercase' as any : 'none',
        }}
      >
        {label}
        {hint && (
          <span
            className="ml-2 normal-case"
            style={{ color: REPORT_DIM, fontSize: 10.5, fontWeight: 400, letterSpacing: 0, fontFamily: 'inherit' }}
          >
            {hint}
          </span>
        )}
        {manuel && (
          <span
            className="ml-2 inline-flex items-center rounded-md px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.14em] normal-case"
            style={{
              background: 'rgba(212,184,118,0.14)',
              border: '1px solid rgba(212,184,118,0.32)',
              color: MANUAL_TEXT,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            Manuel
          </span>
        )}
      </td>
      {cols.map((c, i) => {
        const rColor = ratios && ratios[i] ? ratioColor(ratios[i]) : null;
        const cStr = typeof c === 'string' ? c : '';
        const isEmpty = cStr === '0,00' || cStr === '0';
        const isNegative = cStr.startsWith('-');
        const showRatio = rColor && ratios![i] && ratios![i] !== '—' && !isEmpty;

        // Yeşil yalnızca kâr satırlarında kullanılır; stok/ara toplam pozitif diye yeşillenmez.
        const ratioStr = ratios?.[i] || '';
        const isRatioNeg = ratioStr.includes('-');
        const amountColor = isEmpty
          ? REPORT_DIM
          : isNegative || isRatioNeg
          ? LOSS_TEXT
          : profit && !isEmpty && !isNegative
          ? PROFIT_TEXT
          : AMOUNT_TEXT;

        return (
          <td
            key={i}
            className="px-5 py-3 text-center tabular-nums"
            style={{
              borderTop: `1px solid ${GRID_LINE}`,
              borderLeft: `1px solid ${GRID_LINE}`,
              background: 'transparent',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.2,
            }}
          >
            {showRatio ? (
              <div className="flex flex-col items-center justify-center gap-1">
                <span
                  className="tabular-nums"
                  style={{
                    fontFamily: NUM_FONT,
                    fontSize: 15,
                    fontWeight: bold ? 700 : 600,
                    letterSpacing: 0,
                    color: amountColor,
                  }}
                >
                  {c}
                </span>
                <span
                  className="inline-block tabular-nums"
                  style={{
                    color: rColor!,
                    fontWeight: 700,
                    fontSize: 10.5,
                    letterSpacing: '0.05em',
                    padding: '2px 7px',
                    borderRadius: 4,
                    background: isRatioNeg ? 'rgba(248,113,113,0.08)' : 'rgba(212,184,118,0.10)',
                    border: `1px solid ${isRatioNeg ? 'rgba(248,113,113,0.22)' : 'rgba(212,184,118,0.20)'}`,
                  }}
                >
                  {ratios![i]}
                </span>
              </div>
            ) : (
              <span
                className="tabular-nums"
                style={{
                  fontFamily: NUM_FONT,
                  fontSize: 15,
                  fontWeight: bold ? 700 : 600,
                  letterSpacing: 0,
                  color: amountColor,
                }}
              >
                {c}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
