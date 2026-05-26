'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  MessageCircle,
  Save,
  Send,
  TestTube2,
  XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const GOLD_DEEP = '#8b7649';
const LINE = 'rgba(255,255,255,0.08)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const SOFT = 'rgba(255,255,255,0.035)';
const GREEN = '#4ade80';
const RED = '#f87171';
const BLUE = '#60a5fa';

const EMAIL_PRESETS: Record<string, { host: string; port: number; secure: boolean; help: string }> = {
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false, help: 'Google Workspace / Gmail için 2FA + Uygulama Şifresi (16 haneli) gerekli.' },
  yandex: { host: 'smtp.yandex.com', port: 465, secure: true, help: 'Yandex için "Uygulama parolası" oluşturmanız gerekiyor.' },
  office365: { host: 'smtp.office365.com', port: 587, secure: false, help: 'Microsoft 365 / Outlook için hesap parolası veya app password.' },
  custom: { host: '', port: 587, secure: false, help: 'Kendi SMTP sunucunuz için manuel ayarlar.' },
};

type EmailConfigShape = {
  configured: boolean;
  config: null | {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    from: string;
    provider?: 'gmail' | 'yandex' | 'office365' | 'custom';
    hasPassword: boolean;
    source: 'db' | 'env' | 'none';
  };
};

type WhatsAppConfigShape = {
  source: 'db' | 'env' | 'none';
  configured: boolean;
  phoneNumberId: string;
  businessAccountId: string;
  templateName: string;
  templateLang: string;
  apiVersion: string;
  documentTemplateName: string;
  portalTemplateName: string;
  ownerAlertTemplateName: string;
  ownerPhones: string;
  hasAccessToken: boolean;
  hasWebhookToken: boolean;
  automationActive: boolean;
};

export default function EntegrasyonlarPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <header className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
        <Link
          href="/panel/ayarlar"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: MUTED }}
        >
          <ArrowLeft size={14} /> Ayarlar
        </Link>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight" style={{ color: TEXT }}>
          Entegrasyonlar
        </h1>
        <p className="mt-2 max-w-3xl text-[13px]" style={{ color: MUTED }}>
          E-posta (SMTP) ve WhatsApp Business (Meta Cloud API) bağlantı ayarları. Şifre/token bilgileri AES-256-GCM ile şifreli olarak veritabanında saklanır.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <EmailCard />
        <WhatsAppCard />
      </div>
    </div>
  );
}

// ============================================================
// E-POSTA KARTI
// ============================================================

