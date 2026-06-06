'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Contact,
  FileCheck,
  FileText,
  Hash,
  Landmark,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Plus,
  Save,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  UserCog,
  UserRound,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import TaxpayerStatsCard from '@/components/TaxpayerStatsCard';
import DocumentExpiryWidget from '@/components/DocumentExpiryWidget';
import { MukellefiyetlerCard } from '@/components/mukellef/MukellefiyetlerCard';
import { TaxpayerPortalCredentialsCard } from '@/components/portal-automation/PortalCredentialCards';

// ── Kurumsal duo palet (altın marka + çelik mavisi yapı), siyah zemin ──
const GOLD = '#d4b876';
const GOLD_BR = '#ecd6a4';
const GOLD_DP = '#8b7649';
const STEEL = '#4f86c9';
const STEEL_BR = '#74a6e6';
const STEEL_DP = '#2b5489';
const STEEL_SF = 'rgba(79,134,201,0.13)';
const STEEL_LN = 'rgba(79,134,201,0.32)';
const TEXT = '#f5f5f4';
const MUTED = 'rgba(245,245,244,0.60)';
const FAINT = 'rgba(245,245,244,0.36)';
const CARD = '#131419';
const CARD2 = '#0e0f13';
const RAISE = '#181a20';
const HAIR = 'rgba(255,255,255,0.07)';
const LINE = 'rgba(255,255,255,0.11)';
const GREEN = '#5fcf8e';
const AMBER = '#f0b755';
const RED = '#ef6b6b';

const FIELD_CLS = 'h-[42px] w-full rounded-xl border border-white/10 bg-[#0c0d11] px-3.5 text-[13px] text-[#f5f5f4] outline-none transition placeholder:text-white/30 focus:border-[#4f86c9]/60 focus:bg-[#0e1014] focus:shadow-[0_0_0_3px_rgba(79,134,201,0.15)]';
const SELECT_CLS = `${FIELD_CLS} cursor-pointer`;
const TEXTAREA_CLS = 'w-full resize-none rounded-xl border border-white/10 bg-[#0c0d11] px-3.5 py-3 text-[13px] text-[#f5f5f4] outline-none transition placeholder:text-white/30 focus:border-[#4f86c9]/60 focus:bg-[#0e1014] focus:shadow-[0_0_0_3px_rgba(79,134,201,0.15)]';

const TAXPAYER_TYPES = [
  { value: 'TUZEL_KISI', label: 'Tüzel Kişi', detail: 'Şirket veya kurum kaydı' },
  { value: 'GERCEK_KISI', label: 'Gerçek Kişi', detail: 'Şahıs işletmesi veya bireysel kayıt' },
] as const;

type TaxpayerType = (typeof TAXPAYER_TYPES)[number]['value'];
type DefterTuru = 'BILANCO' | 'ISLETME';

type FormState = {
  type: TaxpayerType;
  companyName: string;
  firstName: string;
  lastName: string;
  taxNumber: string;
  taxOffice: string;
  phones: string[];
  emails: string[];
  address: string;
  notes: string;
  startDate: string;
  endDate: string;
  evrakTeslimGunu: string | number;
  whatsappEvrakTalep: boolean;
  whatsappEvrakGeldi: boolean;
  isEFaturaMukellefi: boolean;
  lucaSlug: string;
  mihsapId: string;
  mihsapDefterTuru: string;
  defterTuru: DefterTuru;
  // v1.37.0 yeni alanlar
  logoUrl: string;
  naceKodu: string;
  ticaretSicilNo: string;
  mersisNo: string;
  odaSicilNo: string;
  bagkurSicilNo: string;
  kepAdresi: string;
  webSitesi: string;
  eFaturaEntegrator: string;
};

function emptyForm(): FormState {
  return {
    type: 'TUZEL_KISI',
    companyName: '',
    firstName: '',
    lastName: '',
    taxNumber: '',
    taxOffice: '',
    phones: ['', '', ''],
    emails: ['', '', ''],
    address: '',
    notes: '',
    startDate: '',
    endDate: '',
    evrakTeslimGunu: '',
    whatsappEvrakTalep: false,
    whatsappEvrakGeldi: false,
    isEFaturaMukellefi: false,
    lucaSlug: '',
    mihsapId: '',
    mihsapDefterTuru: 'BILANCO',
    defterTuru: 'BILANCO',
    logoUrl: '',
    naceKodu: '',
    ticaretSicilNo: '',
    mersisNo: '',
    odaSicilNo: '',
    bagkurSicilNo: '',
    kepAdresi: '',
    webSitesi: '',
    eFaturaEntegrator: '',
  };
}

function displayName(item: any) {
  return (
    item?.companyName ||
    [item?.firstName, item?.lastName].filter(Boolean).join(' ') ||
    item?.taxNumber ||
    'Mükellef'
  );
}

