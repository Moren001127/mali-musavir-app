'use client';
import { useMe } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import MobilePanelNavigation from '@/components/layout/MobilePanelNavigation';
import { LucaCaptchaOverlay } from '@/components/luca/LucaCaptchaOverlay';
import NotificationFlashOverlay from '@/components/layout/NotificationFlashOverlay';

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isError) router.push('/giris');
  }, [isLoading, isError, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <div
            className="w-10 h-10 rounded-full border-2 border-transparent animate-spin mx-auto"
            style={{ borderTopColor: '#d4b876', borderRightColor: '#d4b876' }}
          />
          <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>Yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div data-panel-shell className="flex h-screen w-full max-w-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="hidden lg:flex">
        <Sidebar />
      </div>
      <div data-panel-content className="flex-1 flex flex-col min-w-0 max-w-full">
        <MobilePanelNavigation />
        <div className="hidden lg:block">
          <TopBar />
        </div>
        <main data-panel-main className="flex-1 min-w-0 max-w-full overflow-y-auto overflow-x-hidden p-3 pb-24 sm:p-4 lg:overflow-auto lg:p-4 lg:pb-4 animate-fade-up">
          {children}
        </main>
        <LucaCaptchaOverlay />
      </div>
      <NotificationFlashOverlay />
    </div>
  );
}
