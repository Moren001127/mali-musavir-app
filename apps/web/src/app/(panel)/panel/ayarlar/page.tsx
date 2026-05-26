'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCheck2,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquareText,
  Plug,
  Save,
  Settings2,
  ShieldCheck,
  UsersRound,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { AdvisorPortalCredentialCard } from '@/components/portal-automation/PortalCredentialCards';

// ---- Renkler — daha yumuşak, kahverengi tonu ile boğmayan tema ----
const GOLD = '#d4b876';
const GOLD_DEEP = '#8b7649';
const LINE = 'rgba(212,184,118,0.12)';
const LINE_GOLD = 'rgba(212,184,118,0.28)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.62)';
const SOFT = 'rgba(255,255,255,0.04)';
const CARD = 'rgba(28,22,18,0.85)';        // siyah yerine sıcak koyu kahve
const CARD_HOVER = 'rgba(40,32,26,0.92)';
const GREEN = '#4ade80';
const RED = '#f87171';
// Sayfa arka planı için sıcak gradient
const PAGE_BG =
  'radial-gradient(1200px 600px at 20% -10%, rgba(212,184,118,0.05), transparent 60%),' +
  ' radial-gradient(900px 500px at 100% 100%, rgba(139,118,73,0.04), transparent 60%),' +
  ' linear-gradient(180deg, #1a1612 0%, #14110e 100%)';

// =====================================================================
// ANA SAYFA
// =====================================================================

export default function AyarlarPage() {
  return (
    <div
      className="min-h-full"
      style={{ background: PAGE_BG, marginInline: '-1rem', paddingInline: '1rem', paddingBlock: '0.5rem' }}
    >
      <div className="mx-auto max-w-6xl space-y-5 pb-12 pt-2">
        <PageHeader />
        <StatusStrip />
        <SettingsGrid />
        <CollapsibleSection
          id="portal-creds"
          icon={KeyRound}
          title="Portal Şifreleri"
          subtitle="e-Beyanname, Vergi Dairesi ve diğer mali müşavir portal girişleri"
          tone="gold"
        >
          <AdvisorPortalCredentialCard />
        </CollapsibleSection>
        <MessageTemplatesSection />
        <CollapsibleSection
          id="agent"
          icon={Bot}
          title="Moren Agent — Tarayıcı Eklentisi"
          subtitle="Token + bookmarklet kodu (tek seferlik kurulum)"
          tone="violet"
        >
          <AgentContent />
        </CollapsibleSection>
      </div>
    </div>
  );
}

// =====================================================================
// HEADER
// =====================================================================

function PageHeader() {
  return (
    <header
      className="rounded-xl border p-5"
      style={{ borderColor: LINE, background: CARD }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: GOLD }}>
        Sistem
      </p>
      <h1 className="mt-1 text-[28px] font-semibold leading-tight" style={{ color: TEXT }}>
        Ayarlar
      </h1>
      <p className="mt-1.5 max-w-2xl text-[13px]" style={{ color: MUTED }}>
        Erişim, entegrasyonlar, portal şifreleri ve mesaj metinleri.
      </p>
    </header>
  );
}

// =====================================================================
// HIZLI DURUM ŞERİDİ
// =====================================================================

