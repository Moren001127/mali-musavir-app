'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Clock,
  Download,
  FileCheck2,
  Loader2,
  Mailbox,
  Play,
  RefreshCw,
  ServerCog,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  PortalJob,
  PortalJobType,
  PORTAL_JOB_LABEL,
  portalAutomationApi,
} from '@/lib/portal-automation';
import TaxpayerSelect, { TaxpayerLite } from '@/components/ui/TaxpayerSelect';

const GOLD = '#d4b876';
const LINE = 'rgba(255,255,255,0.07)';

type Focus = 'all' | 'beyanname' | 'tebligat' | 'sgk';

const SGK_TYPES: PortalJobType[] = [
  'SGK_HIZMET_LISTESI',
  'SGK_TAHAKKUK',
  'SGK_ISE_GIRIS_CIKIS',
  'SGK_ISGOREMEZLIK',
];

function taxpayerName(t?: TaxpayerLite | null) {
  if (!t) return 'Tum ofis';
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || t.taxNumber || 'Mukellef';
}

function fmtDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusStyle(status: PortalJob['status']) {
  switch (status) {
    case 'done': return { label: 'Tamam', color: '#22c55e', bg: 'rgba(34,197,94,.12)' };
    case 'running': return { label: 'Calisiyor', color: '#38bdf8', bg: 'rgba(56,189,248,.12)' };
    case 'failed': return { label: 'Hata', color: '#ef4444', bg: 'rgba(239,68,68,.12)' };
    case 'cancelled': return { label: 'Iptal', color: '#94a3b8', bg: 'rgba(148,163,184,.12)' };
    default: return { label: 'Kuyrukta', color: '#f59e0b', bg: 'rgba(245,158,11,.12)' };
  }
}

