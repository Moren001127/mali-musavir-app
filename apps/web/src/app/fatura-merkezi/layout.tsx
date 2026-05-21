'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMe } from '@/hooks/useAuth';

/**
 * Fatura İşleme Merkezi — Tam Sayfa Mod
 *
 * Bu route panel layout'unu BYPASS eder; kendi tam ekran arayüzünü
 * (sol sidebar + üst toolbar) içerir. Sebep: Mihsap benzeri yoğun
 * tablolar ve çoklu sekmeler panel-içi 6 padding'de sıkışıyordu.
 *
 * Auth kontrolü burada yapılır — login değilse /giris'e yönlendirir.
 */
export default function FaturaMerkeziLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isError) router.push('/giris');
  }, [isLoading, isError, router]);

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg)' }}
      >
        <div className="text-center">
          <div
            className="w-10 h-10 rounded-full border-2 border-transparent animate-spin mx-auto"
            style={{ borderTopColor: 'var(--accent)', borderRightColor: 'var(--accent)' }}
          />
          <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>Yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div
      className="h-screen w-screen overflow-hidden"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {children}
    </div>
  );
}