function initialsFor(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function fmtDateTR(iso: string): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

const COMPLETENESS_COLOR: Record<string, string> = {
  TAM: GREEN,
  IYI: '#9bd445',
  EKSIK: AMBER,
  KRITIK_EKSIK: RED,
};

// ============================================================
// KISAYOL GİRİŞLERİ — devlet portalları + sık sorgular (açılır panelde)
// ============================================================
type Kisayol = { id: string; label: string; url: string; renk: string; kisaltma: string };

const PORTAL_KISAYOLLAR: Kisayol[] = [
  { id: 'dijital_vd',    label: 'Dijital Vergi Dairesi',  url: 'https://dijital.gib.gov.tr',                renk: '#0066b3', kisaltma: 'VD' },
  { id: 'gib_ivd',       label: 'GİB İnteraktif V.D.',    url: 'https://ivd.gib.gov.tr',                    renk: '#c8102e', kisaltma: 'GİB' },
  { id: 'ebeyanname',    label: 'E-Beyanname',            url: 'https://ebeyanname.gib.gov.tr',             renk: '#28a745', kisaltma: 'eB' },
  { id: 'edefter',       label: 'e-Defter',               url: 'https://uyg.edefter.gov.tr',                renk: '#6f42c1', kisaltma: 'eD' },
  { id: 'earsiv',        label: 'E-Arşiv Portal',         url: 'https://earsivportal.efatura.gov.tr',       renk: '#c8102e', kisaltma: 'eA' },
  { id: 'mersis',        label: 'Mersis',                 url: 'https://mersis.gtb.gov.tr',                 renk: '#0066b3', kisaltma: 'M' },
  { id: 'tobb',          label: 'TOBB Bilgi Merkezi',     url: 'https://bilgimerkezi.tobb.org.tr',          renk: '#fd7e14', kisaltma: 'TB' },
  { id: 'sgk_ebildirge', label: 'SGK E-Bildirge V2',      url: 'https://uyg.sgk.gov.tr/IsverenSistemi',     renk: '#1d70b8', kisaltma: 'SGK' },
  { id: 'sgk_isveren',   label: 'SGK İşveren Sistemi',    url: 'https://uyg.sgk.gov.tr/IsverenSistemi',     renk: '#1d70b8', kisaltma: 'SGK' },
  { id: 'sgk_erapor',    label: 'SGK E-Rapor',            url: 'https://uyg.sgk.gov.tr/eRaporIsveren',      renk: '#1d70b8', kisaltma: 'SGK' },
  { id: 'sgk_isegiris',  label: 'SGK İşe Giriş/Çıkış',    url: 'https://uyg.sgk.gov.tr/SgkIsgs',            renk: '#1d70b8', kisaltma: 'SGK' },
  { id: 'edevlet',       label: 'e-Devlet (Türkiye.gov)', url: 'https://www.turkiye.gov.tr',                renk: '#dc3545', kisaltma: 'eD' },
];

const HIZLI_SORGULAR: Kisayol[] = [
  { id: 'vergi_borcu',   label: 'Vergi Borcu Sorgula',  url: 'https://ivd.gib.gov.tr',          renk: '#c8102e', kisaltma: '?' },
  { id: 'vergi_levha',   label: 'Vergi Levhası',        url: 'https://ivd.gib.gov.tr',          renk: '#c8102e', kisaltma: '?' },
  { id: 'mukellefiyet',  label: 'Mükellefiyet Yazısı',  url: 'https://ivd.gib.gov.tr',          renk: '#c8102e', kisaltma: '?' },
  { id: 'nace',          label: 'NACE Kodu',            url: 'https://www.tuik.gov.tr',         renk: '#c8102e', kisaltma: '?' },
  { id: 'sgk_borcyok',   label: 'SGK Borç Yoktur',      url: 'https://uyg.sgk.gov.tr',          renk: '#1d70b8', kisaltma: '?' },
  { id: 'sgk_donem',     label: 'SGK Dönem Borç',       url: 'https://uyg.sgk.gov.tr',          renk: '#1d70b8', kisaltma: '?' },
  { id: 'ticaret_sicil', label: 'Tic. Sicil Gazetesi',  url: 'https://www.ticaretsicil.gov.tr', renk: '#fd7e14', kisaltma: '?' },
  { id: 'mersis_firma',  label: 'Mersis Firma Bilgi',   url: 'https://mersis.gtb.gov.tr',       renk: '#fd7e14', kisaltma: '?' },
];

// ============================================================
// SEKMELER + ayrı sayfaya götüren link modülleri (hızlı erişim)
// ============================================================
type TabKey = 'bilgiler' | 'mukellefiyetler' | 'sgk' | 'tebligat' | 'notlar';

const REAL_TABS: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
  { key: 'bilgiler',        label: 'Bilgiler',        icon: UserRound },
  { key: 'mukellefiyetler', label: 'Mükellefiyetler', icon: FileCheck },
  { key: 'sgk',             label: 'SGK',             icon: Shield },
  { key: 'tebligat',        label: 'E-Tebligat',      icon: Mail },
  { key: 'notlar',          label: 'Notlar',          icon: MessageSquareText },
];

const LINK_MODULES: Array<{ label: string; icon: React.ElementType; href: string }> = [
  { label: 'Beyannameler', icon: FileText,    href: '/panel/beyannameler' },
  { label: 'Evraklar',     icon: BookOpen,    href: '/panel/evraklar' },
  { label: 'Cari Hesap',   icon: Landmark,    href: '/panel/cari-kasa' },
  { label: 'KDV Kontrol',  icon: ShieldCheck, href: '/panel/kdv-kontrol' },
];

