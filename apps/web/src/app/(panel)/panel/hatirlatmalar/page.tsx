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
  Inbox,
  Loader2,
  LogOut,
  MessageSquare,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Smartphone,
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
  hasQr?: boolean;
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

  // ─── QR (Baileys) bağlantı durumu ──────────────────────────────
  const qrStatusQuery = useQuery<{
    connected: boolean;
    phone?: string;
    qrDataUrl?: string;
    lastError?: string;
    initSecondsAgo?: number;
    reconnectAttempts?: number;
  }>({
    queryKey: ['wa-qr-status'],
    queryFn: async () => (await api.get('/whatsapp-qr/status')).data,
    refetchInterval: 3000,
  });

  const qrConnect = useMutation({
    mutationFn: async () => (await api.post('/whatsapp-qr/connect')).data,
    onSuccess: () => {
      toast.success('QR oturumu başlatılıyor…');
      qc.invalidateQueries({ queryKey: ['wa-qr-status'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'QR başlatılamadı'),
  });

  const qrDisconnect = useMutation({
    mutationFn: async () => (await api.delete('/whatsapp-qr')).data,
    onSuccess: () => {
      toast.success('QR oturumu kapatıldı');
      qc.invalidateQueries({ queryKey: ['wa-qr-status'] });
    },
  });

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
              <Bell size={10} className="inline mr-1" /> WHATSAPP OTOMASYON MERKEZI
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 38, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1 }}>
            WhatsApp Otomasyonu
          </h1>
          <p className="text-[13px] mt-2" style={{ color: 'rgba(250,250,249,0.48)' }}>
            Evrak, tahsilat ve portal mesajlarını göndermeden önce alıcıları, atlama sebeplerini ve mesaj içeriğini kontrol et.
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

      {/* QR (Baileys) Bağlantı Bölümü */}
      <section className="rounded-2xl overflow-hidden mb-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-5 py-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.28)' }}>
              <Smartphone size={17} style={{ color: GOLD }} />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>WhatsApp QR (Kişisel Hat)</h2>
              <p className="text-[12.5px] mt-1" style={{ color: 'rgba(250,250,249,0.48)' }}>Meta Cloud API'sinin yanında kişisel WA hesabını QR ile bağla. Resmi olmayan yol — ban riski var.</p>
            </div>
          </div>
        </div>
        <div className="p-5">
          {qrStatusQuery.data?.connected ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={24} style={{ color: '#10b981' }} />
                <div>
                  <div className="text-[14px] font-medium" style={{ color: '#fafaf9' }}>Bağlı</div>
                  <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
                    Numara: +{qrStatusQuery.data.phone}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm('QR oturumunu kapatmak istediğine emin misin?')) qrDisconnect.mutate();
                }}
                disabled={qrDisconnect.isPending}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
              >
                <LogOut size={14} /> Bağlantıyı Kes
              </button>
            </div>
          ) : qrStatusQuery.data?.qrDataUrl ? (
            <div className="flex flex-col items-center gap-3">
              <div className="text-[12.5px] text-center" style={{ color: 'rgba(250,250,249,0.7)' }}>
                Telefon → WhatsApp → <b>Ayarlar</b> → <b>Bağlı Cihazlar</b> → <b>Cihaz Bağla</b> ile aşağıdaki QR'ı okutun:
              </div>
              <div className="rounded-lg p-2" style={{ background: '#fff' }}>
                <img src={qrStatusQuery.data.qrDataUrl} alt="WhatsApp QR" width={240} height={240} />
              </div>
              <button
                onClick={() => qrDisconnect.mutate()}
                className="text-[11px] underline"
                style={{ color: 'rgba(250,250,249,0.5)' }}
              >
                İptal et
              </button>
            </div>
          ) : qrStatusQuery.data?.lastError ? (
            <div className="text-center">
              <ShieldAlert size={32} style={{ color: '#f87171', margin: '0 auto' }} />
              <div className="mt-2 text-[14px] font-medium" style={{ color: '#f87171' }}>QR Oluşturulamadı</div>
              <div className="mt-1 text-[12px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
                {qrStatusQuery.data.lastError}
              </div>
              <button
                onClick={() => qrConnect.mutate()}
                disabled={qrConnect.isPending}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-medium text-white shadow-sm"
                style={{ background: GOLD }}
              >
                {qrConnect.isPending && <Loader2 size={14} className="animate-spin" />}
                <RefreshCw size={14} /> Tekrar Dene
              </button>
            </div>
          ) : (qrStatusQuery.data?.initSecondsAgo ?? 0) > 0 ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={28} className="animate-spin" style={{ color: GOLD }} />
              <div className="text-[12.5px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
                QR hazırlanıyor… {qrStatusQuery.data?.initSecondsAgo}sn
              </div>
              {(qrStatusQuery.data?.initSecondsAgo ?? 0) > 30 && (
                <button
                  onClick={() => qrDisconnect.mutate()}
                  className="text-[11px] underline mt-1"
                  style={{ color: 'rgba(250,250,249,0.5)' }}
                >
                  Sıfırla ve baştan başla
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Smartphone size={24} style={{ color: 'rgba(250,250,249,0.4)' }} />
                <div>
                  <div className="text-[14px]" style={{ color: 'rgba(250,250,249,0.8)' }}>Henüz oturum yok</div>
                  <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.5)' }}>QR üretip telefonundan okut.</div>
                </div>
              </div>
              <button
                onClick={() => qrConnect.mutate()}
                disabled={qrConnect.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-medium text-white shadow-sm"
                style={{ background: GOLD }}
              >
                {qrConnect.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                QR Üret ve Bağlan
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[0.85fr_1.15fr] gap-4">
        <section className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-5 py-4 flex items-start gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.28)' }}>
              <Settings size={17} style={{ color: GOLD }} />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>Bağlantı Ayarları</h2>
              <p className="text-[12.5px] mt-1" style={{ color: 'rgba(250,250,249,0.48)' }}>Meta Cloud API durumu ve kullanılan şablonlar.</p>
            </div>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StatusPill label="Sağlayıcı" value={whatsappStatus?.provider || 'meta-cloud'} />
            <StatusPill label="QR" value={whatsappStatus?.hasQr ? 'Var' : 'Yok'} tone={whatsappStatus?.hasQr ? 'amber' : 'green'} />
            <StatusPill label="Webhook" value={whatsappStatus?.webhookReady ? 'Hazır' : 'Eksik'} tone={whatsappStatus?.webhookReady ? 'green' : 'amber'} />
            <StatusPill label="Numara ID" value={whatsappStatus?.phoneNumberId || 'Eksik'} tone={whatsappStatus?.phoneNumberId ? 'green' : 'amber'} />
            <StatusPill label="Evrak Şablonu" value={whatsappStatus?.documentTemplateName || 'Eksik'} tone={whatsappStatus?.documentTemplateName ? 'green' : 'amber'} />
            <StatusPill label="Portal Şablonu" value={whatsappStatus?.portalTemplateName || 'Eksik'} tone={whatsappStatus?.portalTemplateName ? 'green' : 'amber'} />
          </div>
        </section>

        <section className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-5 py-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.28)' }}>
                <Inbox size={17} style={{ color: '#10b981' }} />
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
