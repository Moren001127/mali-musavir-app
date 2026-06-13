'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Inbox, RefreshCw, Loader2, Search, Users, Clock, ShieldCheck,
  Building2, FileText, CalendarClock, Download, ChevronDown, Activity, Eye,
} from 'lucide-react';
import { portalAutomationApi, type PortalDocument } from '@/lib/portal-automation';

const GOLD = '#d4b876';

function taxpayerName(tp?: PortalDocument['taxpayer']): string {
  if (!tp) return '—';
  if (tp.companyName) return tp.companyName;
  const ad = [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim();
  return ad || tp.taxNumber || '—';
}

// "20/05/2026 09:25:51" -> "20/05/2026 09:25"; ISO ise gun/ay/yil cevir.
function fmtTrDate(v: any): string {
  if (!v) return '—';
  const s = String(v).trim();
  const tr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (tr) return `${tr[1]}/${tr[2]}/${tr[3]} ${tr[4]}:${tr[5]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]} ${iso[4]}:${iso[5]}`;
  return s.slice(0, 16);
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border p-4" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="grid place-items-center rounded-lg flex-shrink-0" style={{ width: 30, height: 30, background: 'rgba(212,184,118,0.12)', color: GOLD }}>{icon}</span>
        <span className="text-[10px] uppercase font-bold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: '#fafaf9', lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.4)' }}>{sub}</div>}
    </div>
  );
}

