'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  MessageSquareText,
  Plug,
  Settings2,
  ShieldCheck,
  UsersRound,
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


// =====================================================================
// ANA SAYFA
// =====================================================================

export default function AyarlarPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
        <PageHeader />
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
        <TwoFactorSection />
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
  );
}

// =====================================================================
// HEADER
// =====================================================================

function PageHeader() {
  return (
    <header
      className="relative overflow-hidden rounded-2xl border p-5"
      style={{
        borderColor: 'rgba(255,255,255,0.08)',
        background:
          'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.18), transparent 45%), radial-gradient(120% 140% at 100% 0%, rgba(217,160,108,0.12), transparent 45%), #0f0d0b',
      }}
    >
      {/* üst renk şeridi */}
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: 'linear-gradient(90deg, #d4b876, #e0b878, #d9a06c, #b8863a)' }}
      />
      <Link href="/panel" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: MUTED }}>
        <ArrowLeft size={14} /> Panel
      </Link>
      <div className="mt-2 flex items-center gap-2.5">
        <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight" style={{ color: TEXT }}>
          <span
            className="grid h-10 w-10 place-items-center rounded-xl"
            style={{ background: 'linear-gradient(135deg, #d4b876, #8b7649)', boxShadow: '0 6px 18px rgba(212,184,118,0.35)' }}
          >
            <Settings2 size={22} style={{ color: '#1a1410' }} />
          </span>
          Ayarlar
        </h1>
      </div>
      <p className="mt-2 max-w-2xl text-[13px]" style={{ color: MUTED }}>
        Erişim, entegrasyonlar ve portal şifreleri.
      </p>
    </header>
  );
}

// =====================================================================
// AYAR KATEGORİLERİ — tile grid
// (E-posta/WhatsApp bağlantı durumu Entegrasyonlar kartında nokta olarak
//  gösterilir — eski üçlü durum şeridi kaldırıldı, tek giriş noktası.)
// =====================================================================

function SettingsGrid() {
  const { data: emailCfg } = useQuery({
    queryKey: ['integration-email-status'],
    queryFn: () => api.get('/integrations/email').then((r) => r.data),
  });
  const { data: waCfg } = useQuery({
    queryKey: ['integration-whatsapp-status'],
    queryFn: () => api.get('/integrations/whatsapp').then((r) => r.data),
  });

  const entegrasyonDurum = [
    { label: 'E-posta', ok: !!emailCfg?.configured },
    { label: 'WhatsApp', ok: !!waCfg?.configured },
  ];

  const links: Array<{ href: string; title: string; text: string; icon: any; tone: 'blue'|'purple'|'green'|'teal'|'amber'|'pink'; status?: Array<{ label: string; ok: boolean }> }> = [
    {
      href: '/panel/ayarlar/entegrasyonlar',
      title: 'Entegrasyonlar',
      text: 'E-posta (SMTP) + WhatsApp bağlantısı',
      icon: Plug,
      tone: 'blue',
      status: entegrasyonDurum,
    },
    {
      href: '/panel/ayarlar/kullanicilar',
      title: 'Kullanıcılar & Erişim',
      text: 'Personel hesapları, roller',
      icon: UsersRound,
      tone: 'purple',
    },
    {
      href: '/panel/hatirlatmalar',
      title: 'WhatsApp Otomasyonu',
      text: 'Evrak ve tahsilat hatırlatma akışları',
      icon: MessageSquareText,
      tone: 'teal',
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
  status,
}: {
  href: string;
  title: string;
  text: string;
  icon: React.ElementType;
  tone?: 'gold' | 'blue' | 'purple' | 'green' | 'teal' | 'amber' | 'pink' | 'violet';
  status?: Array<{ label: string; ok: boolean }>;
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
  const idle = `linear-gradient(135deg, ${t.fg}1f, rgba(255,255,255,0.02)), ${CARD}`;
  const hover = `linear-gradient(135deg, ${t.fg}2e, rgba(255,255,255,0.03)), ${CARD_HOVER}`;
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-xl border p-4 transition"
      style={{ borderColor: t.bd, background: idle }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = idle)}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${t.fg}, ${t.fg}33)` }}
      />
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ color: '#0f0d0b', background: `linear-gradient(135deg, ${t.fg}, ${t.fg}aa)`, boxShadow: `0 4px 12px ${t.fg}33` }}
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
          {status && status.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              {status.map((s) => (
                <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: s.ok ? GREEN : RED }}>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: s.ok ? GREEN : RED, boxShadow: `0 0 6px ${s.ok ? GREEN : RED}66` }}
                  />
                  {s.label} {s.ok ? 'bağlı' : 'bağlı değil'}
                </span>
              ))}
            </div>
          )}
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
      className="relative rounded-xl border overflow-hidden"
      style={{ borderColor: t.bd, background: `linear-gradient(135deg, ${t.fg}14, rgba(255,255,255,0.015)), ${CARD}` }}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${t.fg}, ${t.fg}33)` }}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-5 text-left transition"
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `linear-gradient(135deg, ${t.fg}, ${t.fg}aa)`, color: '#0f0d0b', boxShadow: `0 4px 12px ${t.fg}33` }}
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
// İKİ ADIMLI DOĞRULAMA (2FA)
// =====================================================================