function EmailCard() {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<'gmail' | 'yandex' | 'office365' | 'custom'>('gmail');
  const [host, setHost] = useState('smtp.gmail.com');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [testTo, setTestTo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['integration-email'],
    queryFn: () => api.get('/integrations/email').then((r) => r.data as EmailConfigShape),
  });

  useEffect(() => {
    if (data?.config) {
      const c = data.config;
      setProvider(c.provider || 'custom');
      setHost(c.host);
      setPort(c.port);
      setSecure(c.secure);
      setUser(c.user);
      setFrom(c.from);
    }
  }, [data]);

  const applyPreset = (p: 'gmail' | 'yandex' | 'office365' | 'custom') => {
    setProvider(p);
    const preset = EMAIL_PRESETS[p];
    setHost(preset.host);
    setPort(preset.port);
    setSecure(preset.secure);
  };

  const saveMut = useMutation({
    mutationFn: () =>
      api.put('/integrations/email', { host, port, secure, user, pass, from, provider }).then((r) => r.data),
    onSuccess: () => {
      toast.success('E-posta ayarları kaydedildi.');
      setPass('');
      qc.invalidateQueries({ queryKey: ['integration-email'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydetme hatası'),
  });

  const verifyMut = useMutation({
    mutationFn: () => api.post('/integrations/email/test/verify').then((r) => r.data as { ok: boolean; error?: string }),
    onSuccess: (res) => {
      if (res.ok) toast.success('SMTP bağlantısı doğrulandı.');
      else toast.error('Doğrulama başarısız: ' + (res.error || ''));
    },
    onError: (e: any) => toast.error('Doğrulama hatası: ' + (e?.message || '')),
  });

  const sendTestMut = useMutation({
    mutationFn: () =>
      api
        .post('/integrations/email/test/send', { to: testTo || undefined })
        .then((r) => r.data as { sent: boolean; messageId?: string; error?: string }),
    onSuccess: (res) => {
      if (res.sent) toast.success(`Test e-postası gönderildi. (id: ${res.messageId?.slice(0, 24)}…)`);
      else toast.error('Test gönderim hatası: ' + (res.error || ''));
    },
    onError: (e: any) => toast.error('Gönderim hatası: ' + (e?.message || '')),
  });

  return (
    <section className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-lg border"
          style={{ borderColor: LINE, color: GOLD, background: SOFT }}
        >
          <Mail size={20} />
        </div>
        <div className="flex-1">
          <h2 className="text-[17px] font-semibold" style={{ color: TEXT }}>
            E-posta (SMTP)
          </h2>
          <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
            Otomasyon ve bildirimlerde kullanılacak SMTP sağlayıcısı.
          </p>
        </div>
        <StatusBadge
          ok={!!data?.configured}
          source={data?.config?.source || 'none'}
        />
      </div>

      <div className="mt-4 space-y-3">
        {/* Provider seçici */}
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>
            Sağlayıcı
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(['gmail', 'yandex', 'office365', 'custom'] as const).map((p) => (
              <button
                key={p}
                onClick={() => applyPreset(p)}
                className="rounded-md border px-3 py-2 text-[12px] font-medium transition"
                style={{
                  borderColor: provider === p ? GOLD : LINE,
                  color: provider === p ? GOLD : TEXT,
                  background: provider === p ? 'rgba(212,184,118,0.08)' : SOFT,
                }}
              >
                {p === 'gmail' ? 'Gmail / Workspace' : p === 'yandex' ? 'Yandex' : p === 'office365' ? 'Microsoft 365' : 'Özel'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
            {EMAIL_PRESETS[provider].help}
          </p>
          {provider === 'gmail' && (
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[11px] underline"
              style={{ color: BLUE }}
            >
              Google Uygulama Şifresi oluştur →
            </a>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldText label="SMTP Host" value={host} onChange={setHost} placeholder="smtp.gmail.com" />
          <FieldText label="Port" value={String(port)} onChange={(v) => setPort(Number(v) || 587)} placeholder="587" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldText
            label="Kullanıcı (e-posta adresi)"
            value={user}
            onChange={setUser}
            placeholder="ornek@morenmusavirlik.com"
          />
          <FieldText
            label="Gönderici (From)"
            value={from}
            onChange={setFrom}
            placeholder="Moren Müşavirlik <ornek@morenmusavirlik.com>"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>
            Şifre {data?.config?.hasPassword && <span className="ml-1 normal-case" style={{ color: GREEN }}>(kayıtlı — boş bırakılabilir)</span>}
          </label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={data?.config?.hasPassword ? '••••••••••••••••' : 'Uygulama şifresi (Gmail için 16 haneli)'}
              className="w-full rounded-md border bg-transparent px-3 py-2 pr-10 text-[13px]"
              style={{ borderColor: LINE, color: TEXT }}
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: MUTED }}
            >
              {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12px]" style={{ color: TEXT }}>
          <input
            type="checkbox"
            checked={secure}
            onChange={(e) => setSecure(e.target.checked)}
            className="h-4 w-4 accent-amber-500"
          />
          SSL/TLS kullan (port 465 için açın; STARTTLS port 587 için kapatın)
        </label>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[12px] font-bold"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
          >
            {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Kaydet
          </button>
          <button
            onClick={() => verifyMut.mutate()}
            disabled={verifyMut.isPending || !data?.configured}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-4 text-[12px] font-medium"
            style={{ borderColor: LINE, color: TEXT, background: SOFT }}
          >
            {verifyMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <TestTube2 size={14} />} Bağlantıyı Doğrula
          </button>
        </div>

        <div className="rounded-md border p-3" style={{ borderColor: LINE, background: SOFT }}>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>
            Test E-postası
          </label>
          <div className="flex gap-2">
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="ornek@gmail.com (boş bırak = kendine gönder)"
              className="flex-1 rounded-md border bg-transparent px-3 py-2 text-[13px]"
              style={{ borderColor: LINE, color: TEXT }}
            />
            <button
              onClick={() => sendTestMut.mutate()}
              disabled={sendTestMut.isPending || !data?.configured}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium"
              style={{ borderColor: LINE, color: TEXT, background: SOFT }}
            >
              {sendTestMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Gönder
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// WHATSAPP KARTI
// ============================================================

function WhatsAppCard() {
  const qc = useQueryClient();
  const [accessToken, setAccessToken] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateLang, setTemplateLang] = useState('tr');
  const [apiVersion, setApiVersion] = useState('v20.0');
  const [documentTemplateName, setDocumentTemplateName] = useState('');
  const [portalTemplateName, setPortalTemplateName] = useState('');
  const [ownerAlertTemplateName, setOwnerAlertTemplateName] = useState('');
  const [ownerPhones, setOwnerPhones] = useState('');
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testTemplate, setTestTemplate] = useState('');

  const { data } = useQuery({
    queryKey: ['integration-whatsapp'],
    queryFn: () => api.get('/integrations/whatsapp').then((r) => r.data as WhatsAppConfigShape),
  });

  useEffect(() => {
    if (data) {
      setPhoneNumberId(data.phoneNumberId);
      setBusinessAccountId(data.businessAccountId);
      setTemplateName(data.templateName);
      setTemplateLang(data.templateLang);
      setApiVersion(data.apiVersion);
      setDocumentTemplateName(data.documentTemplateName);
      setPortalTemplateName(data.portalTemplateName);
      setOwnerAlertTemplateName(data.ownerAlertTemplateName);
      setOwnerPhones(data.ownerPhones || '');
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () =>
      api
        .put('/integrations/whatsapp', {
          accessToken,
          phoneNumberId,
          businessAccountId,
          templateName,
          templateLang,
          apiVersion,
          documentTemplateName,
          portalTemplateName,
          ownerAlertTemplateName,
          ownerPhones,
          webhookVerifyToken,
        })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('WhatsApp ayarları kaydedildi.');
      setAccessToken('');
      setWebhookVerifyToken('');
      qc.invalidateQueries({ queryKey: ['integration-whatsapp'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydetme hatası'),
  });

  const verifyMut = useMutation({
    mutationFn: () => api.post('/integrations/whatsapp/test/verify').then((r) => r.data as { ok: boolean; error?: string; phoneInfo?: any }),
    onSuccess: (res) => {
      if (res.ok) {
        const display = res.phoneInfo?.display_phone_number || res.phoneInfo?.verified_name || 'OK';
        toast.success(`Meta API'ye bağlantı başarılı: ${display}`);
      } else toast.error('Bağlantı hatası: ' + (res.error || ''));
    },
    onError: (e: any) => toast.error('Hata: ' + (e?.message || '')),
  });

  const sendTestMut = useMutation({
    mutationFn: () =>
      api
        .post('/integrations/whatsapp/test/send', { to: testTo, templateName: testTemplate || undefined })
        .then((r) => r.data as { sent: boolean; error?: string }),
    onSuccess: (res) => {
      if (res.sent) toast.success('Test mesajı gönderildi.');
      else toast.error('Gönderim başarısız (24s pencere veya şablon kontrolü yapın).');
    },
    onError: (e: any) => toast.error('Hata: ' + (e?.message || '')),
  });

  const toggleMut = useMutation({
    mutationFn: (active: boolean) => api.put('/integrations/whatsapp/toggle', { active }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(res.active ? 'WhatsApp otomasyonlari aktif' : 'WhatsApp otomasyonlari pasif');
      qc.invalidateQueries({ queryKey: ['integration-whatsapp'] });
      qc.invalidateQueries({ queryKey: ['integration-whatsapp-status'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Durum degistirilemedi'),
  });

  return (
    <section className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-lg border"
          style={{ borderColor: LINE, color: GREEN, background: SOFT }}
        >
          <MessageCircle size={20} />
        </div>
        <div className="flex-1">
          <h2 className="text-[17px] font-semibold" style={{ color: TEXT }}>
            WhatsApp (Meta Cloud API)
          </h2>
          <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
            Resmi WhatsApp Business — şablon onayları Meta Business Manager'dan alınmalıdır.
          </p>
        </div>
        <StatusBadge ok={!!data?.configured} source={data?.source || 'none'} />
      </div>

      <div className="mt-4 space-y-3">
        <div
          className="flex items-center justify-between gap-3 rounded-md border p-3"
          style={{
            borderColor: data?.automationActive ? 'rgba(74,222,128,0.28)' : 'rgba(248,113,113,0.28)',
            background: data?.automationActive ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)',
          }}
        >
          <div>
            <div className="text-[12.5px] font-semibold" style={{ color: TEXT }}>Master Switch</div>
            <div className="text-[11px]" style={{ color: MUTED }}>
              Meta, QR ve otomasyon WhatsApp gonderimlerini tek yerden acar/kapatir.
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleMut.mutate(!data?.automationActive)}
            disabled={toggleMut.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-bold disabled:opacity-60"
            style={{
              borderColor: data?.automationActive ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)',
              color: data?.automationActive ? GREEN : RED,
              background: 'rgba(0,0,0,0.16)',
            }}
          >
            {toggleMut.isPending ? <Loader2 size={13} className="animate-spin" /> : data?.automationActive ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {data?.automationActive ? 'Aktif' : 'Pasif'}
          </button>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>
            Access Token {data?.hasAccessToken && <span className="ml-1 normal-case" style={{ color: GREEN }}>(kayıtlı)</span>}
          </label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={data?.hasAccessToken ? '••••••••• EAA…' : 'EAA... ile başlayan uzun token'}
              className="w-full rounded-md border bg-transparent px-3 py-2 pr-10 text-[13px] font-mono"
              style={{ borderColor: LINE, color: TEXT }}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: MUTED }}
            >
              {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <a
            href="https://developers.facebook.com/apps"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-[11px] underline"
            style={{ color: BLUE }}
          >
            Meta Developer Console →
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldText label="Phone Number ID" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="106xxxxxxxxxxxx" />
          <FieldText label="Business Account ID" value={businessAccountId} onChange={setBusinessAccountId} placeholder="opsiyonel" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldText label="Varsayılan Şablon Adı" value={templateName} onChange={setTemplateName} placeholder="evrak_hatirlatma" />
          <FieldText label="Şablon Dili" value={templateLang} onChange={setTemplateLang} placeholder="tr" />
        </div>

        <details className="rounded-md border p-3" style={{ borderColor: LINE, background: SOFT }}>
          <summary className="cursor-pointer text-[12px] font-medium" style={{ color: MUTED }}>
            Gelişmiş — özel şablon eşleştirmeleri
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <FieldText label="Evrak Hatırlatma Şablonu" value={documentTemplateName} onChange={setDocumentTemplateName} placeholder="evrak_hatirlatma" />
            <FieldText label="Portal Mesajı Şablonu" value={portalTemplateName} onChange={setPortalTemplateName} placeholder="portal_mesaji" />
            <FieldText label="Patron Uyarı Şablonu" value={ownerAlertTemplateName} onChange={setOwnerAlertTemplateName} placeholder="ofis_uyari" />
            <FieldText label="Ofis / Owner WhatsApp Numaralari" value={ownerPhones} onChange={setOwnerPhones} placeholder="905xxxxxxxxx,905yyyyyyyyy" />
            <FieldText label="API Versiyonu" value={apiVersion} onChange={setApiVersion} placeholder="v20.0" />
            <FieldText
              label={`Webhook Doğrulama Token'ı ${data?.hasWebhookToken ? '(kayıtlı)' : ''}`}
              value={webhookVerifyToken}
              onChange={setWebhookVerifyToken}
              placeholder={data?.hasWebhookToken ? '••••••••' : 'Meta webhook için doğrulama dizisi'}
            />
          </div>
        </details>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[12px] font-bold"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
          >
            {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Kaydet
          </button>
          <button
            onClick={() => verifyMut.mutate()}
            disabled={verifyMut.isPending || !data?.configured}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-4 text-[12px] font-medium"
            style={{ borderColor: LINE, color: TEXT, background: SOFT }}
          >
            {verifyMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <TestTube2 size={14} />} Meta API'yi Doğrula
          </button>
        </div>

        <div className="rounded-md border p-3" style={{ borderColor: LINE, background: SOFT }}>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>
            Test Mesajı
          </label>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="905XXxxxxxxx"
              className="rounded-md border bg-transparent px-3 py-2 text-[13px]"
              style={{ borderColor: LINE, color: TEXT }}
            />
            <input
              value={testTemplate}
              onChange={(e) => setTestTemplate(e.target.value)}
              placeholder={`Şablon (boş = varsayılan) "${templateName || 'serbest metin'}"`}
              className="rounded-md border bg-transparent px-3 py-2 text-[13px]"
              style={{ borderColor: LINE, color: TEXT }}
            />
            <button
              onClick={() => sendTestMut.mutate()}
              disabled={sendTestMut.isPending || !testTo || !data?.configured}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[12px] font-medium"
              style={{ borderColor: LINE, color: TEXT, background: SOFT }}
            >
              {sendTestMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Gönder
            </button>
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
            Şablon adı yoksa serbest metin gönderilir — sadece son 24 saatte sana yazan numaralara çalışır.
          </p>
        </div>

      </div>
    </section>
  );
}

// ============================================================
// YARDIMCILAR
// ============================================================

function FieldText({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border bg-transparent px-3 py-2 text-[13px]"
        style={{ borderColor: LINE, color: TEXT }}
      />
    </div>
  );
}

function StatusBadge({ ok, source }: { ok: boolean; source: 'db' | 'env' | 'none' }) {
  const sourceLabel = source === 'db' ? 'Veritabanı' : source === 'env' ? 'ENV (eski)' : '—';
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold"
      style={{
        borderColor: ok ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.4)',
        color: ok ? GREEN : RED,
        background: ok ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)',
      }}
    >
      {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {ok ? 'Bağlı' : 'Bağlı değil'}
      <span style={{ color: MUTED }}>· {sourceLabel}</span>
    </div>
  );
}