export default function ETebligatModule() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [search, setSearch] = useState('');

  const docsQuery = useQuery({
    queryKey: ['etebligat-docs'],
    queryFn: () => portalAutomationApi.documents({ belgeTuru: 'E_TEBLIGAT', limit: 200 }),
    refetchInterval: 30_000,
  });
  const summaryQuery = useQuery({
    queryKey: ['etebligat-summary'],
    queryFn: () => portalAutomationApi.summary(),
    refetchInterval: 30_000,
  });
  // Vergi dairesi sifresi olan mukellefler (henuz tebligati olmasa da sorgulanabilsin).
  const credsQuery = useQuery({
    queryKey: ['etebligat-creds'],
    queryFn: () => portalAutomationApi.credentials(),
    staleTime: 5 * 60_000,
  });

  const docs = (docsQuery.data || []) as Array<PortalDocument & { raw?: any }>;
  const summary = summaryQuery.data;

  // Mukellef listesi: GIB_IVD sifresi olanlar + tebligati olanlar (birlesim).
  const mukellefler = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of credsQuery.data?.rows || []) {
      if (c.provider === 'GIB_IVD' && c.taxpayer?.id) {
        const t = c.taxpayer;
        const name = t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || t.taxNumber || '—';
        map.set(t.id, name);
      }
    }
    for (const d of docs) {
      if (d.taxpayerId && !map.has(d.taxpayerId)) map.set(d.taxpayerId, taxpayerName(d.taxpayer));
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [docs, credsQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return docs.filter((d) => {
      if (taxpayerId && d.taxpayerId !== taxpayerId) return false;
      if (!q) return true;
      const hay = [
        d.title,
        d.referenceNo,
        taxpayerName(d.taxpayer),
        d.raw?.kurumAciklama,
        d.raw?.altKurum,
      ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return hay.includes(q);
    });
  }, [docs, taxpayerId, search]);

  const sorgulaMut = useMutation({
    mutationFn: () => portalAutomationApi.manualRun({
      jobTypes: ['E_TEBLIGAT_CHECK'],
      taxpayerIds: taxpayerId ? [taxpayerId] : [],
      force: true,
    }),
    onSuccess: (d) => {
      const n = d.created?.length || 0;
      toast.success(n > 0 ? `${n} mükellef için e-Tebligat sorgusu kuyruğa alındı.` : (d.message || 'Sorgu kuyruğa alındı.'));
      if (d.skipped?.length) toast.info(`${d.skipped.length} mükellef atlandı (şifre yok / zaten kuyrukta).`);
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['etebligat-docs'] });
        qc.invalidateQueries({ queryKey: ['etebligat-summary'] });
      }, 1500);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Sorgu başlatılamadı'),
  });

  const openPdf = async (id: string) => {
    try {
      const { url } = await portalAutomationApi.documentViewUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Belge açılamadı');
    }
  };

  const cellBorder = '1px solid rgba(255,255,255,0.06)';
  const aktifIs = summary?.stats?.activeJobs ?? 0;

  return (
    <div className="space-y-4">
      {/* ── KPI ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Inbox size={16} />} label="Toplam e-Tebligat" value={String(docs.length)} sub="kayıtlı tebligat" />
        <Kpi icon={<Activity size={16} />} label="Bu hafta yeni" value={String(summary?.stats?.tebligat7d ?? 0)} sub="son 7 gün" />
        <Kpi icon={<ShieldCheck size={16} />} label="Şifreli mükellef" value={String(summary?.credentials?.eTebligatTaxpayerCount ?? 0)} sub="vergi dairesi şifresi" />
        <Kpi
          icon={<Clock size={16} />}
          label="Gece kontrolü"
          value={summary?.nightly?.time || '—'}
          sub={aktifIs > 0 ? `${aktifIs} iş çalışıyor` : (summary?.nightly?.active ? 'her gece otomatik' : 'kapalı')}
        />
      </div>

      {/* ── Aksiyon barı ── */}
      <div className="rounded-2xl border p-3.5 flex flex-wrap items-center gap-2.5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Belge no, kurum veya mükellef ara…"
            className="w-full h-[38px] pl-9 pr-3 rounded-[10px] text-[13px] outline-none border"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
        </div>
        <div className="relative">
          <select
            value={taxpayerId}
            onChange={(e) => setTaxpayerId(e.target.value)}
            className="h-[38px] pl-9 pr-8 rounded-[10px] text-[13px] outline-none border appearance-none min-w-[200px]"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            <option value="">Tüm mükellefler ({mukellefler.length})</option>
            {mukellefler.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <Users size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['etebligat-docs'] })}
          className="h-[38px] px-3 rounded-[10px] text-[13px] font-semibold flex items-center gap-1.5 border"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
        >
          <RefreshCw size={14} className={docsQuery.isFetching ? 'animate-spin' : ''} /> Yenile
        </button>
        <button
          onClick={() => sorgulaMut.mutate()}
          disabled={sorgulaMut.isPending}
          className="h-[38px] px-4 rounded-[10px] text-[13px] font-bold flex items-center gap-2 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#1a1410' }}
        >
          {sorgulaMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {taxpayerId ? 'Bu mükellefi sorgula' : 'Şimdi sorgula'}
        </button>
      </div>

      {/* ── Tablo ── */}
      <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(0,0,0,0.18)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse', minWidth: 980 }}>
            <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
              <tr style={{ color: 'rgba(250,250,249,0.55)' }}>
                {['Mükellef', 'Gönderen Kurum', 'Belge Türü', 'Belge No', 'Gönderim', 'Tebliğ', 'Okuma', 'Belge'].map((h, i) => (
                  <th key={h} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${i >= 4 ? 'text-center' : 'text-left'}`} style={{ borderBottom: cellBorder }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody style={{ color: 'rgba(250,250,249,0.88)' }}>
              {docsQuery.isLoading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}><Loader2 size={18} className="animate-spin inline" /> Yükleniyor…</td></tr>
              )}
              {!docsQuery.isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  <Inbox size={26} className="inline mb-2 opacity-50" /><br />
                  {docs.length === 0 ? 'Henüz e-Tebligat kaydı yok. "Şimdi sorgula" ile çekin ya da gece otomatik gelsin.' : 'Filtreye uyan tebligat yok.'}
                </td></tr>
              )}
              {filtered.map((d) => {
                const r = d.raw || {};
                return (
                  <tr key={d.id} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 align-top" style={{ borderBottom: cellBorder }}>
                      <div className="font-semibold" style={{ color: '#fafaf9' }}>{taxpayerName(d.taxpayer)}</div>
                      {d.taxpayer?.taxNumber && <div className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>{d.taxpayer.taxNumber}</div>}
                    </td>
                    <td className="px-3 py-2.5 align-top" style={{ borderBottom: cellBorder }}>
                      <div className="flex items-start gap-1.5">
                        <Building2 size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'rgba(250,250,249,0.4)' }} />
                        <div>
                          <div>{r.kurumAciklama || '—'}</div>
                          {r.altKurum && <div className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>{r.altKurum}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top" style={{ borderBottom: cellBorder }}>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}>
                        <FileText size={11} /> {d.title}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top font-mono text-[11.5px]" style={{ borderBottom: cellBorder, color: '#fafaf9' }}>{d.referenceNo || '—'}</td>
                    <td className="px-3 py-2.5 align-top text-center whitespace-nowrap tabular-nums" style={{ borderBottom: cellBorder, color: 'rgba(250,250,249,0.7)' }}>{fmtTrDate(r.gonderimZamani)}</td>
                    <td className="px-3 py-2.5 align-top text-center whitespace-nowrap tabular-nums" style={{ borderBottom: cellBorder, color: 'rgba(250,250,249,0.7)' }}>{fmtTrDate(r.tebligZamani)}</td>
                    <td className="px-3 py-2.5 align-top text-center whitespace-nowrap tabular-nums" style={{ borderBottom: cellBorder, color: 'rgba(250,250,249,0.7)' }}>{fmtTrDate(r.mukellefOkumaZamani)}</td>
                    <td className="px-3 py-2.5 align-top text-center" style={{ borderBottom: cellBorder }}>
                      {d.storageKey ? (
                        <button
                          onClick={() => openPdf(d.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold hover:brightness-110 transition"
                          style={{ background: 'rgba(95,207,142,0.1)', border: '1px solid rgba(95,207,142,0.3)', color: '#5fcf8e' }}
                        >
                          <Eye size={12} /> Görüntüle
                        </button>
                      ) : (
                        <span className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.35)' }}>bekliyor</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="px-3 py-2 text-[11px] flex items-center gap-2" style={{ borderTop: cellBorder, color: 'rgba(250,250,249,0.45)' }}>
            <CalendarClock size={12} /> {filtered.length} tebligat gösteriliyor{taxpayerId ? ' (mükellef süzüldü)' : ''}.
            {summary?.runner && <span className="ml-auto inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: summary.runner.enabled ? '#5fcf8e' : '#ef6b6b' }} /> Sunucu runner {summary.runner.enabled ? 'aktif' : 'kapalı'}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