function TwoFactorSection() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: ['2fa-status'],
    queryFn: () => api.get('/auth/2fa/status').then((r) => r.data),
  });
  const enabled = !!status?.enabled;
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');

  const setupMut = useMutation({
    mutationFn: () => api.post('/auth/2fa/setup').then((r) => r.data),
    onSuccess: (d: any) => setSetup(d),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kurulum başlatılamadı'),
  });
  const enableMut = useMutation({
    mutationFn: () => api.post('/auth/2fa/enable', { code }).then((r) => r.data),
    onSuccess: () => {
      toast.success('İki adımlı doğrulama açıldı');
      setSetup(null);
      setCode('');
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kod doğrulanamadı'),
  });
  const disableMut = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable', { code }).then((r) => r.data),
    onSuccess: () => {
      toast.success('İki adımlı doğrulama kapatıldı');
      setCode('');
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kod doğrulanamadı'),
  });

  const codeInput = (
    <input
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      placeholder="6 haneli kod"
      className="w-40 rounded-lg px-3 py-2.5 text-[14px] tracking-[0.3em] outline-none"
      style={{ background: SOFT, border: `1px solid ${LINE_GOLD}`, color: TEXT }}
    />
  );

  return (
    <CollapsibleSection
      id="2fa"
      icon={ShieldCheck}
      title="İki Adımlı Doğrulama (2FA)"
      subtitle="Authenticator uygulamasıyla girişe ikinci güvenlik katmanı"
      tone="gold"
    >
      {isLoading ? (
        <p className="text-[13px]" style={{ color: MUTED }}>Yükleniyor…</p>
      ) : enabled ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[13.5px]" style={{ color: GREEN }}>
            <CheckCircle2 size={16} /> Açık — girişte authenticator kodu istenir.
          </div>
          <p className="text-[12.5px]" style={{ color: MUTED }}>Kapatmak için uygulamadaki güncel kodu girin:</p>
          <div className="flex flex-wrap items-center gap-2">
            {codeInput}
            <button
              type="button"
              onClick={() => disableMut.mutate()}
              disabled={code.length !== 6 || disableMut.isPending}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold disabled:opacity-40"
              style={{ background: 'rgba(248,113,113,0.12)', border: `1px solid ${RED}55`, color: RED }}
            >
              {disableMut.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Kapat
            </button>
          </div>
        </div>
      ) : setup ? (
        <div className="space-y-4">
          <p className="text-[13px]" style={{ color: MUTED }}>
            <strong style={{ color: TEXT }}>1)</strong> Authenticator uygulamanıza (Google Authenticator, Authy vb.) aşağıdaki anahtarı elle ekleyin:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg px-3 py-2 text-[14px] tracking-widest" style={{ background: SOFT, border: `1px solid ${LINE}`, color: GOLD }}>
              {setup.secret}
            </code>
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText(setup.secret.replace(/\s/g, '')); toast.success('Anahtar kopyalandı'); }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px]"
              style={{ background: SOFT, border: `1px solid ${LINE}`, color: MUTED }}
            >
              <Copy size={13} /> Kopyala
            </button>
          </div>
          <p className="text-[13px]" style={{ color: MUTED }}>
            <strong style={{ color: TEXT }}>2)</strong> Uygulamadaki 6 haneli kodu girip etkinleştirin:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {codeInput}
            <button
              type="button"
              onClick={() => enableMut.mutate()}
              disabled={code.length !== 6 || enableMut.isPending}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
            >
              {enableMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Etkinleştir
            </button>
            <button type="button" onClick={() => { setSetup(null); setCode(''); }} className="text-[12.5px]" style={{ color: MUTED }}>
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: MUTED }}>
            Şifrenize ek olarak telefondaki authenticator uygulamasından 6 haneli kod ister. Şifreniz çalınsa bile giriş engellenir.
          </p>
          <button
            type="button"
            onClick={() => setupMut.mutate()}
            disabled={setupMut.isPending}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
          >
            {setupMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Etkinleştir
          </button>
        </div>
      )}
    </CollapsibleSection>
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

function LoadingLine() {
  return (
    <div className="flex items-center gap-2 text-[13px]" style={{ color: MUTED }}>
      <Loader2 size={14} className="animate-spin" /> Yükleniyor…
    </div>
  );
}
