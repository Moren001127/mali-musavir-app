'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  ArrowRight,
  Bot,
  Check,
  Copy,
  ExternalLink,
  FileCheck2,
  KeyRound,
  Loader2,
  Mail,
  MessageSquareText,
  Plug,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  UsersRound,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { AdvisorPortalCredentialCard } from '@/components/portal-automation/PortalCredentialCards';

const GOLD = '#d4b876';
const GOLD_DEEP = '#8b7649';
const LINE = 'rgba(255,255,255,0.08)';
const LINE_GOLD = 'rgba(212,184,118,0.24)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const SOFT = 'rgba(255,255,255,0.035)';

function MorenAgentSection() {
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

  return (
    <section className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
      <SectionHeader
        icon={Bot}
        title="Moren Agent"
        subtitle="Tarayıcı oturumu ve yerel otomasyon bağlantısı"
        action={
          <a
            href={bookmarkletCode}
            onClick={(event) => event.preventDefault()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-bold"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
          >
            <ExternalLink size={14} />
            Başlat
          </a>
        }
      />

      {isLoading ? (
        <LoadingLine />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-4">
            <Field label="Agent token">
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={info?.token || ''}
                  className="h-10 flex-1 rounded-lg border px-3 font-mono text-[12px] outline-none"
                  style={{ background: SOFT, borderColor: LINE, color: TEXT }}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <IconTextButton onClick={() => copy(info?.token || '', 'token')} active={copiedToken}>
                  {copiedToken ? <Check size={14} /> : <Copy size={14} />}
                  {copiedToken ? 'Tamam' : 'Kopyala'}
                </IconTextButton>
              </div>
            </Field>

            <Field label="Bookmarklet kodu">
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={bookmarkletCode}
                  className="h-10 flex-1 rounded-lg border px-3 font-mono text-[12px] outline-none"
                  style={{ background: SOFT, borderColor: LINE, color: TEXT }}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <IconTextButton onClick={() => copy(bookmarkletCode, 'bookmarklet')} active={copiedBookmarklet}>
                  {copiedBookmarklet ? <Check size={14} /> : <Copy size={14} />}
                  {copiedBookmarklet ? 'Kopyalandı' : 'Kopyala'}
                </IconTextButton>
              </div>
            </Field>
          </div>

          <div className="rounded-lg border p-4" style={{ borderColor: LINE_GOLD, background: 'rgba(212,184,118,0.07)' }}>
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border" style={{ borderColor: LINE_GOLD, color: GOLD }}>
              <Workflow size={17} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: TEXT }}>Otomasyon kanalı hazır</h3>
            <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: MUTED }}>
              Luca güvenlik kodları, Mihsap işlemleri ve portal komutları aynı agent hattından yönetilir.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function SmsTemplateSection() {
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
    <section className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
      <SectionHeader
        icon={MessageSquareText}
        title="SMS / WhatsApp Şablonları"
        subtitle="Evrak ve tahsilat mesaj metinleri"
        action={!editing ? (
          <IconTextButton onClick={handleEdit}>
            <Settings2 size={14} />
            Düzenle
          </IconTextButton>
        ) : null}
      />

      {isLoading ? (
        <LoadingLine />
      ) : editing ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-[11.5px]" style={{ color: MUTED }}>
            {['{ad}', '{dönem}', '{bakiye}'].map((tag) => (
              <code key={tag} className="rounded-md border px-2 py-1" style={{ borderColor: LINE, background: SOFT, color: GOLD }}>{tag}</code>
            ))}
          </div>
          <TemplateTextarea label="Evrak talebi" value={evrakTalep} onChange={setEvrakTalep} />
          <TemplateTextarea label="İşleme başlama onayı" value={evrakGeldi} onChange={setEvrakGeldi} />
          <TemplateTextarea label="Tahsilat hatırlatma" value={tahsilat} onChange={setTahsilat} />
          <div className="flex justify-end gap-2">
            <IconTextButton onClick={() => setEditing(false)}>İptal</IconTextButton>
            <button
              type="button"
              disabled={isPending}
              onClick={() => save({ evrakTalepMesaji: evrakTalep, evrakGeldiMesaji: evrakGeldi, tahsilatHatirlatmaMesaji: tahsilat })}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[12.5px] font-bold disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
            >
              {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Kaydet
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <TemplatePreview label="Evrak Talebi" value={data?.evrakTalepMesaji || '—'} />
          <TemplatePreview label="İşleme Başlama" value={data?.evrakGeldiMesaji || '—'} />
          <TemplatePreview label="Tahsilat" value={data?.tahsilatHatirlatmaMesaji || '—'} />
        </div>
      )}
    </section>
  );
}