export default function MukellefDetayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const isNew = id === 'yeni';

  const [activeTab, setActiveTab] = useState<TabKey>('bilgiler');
  const [portalOpen, setPortalOpen] = useState(false);

  const { data: taxpayer, isLoading } = useQuery({
    queryKey: ['taxpayer', id],
    queryFn: () => api.get(`/taxpayers/${id}`).then((res) => res.data),
    enabled: !isNew,
  });

  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers', 'card-nav'],
    queryFn: () => api.get('/taxpayers').then((res) => res.data),
    enabled: !isNew,
  });

  const { data: completeness } = useQuery<any>({
    queryKey: ['taxpayer-completeness', id],
    queryFn: () => api.get(`/taxpayers/${id}/completeness`).then((r) => r.data),
    enabled: !isNew && !!id,
    refetchInterval: 60_000,
  });

  const [form, setForm] = useState<FormState>(() => emptyForm());

  useEffect(() => {
    if (!taxpayer) return;

    const phones = [...(taxpayer.phones || []), '', '', ''].slice(0, 3);
    const emails = [...(taxpayer.emails || []), '', '', ''].slice(0, 3);
    const defterTuru = (((taxpayer as any).defterTuru || taxpayer.mihsapDefterTuru) === 'DEFTER_BEYAN'
      ? 'ISLETME'
      : ((taxpayer as any).defterTuru ?? 'BILANCO')) as DefterTuru;

    setForm({
      type: taxpayer.type || 'TUZEL_KISI',
      companyName: taxpayer.companyName || '',
      firstName: taxpayer.firstName || '',
      lastName: taxpayer.lastName || '',
      taxNumber: taxpayer.taxNumber || '',
      taxOffice: taxpayer.taxOffice || '',
      phones,
      emails,
      address: taxpayer.address || '',
      notes: taxpayer.notes || '',
      startDate: taxpayer.startDate ? taxpayer.startDate.substring(0, 10) : '',
      endDate: taxpayer.endDate ? taxpayer.endDate.substring(0, 10) : '',
      evrakTeslimGunu: taxpayer.evrakTeslimGunu ?? '',
      whatsappEvrakTalep: taxpayer.whatsappEvrakTalep ?? false,
      whatsappEvrakGeldi: taxpayer.whatsappEvrakGeldi ?? false,
      isEFaturaMukellefi: (taxpayer as any).isEFaturaMukellefi ?? false,
      lucaSlug: taxpayer.lucaSlug ?? '',
      mihsapId: taxpayer.mihsapId ?? '',
      mihsapDefterTuru: taxpayer.mihsapDefterTuru ?? (defterTuru === 'ISLETME' ? 'DEFTER_BEYAN' : 'BILANCO'),
      defterTuru,
      logoUrl: (taxpayer as any).logoUrl ?? '',
      naceKodu: (taxpayer as any).naceKodu ?? '',
      ticaretSicilNo: (taxpayer as any).ticaretSicilNo ?? '',
      mersisNo: (taxpayer as any).mersisNo ?? '',
      odaSicilNo: (taxpayer as any).odaSicilNo ?? '',
      bagkurSicilNo: (taxpayer as any).bagkurSicilNo ?? '',
      kepAdresi: (taxpayer as any).kepAdresi ?? '',
      webSitesi: (taxpayer as any).webSitesi ?? '',
      eFaturaEntegrator: (taxpayer as any).eFaturaEntegrator ?? '',
    });
  }, [taxpayer]);

  const { mutate: saveData, isPending } = useMutation({
    mutationFn: (data: any) => (isNew ? api.post('/taxpayers', data) : api.put(`/taxpayers/${id}`, data)),
    onSuccess: () => {
      toast.success(isNew ? 'Mükellef eklendi' : 'Mükellef güncellendi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      qc.invalidateQueries({ queryKey: ['taxpayer', id] });
      if (isNew) router.push('/panel/mukellefler');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : msg || 'Kayıt hatası');
    },
  });

  const { mutate: deleteMukellef, isPending: isDeleting } = useMutation({
    mutationFn: () => api.delete(`/taxpayers/${id}`),
    onSuccess: () => {
      toast.success('Mükellef silindi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      router.push('/panel/mukellefler');
    },
    onError: () => toast.error('Silme işlemi başarısız'),
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      ...form,
      phones: form.phones.filter(Boolean),
      emails: form.emails.filter(Boolean),
      evrakTeslimGunu: form.evrakTeslimGunu ? parseInt(String(form.evrakTeslimGunu), 10) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    };
    saveData(payload);
  };

  const cardNav = useMemo(() => {
    const list = Array.isArray(taxpayers) ? taxpayers : [];
    const index = list.findIndex((item: any) => item.id === id);
    return {
      index,
      total: list.length,
      prev: index > 0 ? list[index - 1] : null,
      next: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
    };
  }, [taxpayers, id]);

  const currentName = isNew ? 'Yeni Mükellef' : displayName(taxpayer);
  const avatarText = initialsFor(currentName);

  const statuses = useMemo(() => {
    const phonesCount = form.phones.filter(Boolean).length;
    const emailsCount = form.emails.filter(Boolean).length;
    return [
      { key: 'efatura',  label: 'E-Fatura',  active: form.isEFaturaMukellefi },
      { key: 'sgk',      label: 'SGK',       active: !!(taxpayer && (taxpayer as any)?._count?.employees > 0) },
      { key: 'email',    label: 'E-Posta',   active: emailsCount > 0 },
      { key: 'phone',    label: 'Telefon',   active: phonesCount > 0 },
      { key: 'whatsapp', label: 'WhatsApp',  active: form.whatsappEvrakTalep || form.whatsappEvrakGeldi },
      { key: 'edefter',  label: 'e-Defter',  active: form.defterTuru === 'BILANCO' },
      { key: 'kep',      label: 'KEP',       active: !!form.kepAdresi },
    ];
  }, [form, taxpayer]);
  const activeChannels = statuses.filter((s) => s.active);

  const handleKisayolClick = (k: Kisayol) => {
    window.open(k.url, '_blank', 'noopener,noreferrer');
  };

  const visibleTabs = isNew ? REAL_TABS.filter((t) => t.key === 'bilgiler' || t.key === 'notlar') : REAL_TABS;
  const defterLabel = form.defterTuru === 'BILANCO' ? 'Bilanço' : 'İşletme defteri';
  const taxLabel = form.type === 'TUZEL_KISI' ? 'VKN' : 'TCKN';

  const compScore: number | null = completeness?.score ?? null;
  const compColor = completeness?.durum ? (COMPLETENESS_COLOR[completeness.durum] || STEEL) : STEEL;
  const eksikler: any[] = Array.isArray(completeness?.eksikler) ? completeness.eksikler : [];

  if (!isNew && isLoading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <Loader2 size={16} className="animate-spin" />
          Yükleniyor...
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-[1440px] space-y-4 px-1">
      {/* ============================================================
          HERO — kimlik komut paneli (künye + tamamlanma halkası + sekmeler)
      ============================================================ */}
      <header className="relative overflow-hidden rounded-[20px] border" style={{ borderColor: LINE, background: `linear-gradient(180deg, ${RAISE}, ${CARD})` }}>
        <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${GOLD_BR}, ${GOLD} 26%, ${STEEL_BR} 60%, ${STEEL} 82%, #7c5cf0)` }} />
        <div className="pointer-events-none absolute -left-14 -top-36 h-[340px] w-[480px] rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(212,184,118,0.14), transparent 70%)' }} />
        <div className="pointer-events-none absolute -right-8 -top-32 h-[320px] w-[440px] rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(79,134,201,0.13), transparent 70%)' }} />

        <div className="relative flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start">
          {/* Kimlik + künye */}
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <Link
              href="/panel/mukellefler"
              className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition hover:bg-white/[0.06]"
              style={{ borderColor: LINE, color: MUTED }}
              title="Listeye dön"
            >
              <ArrowLeft size={17} />
            </Link>

            {/* Avatar + tamamlanma halkası */}
            <div className="relative shrink-0" style={{ width: 88, height: 88 }}>
              <div className="h-[88px] w-[88px] rounded-full p-[5px]" style={{ background: compScore != null ? `conic-gradient(${compColor} 0 ${compScore}%, rgba(255,255,255,0.09) ${compScore}% 100%)` : 'rgba(255,255,255,0.09)' }}>
                <div className="flex h-full w-full items-center justify-center rounded-full p-1" style={{ background: CARD }}>
                  {form.logoUrl ? (
                    <div className="h-full w-full rounded-full bg-cover bg-center" style={{ backgroundImage: `url(${form.logoUrl})` }} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-full text-[22px] font-extrabold" style={{ background: `linear-gradient(140deg, ${GOLD_BR}, ${GOLD_DP})`, color: '#1a1408' }}>
                      {avatarText}
                    </div>
                  )}
                </div>
              </div>
              {compScore != null && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border px-2 py-[1px] text-[10.5px] font-extrabold" style={{ background: CARD2, borderColor: LINE, color: compColor }}>
                  %{compScore}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.13em]" style={{ color: GOLD }}>
                {isNew ? 'Yeni kayıt' : form.type === 'TUZEL_KISI' ? 'Şirket kartı' : 'Gerçek kişi kartı'}
                {!isNew && cardNav.total > 0 && (
                  <>
                    <span style={{ color: FAINT }}>·</span>
                    <span className="font-mono" style={{ color: STEEL_BR }}>{cardNav.index >= 0 ? cardNav.index + 1 : '-'} / {cardNav.total}</span>
                  </>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h1 className="truncate text-[24px] font-bold leading-tight" style={{ color: TEXT }}>{currentName}</h1>
                {!isNew && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-bold" style={{ borderColor: 'rgba(95,207,142,0.32)', background: 'rgba(95,207,142,0.12)', color: GREEN }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: GREEN, boxShadow: `0 0 7px ${GREEN}` }} /> Aktif
                  </span>
                )}
              </div>

              {/* Künye ızgarası */}
              {!isNew && (
                <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border sm:grid-cols-3 lg:grid-cols-5" style={{ borderColor: HAIR, background: HAIR }}>
                  <DefCell icon={Landmark} label={taxLabel} value={form.taxNumber || '—'} mono />
                  <DefCell icon={ShieldCheck} label="Vergi Dairesi" value={form.taxOffice || '—'} />
                  <DefCell icon={BookOpen} label="Defter Türü" value={defterLabel} />
                  <DefCell icon={Hash} label="NACE" value={form.naceKodu || '—'} mono />
                  <DefCell icon={Calendar} label="İşe Başlama" value={fmtDateTR(form.startDate)} />
                </div>
              )}
            </div>
          </div>

          {/* Aksiyonlar */}
          <div className="flex shrink-0 flex-col items-stretch gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {!isNew && (
                <button
                  type="button"
                  onClick={() => setPortalOpen(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-[12.5px] font-bold transition hover:brightness-110"
                  style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}
                  title="Kısayol girişleri ve sık sorgular"
                >
                  <Zap size={15} /> Kısayollar
                </button>
              )}
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[12.5px] font-bold transition disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DP})`, color: '#0f0d0b', boxShadow: '0 8px 20px -8px rgba(212,184,118,0.55)' }}
              >
                {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isNew ? 'Kaydı Oluştur' : 'Kaydet'}
              </button>
            </div>
            {!isNew && (
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <CardNavButtons cardNav={cardNav} isNew={isNew} router={router} />
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Mükellef silinsin mi?')) deleteMukellef();
                  }}
                  disabled={isDeleting}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border transition hover:bg-red-500/10 disabled:opacity-40"
                  style={{ borderColor: 'rgba(248,113,113,0.32)', color: '#fca5a5' }}
                  title="Mükellefi sil"
                >
                  {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Eksik alanlar — kimlik panelinde satır içi */}
        {!isNew && eksikler.length > 0 && (
          <div className="relative flex flex-wrap items-center gap-2 px-5 pb-4 sm:px-6">
            <span className="text-[11.5px]" style={{ color: MUTED }}>Tamamlanmamış:</span>
            {eksikler.slice(0, 6).map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={{ borderColor: 'rgba(240,183,85,0.28)', background: 'rgba(240,183,85,0.10)', color: AMBER }}>
                {f.label}
              </span>
            ))}
            {eksikler.length > 6 && (
              <span className="text-[11px]" style={{ color: FAINT }}>+{eksikler.length - 6} daha</span>
            )}
          </div>
        )}

        {/* Sekmeler — kimlik panelinin içinde */}
        <div className="relative flex items-center gap-0.5 overflow-x-auto border-t px-3" style={{ borderColor: HAIR, background: 'rgba(0,0,0,0.18)' }}>
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3.5 text-[13px] font-semibold transition"
                style={{ color: active ? STEEL_BR : MUTED, borderBottom: `2px solid ${active ? STEEL : 'transparent'}` }}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
          {!isNew && activeChannels.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5 pr-1.5">
              {activeChannels.map((s) => <ChannelChip key={s.key} label={s.label} />)}
            </div>
          )}
        </div>
      </header>

      {/* ============================================================
          ANA İÇERİK — sekme içeriği + içgörü rayı
      ============================================================ */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_396px]">
        <main>
          <div className="overflow-hidden rounded-[18px] border" style={{ borderColor: LINE, background: CARD }}>
            <div className="p-5 sm:p-6">
              {activeTab === 'bilgiler' && (
                <BilgilerTab form={form} setForm={setForm} taxpayerId={isNew ? null : id} />
              )}
              {activeTab === 'mukellefiyetler' && !isNew && id && (
                <MukellefiyetlerCard taxpayerId={id} />
              )}
              {activeTab === 'sgk' && (
                <PlaceholderTab
                  icon={Shield}
                  title="SGK İşlemleri"
                  description="Mükellefin SGK bildirgeleri ve çalışan listesi. Bordro modülü ile entegre edilecek."
                  linkLabel="Personel modülüne git"
                  linkHref={`/panel/personel?taxpayerId=${id}`}
                />
              )}
              {activeTab === 'tebligat' && (
                <PlaceholderTab
                  icon={Mail}
                  title="E-Tebligat Takibi"
                  description="GİB ve UETS üzerinden gelen tebligatların otomatik takibi. 7/24 sorgu cron'u + push bildirim planlandı."
                  comingSoon
                />
              )}
              {activeTab === 'notlar' && (
                <NotlarTab form={form} setForm={setForm} />
              )}
            </div>
          </div>
        </main>

        {/* İÇGÖRÜ RAYI */}
        <aside>
          {!isNew && id ? (
            <div className="overflow-hidden rounded-[18px] border" style={{ borderColor: LINE, background: CARD }}>
              <TaxpayerStatsCard taxpayerId={id} />
              <DocumentExpiryWidget taxpayerId={id} compact={false} daysAhead={90} />
              <div className="p-4">
                <SectionTitle icon={Zap} label="Hızlı Erişim" />
                <div className="grid grid-cols-2 gap-2">
                  {LINK_MODULES.map((m) => {
                    const Icon = m.icon;
                    return (
                      <Link
                        key={m.href}
                        href={`${m.href}?taxpayerId=${id}`}
                        className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[12px] font-semibold transition hover:brightness-110"
                        style={{ borderColor: STEEL_LN, background: STEEL_SF, color: TEXT }}
                      >
                        <Icon size={15} style={{ color: STEEL_BR }} />
                        {m.label}
                        <ArrowRight size={11} style={{ color: FAINT, marginLeft: 'auto' }} />
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[18px] border p-5" style={{ borderColor: LINE, background: CARD }}>
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border" style={{ borderColor: STEEL_LN, color: STEEL_BR, background: STEEL_SF }}>
                <CheckCircle2 size={19} />
              </div>
              <h2 className="text-[16px] font-semibold" style={{ color: TEXT }}>Kayıt sonrası açılır</h2>
              <p className="mt-2 text-[13px] leading-relaxed" style={{ color: MUTED }}>
                Mükellef oluşturulduktan sonra cari bakiye, iş yükü, evrak yenileme ve hızlı erişim burada görünür.
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* KISAYOL GİRİŞLERİ — açılır panel */}
      {portalOpen && !isNew && (
        <PortalDrawer vkn={form.taxNumber} onClose={() => setPortalOpen(false)} onKisayol={handleKisayolClick} />
      )}
    </form>
  );
}

// ============================================================
// KÜNYE HÜCRESİ + KART NAVİGASYON
// ============================================================
function DefCell({ icon: Icon, label, value, mono }: { icon: React.ElementType; label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-3 py-2.5" style={{ background: CARD2 }}>
      <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em]" style={{ color: FAINT }}>
        <Icon size={11} style={{ color: STEEL_BR }} /> {label}
      </div>
      <div className={`mt-1 truncate text-[13.5px] font-semibold ${mono ? 'font-mono text-[12.5px]' : ''}`} style={{ color: TEXT }} title={value}>{value}</div>
    </div>
  );
}

function CardNavButtons({ cardNav, isNew, router }: { cardNav: any; isNew: boolean; router: any }) {
  if (isNew || cardNav.total <= 1) return null;
  return (
    <div className="inline-flex overflow-hidden rounded-xl border" style={{ borderColor: LINE }}>
      <button
        type="button"
        onClick={() => cardNav.prev && router.push(`/panel/mukellefler/${cardNav.prev.id}`)}
        disabled={!cardNav.prev}
        title={cardNav.prev ? displayName(cardNav.prev) : 'İlk mükellef'}
        className="inline-flex h-10 items-center gap-1 px-3 text-[12.5px] font-semibold transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
        style={{ color: MUTED }}
      >
        <ChevronLeft size={15} /> <span className="hidden sm:inline">Önceki</span>
      </button>
      <span className="inline-flex h-10 items-center border-x px-3 text-[12px] font-bold tabular-nums" style={{ borderColor: LINE, background: STEEL_SF, color: STEEL_BR }}>
        {cardNav.index >= 0 ? cardNav.index + 1 : '-'} / {cardNav.total}
      </span>
      <button
        type="button"
        onClick={() => cardNav.next && router.push(`/panel/mukellefler/${cardNav.next.id}`)}
        disabled={!cardNav.next}
        title={cardNav.next ? displayName(cardNav.next) : 'Son mükellef'}
        className="inline-flex h-10 items-center gap-1 px-3 text-[12.5px] font-semibold transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
        style={{ color: MUTED }}
      >
        <span className="hidden sm:inline">Sonraki</span> <ChevronRight size={15} />
      </button>
    </div>
  );
}

// ============================================================
// KISAYOL GİRİŞLERİ — sağdan açılan panel
// ============================================================
function PortalDrawer({
  vkn,
  onClose,
  onKisayol,
}: {
  vkn: string;
  onClose: () => void;
  onKisayol: (k: Kisayol) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }} onClick={onClose} />
      <div className="relative h-full w-full max-w-[440px] overflow-y-auto border-l p-5 shadow-2xl" style={{ background: CARD, borderColor: LINE }}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border" style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}>
            <Zap size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>Kısayol Girişleri</h2>
            <p className="truncate text-[11.5px]" style={{ color: MUTED }}>{vkn ? `VKN: ${vkn}` : 'Devlet portallarına hızlı erişim'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition hover:bg-white/[0.06]"
            style={{ borderColor: LINE, color: MUTED }}
            title="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Devlet portalları</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PORTAL_KISAYOLLAR.map((k) => (
            <KisayolButton key={k.id} k={k} onClick={() => onKisayol(k)} />
          ))}
        </div>

        <div className="mt-5 border-t pt-4" style={{ borderColor: HAIR }}>
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>
            En çok kullanılan sorgular
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {HIZLI_SORGULAR.map((k) => (
              <KisayolButton key={k.id} k={k} small onClick={() => onKisayol(k)} />
            ))}
          </div>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed" style={{ color: FAINT }}>
          Portal şifreleri Bilgiler sekmesindeki “Şifreler” bölümünden yönetilir.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// BİLGİLER TAB — sol bölüm menüsü + gruplu kartlar
// ============================================================
type BilgiSectionId = 'musteri' | 'yetkili' | 'iletisim' | 'sifreler' | 'bagkur' | 'entegrator' | 'otomasyon' | 'sistem';

function BilgilerTab({
  form,
  setForm,
  taxpayerId,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  taxpayerId: string | null;
}) {
  const sections: {
    id: BilgiSectionId;
    title: string;
    subtitle: string;
    icon: React.ElementType;
    show: boolean;
    filled: boolean;
  }[] = [
    { id: 'musteri',    title: 'Müşteri / Şirket',     subtitle: 'Kimlik, vergi, sicil',     icon: Building2,  show: true,            filled: !!(form.companyName || form.firstName || form.taxNumber) },
    { id: 'yetkili',    title: 'Firma Yetkilileri',    subtitle: 'Müdür, ortak, imza',       icon: UserCog,    show: !!taxpayerId,    filled: false },
    { id: 'iletisim',   title: 'İletişim',             subtitle: 'Telefon, e-posta, KEP',    icon: Phone,      show: true,            filled: form.phones.some(Boolean) || form.emails.some(Boolean) || !!form.kepAdresi },
    { id: 'sifreler',   title: 'Şifreler',             subtitle: 'Vergi dairesi & SGK',      icon: Lock,       show: !!taxpayerId,    filled: false },
    { id: 'bagkur',     title: 'Bağ-Kur',              subtitle: 'Sicil bilgisi',            icon: Shield,     show: true,            filled: !!form.bagkurSicilNo },
    { id: 'entegrator', title: 'E-Fatura Entegratör',  subtitle: 'Sağlayıcı & mükellefiyet', icon: Sparkles,   show: true,            filled: !!form.eFaturaEntegrator || form.isEFaturaMukellefi },
    { id: 'otomasyon',  title: 'Evrak & Otomasyon',    subtitle: 'Teslim günü, WhatsApp',    icon: Workflow,   show: true,            filled: !!form.evrakTeslimGunu || form.whatsappEvrakTalep || form.whatsappEvrakGeldi },
    { id: 'sistem',     title: 'Defter & Sistem',      subtitle: 'Luca / Mihsap eşleşme',    icon: Settings2,  show: true,            filled: !!form.lucaSlug || !!form.mihsapId },
  ];
  const visible = sections.filter((s) => s.show);
  const [active, setActive] = useState<BilgiSectionId>('musteri');

  return (
    <div className="grid gap-4 md:grid-cols-[236px_minmax(0,1fr)] md:gap-0">
      {/* Sol bölüm menüsü */}
      <nav className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:gap-1 md:overflow-visible md:border-r md:pb-0 md:pr-4" style={{ borderColor: HAIR }}>
        <div className="hidden px-1.5 pb-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] md:block" style={{ color: FAINT }}>Bölümler</div>
        {visible.map((s) => {
          const Icon = s.icon;
          const on = active === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className="relative flex shrink-0 items-center gap-3 rounded-xl border py-2.5 pl-3 pr-3 text-left transition hover:bg-white/[0.03] md:w-full"
              style={on
                ? { background: `linear-gradient(90deg, ${STEEL_SF}, transparent)`, borderColor: STEEL_LN }
                : { borderColor: 'transparent' }}
            >
              {on && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full" style={{ background: STEEL }} />}
              <span
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg"
                style={{ background: on ? 'rgba(79,134,201,0.2)' : 'rgba(255,255,255,0.04)', color: on ? STEEL_BR : MUTED }}
              >
                <Icon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="block truncate text-[12.5px] font-semibold" style={{ color: on ? TEXT : 'rgba(245,245,244,0.82)' }}>{s.title}</span>
                  {s.filled && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: GREEN }} title="Dolu" />}
                </span>
                <span className="mt-0.5 hidden truncate text-[10.5px] md:block" style={{ color: FAINT }}>{s.subtitle}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* İçerik */}
      <div className="md:pl-6">
        {/* MÜŞTERİ / ŞİRKET */}
        {active === 'musteri' && (
          <div>
            <GroupCard icon={Contact} title="Mükellef Türü">
              <Segmented
                value={form.type}
                onChange={(v) => setForm((p) => ({ ...p, type: v as TaxpayerType }))}
                options={TAXPAYER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              />
              <p className="mt-2.5 text-[11.5px]" style={{ color: FAINT }}>
                {TAXPAYER_TYPES.find((t) => t.value === form.type)?.detail}
              </p>
            </GroupCard>

            <GroupCard icon={UserRound} title="Kimlik">
              <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                {form.type === 'TUZEL_KISI' ? (
                  <Field label="Şirket adı" required className="sm:col-span-2">
                    <InputBase value={form.companyName} onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))} required />
                  </Field>
                ) : (
                  <>
                    <Field label="Ad" required>
                      <InputBase value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} required />
                    </Field>
                    <Field label="Soyad" required>
                      <InputBase value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} required />
                    </Field>
                  </>
                )}
                <Field label={form.type === 'TUZEL_KISI' ? 'VKN' : 'TCKN'} required>
                  <InputBase
                    value={form.taxNumber}
                    onChange={(e) => setForm((p) => ({ ...p, taxNumber: e.target.value.replace(/\D/g, '') }))}
                    maxLength={11}
                    required
                    className="font-mono"
                  />
                </Field>
                <Field label="Vergi dairesi" required>
                  <InputBase value={form.taxOffice} onChange={(e) => setForm((p) => ({ ...p, taxOffice: e.target.value }))} required />
                </Field>
              </div>
            </GroupCard>

            <GroupCard icon={Tag} title="Sicil & Kodlar">
              <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                <Field label="NACE Kodu">
                  <InputBase value={form.naceKodu} onChange={(e) => setForm((p) => ({ ...p, naceKodu: e.target.value }))} />
                </Field>
                <Field label="Ticaret Sicil No">
                  <InputBase value={form.ticaretSicilNo} onChange={(e) => setForm((p) => ({ ...p, ticaretSicilNo: e.target.value }))} />
                </Field>
                <Field label="MERSİS No">
                  <InputBase value={form.mersisNo} onChange={(e) => setForm((p) => ({ ...p, mersisNo: e.target.value }))} className="font-mono" />
                </Field>
                <Field label="Oda Sicil No">
                  <InputBase value={form.odaSicilNo} onChange={(e) => setForm((p) => ({ ...p, odaSicilNo: e.target.value }))} />
                </Field>
              </div>
            </GroupCard>

            <GroupCard icon={MapPin} title="Tarihler & Adres" last>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                <Field label="İşe başlama tarihi">
                  <InputBase type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
                </Field>
                <Field label="İşi bırakma tarihi">
                  <InputBase type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} />
                </Field>
                <Field label="Adres" className="sm:col-span-2">
                  <InputBase value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
                </Field>
              </div>
            </GroupCard>
          </div>
        )}

        {/* FİRMA YETKİLİLERİ */}
        {active === 'yetkili' && taxpayerId && <YetkililerSection taxpayerId={taxpayerId} />}

        {/* İLETİŞİM */}
        {active === 'iletisim' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-3">
                <Subhead icon={Phone} label="Telefonlar" />
                {form.phones.map((phone, index) => (
                  <InputBase
                    key={index}
                    type="tel"
                    value={phone}
                    onChange={(e) =>
                      setForm((prev) => {
                        const phones = [...prev.phones];
                        phones[index] = e.target.value;
                        return { ...prev, phones };
                      })
                    }
                    placeholder={index === 0 ? 'Ana telefon' : `Telefon ${index + 1}`}
                  />
                ))}
              </div>
              <div className="space-y-3">
                <Subhead icon={Mail} label="E-postalar" />
                {form.emails.map((email, index) => (
                  <InputBase
                    key={index}
                    type="email"
                    value={email}
                    onChange={(e) =>
                      setForm((prev) => {
                        const emails = [...prev.emails];
                        emails[index] = e.target.value;
                        return { ...prev, emails };
                      })
                    }
                    placeholder={index === 0 ? 'Ana e-posta' : `E-posta ${index + 1}`}
                  />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="KEP Adresi">
                <InputBase type="email" value={form.kepAdresi} onChange={(e) => setForm((p) => ({ ...p, kepAdresi: e.target.value }))} />
              </Field>
              <Field label="Web Sitesi">
                <InputBase value={form.webSitesi} onChange={(e) => setForm((p) => ({ ...p, webSitesi: e.target.value }))} />
              </Field>
            </div>
          </div>
        )}

        {/* ŞİFRELER */}
        {active === 'sifreler' && taxpayerId && <TaxpayerPortalCredentialsCard taxpayerId={taxpayerId} />}

        {/* BAĞ-KUR */}
        {active === 'bagkur' && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Bağ-Kur Sicil No">
              <InputBase value={form.bagkurSicilNo} onChange={(e) => setForm((p) => ({ ...p, bagkurSicilNo: e.target.value }))} className="font-mono" />
            </Field>
            <div className="rounded-xl border p-3 text-[12px]" style={{ borderColor: HAIR, background: CARD2, color: MUTED }}>
              <div className="flex items-center gap-2 font-semibold" style={{ color: STEEL_BR }}>
                <Lock size={13} /> Şifre yönetimi
              </div>
              <p className="mt-1.5">Bağ-Kur / e-Devlet şifreleri <strong style={{ color: TEXT }}>Şifreler</strong> bölümünden yönetilir.</p>
            </div>
          </div>
        )}

        {/* E-FATURA ENTEGRATÖR */}
        {active === 'entegrator' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Entegratör">
                <select
                  value={form.eFaturaEntegrator}
                  onChange={(e) => setForm((p) => ({ ...p, eFaturaEntegrator: e.target.value }))}
                  className={SELECT_CLS}
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="">Seçiniz</option>
                  <option value="GIB_PORTAL">GİB Portal</option>
                  <option value="UYUMSOFT">Uyumsoft</option>
                  <option value="BILGENET">BilgeNet</option>
                  <option value="FORIBA">Foriba</option>
                  <option value="IZIBIZ">İzibiz</option>
                  <option value="DIGER">Diğer</option>
                </select>
              </Field>
              <div>
                <span className="mb-1.5 block text-[11px] font-medium tracking-wide" style={{ color: MUTED }}>E-Fatura Mükellefiyeti</span>
                <ToggleRow
                  checked={form.isEFaturaMukellefi}
                  onChange={(checked) => setForm((p) => ({ ...p, isEFaturaMukellefi: checked }))}
                  title="E-Fatura mükellefi"
                  detail="Fatura sorgulama modüllerindeki varsayılan kanal."
                />
              </div>
            </div>
            <p className="text-[12px]" style={{ color: MUTED }}>
              Entegratör kullanıcı/şifresi <strong style={{ color: TEXT }}>Şifreler</strong> bölümünden yönetilir (provider: <code>EFATURA_ENTEGRATOR</code>).
            </p>
          </div>
        )}

        {/* EVRAK & OTOMASYON */}
        {active === 'otomasyon' && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
            <Field label="Evrak teslim son günü">
              <InputBase
                type="number"
                min={1}
                max={30}
                value={form.evrakTeslimGunu}
                onChange={(e) => setForm((p) => ({ ...p, evrakTeslimGunu: e.target.value }))}
              />
            </Field>
            <div className="grid gap-3">
              <ToggleRow
                checked={form.whatsappEvrakTalep}
                onChange={(checked) => setForm((p) => ({ ...p, whatsappEvrakTalep: checked }))}
                title="Evrak talep mesajı"
                detail="Aylık evrak akışı için WhatsApp hatırlatması."
              />
              <ToggleRow
                checked={form.whatsappEvrakGeldi}
                onChange={(checked) => setForm((p) => ({ ...p, whatsappEvrakGeldi: checked }))}
                title="Evrak geldi onayı"
                detail="Evrak geldi işaretlendiğinde bilgilendirme mesajı."
              />
            </div>
          </div>
        )}

        {/* DEFTER & SİSTEM */}
        {active === 'sistem' && (
          <div className="space-y-6">
            <div>
              <span className="mb-2 block text-[11px] font-medium tracking-wide" style={{ color: MUTED }}>Defter türü</span>
              <Segmented
                value={form.defterTuru}
                onChange={(v) => setForm((p) => ({ ...p, defterTuru: v as DefterTuru, mihsapDefterTuru: v === 'ISLETME' ? 'DEFTER_BEYAN' : 'BILANCO' }))}
                options={[{ value: 'BILANCO', label: 'Bilanço' }, { value: 'ISLETME', label: 'İşletme defteri' }]}
              />
              <p className="mt-2 text-[12px]" style={{ color: FAINT }}>
                {form.defterTuru === 'BILANCO' ? 'Banka takip ve bilanço modülleri aktif.' : 'Defter beyan akışı için sade profil.'}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Luca slug">
                <InputBase value={form.lucaSlug} onChange={(e) => setForm((p) => ({ ...p, lucaSlug: e.target.value }))} />
              </Field>
              <Field label="Mihsap ID">
                <InputBase value={form.mihsapId} onChange={(e) => setForm((p) => ({ ...p, mihsapId: e.target.value }))} />
              </Field>
              <Field label="Mihsap defter türü">
                <select
                  value={form.mihsapDefterTuru}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      mihsapDefterTuru: e.target.value,
                      defterTuru: e.target.value === 'DEFTER_BEYAN' ? 'ISLETME' : 'BILANCO',
                    }))
                  }
                  className={SELECT_CLS}
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="BILANCO">Bilanço</option>
                  <option value="DEFTER_BEYAN">Defter Beyan</option>
                </select>
              </Field>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// YETKILILER SECTION
// ============================================================
function YetkililerSection({ taxpayerId }: { taxpayerId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newY, setNewY] = useState({ firstName: '', lastName: '', tcNo: '', gorev: '', telefon: '', eposta: '', isPrimary: false });

  const { data: yetkililer = [], isLoading } = useQuery({
    queryKey: ['taxpayer-yetkililer', taxpayerId],
    queryFn: () => api.get(`/taxpayers/${taxpayerId}/yetkililer`).then((r) => r.data),
  });

  const { mutate: createY, isPending: creating } = useMutation({
    mutationFn: (data: any) => api.post(`/taxpayers/${taxpayerId}/yetkililer`, data),
    onSuccess: () => {
      toast.success('Yetkili eklendi');
      qc.invalidateQueries({ queryKey: ['taxpayer-yetkililer', taxpayerId] });
      setAdding(false);
      setNewY({ firstName: '', lastName: '', tcNo: '', gorev: '', telefon: '', eposta: '', isPrimary: false });
    },
    onError: (e: any) => {
      const msg = e.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : msg || 'Yetkili eklenemedi');
    },
  });

  const { mutate: deleteY } = useMutation({
    mutationFn: (yId: string) => api.delete(`/taxpayers/${taxpayerId}/yetkililer/${yId}`),
    onSuccess: () => {
      toast.success('Yetkili silindi');
      qc.invalidateQueries({ queryKey: ['taxpayer-yetkililer', taxpayerId] });
    },
  });

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="text-[12px]" style={{ color: MUTED }}>Yükleniyor...</div>
      ) : (
        <>
          {(yetkililer as any[]).length === 0 && !adding ? (
            <div className="rounded-xl border p-4 text-center text-[12.5px]" style={{ borderColor: HAIR, color: MUTED, background: CARD2 }}>
              Henüz yetkili eklenmemiş.
            </div>
          ) : (
            <div className="space-y-2">
              {(yetkililer as any[]).map((y) => (
                <div key={y.id} className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: y.isPrimary ? STEEL_LN : HAIR, background: y.isPrimary ? STEEL_SF : CARD2 }}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border" style={{ borderColor: STEEL_LN, background: 'rgba(79,134,201,0.14)', color: STEEL_BR, fontSize: 12, fontWeight: 700 }}>
                    {(y.firstName?.[0] || '') + (y.lastName?.[0] || '')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[13.5px]" style={{ color: TEXT }}>{y.firstName} {y.lastName}</strong>
                      {y.isPrimary && (
                        <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase" style={{ background: 'rgba(79,134,201,0.18)', color: STEEL_BR }}>Birincil</span>
                      )}
                      {y.gorev && <span className="text-[11.5px]" style={{ color: MUTED }}>· {y.gorev}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-[11.5px]" style={{ color: MUTED }}>
                      {y.tcNo && <span className="font-mono">TC: {y.tcNo}</span>}
                      {y.telefon && <span>{y.telefon}</span>}
                      {y.eposta && <span>{y.eposta}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`${y.firstName} ${y.lastName} silinsin mi?`)) deleteY(y.id);
                    }}
                    className="rounded-md border p-1.5 transition hover:bg-red-500/10"
                    style={{ borderColor: 'rgba(248,113,113,0.32)', color: '#fca5a5' }}
                    title="Sil"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {adding ? (
            <div className="rounded-xl border p-4" style={{ borderColor: STEEL_LN, background: STEEL_SF }}>
              <div className="mb-3 text-[12px] font-semibold" style={{ color: STEEL_BR }}>Yeni yetkili</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Ad" required>
                  <InputBase value={newY.firstName} onChange={(e) => setNewY((p) => ({ ...p, firstName: e.target.value }))} />
                </Field>
                <Field label="Soyad" required>
                  <InputBase value={newY.lastName} onChange={(e) => setNewY((p) => ({ ...p, lastName: e.target.value }))} />
                </Field>
                <Field label="TC Kimlik No">
                  <InputBase value={newY.tcNo} onChange={(e) => setNewY((p) => ({ ...p, tcNo: e.target.value.replace(/\D/g, '') }))} maxLength={11} className="font-mono" />
                </Field>
                <Field label="Görev">
                  <select
                    value={newY.gorev}
                    onChange={(e) => setNewY((p) => ({ ...p, gorev: e.target.value }))}
                    className={SELECT_CLS}
                    style={{ colorScheme: 'dark' }}
                  >
                    <option value="">Seçiniz</option>
                    <option value="MUDUR">Müdür</option>
                    <option value="ORTAK">Ortak</option>
                    <option value="IMZA_YETKILI">İmza Yetkilisi</option>
                    <option value="MUHASEBE_SORUMLUSU">Muhasebe Sorumlusu</option>
                    <option value="DIGER">Diğer</option>
                  </select>
                </Field>
                <Field label="Telefon">
                  <InputBase type="tel" value={newY.telefon} onChange={(e) => setNewY((p) => ({ ...p, telefon: e.target.value }))} />
                </Field>
                <Field label="E-posta">
                  <InputBase type="email" value={newY.eposta} onChange={(e) => setNewY((p) => ({ ...p, eposta: e.target.value }))} />
                </Field>
                <label className="flex items-center gap-2 text-[12.5px] md:col-span-2" style={{ color: TEXT }}>
                  <input
                    type="checkbox"
                    checked={newY.isPrimary}
                    onChange={(e) => setNewY((p) => ({ ...p, isPrimary: e.target.checked }))}
                  />
                  Birincil iletişim kişisi olarak işaretle
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setAdding(false)} className="rounded-lg border px-3 py-2 text-[12px] font-semibold" style={{ borderColor: LINE, color: MUTED }}>
                  İptal
                </button>
                <button
                  type="button"
                  onClick={() => createY(newY)}
                  disabled={creating || !newY.firstName || !newY.lastName}
                  className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-bold disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${STEEL_BR}, ${STEEL_DP})`, color: '#fff' }}
                >
                  {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Yetkili Ekle
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed px-4 py-2.5 text-[12.5px] font-semibold transition hover:bg-white/[0.04]"
              style={{ borderColor: STEEL_LN, color: STEEL_BR }}
            >
              <Plus size={14} /> Yetkili Ekle
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// NOTLAR TAB
// ============================================================
function NotlarTab({ form, setForm }: { form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>> }) {
  return (
    <div>
      <label className="mb-2 block text-[12.5px] font-semibold" style={{ color: MUTED }}>
        Mükellef hakkında notlar
      </label>
      <textarea
        value={form.notes}
        onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
        rows={10}
        placeholder="Bu mükellefe özel notlar..."
        className={TEXTAREA_CLS}
      />
    </div>
  );
}

// ============================================================
// YARDIMCI KOMPONENTLER
// ============================================================
function GroupCard({ icon: Icon, title, count, countColor, last, children }: { icon: React.ElementType; title: string; count?: string; countColor?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border p-4 sm:p-[17px] ${last ? '' : 'mb-3.5'}`} style={{ borderColor: HAIR, background: CARD2 }}>
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="flex h-[27px] w-[27px] items-center justify-center rounded-lg border" style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}>
          <Icon size={15} />
        </span>
        <span className="text-[12.5px] font-bold" style={{ color: TEXT }}>{title}</span>
        {count && <span className="ml-auto text-[10px] font-bold" style={{ color: countColor || FAINT }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.1em]" style={{ color: MUTED }}>
      <Icon size={13} style={{ color: STEEL_BR }} /> {label}
    </div>
  );
}

function ChannelChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase"
      style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR, letterSpacing: '0.03em' }}
      title={`${label} aktif`}
    >
      <span className="h-[5px] w-[5px] rounded-full" style={{ background: GREEN }} />
      {label}
    </span>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex w-full rounded-xl border p-1" style={{ borderColor: LINE, background: '#0c0d11' }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="flex-1 rounded-lg px-4 py-2 text-[12.5px] font-semibold transition"
            style={on ? { background: `linear-gradient(135deg, ${STEEL_BR}, ${STEEL_DP})`, color: '#fff', boxShadow: '0 4px 12px -4px rgba(79,134,201,0.5)' } : { color: MUTED, background: 'transparent' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function KisayolButton({ k, onClick, small = false }: { k: Kisayol; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition hover:bg-white/[0.04]"
      style={{ borderColor: HAIR, background: CARD2 }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10.5px] font-bold"
        style={{ background: k.renk, color: 'white' }}
      >
        {k.kisaltma}
      </span>
      <span className={`min-w-0 flex-1 truncate font-semibold ${small ? 'text-[11.5px]' : 'text-[12.5px]'}`} style={{ color: TEXT }}>
        {k.label}
      </span>
      <ArrowRight size={11} style={{ color: MUTED, flexShrink: 0 }} />
    </button>
  );
}

function PlaceholderTab({
  icon: Icon,
  title,
  description,
  linkLabel,
  linkHref,
  comingSoon,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  linkLabel?: string;
  linkHref?: string;
  comingSoon?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}>
        <Icon size={26} />
      </div>
      <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>{title}</h3>
      <p className="mt-2 max-w-md text-[12.5px]" style={{ color: MUTED }}>{description}</p>
      {comingSoon && (
        <span className="mt-3 rounded px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: STEEL_SF, color: STEEL_BR }}>Yakında</span>
      )}
      {linkLabel && linkHref && (
        <Link href={linkHref} className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-bold" style={{ background: `linear-gradient(135deg, ${STEEL_BR}, ${STEEL_DP})`, color: '#fff' }}>
          {linkLabel} <ChevronRight size={13} />
        </Link>
      )}
    </div>
  );
}

function Field({ label, required, className = '', children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-medium tracking-wide" style={{ color: MUTED }}>
        {label}{required ? <span style={{ color: AMBER }}> *</span> : ''}
      </span>
      {children}
    </label>
  );
}

function InputBase({ className = '', style, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`${FIELD_CLS} ${className}`}
      style={{ colorScheme: 'dark', ...(style || {}) }}
    />
  );
}

function Subhead({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: MUTED }}>
      <Icon size={14} style={{ color: STEEL_BR }} />
      {label}
    </div>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition hover:bg-white/[0.04]" style={{ borderColor: checked ? STEEL_LN : HAIR, background: checked ? STEEL_SF : CARD2 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border" style={{ borderColor: checked ? STEEL_LN : LINE, color: checked ? STEEL_BR : 'rgba(245,245,244,0.30)' }}>
        <CheckCircle2 size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold" style={{ color: TEXT }}>{title}</span>
        <span className="mt-0.5 block text-[12px]" style={{ color: MUTED }}>{detail}</span>
      </span>
    </label>
  );
}
