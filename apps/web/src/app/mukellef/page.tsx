'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { FileText, Wallet, FolderArchive, Sparkles, ArrowRight } from 'lucide-react';
import { GOLD, fmtTRY, DURUM, Card, Empty, Spinner, OzetCard } from './_lib/shared';

export default function MukellefOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-dashboard'],
    queryFn: () => taxpayerApi.get('/portal/dashboard').then((r) => r.data),
  });

  if (isLoading) return <Spinner />;

  const p = data?.profile || {};
  const ad = p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Mükellef';
  const ozet = data?.ozet || {};

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-[.18em]" style={{ color: '#b8a06f' }}>Hoş geldiniz</p>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>{ad}</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <OzetCard icon={FileText} label="Bekleyen Beyanname" value={String(ozet.bekleyenBeyan ?? 0)} />
        <OzetCard icon={Wallet} label="Cari Bakiye" value={fmtTRY(ozet.cariBakiye ?? 0)} accent={(ozet.cariBakiye ?? 0) > 0 ? '#f87171' : '#4ade80'} />
        <OzetCard icon={FolderArchive} label="Evrak" value={String(ozet.evrakSayisi ?? 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><FileText size={15} style={{ color: GOLD }} /><h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Son Beyannameler</h2></div>
            <Link href="/mukellef/beyannameler" className="text-[12px] inline-flex items-center gap-1" style={{ color: GOLD }}>Tümü <ArrowRight size={13} /></Link>
          </div>
          {(!data?.beyannameler || data.beyannameler.length === 0) ? <Empty>Beyanname kaydı yok.</Empty> : (
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {data.beyannameler.slice(0, 6).map((b: any, i: number) => {
                const d = DURUM[b.durum] || DURUM.beklemede;
                return (
                  <div key={i} className="flex items-center justify-between py-2.5">
                    <div><span className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>{b.beyanTipi}</span><span className="text-[12px] ml-2" style={{ color: 'rgba(250,250,249,0.45)' }}>{b.donem}</span></div>
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-1 rounded-md" style={{ background: `${d.color}1a`, color: d.color }}><d.Icon size={12} /> {d.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Link href="/mukellef/asistan" className="block rounded-2xl p-5 transition hover:brightness-110" style={{ background: 'linear-gradient(135deg, rgba(184,160,111,0.16), rgba(184,160,111,0.05))', border: '1px solid rgba(184,160,111,0.28)' }}>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl mb-3" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#0f0d0b' }}><Sparkles size={20} /></div>
          <h2 className="text-[16px] font-semibold" style={{ color: '#fafaf9' }}>MOREN AI'ya sorun</h2>
          <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: 'rgba(250,250,249,0.55)' }}>Beyanname, cari bakiye ve evrak durumunuz hakkında size özel asistana soru sorun.</p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: GOLD }}>Sohbeti aç <ArrowRight size={15} /></span>
        </Link>
      </div>
    </div>
  );
}
