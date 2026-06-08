'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Contact,
  Download,
  ExternalLink,
  Eye,
  FileCheck,
  FileText,
  Landmark,
  Loader2,
  Lock,
  Mail,
  MessageSquareText,
  Phone,
  Plus,
  Printer,
  Save,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  UserCog,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { MukellefiyetlerCard } from '@/components/mukellef/MukellefiyetlerCard';
import { TaxpayerPortalCredentialsCard } from '@/components/portal-automation/PortalCredentialCards';
import { beyanKayitlariApi, BEYAN_TIPI_LABEL, type BeyanKaydi } from '@/lib/beyan-kayitlari';
import { documentsApi } from '@/lib/documents';
import { portalAutomationApi, type PortalProvider } from '@/lib/portal-automation';
import { DocumentCategory } from '@mali-musavir/shared';

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

const FIELD_CLS = 'h-11 w-full rounded-[8px] border border-white/12 bg-[#0b0c10] px-3.5 text-[13px] font-bold text-[#f5f5f4] outline-none transition placeholder:text-white/28 focus:border-[#d4b876]/60 focus:bg-[#0e1014] focus:shadow-[0_0_0_3px_rgba(212,184,118,0.14)]';
const SELECT_CLS = `${FIELD_CLS} cursor-pointer`;
const TEXTAREA_CLS = 'w-full resize-none rounded-[8px] border border-white/12 bg-[#0b0c10] px-3.5 py-3 text-[13px] font-bold text-[#f5f5f4] outline-none transition placeholder:text-white/28 focus:border-[#4f86c9]/60 focus:bg-[#0e1014] focus:shadow-[0_0_0_3px_rgba(79,134,201,0.15)]';

const TAXPAYER_TYPES = [
  { value: 'TUZEL_KISI', label: 'Tüzel Kişi', detail: 'Şirket veya kurum kaydı' },
  { value: 'GERCEK_KISI', label: 'Gerçek Kişi', detail: 'Şahıs işletmesi veya bireysel kayıt' },
] as const;

type TaxpayerType = (typeof TAXPAYER_TYPES)[number]['value'];
type DefterTuru = 'BILANCO' | 'ISLETME';
type TaxpayerKind = 'FIRMA' | 'SAHIS' | 'BASIT';

const TAXPAYER_KIND_OPTIONS: Array<{ value: TaxpayerKind; label: string }> = [
  { value: 'FIRMA', label: 'Firma' },
  { value: 'SAHIS', label: 'Şahıs' },
  { value: 'BASIT', label: 'Basit' },
];

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

function taxpayerKindFromForm(form: FormState): TaxpayerKind {
  const defter = `${form.defterTuru || ''} ${form.mihsapDefterTuru || ''}`.toLocaleUpperCase('tr-TR');
  if (/ISLETME|İŞLETME|DEFTER[_\s-]*BEYAN/.test(defter)) return 'BASIT';
  return form.type === 'TUZEL_KISI' ? 'FIRMA' : 'SAHIS';
}

function taxpayerKindLabel(kind: TaxpayerKind): string {
  if (kind === 'FIRMA') return 'FİRMA';
  if (kind === 'SAHIS') return 'ŞAHIS';
  return 'BASİT';
}

function applyTaxpayerKind(kind: TaxpayerKind, setForm: React.Dispatch<React.SetStateAction<FormState>>) {
  setForm((prev) => {
    if (kind === 'FIRMA') {
      return { ...prev, type: 'TUZEL_KISI', defterTuru: 'BILANCO', mihsapDefterTuru: prev.mihsapDefterTuru === 'DEFTER_BEYAN' ? 'BILANCO' : prev.mihsapDefterTuru || 'BILANCO' };
    }
    if (kind === 'SAHIS') {
      return { ...prev, type: 'GERCEK_KISI', defterTuru: 'BILANCO', mihsapDefterTuru: prev.mihsapDefterTuru === 'DEFTER_BEYAN' ? 'BILANCO' : prev.mihsapDefterTuru || 'BILANCO' };
    }
    return { ...prev, type: 'GERCEK_KISI', defterTuru: 'ISLETME', mihsapDefterTuru: 'DEFTER_BEYAN' };
  });
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
type TabKey =
  | 'bilgiler'
  | 'beyannameler'
  | 'sgk'
  | 'tebligat'
  | 'dosyalar'
  | 'cariHesap'
  | 'iseGiris'
  | 'notlar';

const REAL_TABS: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
  { key: 'bilgiler', label: 'Bilgiler', icon: Contact },
  { key: 'beyannameler', label: 'Beyannameler', icon: FileText },
  { key: 'sgk', label: 'SGK', icon: Shield },
  { key: 'tebligat', label: 'E-Tebligat', icon: Mail },
  { key: 'dosyalar', label: 'Dosyalar', icon: BookOpen },
  { key: 'cariHesap', label: 'Cari Hesap', icon: Landmark },
  { key: 'iseGiris', label: 'İşe Giriş Bildirgesi', icon: UserCog },
  { key: 'notlar', label: 'Mükellef Not', icon: MessageSquareText },
];

