'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FileText, ChevronDown, Users, CalendarDays, Search,
  Cloud, Upload, RefreshCw, BarChart3, GitMerge, Inbox,
} from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName, taxpayerTaxNumber, taxpayerSearchMatch } from './_lib/taxpayer';
import { buildKdvClientReportHtml, fetchKdvClientReport } from './_lib/kdv-client-report';
import GenelBakisPanel from './_panels/GenelBakisPanel';
import EslestirmePanel from './_panels/EslestirmePanel';
import MukelleflerPanel from './_panels/MukelleflerPanel';
import EFaturaInboxPanel from './_panels/EFaturaInboxPanel';
import UploadDialog from './_dialogs/UploadDialog';
import EntegratorDialog from './_dialogs/EntegratorDialog';

/* Fatura İşleme Merkezi — v3 (AI Maliyet stili) */

const PERIODS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

const PIPELINE_STEPS: Array<{ id: number; label: string; desc: string }> = [
  { id: 1, label: 'Topla',         desc: 'Entegratörden çekilen' },
  { id: 2, label: 'OCR + İçerik',  desc: 'İşlenen belgeler' },
  { id: 3, label: 'Eşleştir',      desc: 'Kural atanan' },
  { id: 4, label: 'Onay',          desc: 'Mali müşavir onayi' },
  { id: 5, label: "Luca'ya Aktar", desc: 'Aktarilan' },
  { id: 6, label: 'Arşiv',         desc: 'Arşivlenen' },
];

type TabId = 'genel' | 'eslestirme' | 'efatura-inbox' | 'mukellefler';

