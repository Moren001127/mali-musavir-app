'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { FileText, Wallet, FolderArchive, Sparkles, ArrowRight, ReceiptText, MailWarning, BellDot, BarChart3 } from 'lucide-react';
import { fmtTRY, Card, Spinner, OzetCard, PageTitle } from './_lib/shared';
import { MukellefBrifing } from './_lib/MukellefBrifing';
import { MukellefTakvim } from './_lib/MukellefTakvim';

const ALIS = '#d4b876';
const SATIS = '#4ade80';
const AY_KISA = (donem: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(donem || '');
  if (!m) return donem || '—';
  const aylar = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${aylar[Number(m[2]) - 1] || m[2]}`;
};

const HIZLI = [
  { href: '/mukellef/beyannameler', label: 'Beyannamelerim', icon: FileText, c: '#d8ad70' },
  { href: '/mukellef/faturalar', label: 'Faturalarım', icon: ReceiptText, c: '#8fd7bd' },
  { href: '/mukellef/cari', label: 'Cari Hesabım', icon: Wallet, c: '#d9a06c' },
  { href: '/mukellef/tebligatlar', label: 'e-Tebligat', icon: MailWarning, c: '#fbbf24' },
  { href: '/mukellef/evraklar', label: 'Evraklarım', icon: FolderArchive, c: '#60a5fa' },
  { href: '/mukellef/asistan', label: 'MOREN AI', icon: Sparkles, c: '#f09aa8' },
];

export default function MukellefOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-dashboard'],
    queryFn: () => taxpayerApi.get('/portal/dashboard').then((r) => r.data),
  });

  if (isLoading) return <Spinner />;

  const p = data?.profile || {};
  const ad = p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Mükellef';
  const ozet = data?.ozet || {};
  const fa = data?.faturaOzet || {};
  const aylik: any[] = data?.faturaAylik || [];
  const maxAy = Math.max(1, ...aylik.map((a) => Math.max(a.alis, a.satis)));

  return (
    <div className="space-y-6">
      <PageTitle ust="Hoş geldiniz" baslik={ad} />

      <MukellefBrifing userName={ad} />

      {(ozet.okunmamisTebligat ?? 0) > 0 && (
        <Link href="/mukellef/tebligatlar" className="flex items-center gap-2.5 rounded-2xl px-4 py-3 transition hover:brightness-110" style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.36)' }}>
          <BellDot size={16} style={{ color: '#fbbf24' }} />
          <span className="text-[13px]" style={{ color: '#fafaf9' }}><strong>{ozet.okunmamisTebligat}</strong> okunmamış e-Tebligatınız var.</span>
          <ArrowRight size={14} className="ml-auto" style={{ color: '#fbbf24' }} />
        </Link>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <OzetCard icon={FileText} label="Bekleyen Beyanname" value={String(ozet.bekleyenBeyan ?? 0)} accent="#fbbf24" sub="onay bekliyor" />
        <OzetCard icon={Wallet} label="Cari Bakiye" value={fmtTRY(ozet.cariBakiye ?? 0)} accent={(ozet.cariBakiye ?? 0) > 0 ? '#f87171' : '#4ade80'} sub={(ozet.cariBakiye ?? 0) > 0 ? 'açık bakiye (borç)' : 'bakiye'} />
        <OzetCard icon={ReceiptText} label="Fatura" value={String(ozet.faturaSayisi ?? 0)} accent="#8fd7bd" sub="işlenen belge" />
        <OzetCard icon={FolderArchive} label="Evrak" value={String(ozet.evrakSayisi ?? 0)} accent="#60a5fa" sub="arşivde" />
      </div>

      {/* Hızlı erişim */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        {HIZLI.map(({ href, label, icon: Icon, c }) => (
          <Link key={href} href={href} className="flex flex-col items-center gap-2 rounded-2xl py-4 px-2 transition hover:brightness-125" style={{ background: `linear-gradient(160deg, ${c}14, ${c}06), #100d0a`, border: `1px solid ${c}26` }}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${c}1c`, border: `1px solid ${c}3a`, color: c }}><Icon size={18} /></span>
            <span className="text-[11.5px] font-medium text-center leading-tight" style={{ color: 'rgba(250,250,249,0.8)' }}>{label}</span>
          </Link>
        ))}
      </div>

      {/* Mali takvim — ofis BuHaftaTakvim ile birebir */}
      <MukellefTakvim />

      {/* Fatura mini grafik */}
      {aylik.length > 0 && (
        <Card accent="#8fd7bd">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={15} style={{ color: '#8fd7bd' }} />
              <h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Aylık Alış / Satış</h2>
              <div className="ml-3 flex items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ALIS }} /> Alış {fmtTRY(fa.alisToplam ?? 0)}</span>
                <span className="inline-flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SATIS }} /> Satış {fmtTRY(fa.satisToplam ?? 0)}</span>
              </div>
            </div>
            <Link href="/mukellef/faturalar" className="text-[12px] inline-flex items-center gap-1" style={{ color: '#8fd7bd' }}>Detay <ArrowRight size={13} /></Link>
          </div>
          <div className="flex items-end gap-3 overflow-x-auto pb-1" style={{ height: 150 }}>
            {aylik.map((a) => (
              <div key={a.donem} className="flex flex-col items-center gap-1.5 shrink-0" style={{ minWidth: 40 }}>
                <div className="flex items-end gap-1" style={{ height: 108 }}>
                  <div title={`Alış: ${fmtTRY(a.alis)}`} className="w-3 rounded-t" style={{ height: `${Math.max(2, (a.alis / maxAy) * 108)}px`, background: `linear-gradient(180deg, ${ALIS}, ${ALIS}66)` }} />
                  <div title={`Satış: ${fmtTRY(a.satis)}`} className="w-3 rounded-t" style={{ height: `${Math.max(2, (a.satis / maxAy) * 108)}px`, background: `linear-gradient(180deg, ${SATIS}, ${SATIS}66)` }} />
                </div>
                <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>{AY_KISA(a.donem)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
