'use client';
import { useMe } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isError) router.push('/giris');
  }, [isLoading, isError, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
        <div className="text-center">
          <div
            className="w-10 h-10 rounded-full border-2 border-transparent animate-spin mx-auto"
            style={{ borderTopColor: '#d4b876', borderRightColor: '#d4b876' }}
          />
          <p className="text-sm mt-3" style={{ color: 'rgba(250,250,249,0.45)' }}>Yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar user={user} />
        <main className="flex-1 overflow-auto p-6 animate-fade-up">
          {children}
        </main>
      </div>
    </div>
  );
}
