import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from 'sonner';
import GlobalMorenVoice from '@/components/moren-ai/GlobalMorenVoice';
import { PwaRegistration } from '@/components/PwaRegistration';

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
    icon: [
      { url: '/icons/moren-pwa-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/moren-pwa-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#d4b876',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        {/* Inter — mükellef kartı tipografisi (onaylanan tasarım). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Portal sabit A temasıyla açılır (FOUC önlemi). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  document.documentElement.setAttribute('data-theme', 'A');
                } catch(e){}
              })();
            `,
          }}
        />
      </head>
      <body>
        <Providers>
          {children}
          <GlobalMorenVoice />
          <PwaRegistration />
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
