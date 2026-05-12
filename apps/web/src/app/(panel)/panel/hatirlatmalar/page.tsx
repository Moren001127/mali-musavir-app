'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bell,
  Calendar,
  CheckCircle2,
  FileInput,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';
const AYLAR = ['Ocak', 'Subat', 'Mart', 'Nisan', 'Mayis', 'Haziran', 'Temmuz', 'Agustos', 'Eylul', 'Ekim', 'Kasim', 'Aralik'];

type ReminderRow = {
  taxpayerId: string;
  ad: string;
  phone?: string | null;
  phones?: string[];
  bakiye?: number;
  evrakTeslimGunu?: number;
  sonHatirlatmaTarihi?: string | null;
  gonderilebilir?: boolean;
  atlamaSebebi?: string | null;
  mesaj?: string;
};

type PreviewData = {
  donem: string;
  whatsapp?: { ready?: boolean; error?: string; provider?: string; templateName?: string | null };
  gonderilecek: number;
  atlanacak: number;
  aday?: number;
  rows: ReminderRow[];
};

export default function HatirlatmalarPage() {
  const now = new Date();
  const qc = useQueryClient();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [includeNotDue, setIncludeNotDue] = useState(false);
  const [force, setForce] = useState(false);

  const evrakQuery = useQuery<PreviewData>({
    queryKey: ['evrak-reminder-preview', year, month, includeNotDue, force],
    queryFn: () =>
      api
        .post('/whatsapp/evrak-reminders/preview', { year, month, includeNotDue, force })
        .then((r) => r.data),
    refetchInterval: 60_000,
  });

  const tahsilatQuery = useQuery<PreviewData>({
    queryKey: ['tahsilat-reminder-preview'],
    queryFn: () => api.post('/cari-kasa/tahsilat-hatirlatma/preview', {}).then((r) => r.data),
    refetchInterval: 60_000,
  });

  const evrakSend = useMutation({
    mutationFn: () => api.post('/whatsapp/evrak-reminders/send', { year, month, includeNotDue, force }).then((r) => r.data),
    onSuccess: (r) => {
      toast.success(`Evrak hatırlatma tamam: ${r.basarili || 0} gönderildi`);
      qc.invalidateQueries({ queryKey: ['evrak-reminder-preview'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Evrak hatırlatma gönderilemedi'),
  });

  const tahsilatSend = useMutation({
    mutationFn: () => api.post('/cari-kasa/tahsilat-hatirlatma/send', {}).then((r) => r.data),
    onSuccess: (r) => {
      toast.success(`Tahsilat hatırlatma tamam: ${r.basarili || 0} gönderildi`);
      qc.invalidateQueries({ queryKey: ['tahsilat-reminder-preview'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Tahsilat hatırlatma gönderilemedi'),
  });

  const evrakRows = evrakQuery.data?.rows || [];
  const tahsilatRows = tahsilatQuery.data?.rows || [];
  const whatsappReady = Boolean(evrakQuery.data?.whatsapp?.ready || tahsilatQuery.data?.whatsapp?.ready);

  const totals = useMemo(() => {
    const tahsilatTutar = tahsilatRows
      .filter((r) => r.gonderilebilir)
      .reduce((sum, row) => sum + Number(row.bakiye || 0), 0);
    return {
      evrak: evrakQuery.data?.gonderilecek || 0,
      tahsilat: tahsilatQuery.data?.gonderilecek || 0,
      tahsilatTutar,
    };
  }, [evrakQuery.data, tahsilatQuery.data, tahsilatRows]);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="pb-5 flex items-end justify-between flex-wrap gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD_SOFT }}>
              <Bell size={10} className="inline mr-1" /> HATIRLATMA MERKEZI
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 38, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1 }}>
            Hatırlatmalar
          </h1>
          <p className="text-[13px] mt-2" style={{ color: 'rgba(250,250,249,0.48)' }}>
            Evrak ve tahsilat mesajlarını göndermeden önce kimlere gideceğini gör.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="px-3 py-2 rounded-lg text-sm border outline-none cursor-pointer" style={selectStyle}>
            {AYLAR.map((a, i) => <option key={a} value={i + 1} style={{ background: '#0f0d0b' }}>{a}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 rounded-lg text-sm border outline-none cursor-pointer" style={selectStyle}>
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>)}
          </select>
          <button
            onClick={() => {
              evrakQuery.refetch();
              tahsilatQuery.refetch();
            }}
            className="h-9 w-9 rounded-lg inline-flex items-center justify-center"
            title="Yenile"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard icon={MessageSquare} label="WhatsApp" value={whatsappReady ? 'Hazır' : 'Eksik'} tone={whatsappReady ? 'green' : 'amber'} sub={evrakQuery.data?.whatsapp?.provider || 'Meta Cloud'} />
        <SummaryCard icon={FileInput} label="Evrak Mesajı" value={String(totals.evrak)} tone="gold" sub={`${evrakQuery.data?.atlanacak || 0} atlanacak`} />
        <SummaryCard icon={Wallet} label="Tahsilat Mesajı" value={String(totals.tahsilat)} tone="blue" sub={`${formatMoney(totals.tahsilatTutar)} TL açık bakiye`} />
        <SummaryCard icon={Calendar} label="Dönem" value={evrakQuery.data?.donem || `${AYLAR[month - 1]} ${year}`} tone="neutral" sub="Evrak hatırlatma dönemi" />
      </div>

      {!whatsappReady && (
        <div className="rounded-2xl px-4 py-3 flex items-start gap-3" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#fbbf24' }}>
          <AlertTriangle size={17} className="mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">WhatsApp ayarı eksik görünüyor.</div>
            <div className="text-[12.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.62)' }}>
              {evrakQuery.data?.whatsapp?.error || tahsilatQuery.data?.whatsapp?.error || 'Meta Cloud API ortam değişkenlerini kontrol et.'}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReminderPanel
          title="Evrak Hatırlatma"
          desc="Evrak teslim günü gelen, evrakı henüz işaretlenmemiş mükellefler."
          icon={FileInput}
          loading={evrakQuery.isLoading}
          preview={evrakQuery.data}
          rows={evrakRows}
          sendLabel="Evrak Mesajlarını Gönder"
          sending={evrakSend.isPending}
          onSend={() => {
            if (!confirm(`${evrakQuery.data?.gonderilecek || 0} evrak hatırlatması gönderilsin mi?`)) return;
            evrakSend.mutate();
          }}
          controls={
            <div className="flex items-center gap-3 flex-wrap text-[12px]" style={{ color: 'rgba(250,250,249,0.58)' }}>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={includeNotDue} onChange={(e) => setIncludeNotDue(e.target.checked)} />
                günü gelmeyeni de göster
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                son 2 gün engelini kaldır
              </label>
            </div>
          }
        />

        <ReminderPanel
          title="Tahsilat Hatırlatma"
          desc="Cari hesabında açık bakiye olan mükellefler."
          icon={Wallet}
          loading={tahsilatQuery.isLoading}
          preview={tahsilatQuery.data}
          rows={tahsilatRows}
          sendLabel="Tahsilat Mesajlarını Gönder"
          sending={tahsilatSend.isPending}
          onSend={() => {
            if (!confirm(`${tahsilatQuery.data?.gonderilecek || 0} tahsilat hatırlatması gönderilsin mi?`)) return;
            tahsilatSend.mutate();
          }}
        />
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub: string; tone: 'green' | 'amber' | 'gold' | 'blue' | 'neutral' }) {
  const colors: Record<string, string> = {
    green: '#4ade80',
    amber: '#fbbf24',
    gold: GOLD,
    blue: '#60a5fa',
    neutral: '#cbd5e1',
  };
  const color = colors[tone];
  return (
    <div className="rounded-2xl p-4" style={{ background: `linear-gradient(135deg, ${color}12, rgba(255,255,255,0.02))`, border: `1px solid ${color}30` }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold tracking-[.16em]" style={{ color: 'rgba(250,250,249,0.46)' }}>{label}</span>
        <Icon size={15} style={{ color }} />
      </div>
      <div className="mt-3" style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 700, color: '#fafaf9', lineHeight: 1 }}>
        {value}
      </div>
      <div className="text-[11.5px] mt-1 truncate" style={{ color: 'rgba(250,250,249,0.48)' }}>{sub}</div>
    </div>
  );
}

function ReminderPanel({
  title,
  desc,
  icon: Icon,
  loading,
  preview,
  rows,
  sendLabel,
  sending,
  onSend,
  controls,
}: {
  title: string;
  desc: string;
  icon: any;
  loading: boolean;
  preview?: PreviewData;
  rows: ReminderRow[];
  sendLabel: string;
  sending: boolean;
  onSend: () => void;
  controls?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="px-5 py-4 flex items-start justify-between gap-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.28)' }}>
            <Icon size={17} style={{ color: GOLD }} />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>{title}</h2>
            <p className="text-[12.5px] mt-1" style={{ color: 'rgba(250,250,249,0.48)' }}>{desc}</p>
            {controls && <div className="mt-2">{controls}</div>}
          </div>
        </div>
        <button
          onClick={onSend}
          disabled={sending || loading || !preview?.gonderilecek}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-bold disabled:opacity-45"
          style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b' }}
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {sendLabel}
        </button>
      </div>

      <div className="px-5 py-3 flex items-center gap-3 text-[12px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.58)' }}>
        <span><strong style={{ color: '#fafaf9' }}>{preview?.gonderilecek || 0}</strong> gönderilecek</span>
        <span className="w-1 h-1 rounded-full" style={{ background: 'rgba(250,250,249,0.25)' }} />
        <span><strong style={{ color: '#fafaf9' }}>{preview?.atlanacak || 0}</strong> atlanacak</span>
      </div>

      <div className="max-h-[520px] overflow-auto">
        {loading ? (
          <div className="py-14 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>
            <Loader2 size={18} className="inline animate-spin mr-2" /> Yükleniyor...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>Gösterilecek kayıt yok.</div>
        ) : (
          rows.slice(0, 80).map((row) => <ReminderRowItem key={row.taxpayerId} row={row} />)
        )}
      </div>
    </section>
  );
}

function ReminderRowItem({ row }: { row: ReminderRow }) {
  const ok = Boolean(row.gonderilebilir);
  return (
    <div className="px-5 py-3 flex items-start gap-3 hover:bg-white/[0.025] transition" style={{ borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
      <span className="mt-0.5">
        {ok ? <CheckCircle2 size={16} style={{ color: '#4ade80' }} /> : <AlertTriangle size={16} style={{ color: '#fbbf24' }} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>{row.ad}</div>
          {row.bakiye !== undefined && (
            <div className="text-[12px] font-mono tabular-nums" style={{ color: GOLD }}>{formatMoney(row.bakiye)} TL</div>
          )}
        </div>
        <div className="text-[11.5px] mt-1 flex items-center gap-2 flex-wrap" style={{ color: 'rgba(250,250,249,0.46)' }}>
          <span>{row.phone || row.phones?.[0] || 'telefon yok'}</span>
          {row.evrakTeslimGunu ? <span>teslim günü: {row.evrakTeslimGunu}</span> : null}
          {row.sonHatirlatmaTarihi ? <span>son: {new Date(row.sonHatirlatmaTarihi).toLocaleDateString('tr-TR')}</span> : null}
        </div>
        {!ok && row.atlamaSebebi && (
          <div className="text-[11px] mt-1" style={{ color: '#fbbf24' }}>{row.atlamaSebebi}</div>
        )}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  borderColor: 'rgba(255,255,255,0.08)',
  color: '#fafaf9',
};

function formatMoney(value: number) {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Number(value || 0));
}
