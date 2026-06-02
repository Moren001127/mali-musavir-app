'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  FileInput,
  Inbox,
  Loader2,
  MessageSquare,
  MessageSquareText,
  RefreshCw,
  Send,
  Settings,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
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
  whatsapp?: WhatsAppStatus;
  gonderilecek: number;
  atlanacak: number;
  aday?: number;
  rows: ReminderRow[];
};

type WhatsAppStatus = {
  ready?: boolean;
  error?: string;
  provider?: string;
  phoneNumberId?: string;
  templateName?: string | null;
  documentTemplateName?: string | null;
  portalTemplateName?: string | null;
  ownerAlertTemplateName?: string | null;
  webhookReady?: boolean;
};

type WhatsAppInboxItem = {
  id: string;
  subject: string;
  content: string;
  occurredAt: string;
  direction: 'incoming' | 'outgoing';
  taxpayer: {
    id: string;
    name: string;
    phone?: string | null;
  };
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

  const inboxQuery = useQuery<WhatsAppInboxItem[]>({
    queryKey: ['whatsapp-inbox'],
    queryFn: () => api.get('/whatsapp/inbox?limit=40').then((r) => r.data),
    refetchInterval: 30_000,
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
  const whatsappStatus = evrakQuery.data?.whatsapp || tahsilatQuery.data?.whatsapp;
  const whatsappReady = Boolean(whatsappStatus?.ready);

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
    <div className="space-y-5 max-w-7xl pb-12">
      {/* === BASLIK (AI Maliyet imzasi — zumrut/teal temasi) === */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(16,185,129,0.18), transparent 45%), radial-gradient(120% 140% at 100% 0%, rgba(45,212,191,0.14), transparent 45%), #0f0d0b',
        }}
      >
        {/* ust renk seridi */}
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #10b981, #2dd4bf, #34d399, #a3e635, #d4b876)' }}
        />
        <Link href="/panel" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'rgba(250,250,249,0.58)' }}>
          <ArrowLeft size={14} /> Panel
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: 'linear-gradient(135deg, #10b981, #2dd4bf)', boxShadow: '0 6px 18px rgba(16,185,129,0.35)' }}
            >
              <MessageSquareText size={22} style={{ color: '#08130f' }} />
            </span>
            WhatsApp Otomasyonu
          </h1>
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
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
              title="Yenile"
              style={{ background: 'rgba(16,185,129,0.16)', color: '#34d399', border: '1px solid rgba(16,185,129,0.35)' }}
            >
              <RefreshCw size={14} /> Yenile
            </button>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
          Evrak, tahsilat ve portal mesajlarını göndermeden önce alıcıları, atlama sebeplerini ve mesaj içeriğini kontrol et.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard icon={MessageSquare} label="Meta Cloud" value={whatsappReady ? 'Hazır' : 'Eksik'} tone={whatsappReady ? 'green' : 'amber'} sub={evrakQuery.data?.whatsapp?.provider || 'WhatsApp'} />
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
              {evrakQuery.data?.whatsapp?.error || tahsilatQuery.data?.whatsapp?.error || 'WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID ve şablon değişkenlerini kontrol et.'}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[0.85fr_1.15fr] gap-4">
        <section className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-5 py-4 flex items-start gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #d4b876, #b8863a)', boxShadow: '0 6px 16px rgba(212,184,118,0.30)' }}>
              <Settings size={17} style={{ color: '#1a1410' }} />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>Bağlantı Ayarları</h2>
              <p className="text-[12.5px] mt-1" style={{ color: 'rgba(250,250,249,0.48)' }}>Meta Cloud API durumu ve kullanılan şablonlar.</p>
            </div>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StatusPill label="Sağlayıcı" value={whatsappStatus?.provider || 'meta-cloud'} />
            <StatusPill label="Webhook" value={whatsappStatus?.webhookReady ? 'Hazır' : 'Eksik'} tone={whatsappStatus?.webhookReady ? 'green' : 'amber'} />
            <StatusPill label="Numara ID" value={whatsappStatus?.phoneNumberId || 'Eksik'} tone={whatsappStatus?.phoneNumberId ? 'green' : 'amber'} />
            <StatusPill label="Evrak Şablonu" value={whatsappStatus?.documentTemplateName || 'Eksik'} tone={whatsappStatus?.documentTemplateName ? 'green' : 'amber'} />
            <StatusPill label="Portal Şablonu" value={whatsappStatus?.portalTemplateName || 'Eksik'} tone={whatsappStatus?.portalTemplateName ? 'green' : 'amber'} />
          </div>
        </section>

        <section className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-5 py-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #10b981, #2dd4bf)', boxShadow: '0 6px 16px rgba(16,185,129,0.30)' }}>
                <Inbox size={17} style={{ color: '#08130f' }} />
              </span>
              <div>
                <h2 className="text-[16px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>Gelen Mesajlar</h2>
                <p className="text-[12.5px] mt-1" style={{ color: 'rgba(250,250,249,0.48)' }}>Webhook ile eşleşen son WhatsApp kayıtları.</p>
              </div>
            </div>
            <button
              onClick={() => inboxQuery.refetch()}
              className="h-9 w-9 rounded-lg inline-flex items-center justify-center"
              title="Gelen mesajları yenile"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="max-h-[300px] overflow-auto">
            {inboxQuery.isLoading ? (
              <div className="py-10 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>
                <Loader2 size={18} className="inline animate-spin mr-2" /> Yükleniyor...
              </div>
            ) : !inboxQuery.data?.length ? (
              <div className="py-10 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>Henüz WhatsApp kaydı yok.</div>
            ) : (
              inboxQuery.data.map((item) => <InboxRow key={item.id} item={item} />)
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReminderPanel
          title="Evrak Hatırlatma"
          desc="Evrak teslim günü gelen, evrakı henüz işaretlenmemiş mükellefler."
          icon={FileInput}
          accent={GOLD}
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
          accent="#60a5fa"
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
    <div
      className="relative overflow-hidden rounded-2xl border p-4"
      style={{ borderColor: `${color}40`, background: `linear-gradient(135deg, ${color}26, ${color}0a 58%, rgba(255,255,255,0.02))` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold tracking-[.16em]" style={{ color }}>{label}</span>
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${color}22`, border: `1px solid ${color}40` }}>
          <Icon size={14} style={{ color }} />
        </span>
      </div>
      <div className="mt-3 text-[30px] font-semibold leading-none" style={{ color: '#fafaf9' }}>
        {value}
      </div>
      <div className="text-[11.5px] mt-1 truncate" style={{ color: 'rgba(250,250,249,0.55)' }}>{sub}</div>
    </div>
  );
}

function StatusPill({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'green' | 'amber' | 'neutral' }) {
  const color = tone === 'green' ? '#4ade80' : tone === 'amber' ? '#fbbf24' : 'rgba(250,250,249,0.62)';
  return (
    <div className="rounded-xl p-3 min-w-0" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[10px] uppercase font-bold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.38)' }}>{label}</div>
      <div className="text-[12.5px] mt-1 truncate font-semibold" title={value} style={{ color }}>{value}</div>
    </div>
  );
}

function InboxRow({ item }: { item: WhatsAppInboxItem }) {
  const incoming = item.direction === 'incoming';
  return (
    <div className="px-5 py-3 hover:bg-white/[0.025] transition" style={{ borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex-shrink-0"
              style={{
                color: incoming ? '#10b981' : GOLD,
                background: incoming ? 'rgba(16,185,129,0.12)' : 'rgba(212,184,118,0.12)',
                border: incoming ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(212,184,118,0.25)',
              }}
            >
              {incoming ? 'Gelen' : 'Giden'}
            </span>
            <span className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>{item.taxpayer.name}</span>
          </div>
          <div className="text-[11.5px] mt-1 truncate" style={{ color: 'rgba(250,250,249,0.44)' }}>{item.subject}</div>
        </div>
        <div className="text-[11px] whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.36)' }}>
          {new Date(item.occurredAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      {item.content ? (
        <div className="text-[12px] leading-relaxed mt-2 line-clamp-2" style={{ color: 'rgba(250,250,249,0.58)' }}>
          {item.content}
        </div>
      ) : null}
    </div>
  );
}

function ReminderPanel({
  title,
  desc,
  icon: Icon,
  accent = GOLD,
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
  accent?: string;
  loading: boolean;
  preview?: PreviewData;
  rows: ReminderRow[];
  sendLabel: string;
  sending: boolean;
  onSend: () => void;
  controls?: React.ReactNode;
}) {
  return (
    <section className="relative rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${accent}26` }}>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}33)` }} />
      <div className="px-5 py-4 flex items-start justify-between gap-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}aa)`, boxShadow: `0 6px 16px ${accent}30` }}>
            <Icon size={17} style={{ color: '#0f0d0b' }} />
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
          style={{ background: `linear-gradient(135deg, ${accent}, ${accent}aa)`, color: '#0f0d0b' }}
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
