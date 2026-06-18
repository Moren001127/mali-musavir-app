'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMe } from '@/hooks/useAuth';

/**
 * Fatura İşleme Merkezi v2 — Tam Sayfa Mod (yeni tasarım)
 *
 * Mevcut /fatura-merkezi route'unun yeniden tasarlanan sürümü.
 * Panel layout'unu BYPASS eder; kendi sol-menülü beyaz/yeşil arayüzünü içerir.
 * Portal temasından bağımsız kendi teması vardır (page.tsx içinde #fm-root scope'lu).
 *
 * Auth kontrolü burada — login değilse /giris'e yönlendirir.
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
        style={{ background: '#f4f6f5' }}
      >
        <div className="text-center">
          <div
            className="w-10 h-10 rounded-full border-2 border-transparent animate-spin mx-auto"
            style={{ borderTopColor: '#15803d', borderRightColor: '#15803d' }}
          />
          <p className="text-sm mt-3" style={{ color: '#6b7280' }}>Yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="h-screen w-screen overflow-auto" style={{ background: '#f4f6f5' }}>
      {children}
    </div>
  );
}