export default function PortalAutomationPanel({ focus = 'all' }: { focus?: Focus }) {
  const qc = useQueryClient();
  const [selectedTaxpayer, setSelectedTaxpayer] = useState('__ALL__');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['portal-automation-summary'],
    queryFn: () => portalAutomationApi.summary(),
    refetchInterval: 8000,
  });

  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers', 'portal-automation'],
    queryFn: () => api.get('/taxpayers').then((r) => (r.data?.data ?? r.data ?? []) as TaxpayerLite[]),
  });

  const targetIds = useMemo(
    () => (selectedTaxpayer === '__ALL__' ? [] : [selectedTaxpayer]),
    [selectedTaxpayer],
  );

  const runMut = useMutation({
    mutationFn: (body: Parameters<typeof portalAutomationApi.manualRun>[0]) => portalAutomationApi.manualRun(body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      qc.invalidateQueries({ queryKey: ['portal-automation-jobs'] });
      const skipped = res.skipped?.length || 0;
      if (res.created.length) toast.success(`${res.created.length} is kuyruga alindi${res.runnerWake ? ' ve sunucu runner uyandirildi' : ''}`);
      if (skipped) toast.warning(`${skipped} is atlandi; sifre veya tekrar kaydi eksik olabilir`);
      if (!res.created.length && !skipped) toast.info('Baslatilacak is bulunamadi');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Is baslatilamadi'),
  });

  const nightlyMut = useMutation({
    mutationFn: () => portalAutomationApi.nightlyRunNow(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      toast.success(`${res.created.length} gece isi kuyruga alindi${res.runnerWake ? ' ve sunucu runner uyandirildi' : ''}`);
      if (res.skipped.length) toast.warning(`${res.skipped.length} is atlandi`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Gece akisi baslatilamadi'),
  });

  const showBeyanname = focus === 'all' || focus === 'beyanname';
  const showTebligat = focus === 'all' || focus === 'tebligat';
  const showSgk = focus === 'all' || focus === 'sgk';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Metric icon={Clock} label="Gece akisi" value={summary?.nightly?.time || '02:15'} sub="Her gece otomatik" />
        <Metric icon={ServerCog} label="Sunucu runner" value={summary?.runner?.enabled ? 'Aktif' : 'Pasif'} sub={summary?.runner?.includeNightly ? 'Gece + manuel' : 'Manuel'} danger={!summary?.runner?.enabled} />
        <Metric icon={FileCheck2} label="e-Beyanname" value={summary?.credentials.eBeyannameReady ? 'Hazir' : 'Sifre yok'} sub="Mali musavir hesabi" danger={!summary?.credentials.eBeyannameReady} />
        <Metric icon={Mailbox} label="e-Tebligat" value={summary?.credentials.eTebligatTaxpayerCount || 0} sub="Sifreli mukellef" />
        <Metric icon={ShieldCheck} label="SGK" value={summary?.credentials.sgkTaxpayerCount || 0} sub="Sifreli mukellef" />
        <Metric icon={RefreshCw} label="Aktif is" value={summary?.stats.activeJobs || 0} sub="Kuyruk / calisan" />
      </div>

      <div
        className="rounded-xl p-4 space-y-4"
        style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${LINE}` }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>Portal Otomasyon Merkezi</h2>
            <p className="text-[12.5px] mt-1 max-w-3xl" style={{ color: 'rgba(250,250,249,.52)' }}>
              e-Beyanname, e-Tebligat ve SGK indirmeleri ayni kuyrukta izlenir. Gece calisir; gerekirse buradan manuel tetiklenir.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Link
              href="/panel/ayarlar"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[12.5px] font-semibold"
              style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${LINE}`, color: 'rgba(250,250,249,.78)' }}
            >
              Mali musavir sifresi
            </Link>
            {selectedTaxpayer !== '__ALL__' && (
              <Link
                href={`/panel/mukellefler/${selectedTaxpayer}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[12.5px] font-semibold"
                style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${LINE}`, color: 'rgba(250,250,249,.78)' }}
              >
                Mukellef sifreleri
              </Link>
            )}
            <button
              type="button"
              disabled={nightlyMut.isPending}
              onClick={() => nightlyMut.mutate()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[12.5px] font-bold disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
            >
              {nightlyMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Gece akisini simdi calistir
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(240px,360px),1fr] gap-3">
          <div>
            <label className="block text-[11px] uppercase font-semibold tracking-[.12em] mb-1.5" style={{ color: 'rgba(250,250,249,.45)' }}>
              Hedef mukellef
            </label>
            <TaxpayerSelect
              taxpayers={taxpayers}
              value={selectedTaxpayer}
              onChange={setSelectedTaxpayer}
              allLabel="Tum uygun mukellefler"
              allValue="__ALL__"
            />
          </div>

          <div className="grid sm:grid-cols-3 gap-2">
            {showBeyanname && (
              <ActionButton
                icon={Download}
                title="Onceki gun beyannameleri"
                desc="Mali musavir e-Beyanname sifresi ile indir"
                loading={runMut.isPending}
                onClick={() => runMut.mutate({ scope: 'beyanname', taxpayerIds: [] })}
              />
            )}
            {showTebligat && (
              <ActionButton
                icon={Mailbox}
                title="e-Tebligat kontrol"
                desc="Vergi dairesi sifresi olanlari sorgula"
                loading={runMut.isPending}
                onClick={() => runMut.mutate({ scope: 'tebligat', taxpayerIds: targetIds })}
              />
            )}
            {showSgk && (
              <ActionButton
                icon={ShieldCheck}
                title="SGK paketi"
                desc="Hizmet, tahakkuk, giris/cikis, rapor"
                loading={runMut.isPending}
                onClick={() => runMut.mutate({ scope: 'sgk', taxpayerIds: targetIds, jobTypes: SGK_TYPES })}
              />
            )}
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <JobList jobs={summary?.latestJobs || []} isLoading={isLoading} />
        <DocumentList docs={summary?.latestDocuments || []} />
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, danger }: { icon: any; label: string; value: string | number; sub: string; danger?: boolean }) {
  return (
    <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,.025)', border: `1px solid ${danger ? 'rgba(239,68,68,.25)' : LINE}` }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: danger ? 'rgba(239,68,68,.10)' : 'rgba(212,184,118,.10)', color: danger ? '#ef4444' : GOLD }}>
        <Icon size={17} />
      </div>
      <div className="min-w-0">
        <div className="text-[10.5px] uppercase tracking-[.12em]" style={{ color: 'rgba(250,250,249,.45)' }}>{label}</div>
        <div className="text-[17px] font-semibold tabular-nums truncate" style={{ color: danger ? '#fca5a5' : '#fafaf9' }}>{value}</div>
        <div className="text-[11px] truncate" style={{ color: 'rgba(250,250,249,.42)' }}>{sub}</div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, title, desc, loading, onClick }: { icon: any; title: string; desc: string; loading?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className="text-left rounded-xl p-3 transition-all disabled:opacity-50"
      style={{ background: 'rgba(255,255,255,.035)', border: `1px solid ${LINE}`, color: '#fafaf9' }}
    >
      <div className="flex items-center gap-2 mb-2">
        {loading ? <Loader2 size={16} className="animate-spin" style={{ color: GOLD }} /> : <Icon size={16} style={{ color: GOLD }} />}
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      <p className="text-[11.5px] leading-5" style={{ color: 'rgba(250,250,249,.48)' }}>{desc}</p>
    </button>
  );
}