export default function FaturaMerkeziPage() {
  const [tab, setTab] = useState<TabId>('genel');
  const [taxpayerId, setTaxpayerId] = useState<string | undefined>(undefined);
  const [period, setPeriod] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showTaxpayerPicker, setShowTaxpayerPicker] = useState(false);
  const [taxpayerSearch, setTaxpayerSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showEntegrator, setShowEntegrator] = useState(false);
  const [kdvReportLoading, setKdvReportLoading] = useState(false);

  /* Mükellef listesi */
  const taxpayersQ = useQuery({
    queryKey: ['fatura-merkezi', 'taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });
  const taxpayers: Array<any> = Array.isArray(taxpayersQ.data)
    ? taxpayersQ.data
    : (taxpayersQ.data?.items || []);

  const filteredTaxpayers = useMemo(() => {
    if (!taxpayerSearch) return taxpayers;
    return taxpayers.filter((t) => taxpayerSearchMatch(t, taxpayerSearch));
  }, [taxpayers, taxpayerSearch]);
  const selectedTaxpayer: any = taxpayers.find((t) => t.id === taxpayerId) || null;

  /* Dashboard özet */
  const dashQ = useQuery({
    queryKey: ['fatura-merkezi', 'dashboard', taxpayerId, period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/dashboard', { params: { taxpayerId, period } })
        .then((r) => r.data)
        .catch(() => ({})),
  });
  const dash = dashQ.data || {};
  const [y, m] = period.split('-');

  const pipelineCounts: number[] = [
    dash.collected ?? 0, dash.ocr ?? 0, dash.matched ?? 0,
    dash.pending ?? 0, dash.posted ?? 0, dash.archived ?? 0,
  ];

  const refresh = () => { taxpayersQ.refetch(); dashQ.refetch(); };

  const handleKdvOutput = async () => {
    if (!taxpayerId) { toast.error('Önce mükellef seçin'); return; }
    setKdvReportLoading(true);
    try {
      const report = await fetchKdvClientReport({ taxpayerId, period });
      const win = window.open('', '_blank', 'width=980,height=760');
      if (!win) { toast.error('Çıktı penceresi açılamadı'); return; }
      win.document.open();
      win.document.write(buildKdvClientReportHtml(report, `${window.location.origin}/brand/moren-logo-gold.png`));
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 750);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'KDV çıktısı hazırlanamadı');
    } finally {
      setKdvReportLoading(false);
    }
  };

  const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: 'genel',          label: 'Genel Bakış',       icon: <BarChart3 size={15} /> },
    { id: 'eslestirme',     label: 'Eşleştirme & Onay', icon: <GitMerge size={15} /> },
    { id: 'efatura-inbox',  label: 'E-Fatura Kutusu',   icon: <Inbox size={15} /> },
    { id: 'mukellefler',    label: 'Mükellefler',        icon: <Users size={15} /> },
  ];

  const isIsletme = /ISLETME/i.test(selectedTaxpayer?.defterTuru || '');

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0f0d0b', color: '#fafaf9' }}>

      {/* Gokkusagi seridi */}
      <div style={{ height: 4, background: 'linear-gradient(90deg,#d4b876,#fb923c,#f472b6,#a855f7,#60a5fa,#22d3ee,#4ade80)', flexShrink: 0 }} />

      {/* Hero baslik */}
      <div
        style={{
          background: 'radial-gradient(120% 140% at 0% 0%, rgba(45,212,191,0.14) 0%, transparent 45%), #0f0d0b',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          padding: '20px 28px 16px',
        }}
      >
        {/* Baslik + aksiyon butonlari */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div style={{ background: 'linear-gradient(135deg, #2dd4bf, #22d3ee)', borderRadius: 13, width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileText size={20} color="#0f0d0b" strokeWidth={2.2} />
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fafaf9', letterSpacing: -0.5, lineHeight: 1.2 }}>
                Fatura {'İ'}{'ş'}leme Merkezi
              </h1>
              <div style={{ fontSize: 12, color: 'rgba(250,250,249,0.5)', marginTop: 2 }}>Moren Mali {'M'}{'ü'}{'ş'}avirlik</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleKdvOutput} disabled={kdvReportLoading || !taxpayerId}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.3)', color: '#d4b876', fontSize: 13, fontWeight: 600, cursor: kdvReportLoading || !taxpayerId ? 'not-allowed' : 'pointer', opacity: kdvReportLoading || !taxpayerId ? 0.5 : 1 }}>
              <FileText size={14} />KDV Ciktisi
            </button>
            <button type="button" onClick={() => setShowEntegrator(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              <Cloud size={14} />Entegrat{'ö'}rden {'Ç'}ek
            </button>
            <button type="button" onClick={() => setShowUpload(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, background: 'linear-gradient(135deg, #2dd4bf, #22d3ee)', border: 'none', color: '#0f0d0b', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <Upload size={14} />Belge Y{'ü'}kle
            </button>
            <button type="button" onClick={refresh} disabled={taxpayersQ.isFetching || dashQ.isFetching}
              style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.58)', cursor: taxpayersQ.isFetching || dashQ.isFetching ? 'not-allowed' : 'pointer' }}>
              <RefreshCw size={14} className={taxpayersQ.isFetching || dashQ.isFetching ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Alt kontrol */}
        <div className="flex items-center gap-3 flex-wrap">
          <div style={{ position: 'relative' }}>
            <button type="button" onClick={() => setShowTaxpayerPicker((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 9, background: '#15110d', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', fontSize: 13, fontWeight: 500, minWidth: 260, cursor: 'pointer' }}>
              <Users size={14} style={{ color: 'rgba(250,250,249,0.58)' }} />
              <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedTaxpayer ? taxpayerName(selectedTaxpayer) : `T{'ü'}m M{'ü'}kellefler · ${taxpayers.length}`}
              </span>
              <ChevronDown size={13} style={{ color: 'rgba(250,250,249,0.4)', flexShrink: 0 }} />
            </button>
            {showTaxpayerPicker && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50, background: '#15110d', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, boxShadow: '0 20px 48px rgba(0,0,0,0.6)', width: 360, maxHeight: 460, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                    <Search size={13} style={{ color: 'rgba(250,250,249,0.4)' }} />
                    <input autoFocus placeholder="Ara" value={taxpayerSearch} onChange={(e) => setTaxpayerSearch(e.target.value)}
                      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: '#fafaf9' }} />
                  </div>
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  <button type="button" onClick={() => { setTaxpayerId(undefined); setShowTaxpayerPicker(false); setTaxpayerSearch(''); }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', fontSize: 13, background: !taxpayerId ? 'rgba(45,212,191,0.1)' : 'transparent', color: !taxpayerId ? '#2dd4bf' : '#fafaf9', fontWeight: !taxpayerId ? 600 : 500, cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span>T{'ü'}m m{'ü'}kellefler {'·'} {taxpayers.length}</span>
                    {!taxpayerId && <span style={{ color: '#2dd4bf' }}>{'✓'}</span>}
                  </button>
                  {filteredTaxpayers.map((t: any) => {
                    const sel = t.id === taxpayerId;
                    return (
                      <button key={t.id} type="button" onClick={() => { setTaxpayerId(t.id); setShowTaxpayerPicker(false); setTaxpayerSearch(''); }}
                        style={{ width: '100%', display: 'block', padding: '8px 12px', textAlign: 'left', fontSize: 13, background: sel ? 'rgba(45,212,191,0.1)' : 'transparent', color: sel ? '#2dd4bf' : '#fafaf9', cursor: 'pointer', border: 'none' }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{taxpayerName(t)}</div>
                        <div style={{ fontSize: 11, color: 'rgba(250,250,249,0.45)', marginTop: 1 }}>{taxpayerTaxNumber(t)}</div>
                      </button>
                    );
                  })}
                  {filteredTaxpayers.length === 0 && (
                    <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 13, color: 'rgba(250,250,249,0.4)' }}>Sonuc yok</div>
                  )}
                </div>
                <div style={{ padding: '6px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 10.5, color: 'rgba(250,250,249,0.3)', textAlign: 'right' }}>
                  {filteredTaxpayers.length} / {taxpayers.length}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 9, background: '#15110d', border: '1px solid rgba(255,255,255,0.08)' }}>
            <CalendarDays size={14} style={{ color: 'rgba(250,250,249,0.4)' }} />
            <select value={period} onChange={(e) => setPeriod(e.target.value)}
              style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontWeight: 500, color: '#fafaf9', cursor: 'pointer' }}>
              {Array.from({ length: 12 }, (_, i) => i).map((idx) => {
                const monthStr = String(idx + 1).padStart(2, '0');
                const val = `${y}-${monthStr}`;
                return (<option key={val} value={val} style={{ background: '#15110d', color: '#fafaf9' }}>{PERIODS[idx]} {y}</option>);
              })}
            </select>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>{'·'}</span>
            <select value={y} onChange={(e) => setPeriod(`${e.target.value}-${m}`)}
              style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontWeight: 500, color: '#fafaf9', cursor: 'pointer' }}>
              {[2024, 2025, 2026, 2027].map((yr) => (<option key={yr} value={yr} style={{ background: '#15110d', color: '#fafaf9' }}>{yr}</option>))}
            </select>
          </div>

          {selectedTaxpayer && (
            <div style={{ padding: '5px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, background: isIsletme ? 'rgba(56,189,248,0.12)' : 'rgba(167,139,250,0.12)', color: isIsletme ? '#7dd3fc' : '#c4b5fd', border: `1px solid ${isIsletme ? 'rgba(56,189,248,0.3)' : 'rgba(167,139,250,0.3)'}` }}>
              {isIsletme ? 'Isletme Defteri' : 'Bilanco Esasi'}
            </div>
          )}
        </div>

        {/* Pipeline strip */}
        <div style={{ display: 'flex', alignItems: 'stretch', marginTop: 20, background: '#15110d', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          {PIPELINE_STEPS.map((step, idx) => {
            const count = pipelineCounts[idx];
            const isActive = count > 0;
            const isLast = idx === PIPELINE_STEPS.length - 1;
            return (
              <div key={step.id} style={{ flex: 1, padding: '12px 14px', borderRight: isLast ? 'none' : '1px solid rgba(255,255,255,0.06)', background: isActive ? 'rgba(45,212,191,0.06)' : 'transparent' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: isActive ? '#2dd4bf' : 'rgba(250,250,249,0.2)', lineHeight: 1.1 }}>{count}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? '#fafaf9' : 'rgba(250,250,249,0.35)', marginTop: 2 }}>{step.id}. {step.label}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(250,250,249,0.3)', marginTop: 1 }}>{step.desc}</div>
              </div>
            );
          })}
        </div>

        {/* Sekmeler */}
        <div style={{ display: 'flex', gap: 4, marginTop: 16 }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: active ? 600 : 500, background: active ? '#1b1510' : 'transparent', color: active ? '#2dd4bf' : 'rgba(250,250,249,0.55)', border: active ? '1px solid rgba(45,212,191,0.25)' : '1px solid transparent', cursor: 'pointer' }}>
                {t.icon}{t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Icerik */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'genel' && (
          <GenelBakisPanel taxpayerId={taxpayerId} period={period} taxpayers={taxpayers} dashData={dash} dashLoading={dashQ.isLoading} />
        )}
        {tab === 'eslestirme' && (
          <EslestirmePanel taxpayerId={taxpayerId} period={period} taxpayers={taxpayers} />
        )}
        {tab === 'efatura-inbox' && (
          <EFaturaInboxPanel taxpayerId={taxpayerId} period={period} />
        )}
        {tab === 'mukellefler' && (
          <MukelleflerPanel taxpayers={taxpayers} loading={taxpayersQ.isLoading} period={period} onRefresh={refresh} onSelectTaxpayer={(id) => { setTaxpayerId(id); setTab('eslestirme'); }} />
        )}
      </div>

      {showUpload && selectedTaxpayer && (
        <UploadDialog taxpayer={selectedTaxpayer} period={period} onClose={() => setShowUpload(false)} />
      )}
      {showEntegrator && selectedTaxpayer && (
        <EntegratorDialog taxpayer={selectedTaxpayer} onClose={() => setShowEntegrator(false)} />
      )}
      {showTaxpayerPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowTaxpayerPicker(false)} />
      )}
    </div>
  );
}