function StatusStrip() {
  const { data: emailCfg } = useQuery({
    queryKey: ['integration-email-status'],
    queryFn: () => api.get('/integrations/email').then((r) => r.data),
  });
  const { data: waCfg } = useQuery({
    queryKey: ['integration-whatsapp-status'],
    queryFn: () => api.get('/integrations/whatsapp').then((r) => r.data),
  });
  const { data: agentInfo } = useQuery({
    queryKey: ['agent-me-token-status'],
    queryFn: () => api.get('/agent/me/token').then((r) => r.data),
  });

  const items = [
    {
      label: 'E-posta',
      ok: !!emailCfg?.configured,
      icon: Mail,
      detail: emailCfg?.config?.host || 'Bağlı değil',
      href: '/panel/ayarlar/entegrasyonlar',
    },
    {
      label: 'WhatsApp',
      ok: !!waCfg?.configured,
      icon: MessageCircle,
      detail: waCfg?.phoneNumberId ? `${waCfg.phoneNumberId.slice(0, 12)}…` : 'Bağlı değil',
      href: '/panel/ayarlar/entegrasyonlar',
    },
    {
      label: 'Moren Agent',
      ok: !!agentInfo?.token,
      icon: Bot,
      detail: agentInfo?.tenantName || 'Token yok',
      href: '#agent',
    },
  ];

  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {items.map((it) => {
        const Inner = (
          <div
            className="flex items-center gap-3 rounded-xl border px-4 py-3 transition"
            style={{ borderColor: LINE, background: CARD }}
            onMouseEnter={(e) => (e.currentTarget.style.background = CARD_HOVER)}
            onMouseLeave={(e) => (e.currentTarget.style.background = CARD)}
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
              style={{
                borderColor: it.ok ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)',
                color: it.ok ? GREEN : RED,
                background: it.ok ? 'rgba(74,222,128,0.07)' : 'rgba(248,113,113,0.07)',
              }}
            >
              <it.icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: TEXT }}>
                {it.label}
                {it.ok ? (
                  <CheckCircle2 size={12} style={{ color: GREEN }} />
                ) : (
                  <XCircle size={12} style={{ color: RED }} />
                )}
              </div>
              <div className="truncate text-[11.5px]" style={{ color: MUTED }}>
                {it.detail}
              </div>
            </div>
          </div>
        );
        return it.href.startsWith('#') ? (
          <a key={it.label} href={it.href}>{Inner}</a>
        ) : (
          <Link key={it.label} href={it.href}>{Inner}</Link>
        );
      })}
    </div>
  );
}

// =====================================================================
// AYAR KATEGORİLERİ — tile grid
// =====================================================================

function SettingsGrid() {
  const links: Array<{ href: string; title: string; text: string; icon: any; tone: 'blue'|'purple'|'green'|'teal'|'amber'|'pink' }> = [
    {
      href: '/panel/ayarlar/entegrasyonlar',
      title: 'Entegrasyonlar',
      text: 'E-posta (SMTP) + WhatsApp Cloud API',
      icon: Plug,
      tone: 'blue',
    },
    {
      href: '/panel/ayarlar/kullanicilar',
      title: 'Kullanıcılar & Erişim',
      text: 'Personel hesapları, roller',
      icon: UsersRound,
      tone: 'purple',
    },
    {
      href: '/panel/ayarlar/beyanname-takip',
      title: 'Beyanname Takip',
      text: 'Beyan türleri ve dönem ayarları',
      icon: FileCheck2,
      tone: 'green',
    },
    {
      href: '/panel/hatirlatmalar',
      title: 'WhatsApp Otomasyonu',
      text: 'Evrak ve tahsilat hatırlatma akışları',
      icon: MessageSquareText,
      tone: 'teal',
    },
    {
      href: '/panel/ayarlar/denetim',
      title: 'Denetim Günlüğü',
      text: 'Sistem kayıtları ve izler',
      icon: ShieldCheck,
      tone: 'amber',
    },
  ];

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((item) => (
        <SettingsTile key={item.href} {...item} />
      ))}
    </div>
  );
}

