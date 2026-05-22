import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from 'sonner';
import GlobalMorenVoice from '@/components/moren-ai/GlobalMorenVoice';

export const metadata: Metadata = {
  title: 'Moren Mali Müşavirlik Yönetim Portali',
  description: 'Moren Mali Müşavirlik — Ofis Yönetim Portali',
  manifest: '/manifest.json',
  themeColor: '#d4b876',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Moren',
  },
  icons: {
    apple: '/brand/moren-logo-gold.png',
  },
};

export const viewport = {
  themeColor: '#d4b876',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <head>
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
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
