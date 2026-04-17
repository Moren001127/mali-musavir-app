'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, Upload, FileSearch, Folder, FileText, Bot, HardDrive, Receipt, FileSignature, Mailbox, Landmark, ClipboardList } from 'lucide-react';

const GOLD = '#d4b876';

type DocumentItem = {
  id: string;
  name?: string;
  fileName?: string;
  documentType?: string;
  category?: string;
  period?: string;
  size?: number;
  ocrCompleted?: boolean;
  taxpayer?: { id: string; companyName?: string; firstName?: string; lastName?: string };
  createdAt?: string;
};

function getIcon(type?: string) {
  const t = (type || '').toLowerCase();
  if (t.includes('fatur')) return Receipt;
  if (t.includes('sozles')) return FileSignature;
  if (t.includes('tebligat')) return Mailbox;
  if (t.includes('banka')) return Landmark;
  if (t.includes('muhasebe') || t.includes('rapor')) return ClipboardList;
  return FileText;
}
function getTypeTag(type?: string): string {
  const t = (type || '').toLowerCase();
  if (t.includes('fatur')) return 'Fatura';
  if (t.includes('sozles')) return 'Sözleşme';
  if (t.includes('tebligat')) return 'Tebligat';
  if (t.includes('banka')) return 'Banka';
  if (t.includes('muhasebe')) return 'Muhasebe';
  return type || 'Diğer';
}
function fmtBytes(b?: number): string {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
}
function getTaxpayerName(d: DocumentItem): string {
  const t = d.taxpayer;
  if (!t) return '—';
  return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—';
}

export default function EvraklarPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [ocrFilter, setOcrFilter] = useState<'all' | 'ocr' | 'noocr'>('all');

  const { data: documents = [], isLoading } = useQuery<DocumentItem[]>({
    queryKey: ['documents', 'list'],
    queryFn: () => api.get('/documents').then((r) => r.data).catch(() => []),
  });

  const counts = useMemo(() => {
    const byType: Record<string, number> = { Fatura: 0, Sözleşme: 0, Tebligat: 0, Banka: 0, Diğer: 0 };
    for (const d of documents) {
      const tag = getTypeTag(d.documentType || d.category);
      byType[tag] = (byType[tag] || 0) + 1;
    }
    const ocr = documents.filter((d) => d.ocrCompleted).length;
    const thisMonth = documents.filter((d) => {
      if (!d.createdAt) return false;
      const dt = new Date(d.createdAt);
      const now = new Date();
      return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
    }).length;
    const totalSize = documents.reduce((s, d) => s + (d.size || 0), 0);
    return { total: documents.length, byType, ocr, thisMonth, totalSize, noocr: documents.length - ocr };
  }, [documents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((d) => {
      const tag = getTypeTag(d.documentType || d.category);
      if (typeFilter.length > 0 && !typeFilter.includes(tag)) return false;
      if (ocrFilter === 'ocr' && !d.ocrCompleted) return false;
      if (ocrFilter === 'noocr' && d.ocrCompleted) return false;
      if (!q) return true;
      return `${d.name || d.fileName || ''} ${getTaxpayerName(d)}`.toLowerCase().includes(q);
    });
  }, [documents, search, typeFilter, ocrFilter]);

  const toggleType = (t: string) => setTypeFilter((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Arşiv</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>Evrak Yönetimi</h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>Belge arşivleme ve OCR taraması</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}>
            <Upload size={14} /> Evrak Yükle
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px]" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
            <FileSearch size={14} /> OCR Taraması
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {[
          { label: 'Toplam Evrak', value: counts.total, sub: 'tüm dönemler', icon: Folder },
          { label: 'Bu Ay', value: counts.thisMonth, sub: new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }), icon: FileText },
          { label: 'OCR Edilmiş', value: counts.total > 0 ? `${Math.round((counts.ocr / counts.total) * 100)}%` : '0%', sub: `${counts.ocr} belge`, icon: Bot },
          { label: 'Depolama', value: counts.totalSize > 0 ? fmtBytes(counts.totalSize) : '0 B', sub: 'kullanılan', icon: HardDrive },
        ].map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}><Icon size={17} /></div>
            </div>
            <p className="text-[11px] uppercase font-semibold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.38)' }}>{label}</p>
            <p className="mt-1.5 leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: typeof value === 'number' ? 34 : 28, fontWeight: 700, letterSpacing: '-0.03em', color: GOLD }}>{value}</p>
            <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.32)' }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* SEARCH + MAIN GRID */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Evrak adı, mükellef veya tür ara..." className="w-full pl-10 pr-3 py-2.5 text-[13px] rounded-[10px] outline-none" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        {/* DOC GRID */}
        <div>
          {isLoading ? (
            <div className="py-16 flex flex-col items-center gap-3" style={{ color: 'rgba(250,250,249,0.4)' }}>
              <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD }} />
              <span className="text-sm">Yükleniyor...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl py-16 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <Folder size={24} style={{ color: 'rgba(250,250,249,0.35)' }} />
              </div>
              <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Henüz evrak yok</p>
              <p className="text-[11.5px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>Evrak yükleyin ya da OCR taraması başlatın</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {filtered.slice(0, 24).map((d) => {
                  const Icon = getIcon(d.documentType || d.category);
                  const tag = getTypeTag(d.documentType || d.category);
                  return (
                    <div key={d.id} className="p-4 rounded-2xl transition-all cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.05)'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.2)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; }}>
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}>
                        <Icon size={20} />
                      </div>
                      <p className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>{d.name || d.fileName || 'Belge'}</p>
                      <div className="flex items-center gap-1.5 mt-1 text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                        <span className="truncate">{getTaxpayerName(d)}</span>
                        <span>·</span>
                        <span className="tabular-nums">{fmtDate(d.createdAt)}</span>
                      </div>
                      <span className="inline-block mt-2 px-2 py-[2px] rounded-md text-[10px] font-semibold" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>{tag}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-center text-[12px] mt-4" style={{ color: 'rgba(250,250,249,0.4)' }}>
                Gösterilen: {Math.min(24, filtered.length)} / {filtered.length}
              </p>
            </>
          )}
        </div>

        {/* SIDEBAR FILTERS */}
        <div className="space-y-4">
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[11px] font-bold uppercase mb-3 tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.42)' }}>Türe Göre Filtre</p>
            {(['Fatura', 'Sözleşme', 'Tebligat', 'Banka', 'Muhasebe', 'Diğer'] as const).map((t) => (
              <label key={t} className="flex items-center justify-between py-1.5 cursor-pointer">
                <span className="flex items-center gap-2 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.75)' }}>
                  <input type="checkbox" checked={typeFilter.length === 0 || typeFilter.includes(t)} onChange={() => toggleType(t)} style={{ accentColor: GOLD }} />
                  {t}
                </span>
                <span className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.4)' }}>({counts.byType[t] || 0})</span>
              </label>
            ))}
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[11px] font-bold uppercase mb-3 tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.42)' }}>OCR Durumu</p>
            {([['all', 'Tümü', counts.total], ['ocr', 'Taranmış', counts.ocr], ['noocr', 'Taranmamış', counts.noocr]] as const).map(([key, label, n]) => (
              <label key={key} className="flex items-center justify-between py-1.5 cursor-pointer">
                <span className="flex items-center gap-2 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.75)' }}>
                  <input type="radio" name="ocr" checked={ocrFilter === key} onChange={() => setOcrFilter(key as any)} style={{ accentColor: GOLD }} />
                  {label}
                </span>
                <span className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.4)' }}>({n})</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