function SettingsTile({
  href,
  title,
  text,
  icon: Icon,
  tone = 'gold',
}: {
  href: string;
  title: string;
  text: string;
  icon: React.ElementType;
  tone?: 'gold' | 'blue' | 'purple' | 'green' | 'teal' | 'amber' | 'pink' | 'violet';
}) {
  const TONES: Record<string, { fg: string; bg: string; bd: string }> = {
    gold:   { fg: '#d4b876', bg: 'rgba(212,184,118,0.10)', bd: 'rgba(212,184,118,0.32)' },
    blue:   { fg: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  bd: 'rgba(96,165,250,0.32)' },
    purple: { fg: '#c084fc', bg: 'rgba(192,132,252,0.10)', bd: 'rgba(192,132,252,0.32)' },
    green:  { fg: '#4ade80', bg: 'rgba(74,222,128,0.10)',  bd: 'rgba(74,222,128,0.32)' },
    teal:   { fg: '#2dd4bf', bg: 'rgba(45,212,191,0.10)',  bd: 'rgba(45,212,191,0.32)' },
    amber:  { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  bd: 'rgba(251,191,36,0.32)' },
    pink:   { fg: '#f472b6', bg: 'rgba(244,114,182,0.10)', bd: 'rgba(244,114,182,0.32)' },
    violet: { fg: '#a78bfa', bg: 'rgba(167,139,250,0.10)', bd: 'rgba(167,139,250,0.32)' },
  };
  const t = TONES[tone] || TONES.gold;
  return (
    <Link
      href={href}
      className="group rounded-xl border p-4 transition"
      style={{ borderColor: LINE, background: CARD }}
      onMouseEnter={(e) => (e.currentTarget.style.background = CARD_HOVER)}
      onMouseLeave={(e) => (e.currentTarget.style.background = CARD)}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border"
          style={{ borderColor: t.bd, color: t.fg, background: t.bg }}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14.5px] font-semibold" style={{ color: TEXT }}>
            {title}
          </h2>
          <p className="mt-0.5 truncate text-[12px]" style={{ color: MUTED }}>
            {text}
          </p>
        </div>
        <ArrowRight size={15} className="transition group-hover:translate-x-0.5" style={{ color: t.fg }} />
      </div>
    </Link>
  );
}

// =====================================================================
// KATLANAN GENEL SECTION (Portal Şifreleri, Agent için kullanılır)
// =====================================================================

function CollapsibleSection({
  id,
  icon: Icon,
  title,
  subtitle,
  defaultOpen = false,
  tone = 'gold',
  children,
}: {
  id: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  defaultOpen?: boolean;
  tone?: 'gold' | 'blue' | 'purple' | 'green' | 'teal' | 'amber' | 'pink' | 'violet';
  children: React.ReactNode;
}) {
  const TONES: Record<string, { fg: string; bg: string; bd: string }> = {
    gold:   { fg: '#d4b876', bg: 'rgba(212,184,118,0.10)', bd: 'rgba(212,184,118,0.32)' },
    blue:   { fg: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  bd: 'rgba(96,165,250,0.32)' },
    purple: { fg: '#c084fc', bg: 'rgba(192,132,252,0.10)', bd: 'rgba(192,132,252,0.32)' },
    green:  { fg: '#4ade80', bg: 'rgba(74,222,128,0.10)',  bd: 'rgba(74,222,128,0.32)' },
    teal:   { fg: '#2dd4bf', bg: 'rgba(45,212,191,0.10)',  bd: 'rgba(45,212,191,0.32)' },
    amber:  { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  bd: 'rgba(251,191,36,0.32)' },
    pink:   { fg: '#f472b6', bg: 'rgba(244,114,182,0.10)', bd: 'rgba(244,114,182,0.32)' },
    violet: { fg: '#a78bfa', bg: 'rgba(167,139,250,0.10)', bd: 'rgba(167,139,250,0.32)' },
  };
  const t = TONES[tone] || TONES.gold;
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      id={id}
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: LINE, background: CARD }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-5 text-left transition"
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border"
          style={{ borderColor: t.bd, background: t.bg, color: t.fg }}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>
            {title}
          </h2>
          <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
            {subtitle}
          </p>
        </div>
        <span
          className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: open ? GOLD : MUTED }}
        >
          {open ? 'Gizle' : 'Aç'}
        </span>
        <ArrowRight
          size={16}
          className="transition"
          style={{ color: GOLD, transform: open ? 'rotate(90deg)' : 'none' }}
        />
      </button>

      {open && (
        <div className="border-t px-5 pb-5 pt-4" style={{ borderColor: LINE }}>
          {children}
        </div>
      )}
    </section>
  );
}

// =====================================================================
// MESAJ ŞABLONLARI
// =====================================================================

function MessageTemplatesSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: () => api.get('/sms-templates').then((res) => res.data),
  });

  const [evrakTalep, setEvrakTalep] = useState('');
  const [evrakGeldi, setEvrakGeldi] = useState('');
  const [tahsilat, setTahsilat] = useState('');
  const [editing, setEditing] = useState(false);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (payload: any) => api.patch('/sms-templates', payload),
    onSuccess: () => {
      toast.success('Mesaj şablonları kaydedildi');
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      setEditing(false);
    },
    onError: () => toast.error('Kayıt hatası'),
  });

  const handleEdit = () => {
    setEvrakTalep(data?.evrakTalepMesaji || '');
    setEvrakGeldi(data?.evrakGeldiMesaji || '');
    setTahsilat(data?.tahsilatHatirlatmaMesaji || '');
    setEditing(true);
  };

  return (
    <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: CARD }}>
      <SectionHeader
        icon={MessageSquareText}
        title="Mesaj Şablonları"
        subtitle="WhatsApp/SMS otomasyonlarında kullanılan metinler"
        tone="pink"
        action={
          !editing ? (
            <SmallButton onClick={handleEdit}>
              <Settings2 size={13} /> Düzenle
            </SmallButton>
          ) : null
        }
      />

      {isLoading ? (
        <LoadingLine />
      ) : editing ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5 text-[11px]" style={{ color: MUTED }}>
            <span>Değişkenler:</span>
            {['{ad}', '{dönem}', '{bakiye}'].map((tag) => (
              <code
                key={tag}
                className="rounded-md border px-1.5 py-0.5"
                style={{ borderColor: LINE, background: SOFT, color: GOLD }}
              >
                {tag}
              </code>
            ))}
          </div>
          <TemplateTextarea label="Evrak talebi" value={evrakTalep} onChange={setEvrakTalep} />
          <TemplateTextarea label="İşleme başlama onayı" value={evrakGeldi} onChange={setEvrakGeldi} />
          <TemplateTextarea label="Tahsilat hatırlatma" value={tahsilat} onChange={setTahsilat} />
          <div className="flex justify-end gap-2">
            <SmallButton onClick={() => setEditing(false)}>İptal</SmallButton>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                save({
                  evrakTalepMesaji: evrakTalep,
                  evrakGeldiMesaji: evrakGeldi,
                  tahsilatHatirlatmaMesaji: tahsilat,
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-bold disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
            >
              {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Kaydet
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-3">
          <TemplatePreview label="Evrak Talebi" value={data?.evrakTalepMesaji || '—'} />
          <TemplatePreview label="İşleme Başlama" value={data?.evrakGeldiMesaji || '—'} />
          <TemplatePreview label="Tahsilat" value={data?.tahsilatHatirlatmaMesaji || '—'} />
        </div>
      )}
    </section>
  );
}

// =====================================================================
// MOREN AGENT — token + bookmarklet (CollapsibleSection içine giriyor)
// =====================================================================

