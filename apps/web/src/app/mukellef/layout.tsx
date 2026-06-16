'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { getTaxpayerToken, setTaxpayerToken } from '@/lib/taxpayer-api';

const GOLD = '#d4b876';

export default function MukellefLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getTaxpayerToken()) {
      router.replace('/giris/mukellef');
      return;
    }
    setReady(true);
  }, [router]);

  function logout() {
    setTaxpayerToken(null);
    router.replace('/giris/mukellef');
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f0d0b' }}>
        <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #15110d, #0f0d0b)' }}>
      <header
        className="sticky top-0 z-20 flex items-center justify-between px-5 py-3"
        style={{ background: 'rgba(15,13,11,0.92)', borderBottom: '1px solid rgba(184,160,111,0.18)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3">
          <img src="/brand/moren-logo-gold.png" alt="Moren" style={{ height: 34, width: 'auto' }} />
          <span className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>Mükellef Portalı</span>
        </div>
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.7)' }}
        >
          <LogOut size={14} /> Çıkış
        </button>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