function JobList({ jobs, isLoading }: { jobs: PortalJob[]; isLoading: boolean }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,.025)', border: `1px solid ${LINE}` }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${LINE}` }}>
        <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Son isler</h3>
        {isLoading && <Loader2 size={14} className="animate-spin" style={{ color: GOLD }} />}
      </div>
      <div className="divide-y" style={{ borderColor: LINE }}>
        {jobs.length === 0 && (
          <div className="p-6 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,.45)' }}>
            Henuz portal otomasyon isi yok.
          </div>
        )}
        {jobs.map((job) => {
          const st = statusStyle(job.status);
          return (
            <div key={job.id} className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>
                  {PORTAL_JOB_LABEL[job.jobType] || job.jobType}
                </div>
                <div className="text-[11px] mt-1 truncate" style={{ color: 'rgba(250,250,249,.45)' }}>
                  {taxpayerName(job.taxpayer)} · {job.source === 'nightly' ? 'gece' : 'manuel'} · {fmtDate(job.createdAt)}
                </div>
                {job.errorMessage && (
                  <div className="text-[11px] mt-1 flex items-center gap-1.5" style={{ color: '#fca5a5' }}>
                    <AlertCircle size={12} /> {job.errorMessage.slice(0, 120)}
                  </div>
                )}
              </div>
              <span className="text-[10.5px] font-bold px-2 py-1 rounded-md whitespace-nowrap" style={{ color: st.color, background: st.bg }}>
                {st.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DocumentList({ docs }: { docs: any[] }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,.025)', border: `1px solid ${LINE}` }}>
      <div className="px-4 py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Son indirilen belgeler</h3>
      </div>
      <div className="divide-y" style={{ borderColor: LINE }}>
        {docs.length === 0 && (
          <div className="p-6 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,.45)' }}>
            Henuz indirilen e-Tebligat veya SGK belgesi yok.
          </div>
        )}
        {docs.map((doc) => (
          <div key={doc.id} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>{doc.title}</div>
              <div className="text-[11px] mt-1 truncate" style={{ color: 'rgba(250,250,249,.45)' }}>
                {taxpayerName(doc.taxpayer)} · {doc.belgeTuru} · {fmtDate(doc.createdAt)}
              </div>
            </div>
            {doc.documentId ? (
              <a href={`/panel/evraklar`} className="text-[11px] font-semibold" style={{ color: GOLD }}>
                Evrakta
              </a>
            ) : (
              <span className="text-[11px]" style={{ color: 'rgba(250,250,249,.35)' }}>metadata</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