function AgentContent() {
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);

  const { data: info, isLoading } = useQuery({
    queryKey: ['agent-me-token'],
    queryFn: () =>
      api.get('/agent/me/token').then(
        (res) => res.data as { token: string; tenantName: string | null },
      ),
  });

  const portalOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const scriptUrl = `${portalOrigin}/moren-agent.js`;
  const bookmarkletCode =
    `javascript:(function(){var s=document.createElement('script');` +
    `s.src='${scriptUrl}?v='+Date.now();` +
    `document.head.appendChild(s);})();`;

  const copy = async (text: string, which: 'token' | 'bookmarklet') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'token') {
        setCopiedToken(true);
        setTimeout(() => setCopiedToken(false), 1500);
      } else {
        setCopiedBookmarklet(true);
        setTimeout(() => setCopiedBookmarklet(false), 1500);
      }
      toast.success('Kopyalandı');
    } catch {
      toast.error('Kopyalanamadı');
    }
  };

  if (isLoading) return <LoadingLine />;

  return (
    <div className="space-y-3">
      <a
        href={bookmarkletCode}
        onClick={(event) => event.preventDefault()}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-bold"
        style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
      >
        <ExternalLink size={14} /> Bookmarklet'i Çalıştır
      </a>

      <Field label="Agent Token">
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={info?.token || ''}
            className="h-9 flex-1 rounded-md border px-2.5 font-mono text-[11.5px] outline-none"
            style={{ background: SOFT, borderColor: LINE, color: TEXT }}
            onFocus={(event) => event.currentTarget.select()}
          />
          <SmallButton onClick={() => copy(info?.token || '', 'token')} active={copiedToken}>
            {copiedToken ? <Check size={13} /> : <Copy size={13} />}
            {copiedToken ? 'Kopyalandı' : 'Kopyala'}
          </SmallButton>
        </div>
      </Field>

      <Field label="Bookmarklet Kodu">
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={bookmarkletCode}
            className="h-9 flex-1 rounded-md border px-2.5 font-mono text-[11.5px] outline-none"
            style={{ background: SOFT, borderColor: LINE, color: TEXT }}
            onFocus={(event) => event.currentTarget.select()}
          />
          <SmallButton onClick={() => copy(bookmarkletCode, 'bookmarklet')} active={copiedBookmarklet}>
            {copiedBookmarklet ? <Check size={13} /> : <Copy size={13} />}
            {copiedBookmarklet ? 'Kopyalandı' : 'Kopyala'}
          </SmallButton>
        </div>
      </Field>
    </div>
  );
}

// =====================================================================
// YARDIMCI BİLEŞENLER
// =====================================================================

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
  tone = 'gold',
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  tone?: 'gold' | 'blue' | 'purple' | 'green' | 'teal' | 'amber' | 'pink' | 'violet';
}) {
  const TONES: Record<string, { fg: string; bg: string; bd: string }> = {
    gold:   { fg: '#d4b876', bg: 'rgba(212,184,118,0.10)', bd: 'rgba(212,184,118,0.32)' },
    blue:   { fg: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  bd: 'rgba(96,165,250,0.32)' },
    purple: { fg: '#c084fc', bg: 'rgba(192,132,252,0.10)', bd: 'rgba(192,132,252,0.32)' },
    green:  { fg: '#4ade80', bg: 'rgba(74,222,128,0.10)',  bd: 'rgba(74,222,128,0.32)' },
    teal:   { fg: '#2dd4bf', bg: 'rgba(45,212,191,0.10)',  bd: 'rgba(45,212,191,0.32)' },
    amber:  { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  bd: 'rgba(251,191,36,0.32)' },
    pink:   { fg: '#f472b6', bg: 'rgba(244,114,182,0.10)', bd: 'rgba(244,114,182,0.32)' },
    violet: { fg: '#a78bfa', bg: 'rgba(167,139,250,0.10)', bd: 'rgba(167,139,250,0.32)' },
  };
  const t = TONES[tone] || TONES.gold;
  return (
    <div className="mb-4 flex items-start gap-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
        style={{ borderColor: t.bd, background: t.bg, color: t.fg }}
      >
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>{title}</h2>
        <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function SmallButton({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition hover:bg-white/[0.06]"
      style={{
        borderColor: active ? LINE_GOLD : LINE,
        color: active ? GOLD : TEXT,
        background: active ? 'rgba(212,184,118,0.08)' : SOFT,
      }}
    >
      {children}
    </button>
  );
}

function TemplateTextarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-20 w-full resize-none rounded-md border px-2.5 py-2 text-[13px] outline-none"
        style={{ background: SOFT, borderColor: LINE, color: TEXT }}
      />
    </label>
  );
}

function TemplatePreview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3" style={{ borderColor: LINE, background: SOFT }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
        {label}
      </p>
      <p className="mt-2 min-h-[48px] text-[12.5px] leading-relaxed" style={{ color: TEXT }}>
        {value}
      </p>
    </div>
  );
}

function LoadingLine() {
  return (
    <div className="flex items-center gap-2 text-[13px]" style={{ color: MUTED }}>
      <Loader2 size={14} className="animate-spin" /> Yükleniyor…
    </div>
  );
}
