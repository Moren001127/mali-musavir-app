'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FileText, ChevronDown, Users, CalendarDays, Search,
  Cloud, Upload, RefreshCw, BarChart3, GitMerge, Inbox,
  Database,
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

const PERIODS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

const PIPELINE_STEPS = [
  { id: 1, label: 'Topla',        key: 'collected' },
  { id: 2, label: 'OCR',          key: 'ocr' },
  { id: 3, label: 'Eşleştir',     key: 'matched' },
  { id: 4, label: 'Onay',         key: 'pending' },
  { id: 5, label: "Luca'ya Aktar",key: 'posted' },
  { id: 6, label: 'Arşiv',        key: 'archived' },
];

type TabId = 'genel' | 'eslestirme' | 'efatura-inbox' | 'mukellefler';

const NAV: Array<{ id: TabId; label: string; Icon: any; color: string }> = [
  { id: 'genel',         label: 'Genel Bakış',        Icon: BarChart3, color: '#2dd4bf' },
  { id: 'eslestirme',    label: 'Eşleştirme & Onay',  Icon: GitMerge,  color: '#a78bfa' },
  { id: 'efatura-inbox', label: 'E-Fatura Kutusu',     Icon: Inbox,     color: '#60a5fa' },
  { id: 'mukellefler',   label: 'Mükellefler',          Icon: Users,     color: '#4ade80' },
];

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
  const qc = useQueryClient();
  const [mihsapLoading, setMihsapLoading] = useState(false);

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

  const dashQ = useQuery({
    queryKey: ['fatura-merkezi', 'dashboard', taxpayerId, period],
    queryFn: () =>
      api.get('/fatura-muhasebelestirme/dashboard', { params: { taxpayerId, period } })
        .then((r) => r.data).catch(() => ({})),
  });
  const dash = dashQ.data || {};
  const [y, m] = period.split('-');

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

  const handleMihsapCek = async () => {
    if (!taxpayerId) { toast.error('Önce mükellef seçin'); return; }
    setMihsapLoading(true);
    try {
      const res = await api.post('/fatura-muhasebelestirme/import-from-mihsap', {
        taxpayerId,
        donem: period,
      });
      const d = res.data;
      if (d.created > 0) {
        toast.success(`Mihsap'tan ${d.scanned} fatura tarandı, ${d.created} yeni belge aktarıldı`);
      } else if (d.skipped > 0 && d.created === 0) {
        toast.info(`${d.scanned} fatura tarandı, tümü zaten aktarılmış`);
      } else if (d.scanned === 0) {
        toast.info('Mihsap\'ta bu dönem için bekleyen fatura bulunamadı');
      } else {
        toast.warning(`${d.scanned} tarandı, ${d.failed} hata oluştu`);
      }
      qc.invalidateQueries({ queryKey: ['fatura-merkezi'] });
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Mihsap bağlantı hatası';
      toast.error(msg);
    } finally {
      setMihsapLoading(false);
    }
  };

  const isIsletme = /ISLETME/i.test(selectedTaxpayer?.defterTuru || '');

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0f0d0b', color: '#fafaf9' }}>

      {/* Gökkuşağı şeridi */}
      <div style={{ height: 3, background: 'linear-gradient(90deg,#d4b876,#fb923c,#f472b6,#a855f7,#60a5fa,#22d3ee,#4ade80)', flexShrink: 0 }} />

      {/* Üst bar — ince, tüm kontroller */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#0f0d0b', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', gap: 10 }}>

        {/* Logo + başlık */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginRight: 8 }}>
          <div style={{ background: 'linear-gradient(135deg,#2dd4bf,#22d3ee)', borderRadius: 9, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <FileText size={15} color="#0f0d0b" strokeWidth={2.3} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fafaf9', whiteSpace: 'nowrap', letterSpacing: -0.3 }}>Fatura Merkezi</span>
        </div>

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        {/* Mükellef seçici */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" onClick={() => setShowTaxpayerPicker((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 8, background: '#15110d', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', fontSize: 13, fontWeight: 500, minWidth: 220, cursor: 'pointer', height: 34 }}>
            <Users size={13} style={{ color: 'rgba(250,250,249,0.5)', flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedTaxpayer ? taxpayerName(selectedTaxpayer) : `Tüm Mükellefler · ${taxpayers.length}`}
            </span>
            <ChevronDown size={12} style={{ color: 'rgba(250,250,249,0.35)', flexShrink: 0 }} />
          </button>
          {showTaxpayerPicker && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50, background: '#15110d', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, boxShadow: '0 20px 48px rgba(0,0,0,0.7)', width: 360, maxHeight: 420, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px', borderRadius: 7, background: 'rgba(255,255,255,0.04)' }}>
                  <Search size={12} style={{ color: 'rgba(250,250,249,0.4)', flexShrink: 0 }} />
                  <input autoFocus placeholder="Ara" value={taxpayerSearch} onChange={(e) => setTaxpayerSearch(e.target.value)}
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: '#fafaf9' }} />
                </div>
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                <button type="button" onClick={() => { setTaxpayerId(undefined); setShowTaxpayerPicker(false); setTaxpayerSearch(''); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', fontSize: 13, background: !taxpayerId ? 'rgba(45,212,191,0.1)' : 'transparent', color: !taxpayerId ? '#2dd4bf' : '#fafaf9', fontWeight: !taxpayerId ? 600 : 500, cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                  <span>Tüm mükellefler · {taxpayers.length}</span>
                  {!taxpayerId && <span style={{ color: '#2dd4bf' }}>✓</span>}
                </button>
                {filteredTaxpayers.map((t: any) => {
                  const sel = t.id === taxpayerId;
                  return (
                    <button key={t.id} type="button" onClick={() => { setTaxpayerId(t.id); setShowTaxpayerPicker(false); setTaxpayerSearch(''); }}
                      style={{ width: '100%', display: 'block', padding: '7px 12px', textAlign: 'left', fontSize: 13, background: sel ? 'rgba(45,212,191,0.1)' : 'transparent', color: sel ? '#2dd4bf' : '#fafaf9', cursor: 'pointer', border: 'none' }}>
                      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{taxpayerName(t)}</div>
                      <div style={{ fontSize: 11, color: 'rgba(250,250,249,0.4)', marginTop: 1 }}>{taxpayerTaxNumber(t)}</div>
                    </button>
                  );
                })}
                {filteredTaxpayers.length === 0 && (
                  <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 13, color: 'rgba(250,250,249,0.4)' }}>Sonuç yok</div>
                )}
              </div>
              <div style={{ padding: '5px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 10.5, color: 'rgba(250,250,249,0.3)', textAlign: 'right' }}>
                {filteredTaxpayers.length} / {taxpayers.length}
              </div>
            </div>
          )}
        </div>

        {/* Dönem */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, background: '#15110d', border: '1px solid rgba(255,255,255,0.08)', height: 34, flexShrink: 0 }}>
          <CalendarDays size={13} style={{ color: 'rgba(250,250,249,0.4)', flexShrink: 0 }} />
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontWeight: 500, color: '#fafaf9', cursor: 'pointer' }}>
            {Array.from({ length: 12 }, (_, i) => i).map((idx) => {
              const monthStr = String(idx + 1).padStart(2, '0');
              const val = `${y}-${monthStr}`;
              return (<option key={val} value={val} style={{ background: '#15110d', color: '#fafaf9' }}>{PERIODS[idx]} {y}</option>);
            })}
          </select>
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 12 }}>·</span>
          <select value={y} onChange={(e) => setPeriod(`${e.target.value}-${m}`)}
            style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontWeight: 500, color: '#fafaf9', cursor: 'pointer' }}>
            {[2024, 2025, 2026, 2027].map((yr) => (<option key={yr} value={yr} style={{ background: '#15110d', color: '#fafaf9' }}>{yr}</option>))}
          </select>
        </div>

        {selectedTaxpayer && (
          <div style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: isIsletme ? 'rgba(56,189,248,0.12)' : 'rgba(167,139,250,0.12)', color: isIsletme ? '#7dd3fc' : '#c4b5fd', border: `1px solid ${isIsletme ? 'rgba(56,189,248,0.25)' : 'rgba(167,139,250,0.25)'}`, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {isIsletme ? 'İşletme' : 'Bilanço'}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Aksiyon butonları */}
        <button type="button" onClick={handleMihsapCek} disabled={mihsapLoading || !taxpayerId}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.25)', color: '#2dd4bf', fontSize: 12, fontWeight: 600, cursor: mihsapLoading || !taxpayerId ? 'not-allowed' : 'pointer', opacity: !taxpayerId ? 0.45 : 1, height: 34, flexShrink: 0 }}>
          {mihsapLoading ? <RefreshCw size={13} className="animate-spin" /> : <Database size={13} />}
          Mihsap'tan Çek
        </button>
        <button type="button" onClick={handleKdvOutput} disabled={kdvReportLoading || !taxpayerId}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.25)', color: '#d4b876', fontSize: 12, fontWeight: 600, cursor: kdvReportLoading || !taxpayerId ? 'not-allowed' : 'pointer', opacity: !taxpayerId ? 0.45 : 1, height: 34, flexShrink: 0 }}>
          <FileText size={13} />KDV Çıktısı
        </button>
        <button type="button" onClick={() => setShowEntegrator(true)} disabled={!selectedTaxpayer}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#fafaf9', fontSize: 12, fontWeight: 500, cursor: !selectedTaxpayer ? 'not-allowed' : 'pointer', opacity: !selectedTaxpayer ? 0.45 : 1, height: 34, flexShrink: 0 }}>
          <Cloud size={13} />Entegratörden Çek
        </button>
        <button type="button" onClick={() => setShowUpload(true)} disabled={!selectedTaxpayer}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, background: 'linear-gradient(135deg,#2dd4bf,#22d3ee)', border: 'none', color: '#0f0d0b', fontSize: 12, fontWeight: 700, cursor: !selectedTaxpayer ? 'not-allowed' : 'pointer', opacity: !selectedTaxpayer ? 0.6 : 1, height: 34, flexShrink: 0 }}>
          <Upload size={13} />Belge Yükle
        </button>
        <button type="button" onClick={refresh} disabled={taxpayersQ.isFetching || dashQ.isFetching}
          style={{ display: 'flex', alignItems: 'center', padding: '5px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.5)', cursor: 'pointer', height: 34, flexShrink: 0 }}>
          <RefreshCw size={13} className={taxpayersQ.isFetching || dashQ.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Gövde: sidebar + içerik */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>

        {/* Sol kenar çubuğu */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.07)', background: '#0c0a08', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

          {/* Navigasyon */}
          <div style={{ padding: '12px 8px 8px' }}>
            {NAV.map(({ id, label, Icon, color }) => {
              const active = tab === id;
              return (
                <button key={id} type="button" onClick={() => setTab(id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, marginBottom: 2, background: active ? `${color}14` : 'transparent', color: active ? color : 'rgba(250,250,249,0.55)', fontSize: 13, fontWeight: active ? 600 : 400, border: active ? `1px solid ${color}30` : '1px solid transparent', cursor: 'pointer', textAlign: 'left' }}>
                  <Icon size={15} style={{ flexShrink: 0 }} />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Ayraç */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 12px' }} />

          {/* Pipeline istatistikleri */}
          <div style={{ padding: '8px 12px', flex: 1 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(250,250,249,0.3)', letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase' }}>
              {PERIODS[parseInt(m) - 1]} {y}
            </div>
            {PIPELINE_STEPS.map((step) => {
              const count: number = (dash as any)[step.key] ?? 0;
              const isActive = count > 0;
              return (
                <div key={step.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 12, color: isActive ? 'rgba(250,250,249,0.7)' : 'rgba(250,250,249,0.3)' }}>{step.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? '#2dd4bf' : 'rgba(250,250,249,0.18)', minWidth: 24, textAlign: 'right' }}>{count}</span>
                </div>
              );
            })}
          </div>

        </div>

        {/* Ana içerik */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
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
