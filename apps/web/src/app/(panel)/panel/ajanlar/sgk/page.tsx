'use client';
import '@/app/(panel)/panel/ajanlar/_components/operations-white.css';
import '@/components/portal-automation/portal-automation-white.css';
import '@/components/portal-automation/sgk-rapor/sgk-rapor-white.css';

import { portalStyle } from '@/lib/portal-theme';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import SgkBildirgeModule from '@/components/portal-automation/SgkBildirgeModule';
import SgkRaporBolumu from '@/components/portal-automation/sgk-rapor/SgkRaporBolumu';

type Bolum = 'bildirge' | 'rapor';

export default function SgkAutomationPage() {
  return (
    <div data-ops-page="ajanlar" data-pa-page="sgk" className="space-y-5 max-w-7xl">
      {/* ── Başlık kartı — koyu temada (A) kart + altın şerit; beyaz temada (D) sade sayfa başlığı ── */}
      <div data-pa-header className="rounded-2xl border overflow-hidden relative" style={portalStyle({ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.07)' })}>
        <div data-pa-header-line className="absolute top-0 left-0 right-0 h-[3px]" style={portalStyle({ background: 'linear-gradient(90deg, #d4b876, transparent)' })} />
        <div data-pa-header-body className="p-6 flex items-start gap-4">
          <span data-pa-header-icon className="grid place-items-center rounded-2xl flex-shrink-0" style={portalStyle({ width: 56, height: 56, background: 'radial-gradient(circle at 30% 30%, rgba(212,184,118,0.22), rgba(212,184,118,0.06))', border: '1px solid rgba(212,184,118,0.25)', color: '#d4b876' })}>
            <ShieldCheck size={26} />
          </span>
          <div className="min-w-0">
            <div data-pa-eyebrow className="flex items-center gap-2.5 mb-1">
              <span className="w-[22px] h-px" style={portalStyle({ background: '#d4b876' })} />
              <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={portalStyle({ color: '#b8a06f' })}>SGK · e-BİLDİRGE</span>
            </div>
            <h1 style={portalStyle({ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.02em', lineHeight: 1.1 })}>
              SGK Bildirge ve Raporlar
            </h1>
            <p className="text-[13px] mt-1.5" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>
              Onaylı tahakkuk fişleri ve hizmet listeleri her gece otomatik çekilir; dönem, mahiyet, kanun no ve tutar ile kaydedilir.
            </p>
          </div>
        </div>
      </div>

      {/* useSearchParams (?bolum=rapor) için Suspense sınırı */}
      <Suspense fallback={<div className="px-3 py-10 text-center text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}><Loader2 size={18} className="animate-spin inline" /> Yükleniyor…</div>}>
        <SgkBolumleri />
      </Suspense>
    </div>
  );
}

// Bölüm sekmeleri: "Bildirgeler" (varsayılan, adreste bolum yok) · "Rapor · İş Kazası · Giriş-Çıkış" (?bolum=rapor).
// Diğer adres parametreleri (Bildirgeler'in sayfa/boyut'u) korunur.
function SgkBolumleri() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bolum: Bolum = searchParams.get('bolum') === 'rapor' ? 'rapor' : 'bildirge';

  const sec = (b: Bolum) => {
    if (b === bolum) return;
    const p = new URLSearchParams(searchParams.toString());
    if (b === 'rapor') p.set('bolum', 'rapor');
    else p.delete('bolum');
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const sekme = (b: Bolum, ad: string) => {
    const secili = bolum === b;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={secili}
        data-sr-sekme
        onClick={() => sec(b)}
        className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[10px] px-4 text-[13px] font-semibold transition"
        style={portalStyle(secili ? { background: 'rgba(212,184,118,0.16)', color: '#d4b876' } : { background: 'transparent', color: 'rgba(250,250,249,0.7)' })}
      >
        {ad}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div data-sr-sekmeler role="tablist" aria-label="SGK bölümleri" className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border p-1"
        style={portalStyle({ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' })}>
        {sekme('bildirge', 'Bildirgeler')}
        {sekme('rapor', 'Rapor · İş Kazası · Giriş-Çıkış')}
      </div>
      {bolum === 'rapor' ? <SgkRaporBolumu /> : <SgkBildirgeModule />}
    </div>
  );
}