export default function MukellefDetayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const isNew = id === 'yeni';

  const [activeTab, setActiveTab] = useState<TabKey>('bilgiler');
  const [portalOpen, setPortalOpen] = useState(false);
  const [activeActionOpen, setActiveActionOpen] = useState(false);

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
      if (isNew) router.push('/panel/mukellef-listesi');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : msg || 'Kayıt hatası');
    },
  });

  const { mutate: deleteMukellef, isPending: isDeleting } = useMutation({
    mutationFn: () => api.delete(`/taxpayers/${id}`),
    onSuccess: () => {
      toast.success('Mükellef pasife alındı');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      router.push('/panel/mukellef-listesi');
    },
    onError: () => toast.error('Silme işlemi başarısız'),
  });

  const { mutate: setActiveStatus, isPending: isActiveChanging } = useMutation({
    mutationFn: (isActive: boolean) => api.put(`/taxpayers/${id}`, { isActive }),
    onSuccess: (_res, isActive) => {
      toast.success(isActive ? 'Mükellef aktife alındı' : 'Mükellef pasife alındı');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      qc.invalidateQueries({ queryKey: ['taxpayer', id] });
      qc.invalidateQueries({ queryKey: ['taxpayer-completeness', id] });
    },
    onError: () => toast.error('Mükellef durumu güncellenemedi'),
  });

  const buildPayload = () => ({
      ...form,
      phones: form.phones.filter(Boolean),
      emails: form.emails.filter(Boolean),
      evrakTeslimGunu: form.evrakTeslimGunu ? parseInt(String(form.evrakTeslimGunu), 10) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
  });

  const saveForm = () => {
    saveData(buildPayload());
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    saveForm();
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
  const isTaxpayerActive = isNew ? true : taxpayer?.isActive !== false;
  const currentKind = taxpayerKindFromForm(form);

  const handleKisayolClick = (k: Kisayol) => {
    window.open(k.url, '_blank', 'noopener,noreferrer');
  };

  const visibleTabs = isNew ? REAL_TABS.filter((t) => t.key === 'bilgiler' || t.key === 'notlar') : REAL_TABS;

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
    <form onSubmit={handleSubmit} className="mx-auto max-w-[1500px] space-y-3 px-1">
      <header className="rounded-[8px] border px-4 py-3" style={{ borderColor: LINE, background: CARD }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/panel/mukellef-listesi"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border transition hover:bg-white/[0.06]"
              style={{ borderColor: LINE, color: MUTED }}
              title="Mükellef listesine dön"
            >
              <ArrowLeft size={17} />
            </Link>

            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[8px] border" style={{ borderColor: STEEL_LN, background: STEEL_SF }}>
              {form.logoUrl ? (
                <div className="h-full w-full rounded-[8px] bg-cover bg-center" style={{ backgroundImage: `url(${form.logoUrl})` }} />
              ) : (
                <span className="text-[18px] font-black" style={{ color: TEXT }}>{avatarText}</span>
              )}
              {compScore != null && (
                <span className="absolute -bottom-2 rounded-full border px-1.5 py-[1px] text-[9px] font-black" style={{ background: CARD2, borderColor: LINE, color: compColor }}>
                  %{compScore}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[24px] font-black leading-tight" style={{ color: TEXT }}>{currentName}</h1>
                {!isNew && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setActiveActionOpen((v) => !v)}
                      disabled={isActiveChanging}
                      className="inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-[11px] font-black transition disabled:opacity-50"
                      style={{
                        borderColor: isTaxpayerActive ? 'rgba(95,207,142,0.32)' : 'rgba(239,107,107,0.32)',
                        background: isTaxpayerActive ? 'rgba(95,207,142,0.12)' : 'rgba(239,107,107,0.10)',
                        color: isTaxpayerActive ? GREEN : RED,
                      }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: isTaxpayerActive ? GREEN : RED }} />
                      {isTaxpayerActive ? 'Aktif' : 'Pasif'}
                      <ChevronDown size={12} />
                    </button>
                    {activeActionOpen && (
                      <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[150px] rounded-[8px] border p-1 shadow-xl" style={{ borderColor: LINE, background: CARD2 }}>
                        <button
                          type="button"
                          className="w-full rounded-[6px] px-3 py-2 text-left text-[12px] font-bold transition hover:bg-white/[0.06]"
                          style={{ color: isTaxpayerActive ? '#fca5a5' : GREEN }}
                          onClick={() => {
                            setActiveActionOpen(false);
                            setActiveStatus(!isTaxpayerActive);
                          }}
                        >
                          {isTaxpayerActive ? 'Pasife al' : 'Aktife al'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <span className="rounded-[6px] border px-2.5 py-1 text-[11px] font-black" style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}>
                  {form.defterTuru === 'ISLETME' ? 'BASİT' : form.type === 'TUZEL_KISI' ? 'FİRMA' : 'ŞAHIS'}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px]" style={{ color: MUTED }}>
                <span className="font-mono">{form.taxNumber || 'VKN/TC yok'}</span>
                <span style={{ color: FAINT }}>·</span>
                <span>{form.taxOffice || 'Vergi dairesi yok'}</span>
                {!isNew && cardNav.total > 0 && (
                  <>
                    <span style={{ color: FAINT }}>·</span>
                    <span>{cardNav.index >= 0 ? cardNav.index + 1 : '-'} / {cardNav.total}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isNew && <CardNavButtons cardNav={cardNav} isNew={isNew} router={router} />}
            {!isNew && (
              <button
                type="button"
                onClick={() => setPortalOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-[8px] border px-3 text-[12.5px] font-bold transition hover:brightness-110"
                style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}
                title="Kısayol girişleri ve sık sorgular"
              >
                <Zap size={15} /> Kısayollar
              </button>
            )}
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-10 items-center gap-2 rounded-[8px] px-4 text-[12.5px] font-black transition disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DP})`, color: '#0f0d0b' }}
            >
              {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isNew ? 'Kaydı Oluştur' : 'Kaydet'}
            </button>
            {!isNew && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Mükellef pasife alınsın mı?')) deleteMukellef();
                }}
                disabled={isDeleting}
                className="hidden"
                style={{ borderColor: 'rgba(248,113,113,0.32)', color: '#fca5a5' }}
                title="Mükellefi pasife al"
              >
                {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              </button>
            )}
          </div>
        </div>

        {!isNew && eksikler.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: HAIR }}>
            <span className="text-[11.5px] font-semibold" style={{ color: MUTED }}>Eksik:</span>
            {eksikler.slice(0, 5).map((f) => (
              <span key={f.key} className="rounded-[6px] border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: 'rgba(240,183,85,0.28)', background: 'rgba(240,183,85,0.10)', color: AMBER }}>
                {f.label}
              </span>
            ))}
            {eksikler.length > 5 && <span className="text-[11px]" style={{ color: FAINT }}>+{eksikler.length - 5}</span>}
          </div>
        )}
      </header>

      <section className="overflow-hidden rounded-[8px] border" style={{ borderColor: LINE, background: CARD }}>
        <nav className="grid grid-cols-2 border-b md:grid-cols-4 xl:grid-cols-8" style={{ borderColor: HAIR, background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))' }}>
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className="inline-flex min-h-[58px] items-center justify-center gap-2 border-r px-3 text-[13.5px] font-black transition hover:bg-white/[0.045]"
                style={{
                  borderColor: HAIR,
                  color: active ? TEXT : MUTED,
                  background: active ? 'linear-gradient(180deg, rgba(79,134,201,0.19), rgba(79,134,201,0.10))' : 'transparent',
                  boxShadow: active ? `inset 0 4px 0 ${STEEL}, inset 0 -1px 0 rgba(255,255,255,0.05)` : 'none',
                }}
              >
                <Icon size={18} style={{ color: active ? STEEL_BR : MUTED }} />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 sm:p-5">
          {activeTab === 'bilgiler' && <BilgilerTab form={form} setForm={setForm} taxpayerId={isNew ? null : id} onSave={saveForm} saving={isPending} />}
          {activeTab === 'beyannameler' && !isNew && id && <BeyannamelerTab taxpayerId={id} />}
          {activeTab === 'sgk' && (
            <PlaceholderTab
              icon={Shield}
              title="SGK İşlemleri"
              description="Mükellefin SGK bildirgeleri, çalışan listesi ve bordro akışı burada toplanacak."
              linkLabel="Bordro modülüne git"
              linkHref={`/panel/bordro?taxpayerId=${id}`}
            />
          )}
          {activeTab === 'tebligat' && (
            <PlaceholderTab icon={Mail} title="E-Tebligat" description="GİB e-tebligat takibi ve okundu durumları burada izlenecek." comingSoon />
          )}
          {activeTab === 'dosyalar' && !isNew && id && <DosyalarTab taxpayerId={id} />}
          {false && activeTab === 'dosyalar' && (
            <PlaceholderTab icon={BookOpen} title="Dosyalar" description="Mükellefe bağlı evraklar ve dosya arşivi." linkLabel="Evraklar modülüne git" linkHref={`/panel/evraklar?taxpayerId=${id}`} />
          )}
          {activeTab === 'cariHesap' && !isNew && id && <CariHesapTab taxpayerId={id} />}
          {activeTab === 'iseGiris' && (
            <PlaceholderTab icon={UserCog} title="İşe Giriş Bildirgesi" description="İşe giriş ve işten çıkış bildirimleri için ayrılmış alan." comingSoon />
          )}
          {activeTab === 'notlar' && <NotlarTab form={form} setForm={setForm} onSave={saveForm} saving={isPending} hasRecord={!isNew} />}
        </div>
      </section>

      {/* KISAYOL GİRİŞLERİ — açılır panel */}
      {portalOpen && !isNew && (
        <PortalDrawer vkn={form.taxNumber} onClose={() => setPortalOpen(false)} onKisayol={handleKisayolClick} />
      )}
    </form>
  );
}

// ============================================================
// KART NAVİGASYON
// ============================================================
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
// BİLGİLER TAB — Hattat benzeri satır akordeon
// ============================================================
type BilgiSectionId =
  | 'musteri'
  | 'mukellefiyet'
  | 'yetkili'
  | 'iletisim'
  | 'giris'
  | 'vergiSifre'
  | 'sgkSifre'
  | 'bagkur'
  | 'entegrator'
  | 'otomasyon'
  | 'sistem';

function BilgilerTab({
  form,
  setForm,
  taxpayerId,
  onSave,
  saving,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  taxpayerId: string | null;
  onSave: () => void;
  saving: boolean;
}) {
  const { data: credentialData } = useQuery({
    queryKey: ['portal-automation-credentials'],
    queryFn: () => portalAutomationApi.credentials(),
    enabled: !!taxpayerId,
    staleTime: 30_000,
  });

  const credentialReady = (provider: Extract<PortalProvider, 'GIB_IVD' | 'SGK_EBILDIRGE'>) => {
    const rows = credentialData?.rows || [];
    return rows.some((credential) => {
      if (credential.provider !== provider || credential.taxpayerId !== taxpayerId || credential.isActive === false) return false;
      const identity = provider === 'SGK_EBILDIRGE' ? credential.username : credential.userCode;
      return !!String(identity || '').trim() && (!!credential.hasPassword || !!credential.hasSecondaryPassword);
    });
  };

  const hasGibCredential = credentialReady('GIB_IVD');
  const hasSgkCredential = credentialReady('SGK_EBILDIRGE');

  const sections: {
    id: BilgiSectionId;
    title: string;
    subtitle: string;
    icon: React.ElementType;
    show: boolean;
    filled: boolean;
  }[] = [
    { id: 'musteri', title: 'Müşteri & Vergi Dairesi Bilgileri', subtitle: 'Ad, tip, VKN/TCKN, vergi dairesi, sicil ve adres', icon: Building2, show: true, filled: !!(form.companyName || form.firstName || form.taxNumber || form.taxOffice) },
    { id: 'mukellefiyet', title: 'Mükellefiyet Bilgileri', subtitle: 'Vergi türleri ve dönemler', icon: FileCheck, show: !!taxpayerId, filled: !!taxpayerId },
    { id: 'yetkili', title: 'Firma Yetkili Bilgileri', subtitle: 'Müdür, ortak, imza', icon: UserCog, show: !!taxpayerId, filled: false },
    { id: 'iletisim', title: 'İletişim Bilgileri', subtitle: 'Telefon, e-posta, KEP', icon: Phone, show: true, filled: form.phones.some(Boolean) || form.emails.some(Boolean) || !!form.kepAdresi },
    { id: 'giris', title: 'E-Devlet / E-Bildirge Giriş Bilgileri', subtitle: 'Portal kullanıcıları ve şifreler', icon: Lock, show: !!taxpayerId, filled: false },
    { id: 'bagkur', title: 'Bağ-Kur Bilgileri', subtitle: 'Sicil bilgisi', icon: Shield, show: true, filled: !!form.bagkurSicilNo },
    { id: 'entegrator', title: 'E-Fatura Entegratör Bilgileri', subtitle: 'Sağlayıcı ve mükellefiyet', icon: Sparkles, show: true, filled: !!form.eFaturaEntegrator || form.isEFaturaMukellefi },
    { id: 'otomasyon', title: 'Evrak & Otomasyon Bilgileri', subtitle: 'Teslim günü ve mesajlar', icon: Workflow, show: true, filled: !!form.evrakTeslimGunu || form.whatsappEvrakTalep || form.whatsappEvrakGeldi },
    { id: 'sistem', title: 'Defter & Sistem Bilgileri', subtitle: 'Luca / Mihsap eşleşme', icon: Settings2, show: true, filled: !!form.lucaSlug || !!form.mihsapId },
  ];
  let credentialSections: typeof sections = [
    { id: 'vergiSifre', title: 'Vergi Dairesi Şifre Bilgileri', subtitle: 'Kullanıcı kodu, parola ve şifre', icon: Lock, show: !!taxpayerId, filled: false },
    { id: 'sgkSifre', title: 'E-Bildirge Giriş Bilgileri', subtitle: 'SGK kullanıcı adı, sistem şifresi ve işyeri şifresi', icon: Shield, show: !!taxpayerId, filled: false },
  ];
  credentialSections = credentialSections.map((section) => {
    if (section.id === 'vergiSifre') return { ...section, filled: hasGibCredential };
    if (section.id === 'sgkSifre') return { ...section, filled: hasSgkCredential };
    return section;
  });
  const hiddenSectionIds = new Set<BilgiSectionId>(['yetkili', 'giris', 'bagkur']);
  const visible = sections
    .filter((s) => s.show && !hiddenSectionIds.has(s.id))
    .flatMap((s) => (s.id === 'iletisim' ? [s, ...credentialSections.filter((c) => c.show)] : [s]));
  const [open, setOpen] = useState<BilgiSectionId | null>(null);

  const renderSection = (section: BilgiSectionId) => {
    if (section === 'musteri') {
      return (
        <div className="space-y-5">
          <FormCluster title="Temel bilgiler">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 md:grid-cols-2">
              <div className="md:col-span-2">
                <span className="mb-1.5 block text-[11px] font-medium tracking-wide" style={{ color: MUTED }}>Mükellef Tipi</span>
                <Segmented
                  value={taxpayerKindFromForm(form)}
                  onChange={(v) => applyTaxpayerKind(v as TaxpayerKind, setForm)}
                  options={TAXPAYER_KIND_OPTIONS}
                />
              </div>

              {form.type === 'TUZEL_KISI' ? (
                <Field label="Şirket adı" required className="md:col-span-2">
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
                  onChange={(e) => setForm((p) => ({ ...p, taxNumber: e.target.value.replace(/\D/g, '').slice(0, form.type === 'TUZEL_KISI' ? 10 : 11) }))}
                  maxLength={form.type === 'TUZEL_KISI' ? 10 : 11}
                  required
                  className="font-mono"
                />
              </Field>
              <Field label="Logo URL">
                <InputBase value={form.logoUrl} onChange={(e) => setForm((p) => ({ ...p, logoUrl: e.target.value }))} />
              </Field>
            </div>
          </FormCluster>

          <FormCluster title="Vergi dairesi ve sicil">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Vergi dairesi" required>
                <InputBase value={form.taxOffice} onChange={(e) => setForm((p) => ({ ...p, taxOffice: e.target.value }))} required />
              </Field>
              <Field label="İşe başlama tarihi">
                <InputBase type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
              </Field>
              <Field label="İşi bırakma tarihi">
                <InputBase type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} />
              </Field>
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
              <Field label="Adres" className="md:col-span-2">
                <InputBase value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
              </Field>
            </div>
          </FormCluster>
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'mukellefiyet') {
      return taxpayerId ? <MukellefiyetlerCard taxpayerId={taxpayerId} sgkCredentialReady={hasSgkCredential} /> : null;
    }

    if (section === 'yetkili') {
      return taxpayerId ? <YetkililerSection taxpayerId={taxpayerId} /> : null;
    }

    if (section === 'iletisim') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <FormCluster title="Telefonlar">
              <div className="space-y-3">
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
            </FormCluster>
            <FormCluster title="E-postalar">
              <div className="space-y-3">
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
            </FormCluster>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="KEP Adresi">
              <InputBase type="email" value={form.kepAdresi} onChange={(e) => setForm((p) => ({ ...p, kepAdresi: e.target.value }))} />
            </Field>
            <Field label="Web Sitesi">
              <InputBase value={form.webSitesi} onChange={(e) => setForm((p) => ({ ...p, webSitesi: e.target.value }))} />
            </Field>
          </div>
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'vergiSifre') {
      return taxpayerId ? <TaxpayerPortalCredentialsCard taxpayerId={taxpayerId} provider="GIB_IVD" /> : null;
    }

    if (section === 'sgkSifre') {
      return taxpayerId ? <TaxpayerPortalCredentialsCard taxpayerId={taxpayerId} provider="SGK_EBILDIRGE" /> : null;
    }

    if (section === 'giris') {
      return taxpayerId ? <TaxpayerPortalCredentialsCard taxpayerId={taxpayerId} /> : null;
    }

    if (section === 'bagkur') {
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Bağ-Kur Sicil No">
            <InputBase value={form.bagkurSicilNo} onChange={(e) => setForm((p) => ({ ...p, bagkurSicilNo: e.target.value }))} className="font-mono" />
          </Field>
          <div className="rounded-[8px] border p-3 text-[12px]" style={{ borderColor: HAIR, background: CARD2, color: MUTED }}>
            <div className="flex items-center gap-2 font-semibold" style={{ color: STEEL_BR }}>
              <Lock size={13} /> Giriş bilgileri
            </div>
            <p className="mt-1.5">Bağ-Kur ve e-Devlet şifreleri giriş bilgileri bölümünden yönetilir.</p>
          </div>
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'entegrator') {
      return (
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
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'otomasyon') {
      return (
        <div className="space-y-4">
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
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div>
          <span className="mb-2 block text-[11px] font-medium tracking-wide" style={{ color: MUTED }}>Defter türü</span>
          <Segmented
            value={form.defterTuru}
            onChange={(v) => setForm((p) => ({ ...p, defterTuru: v as DefterTuru, mihsapDefterTuru: v === 'ISLETME' ? 'DEFTER_BEYAN' : 'BILANCO' }))}
            options={[{ value: 'BILANCO', label: 'Bilanço' }, { value: 'ISLETME', label: 'İşletme defteri' }]}
          />
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
        <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {visible.map((s) => (
        <AccordionRow
          key={s.id}
          icon={s.icon}
          title={s.title}
          subtitle={s.subtitle}
          filled={s.filled}
          open={open === s.id}
          onToggle={() => setOpen((current) => (current === s.id ? null : s.id))}
        >
          {renderSection(s.id)}
        </AccordionRow>
      ))}
    </div>
  );
}

function SectionSaveButton({
  onSave,
  saving,
  hasRecord,
}: {
  onSave: () => void;
  saving: boolean;
  hasRecord: boolean;
}) {
  return (
    <div className="flex justify-start border-t pt-3" style={{ borderColor: HAIR }}>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex h-10 items-center gap-2 rounded-[6px] px-4 text-[12.5px] font-black shadow-sm transition hover:brightness-105 disabled:opacity-50"
        style={{ background: '#16803d', border: '1px solid rgba(95,207,142,0.42)', color: '#fff' }}
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        {hasRecord ? 'Güncelle' : 'Kaydet'}
      </button>
    </div>
  );
}

function AccordionRow({
  icon: Icon,
  title,
  subtitle,
  filled,
  open,
  onToggle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  filled: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className="overflow-hidden rounded-[8px] border"
      style={{
        borderColor: open ? 'rgba(212,184,118,0.38)' : 'rgba(255,255,255,0.105)',
        background: open ? '#151318' : '#121318',
        boxShadow: open ? '0 14px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.045)' : '0 8px 22px rgba(0,0,0,0.18)',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:brightness-110"
        style={{ background: open ? 'rgba(212,184,118,0.10)' : 'rgba(255,255,255,0.035)' }}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border" style={{ borderColor: open ? 'rgba(212,184,118,0.34)' : LINE, color: open ? GOLD_BR : MUTED, background: open ? 'rgba(212,184,118,0.10)' : 'rgba(255,255,255,0.035)' }}>
          <Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-black" style={{ color: TEXT }}>{title}</span>
          <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: MUTED }}>{subtitle}</span>
        </span>
        {filled && (
          <span className="hidden rounded-[6px] border px-2 py-1 text-[10.5px] font-black sm:inline-flex" style={{ borderColor: 'rgba(95,207,142,0.30)', background: 'rgba(95,207,142,0.10)', color: GREEN }}>
            Tanımlı
          </span>
        )}
        <ChevronRight size={18} className="transition-transform" style={{ color: MUTED, transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} />
      </button>
      {open && (
        <div className="border-t p-4 sm:p-5" style={{ borderColor: HAIR, background: 'linear-gradient(180deg, #111217, #0d0e12)' }}>
          <div className="rounded-[10px] border p-4 sm:p-5" style={{ borderColor: 'rgba(212,184,118,0.18)', background: 'linear-gradient(180deg, rgba(255,255,255,0.032), rgba(255,255,255,0.014))', boxShadow: 'inset 3px 0 0 rgba(212,184,118,0.45), 0 10px 30px rgba(0,0,0,0.24)' }}>
            {children}
          </div>
        </div>
      )}
    </section>
  );
}

function FormCluster({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border p-4 sm:p-5" style={{ borderColor: 'rgba(212,184,118,0.22)', background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.020))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035)' }}>
      <div className="mb-4 flex items-center gap-2 border-b pb-3" style={{ borderColor: HAIR }}>
        <span className="h-2 w-2 rounded-full" style={{ background: GOLD, boxShadow: '0 0 0 4px rgba(212,184,118,0.10)' }} />
        <span className="text-[12px] font-black uppercase tracking-[0.12em]" style={{ color: GOLD_BR }}>{title}</span>
      </div>
      {children}
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
function NotlarTab({
  form,
  setForm,
  onSave,
  saving,
  hasRecord,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: () => void;
  saving: boolean;
  hasRecord: boolean;
}) {
  return (
    <div className="space-y-3">
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
      <SectionSaveButton onSave={onSave} saving={saving} hasRecord={hasRecord} />
    </div>
  );
}

type CariBakiye = {
  tahakkuk?: number;
  tahsilat?: number;
  iade?: number;
  duzeltme?: number;
  borc?: number;
  alacak?: number;
  bakiye?: number;
};

type CariHareket = {
  id: string;
  tarih: string;
  tip: 'TAHAKKUK' | 'TAHSILAT' | 'IADE' | 'DUZELTME' | string;
  tutar: number | string;
  aciklama?: string | null;
  odemeYontemi?: string | null;
  donem?: string | null;
  runningBakiye?: number;
  hizmet?: { hizmetAdi?: string | null } | null;
};

function CariHesapTab({ taxpayerId }: { taxpayerId: string }) {
  const [ekstreBusy, setEkstreBusy] = useState(false);
  const { data: bakiye, isLoading: bakiyeLoading } = useQuery<CariBakiye>({
    queryKey: ['cari-bakiye', taxpayerId],
    queryFn: () => api.get(`/cari-kasa/bakiye/${taxpayerId}`).then((r) => r.data),
    enabled: !!taxpayerId,
  });

  const { data: hareketler = [], isLoading: hareketLoading } = useQuery<CariHareket[]>({
    queryKey: ['cari-hareketler', taxpayerId, 'kart'],
    queryFn: () => api.get('/cari-kasa/hareket', { params: { taxpayerId, limit: 12 } }).then((r) => r.data),
    enabled: !!taxpayerId,
  });

  const loading = bakiyeLoading || hareketLoading;
  const netBakiye = Number(bakiye?.bakiye || 0);
  const borclu = netBakiye > 0;
  const downloadEkstre = async () => {
    setEkstreBusy(true);
    try {
      const now = new Date();
      const baslangic = `${now.getFullYear()}-01-01`;
      const bitis = now.toISOString().slice(0, 10);
      const resp = await api.get(`/cari-kasa/ekstre/${taxpayerId}/pdf`, {
        params: { baslangic, bitis },
        responseType: 'text',
        transformResponse: (data) => data,
      });
      const blob = new Blob([resp.data], { type: 'text/html; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      toast.success('Logolu ekstre açıldı');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ekstre indirilemedi');
    } finally {
      setEkstreBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-black" style={{ color: TEXT }}>Cari Hesap</h3>
          <p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>Cari Kasa & Tahsilat modülündeki bakiye ve son hareketler.</p>
        </div>
        <button
          type="button"
          onClick={downloadEkstre}
          disabled={ekstreBusy}
          className="inline-flex items-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[12.5px] font-bold transition disabled:opacity-50"
          style={{ background: 'rgba(212,184,118,0.14)', border: '1px solid rgba(212,184,118,0.30)', color: GOLD_BR }}
        >
          {ekstreBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          Ekstre indir
        </button>
        <Link
          href={`/panel/cari-kasa?mukellef=${taxpayerId}`}
          className="inline-flex items-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[12.5px] font-bold"
          style={{ background: `linear-gradient(135deg, ${STEEL_BR}, ${STEEL_DP})`, color: '#fff' }}
        >
          Cari modülünde aç <ExternalLink size={13} />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CariMetric label="Toplam tahakkuk" value={bakiye?.tahakkuk} />
        <CariMetric label="Toplam tahsilat" value={bakiye?.tahsilat} tone="good" />
        <CariMetric label="Açık bakiye" value={Math.abs(netBakiye)} tone={borclu ? 'bad' : 'good'} suffix={borclu ? 'Borç' : 'Alacak/Yok'} />
        <CariMetric label="Hareket" text={loading ? 'Yükleniyor' : `${hareketler.length} son kayıt`} />
      </div>

      <div className="overflow-x-auto rounded-[8px] border" style={{ borderColor: HAIR, background: CARD2 }}>
        <div className="min-w-[820px]">
          <div className="grid grid-cols-[110px_112px_minmax(220px,1fr)_120px_120px_120px] gap-2 border-b px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.10em]" style={{ borderColor: HAIR, color: FAINT }}>
            <span>Tarih</span>
            <span>Tip</span>
            <span>Açıklama</span>
            <span className="text-right">Borç</span>
            <span className="text-right">Alacak</span>
            <span className="text-right">Bakiye</span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 px-4 py-8 text-[13px]" style={{ color: MUTED }}>
              <Loader2 size={15} className="animate-spin" /> Cari hareketler yükleniyor...
            </div>
          ) : hareketler.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px]" style={{ color: MUTED }}>
              Bu mükellef için cari hareket bulunamadı.
            </div>
          ) : (
            hareketler.map((h) => {
              const tutar = toMoneyNumber(h.tutar);
              const borc = h.tip === 'TAHAKKUK' ? tutar : h.tip === 'IADE' ? -tutar : 0;
              const alacak = h.tip === 'TAHSILAT' ? tutar : h.tip === 'DUZELTME' ? -tutar : 0;
              const tipLabel = h.tip === 'TAHAKKUK' ? 'Tahakkuk' : h.tip === 'TAHSILAT' ? 'Tahsilat' : h.tip === 'IADE' ? 'İade' : 'Düzeltme';
              const isTahsilat = h.tip === 'TAHSILAT';
              return (
                <div key={h.id} className="grid grid-cols-[110px_112px_minmax(220px,1fr)_120px_120px_120px] gap-2 border-b px-4 py-3 text-[12.5px] last:border-b-0" style={{ borderColor: 'rgba(255,255,255,0.045)' }}>
                  <span className="tabular-nums" style={{ color: MUTED }}>{fmtDateTR(h.tarih?.substring(0, 10))}</span>
                  <span>
                    <span className="rounded-[6px] border px-2 py-1 text-[10.5px] font-bold" style={isTahsilat ? { borderColor: 'rgba(95,207,142,0.28)', background: 'rgba(95,207,142,0.10)', color: GREEN } : { borderColor: 'rgba(212,184,118,0.28)', background: 'rgba(212,184,118,0.10)', color: GOLD }}>
                      {tipLabel}
                    </span>
                  </span>
                  <span className="min-w-0 truncate" style={{ color: TEXT }}>
                    {h.hizmet?.hizmetAdi ? `${h.hizmet.hizmetAdi}${h.aciklama ? ' · ' : ''}` : ''}
                    {h.aciklama || h.donem || '—'}
                  </span>
                  <span className="text-right font-bold tabular-nums" style={{ color: borc ? RED : FAINT }}>{borc ? `${fmtTutar(borc)} ₺` : '—'}</span>
                  <span className="text-right font-bold tabular-nums" style={{ color: alacak ? GREEN : FAINT }}>{alacak ? `${fmtTutar(alacak)} ₺` : '—'}</span>
                  <span className="text-right font-bold tabular-nums" style={{ color: TEXT }}>{h.runningBakiye != null ? `${fmtTutar(h.runningBakiye)} ₺` : '—'}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function CariMetric({ label, value, text, tone = 'neutral', suffix }: { label: string; value?: number; text?: string; tone?: 'neutral' | 'good' | 'bad'; suffix?: string }) {
  const color = tone === 'good' ? GREEN : tone === 'bad' ? RED : TEXT;
  return (
    <div className="rounded-[8px] border p-4" style={{ borderColor: tone === 'bad' ? 'rgba(239,107,107,0.22)' : HAIR, background: tone === 'bad' ? 'rgba(239,107,107,0.06)' : 'rgba(255,255,255,0.025)' }}>
      <div className="text-[10.5px] font-black uppercase tracking-[0.10em]" style={{ color: FAINT }}>{label}</div>
      <div className="mt-2 text-[24px] font-black tabular-nums" style={{ color }}>
        {text ?? `${fmtTutar(value || 0)} ₺`}
      </div>
      {suffix && <div className="mt-1 text-[11px] font-bold" style={{ color }}>{suffix}</div>}
    </div>
  );
}

type MukellefDocument = {
  id: string;
  title: string;
  category: string;
  notes?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  updatedAt?: string;
  createdAt?: string;
  tags?: Array<{ tag?: string | null }>;
};

function DosyalarTab({ taxpayerId }: { taxpayerId: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<DocumentCategory>(DocumentCategory.EVRAK);
  const [progress, setProgress] = useState(0);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [viewBusyDocId, setViewBusyDocId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; title: string; subtitle: string; mimeType?: string | null; docKey: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  const { data: documents = [], isLoading } = useQuery<MukellefDocument[]>({
    queryKey: ['documents', 'taxpayer', taxpayerId],
    queryFn: () => documentsApi.findByTaxpayer(taxpayerId),
    enabled: !!taxpayerId,
  });

  const manualDocuments = useMemo(() => documents.filter(isManualMukellefDocument), [documents]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!previewDoc) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewDoc(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewDoc]);

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Dosya seçilmedi');
      const cleanTitle = title.trim() || file.name;
      const doc = await documentsApi.upload({
        taxpayerId,
        title: cleanTitle,
        category,
        file,
        tags: ['MANUEL_EVRAK'],
        onProgress: setProgress,
      });
      if (notes.trim()) {
        await documentsApi.update(doc.id, { notes: notes.trim() });
      }
      return doc;
    },
    onSuccess: () => {
      toast.success('Evrak yüklendi');
      setFile(null);
      setTitle('');
      setNotes('');
      setProgress(0);
      qc.invalidateQueries({ queryKey: ['documents', 'taxpayer', taxpayerId] });
    },
    onError: (e: any) => {
      const message = e?.response?.data?.message || e?.message || 'Evrak yüklenemedi';
      toast.error(message === 'Failed to fetch' || message === 'Network Error'
        ? 'Evrak yüklenemedi. Sunucuya erişim veya dosya türü kontrol edilmeli.'
        : message);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (documentId: string) => documentsApi.remove(documentId),
    onSuccess: () => {
      toast.success('Evrak silindi');
      qc.invalidateQueries({ queryKey: ['documents', 'taxpayer', taxpayerId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Evrak silinemedi'),
  });

  const downloadDocument = async (documentId: string) => {
    setBusyDocId(documentId);
    try {
      const res = await documentsApi.getDownloadUrl(documentId);
      const url = res?.url || res?.downloadUrl;
      if (!url) throw new Error('İndirme adresi alınamadı');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Evrak indirilemedi');
    } finally {
      setBusyDocId(null);
    }
  };

  const previewDocument = async (doc: MukellefDocument) => {
    setViewBusyDocId(doc.id);
    try {
      const res = await documentsApi.getDownloadUrl(doc.id);
      const url = res?.url || res?.downloadUrl;
      if (!url) throw new Error('Görüntüleme adresi alınamadı');
      setPreviewDoc({
        url,
        title: doc.title,
        subtitle: `${documentCategoryLabel(doc.category)} · ${formatBytes(doc.sizeBytes)} · ${fmtDateTR((doc.updatedAt || doc.createdAt || '').substring(0, 10))}`,
        mimeType: doc.mimeType,
        docKey: doc.id,
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Evrak açılamadı');
    } finally {
      setViewBusyDocId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[8px] border p-4" style={{ borderColor: HAIR, background: CARD2 }}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[8px] border" style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}>
            <Upload size={17} />
          </div>
          <div>
            <h3 className="text-[15px] font-black" style={{ color: TEXT }}>Manuel Evrak Yükleme</h3>
            <p className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>Kira kontratı, imza sirküleri, vekaletname ve diğer firma belgeleri.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <Field label="Dosya">
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className={FIELD_CLS}
              style={{ colorScheme: 'dark' }}
            />
          </Field>
          <Field label="Kategori">
            <select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)} className={SELECT_CLS} style={{ colorScheme: 'dark' }}>
              <option value={DocumentCategory.EVRAK}>Evrak</option>
              <option value={DocumentCategory.SOZLESME}>Sözleşme</option>
              <option value={DocumentCategory.FATURA}>Fatura</option>
              <option value={DocumentCategory.DIGER}>Diğer</option>
            </select>
          </Field>
          <Field label="Dosya başlığı">
            <InputBase value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name || 'Belge adı'} />
          </Field>
          <Field label="Dosya açıklaması">
            <InputBase value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Örn. 2026 kira kontratı, imza sirküleri, vekaletname" />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11.5px]" style={{ color: progress ? STEEL_BR : FAINT }}>
            {progress ? `Yükleme: %${progress}` : file ? `${file.name} seçildi` : 'Dosya seçilmedi'}
          </span>
          <button
            type="button"
            onClick={() => uploadMut.mutate()}
            disabled={!file || uploadMut.isPending}
            className="inline-flex h-10 items-center gap-2 rounded-[8px] px-4 text-[12.5px] font-black transition disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DP})`, color: '#0f0d0b' }}
          >
            {uploadMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Evrakı Yükle
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[8px] border" style={{ borderColor: HAIR, background: CARD2 }}>
        <div className="border-b px-4 py-3 text-[12px] font-black uppercase tracking-[0.10em]" style={{ borderColor: HAIR, color: FAINT }}>
          Yüklü evraklar
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-[13px]" style={{ color: MUTED }}>
            <Loader2 size={15} className="animate-spin" /> Evraklar yükleniyor...
          </div>
        ) : manualDocuments.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px]" style={{ color: MUTED }}>Bu mükellef için evrak yüklenmedi.</div>
        ) : (
          <div className="divide-y" style={{ borderColor: HAIR }}>
            {manualDocuments.map((doc) => (
              <div key={doc.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px_138px] md:items-center">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold" style={{ color: TEXT }}>{doc.title}</div>
                  <div className="mt-1 truncate text-[11.5px]" style={{ color: doc.notes ? MUTED : FAINT }}>
                    {doc.notes || 'Açıklama yok'}
                  </div>
                </div>
                <div className="text-[11.5px]" style={{ color: MUTED }}>
                  <div>{documentCategoryLabel(doc.category)} · {formatBytes(doc.sizeBytes)}</div>
                  <div className="mt-0.5">{fmtDateTR((doc.updatedAt || doc.createdAt || '').substring(0, 10))}</div>
                </div>
                <div className="flex justify-start gap-2 md:justify-end">
                  <button
                    type="button"
                    onClick={() => previewDocument(doc)}
                    disabled={viewBusyDocId === doc.id}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border"
                    style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}
                    title="Görüntüle"
                  >
                    {viewBusyDocId === doc.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadDocument(doc.id)}
                    disabled={busyDocId === doc.id}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border"
                    style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}
                    title="İndir"
                  >
                    {busyDocId === doc.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Bu evrak silinsin mi?')) deleteMut.mutate(doc.id);
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border"
                    style={{ borderColor: 'rgba(239,107,107,0.30)', background: 'rgba(239,107,107,0.08)', color: '#fca5a5' }}
                    title="Sil"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {mounted && previewDoc && createPortal((
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="flex h-[min(92vh,900px)] w-full max-w-[1120px] flex-col overflow-hidden rounded-[14px]"
            style={{ background: CARD2, border: `1px solid ${LINE}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${HAIR}` }}>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold" style={{ color: TEXT }}>{previewDoc.title}</div>
                <div className="mt-0.5 truncate text-[11.5px]" style={{ color: FAINT }}>{previewDoc.subtitle}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={previewDoc.url}
                  download={previewDoc.title.replace(/[\\/:*?"<>|]/g, '_')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="Evrakı indir"
                  style={{ background: STEEL_SF, border: `1px solid ${STEEL_LN}`, color: STEEL_BR }}
                >
                  <Download size={15} />
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="Kapat"
                  style={{ background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.24)', color: '#fda4af' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            {previewDoc.mimeType?.startsWith('image/') ? (
              <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
                <img src={previewDoc.url} alt={previewDoc.title} className="mx-auto max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <iframe key={previewDoc.docKey} title={previewDoc.title} src={previewDoc.url} className="min-h-0 flex-1 bg-white" />
            )}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function isManualMukellefDocument(doc: MukellefDocument): boolean {
  const title = String(doc.title || '').toLocaleUpperCase('tr-TR');
  const notes = String(doc.notes || '').toLocaleUpperCase('tr-TR');
  const category = String(doc.category || '').toLocaleUpperCase('tr-TR');
  const tags = (doc.tags || []).map((item) => String(item.tag || '').toLocaleUpperCase('tr-TR')).join(' ');
  const combined = `${title} ${notes} ${category} ${tags}`;
  if (category === String(DocumentCategory.BEYANNAME).toLocaleUpperCase('tr-TR')) return false;
  if (title.startsWith('DBS_')) return false;
  if (combined.includes('GIB_BEYANNAME') || combined.includes('GİB_BEYANNAME')) return false;
  if (combined.includes('GIB_TAHAKKUK') || combined.includes('GİB_TAHAKKUK')) return false;
  if (combined.includes('PORTALDAN OTOMATIK') || combined.includes('PORTALDAN OTOMATİK')) return false;
  if (combined.includes('PORTAL-AUTOMATION') || combined.includes('OTOMATIK') || combined.includes('OTOMATİK')) return false;
  return true;
}

function documentCategoryLabel(category?: string | null): string {
  if (category === DocumentCategory.SOZLESME) return 'Sözleşme';
  if (category === DocumentCategory.FATURA) return 'Fatura';
  if (category === DocumentCategory.BEYANNAME) return 'Beyanname';
  if (category === DocumentCategory.EVRAK) return 'Evrak';
  return 'Diğer';
}

function formatBytes(value?: number | null): string {
  const size = Number(value || 0);
  if (!size) return '0 KB';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
}

function toMoneyNumber(n: number | string | null | undefined): number {
  if (typeof n === 'number') return Number.isFinite(n) ? n : 0;
  const raw = String(n ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ============================================================
// BEYANNAME TAB — Beyannameler modülünden bu mükellefe ait kayıtlar
// ============================================================
function BeyannamelerTab({ taxpayerId }: { taxpayerId: string }) {
  const { data: kayitlar = [], isLoading } = useQuery({
    queryKey: ['beyan-kayitlari', 'mukellef', taxpayerId],
    queryFn: () => beyanKayitlariApi.list({ taxpayerId, limit: 300 }),
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string; subtitle: string; docKey: string } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); };
  }, []);

  const closePreview = () => {
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    setPreview(null);
  };

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const openDoc = async (row: BeyanKaydi, kind: 'beyanname' | 'tahakkuk') => {
    const hasFile = kind === 'beyanname' ? !!row.beyannameUrl : !!row.pdfUrl;
    if (!hasFile) {
      toast.warning('Bu kayıt için görüntülenecek PDF yok');
      return;
    }
    const key = `${row.id}:${kind}`;
    setBusyKey(key);
    try {
      const endpoint = kind === 'beyanname'
        ? `/beyan-kayitlari/${row.id}/beyanname`
        : `/beyan-kayitlari/${row.id}/pdf`;
      const res = await api.get(endpoint, { responseType: 'blob' });
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/pdf' });
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreview({
        url,
        docKey: key,
        title: `${BEYAN_TIPI_LABEL[row.beyanTipi] || row.beyanTipi} · ${fmtBeyanDonem(row.donem)}`,
        subtitle: `${kind === 'beyanname' ? 'Beyanname' : 'Tahakkuk'}${row.beyanTarihi ? ' · ' + fmtDateTR(row.beyanTarihi.substring(0, 10)) : ''}${row.tahakkukTutari != null ? ' · ' + fmtTutar(row.tahakkukTutari) + ' ₺' : ''}`,
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'PDF açılamadı');
    } finally {
      setBusyKey(null);
    }
  };

  const sorted = useMemo(
    () => [...(Array.isArray(kayitlar) ? kayitlar : [])].sort((a, b) => (b.donem || '').localeCompare(a.donem || '')),
    [kayitlar],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-[13px]" style={{ color: MUTED }}>
        <Loader2 size={15} className="animate-spin" /> Beyannameler yükleniyor…
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}>
          <FileText size={26} />
        </div>
        <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>Beyanname kaydı yok</h3>
        <p className="mt-2 max-w-md text-[12.5px]" style={{ color: MUTED }}>
          Bu mükellef için Beyannameler modülünden indirilmiş beyanname bulunamadı.
        </p>
        <Link href={`/panel/beyannameler?taxpayerId=${taxpayerId}`} className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-bold" style={{ background: `linear-gradient(135deg, ${STEEL_BR}, ${STEEL_DP})`, color: '#fff' }}>
          Beyannameler modülünü aç <ExternalLink size={13} />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px]" style={{ color: MUTED }}>{sorted.length} beyanname kaydı</span>
        <Link href={`/panel/beyannameler?taxpayerId=${taxpayerId}`} className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: STEEL_BR }}>
          Beyannameler modülünde aç <ExternalLink size={12} />
        </Link>
      </div>

      <div className="hidden rounded-[8px] border" style={{ borderColor: HAIR, background: CARD2 }}>
        <div className="grid grid-cols-[minmax(150px,1fr)_minmax(150px,1.1fr)_110px_120px_48px] gap-3 border-b px-3 py-2 text-[10px] font-black uppercase tracking-[0.10em]" style={{ borderColor: HAIR, color: FAINT }}>
          <span>Beyanname</span>
          <span>Donem</span>
          <span>Belge</span>
          <span className="text-right">Tutar</span>
          <span className="text-right">Ac</span>
        </div>
        <div>
          {sorted.flatMap((row) => ([
            { row, kind: 'beyanname' as const, tur: 'E-Beyanname', hasFile: !!row.beyannameUrl },
            { row, kind: 'tahakkuk' as const, tur: 'Tahakkuk', hasFile: !!row.pdfUrl },
          ])).map(({ row, kind, tur, hasFile }) => {
            const busy = busyKey === `${row.id}:${kind}`;
            const isBeyan = kind === 'beyanname';
            return (
              <div key={`${row.id}:${kind}:card`} className="grid grid-cols-[minmax(150px,1fr)_minmax(150px,1.1fr)_110px_120px_48px] gap-3 border-b px-3 py-2.5 text-[12.5px] last:border-b-0" style={{ borderColor: 'rgba(255,255,255,0.055)' }}>
                <div className="min-w-0">
                  <span className="inline-flex max-w-full items-center rounded-[6px] border px-2 py-1 text-[10.5px] font-black" style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}>
                    <span className="truncate">{BEYAN_TIPI_LABEL[row.beyanTipi] || row.beyanTipi}</span>
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="truncate font-black" style={{ color: TEXT }}>{fmtBeyanDonem(row.donem)}</div>
                  <div className="mt-0.5 truncate text-[11px] font-semibold" style={{ color: FAINT }}>
                    {row.beyanTarihi ? `Beyan: ${fmtDateTR(row.beyanTarihi.substring(0, 10))}` : 'Beyan tarihi yok'}
                    {row.onayNo ? ` - Onay: ${row.onayNo}` : ''}
                  </div>
                </div>
                <span className="self-center rounded-[6px] px-2 py-1 text-center text-[10px] font-black uppercase tracking-wide" style={isBeyan ? { background: STEEL_SF, color: STEEL_BR } : { background: 'rgba(212,184,118,0.12)', color: GOLD }}>
                  {tur}
                </span>
                <span className="self-center text-right font-black tabular-nums" style={{ color: isBeyan ? FAINT : TEXT }}>
                  {isBeyan ? '-' : (row.tahakkukTutari != null ? `${fmtTutar(row.tahakkukTutari)} TL` : '-')}
                </span>
                <span className="self-center text-right">
                  <DocBtn label={hasFile ? 'Goruntule' : 'PDF yok'} disabled={!hasFile} busy={busy} onClick={() => openDoc(row, kind)} muted={!isBeyan} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-[6px] border" style={{ borderColor: 'rgba(255,255,255,0.12)', background: '#101114' }}>
        <div className="border-b px-4 py-3" style={{ borderColor: HAIR, background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018))' }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-black" style={{ color: TEXT }}>E-Beyannameler</div>
              <div className="mt-0.5 text-[11px] font-semibold" style={{ color: FAINT }}>Beyannameler modülünden gelen kayıtlar</div>
            </div>
            <span className="rounded-[5px] border px-2.5 py-1 text-[11px] font-black" style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}>
              {sorted.length} kayıt
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-left">
          <colgroup>
            <col style={{ width: '42px' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr className="text-[10.5px] font-black uppercase tracking-[0.12em]" style={{ color: FAINT, background: 'rgba(255,255,255,0.032)' }}>
              <th className="px-3 py-3 font-black">
                <span className="block h-3.5 w-3.5 rounded-[3px] border" style={{ borderColor: LINE }} />
              </th>
              <th className="px-3 py-3 font-black">Beyanname Dönemi</th>
              <th className="px-3 py-3 font-black">Beyanname Türü</th>
              <th className="px-3 py-3 font-black">Belge Mahiyeti</th>
              <th className="px-3 py-3 font-black">Tür</th>
              <th className="px-3 py-3 text-right font-black">Tutar</th>
              <th className="px-3 py-3 text-right font-black">Aç</th>
            </tr>
          </thead>
          <tbody>
            {sorted.flatMap((row) => ([
              { row, kind: 'beyanname' as const, tur: 'E-Beyanname', hasFile: !!row.beyannameUrl },
              { row, kind: 'tahakkuk' as const, tur: 'Tahakkuk', hasFile: !!row.pdfUrl },
            ])).map(({ row, kind, tur, hasFile }) => {
              const busy = busyKey === `${row.id}:${kind}`;
              const isBeyan = kind === 'beyanname';
              return (
                <tr key={`${row.id}:${kind}`} className="border-t transition hover:bg-white/[0.02]" style={{ borderColor: HAIR }}>
                  <td className="px-3 py-3 align-middle">
                    <span className="block h-3.5 w-3.5 rounded-[3px] border" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.02)' }} />
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <div className="truncate text-[13.5px] font-black" style={{ color: TEXT }}>{fmtBeyanDonem(row.donem)}</div>
                    <div className="mt-0.5 truncate text-[11px] font-semibold" style={{ color: FAINT }}>
                      {row.beyanTarihi ? `Beyan: ${fmtDateTR(row.beyanTarihi.substring(0, 10))}` : 'Beyan tarihi yok'}
                      {row.onayNo ? ` · Onay: ${row.onayNo}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <span className="inline-flex items-center rounded-[5px] border px-2.5 py-1 text-[11.5px] font-black" style={{ borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}>
                      {BEYAN_TIPI_LABEL[row.beyanTipi] || row.beyanTipi}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-middle text-[12px] font-black tracking-wide" style={{ color: MUTED }}>
                    ASIL
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <span className="inline-flex min-w-[118px] justify-center rounded-[4px] px-2.5 py-1 text-[10.5px] font-black uppercase tracking-wide" style={isBeyan ? { background: 'rgba(79,134,201,0.16)', color: STEEL_BR } : { background: 'rgba(212,184,118,0.14)', color: GOLD_BR }}>
                      {tur}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right align-middle text-[13.5px] font-black tabular-nums" style={{ color: isBeyan ? FAINT : TEXT }}>
                    {isBeyan ? '—' : (row.tahakkukTutari != null ? `${fmtTutar(row.tahakkukTutari)} TL` : '—')}
                  </td>
                  <td className="px-3 py-3 text-right align-middle">
                    <DocBtn label={hasFile ? 'Görüntüle' : 'PDF yok'} disabled={!hasFile} busy={busy} onClick={() => openDoc(row, kind)} muted={!isBeyan} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {mounted && preview && createPortal((
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={closePreview}
        >
          <div
            className="flex h-[min(92vh,900px)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[14px]"
            style={{ background: CARD2, border: `1px solid ${LINE}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${HAIR}` }}>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold" style={{ color: TEXT }}>{preview.title}</div>
                <div className="mt-0.5 truncate text-[11.5px]" style={{ color: FAINT }}>{preview.subtitle}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={preview.url}
                  download={`${preview.title}.pdf`.replace(/[\\/:*?"<>|]/g, '_')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="PDF indir"
                  style={{ background: STEEL_SF, border: `1px solid ${STEEL_LN}`, color: STEEL_BR }}
                >
                  <Download size={15} />
                </a>
                <button
                  type="button"
                  onClick={() => { const f = document.getElementById('mukellef-beyan-pdf') as HTMLIFrameElement | null; f?.contentWindow?.print(); }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="Yazdır"
                  style={{ background: 'rgba(255,255,255,0.045)', border: `1px solid ${LINE}`, color: MUTED }}
                >
                  <Printer size={15} />
                </button>
                <button
                  type="button"
                  onClick={closePreview}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="Kapat"
                  style={{ background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.24)', color: '#fda4af' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <iframe key={preview.docKey} id="mukellef-beyan-pdf" title={preview.title} src={preview.url} className="min-h-0 flex-1 bg-white" />
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function DocBtn({ label, disabled, busy, onClick, muted }: { label: string; disabled?: boolean; busy?: boolean; onClick: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
      style={muted
        ? { borderColor: LINE, background: 'rgba(255,255,255,0.03)', color: MUTED }
        : { borderColor: STEEL_LN, background: STEEL_SF, color: STEEL_BR }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={15} />}
    </button>
  );
}

function fmtBeyanDonem(donem: string): string {
  if (!donem) return '—';
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  let m = /^(\d{4})-(\d{2})$/.exec(donem);
  if (m) { const ay = +m[2]; return ay >= 1 && ay <= 12 ? `${aylar[ay - 1]} ${m[1]}` : donem; }
  m = /^(\d{4})-Q(\d)$/.exec(donem); if (m) return `${m[1]} ${m[2]}. Dönem`;
  m = /^(\d{4})-YIL$/.exec(donem); if (m) return `${m[1]} Yıllık`;
  return donem;
}

function fmtTutar(n: number | string | null | undefined): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0,00';
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================
// YARDIMCI KOMPONENTLER
// ============================================================
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
            style={on ? { background: `linear-gradient(135deg, ${GOLD_BR}, ${GOLD_DP})`, color: '#0f0d0b', boxShadow: '0 4px 12px -4px rgba(212,184,118,0.45)' } : { color: MUTED, background: 'transparent' }}
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
      <span className="mb-1.5 block text-[11.5px] font-black tracking-wide" style={{ color: 'rgba(245,245,244,0.66)' }}>
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
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition hover:bg-white/[0.04]" style={{ borderColor: checked ? 'rgba(95,207,142,0.30)' : HAIR, background: checked ? 'rgba(95,207,142,0.10)' : CARD2 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border" style={{ borderColor: checked ? 'rgba(95,207,142,0.30)' : LINE, color: checked ? GREEN : 'rgba(245,245,244,0.30)' }}>
        <CheckCircle2 size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold" style={{ color: TEXT }}>{title}</span>
        <span className="mt-0.5 block text-[12px]" style={{ color: MUTED }}>{detail}</span>
      </span>
    </label>
  );
}
