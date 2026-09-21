import type { Metadata, Viewport } from 'next';
import './globals.css';
import './portal-white.css';
import './portal-utilities.css';
import { Providers } from '@/components/providers';
import { Toaster } from 'sonner';
import GlobalMorenVoice from '@/components/moren-ai/GlobalMorenVoice';
import { PwaRegistration } from '@/components/PwaRegistration';
import { PortalTheme } from '@/components/PortalTheme';

export const metadata: Metadata = {
  applicationName: 'Moren',
  title: 'Moren Mali Müşavirlik Yönetim Portali',
  description: 'Moren Mali Müşavirlik — Ofis Yönetim Portali',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Moren',
  },
  icons: {
    // 2026-09-21: sekme simgesi eski siyah/altın logodan lacivert işarete (beyaz kare) geçti — ?v=3 önbelleği kırar
    icon: [
      { url: '/favicon.ico?v=3', sizes: '48x48 32x32 16x16', type: 'image/x-icon' },
      { url: '/icons/favicon-32.png?v=3', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-48.png?v=3', sizes: '48x48', type: 'image/png' },
      { url: '/icons/moren-pwa-192.png?v=3', sizes: '192x192', type: 'image/png' },
      { url: '/icons/moren-pwa-512.png?v=3', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: [{ url: '/favicon.ico?v=3' }],
    apple: [{ url: '/icons/apple-touch-icon.png?v=3', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#0e2a58',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = process.env.MOREN_PORTAL_THEME === 'A' ? 'A' : 'D';
  return (
    <html lang="tr" data-theme={theme} suppressHydrationWarning>
      <head>
        {/* Inter — mükellef kartı tipografisi (onaylanan tasarım). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* İlk boyamadan önce doğru tema; Fatura Merkezi özgün kapsamını korur. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  var invoice = location.pathname === '/fatura-merkezi' || location.pathname.indexOf('/fatura-merkezi/') === 0;
                  document.documentElement.setAttribute('data-theme', invoice ? 'A' : '${theme}');
                } catch(e){}
              })();
            `,
          }}
        />
      </head>
      <body>
        <Providers>
          <PortalTheme theme={theme} />
          {children}
          <GlobalMorenVoice />
          <PwaRegistration />
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