export default function AyarlarPage() {
  const links = [
    {
      href: '/panel/ayarlar/kullanicilar',
      title: 'Kullanıcılar & Erişim',
      text: 'Personel hesapları ve roller',
      icon: UsersRound,
    },
    {
      href: '/panel/ayarlar/entegrasyonlar',
      title: 'Entegrasyonlar (E-posta + WhatsApp)',
      text: 'SMTP, WhatsApp Cloud API ayarları ve test',
      icon: Plug,
    },
    {
      href: '/panel/ayarlar/beyanname-takip',
      title: 'Mükellef Beyanname Takip',
      text: 'Beyan türleri ve dönem ayarları',
      icon: FileCheck2,
    },
    {
      href: '/panel/ayarlar/denetim',
      title: 'Denetim Günlüğü',
      text: 'Sistem kayıtları ve izler',
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: GOLD }}>Sistem</p>
            <h1 className="mt-1 text-[30px] font-semibold leading-tight" style={{ color: TEXT }}>Ayarlar</h1>
            <p className="mt-2 max-w-2xl text-[13px]" style={{ color: MUTED }}>
              Yetki, portal şifreleri, agent bağlantısı ve mesaj metinleri tek düzende.
            </p>
          </div>
          <Link
            href="/panel/hatirlatmalar"
            className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[13px] font-bold"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
          >
            <Send size={15} />
            WhatsApp Akışları
          </Link>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        {links.map((item) => (
          <SettingsTile key={item.href} {...item} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <main className="space-y-5">
          <MorenAgentSection />
          <AdvisorPortalCredentialCard />
          <SmsTemplateSection />
        </main>

        <aside className="space-y-5">
          <SidePanel
            icon={MessageSquareText}
            title="WhatsApp Otomasyonu"
            text="Evrak ve tahsilat mesajları hatırlatma ekranından önizlenir ve gönderilir."
            href="/panel/hatirlatmalar"
            action="Akışı Aç"
          />
          <SidePanel
            icon={KeyRound}
            title="Şifre Yönetimi"
            text="e-Beyanname, Vergi Dairesi ve SGK bilgileri şifreli kasada saklanır."
          />
          <div className="rounded-lg border bg-[#0f0d0b]/80 p-5 opacity-75" style={{ borderColor: LINE }}>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border" style={{ borderColor: LINE, color: MUTED }}>
              <Settings2 size={18} />
            </div>
            <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>Diğer Ayarlar</h2>
            <p className="mt-2 text-[13px]" style={{ color: MUTED }}>
              Ofis bilgileri, logo ve bildirim tercihleri için alan ayrıldı.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border" style={{ borderColor: LINE_GOLD, background: 'rgba(212,184,118,0.09)', color: GOLD }}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-[16px] font-semibold" style={{ color: TEXT }}>{title}</h2>
        <p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold" style={{ color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

function IconTextButton({ children, onClick, active }: { children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition hover:bg-white/[0.06]"
      style={{ borderColor: active ? LINE_GOLD : LINE, color: active ? GOLD : TEXT, background: active ? 'rgba(212,184,118,0.08)' : SOFT }}
    >
      {children}
    </button>
  );
}

function TemplateTextarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold" style={{ color: MUTED }}>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-24 w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ background: SOFT, borderColor: LINE, color: TEXT }}
      />
    </label>
  );
}

function TemplatePreview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: LINE, background: SOFT }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: GOLD }}>{label}</p>
      <p className="mt-3 min-h-[54px] text-[13px] leading-relaxed" style={{ color: TEXT }}>{value}</p>
    </div>
  );
}

function SettingsTile({ href, title, text, icon: Icon }: { href: string; title: string; text: string; icon: React.ElementType }) {
  return (
    <Link
      href={href}
      className="group rounded-lg border bg-[#0f0d0b]/80 p-4 transition hover:bg-white/[0.035]"
      style={{ borderColor: LINE }}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border" style={{ borderColor: LINE_GOLD, color: GOLD, background: 'rgba(212,184,118,0.08)' }}>
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold" style={{ color: TEXT }}>{title}</h2>
          <p className="mt-1 truncate text-[12.5px]" style={{ color: MUTED }}>{text}</p>
        </div>
        <ArrowRight size={16} className="transition group-hover:translate-x-0.5" style={{ color: GOLD }} />
      </div>
    </Link>
  );
}

function SidePanel({
  icon: Icon,
  title,
  text,
  href,
  action,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
  href?: string;
  action?: string;
}) {
  const content = (
    <div className="rounded-lg border bg-[#0f0d0b]/80 p-5 transition hover:bg-white/[0.035]" style={{ borderColor: LINE }}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border" style={{ borderColor: LINE_GOLD, color: GOLD, background: 'rgba(212,184,118,0.08)' }}>
        <Icon size={18} />
      </div>
      <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: MUTED }}>{text}</p>
      {action && (
        <p className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: GOLD }}>
          {action}
          <ArrowRight size={14} />
        </p>
      )}
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function LoadingLine() {
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
      <Loader2 size={14} className="animate-spin" />
      Yükleniyor...
    </div>
  );
}
