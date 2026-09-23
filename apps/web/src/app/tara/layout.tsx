import type { Metadata, Viewport } from 'next';

/**
 * BELGE TARAYICI — telefon tarayıcısından çalışan sürüm (2026-09-23, Muzaffer Bey).
 * Android'de APK var; iPhone'a APK kurulamadığı (Apple Developer hesabı yok) için personelin
 * iPhone'u Safari → Paylaş → "Ana Ekrana Ekle" ile bu sayfayı uygulama gibi kullanır.
 * Kendi manifest'i var (start_url /tara) — ana ekrana eklenen simge portala değil buraya açılır.
 */
export const metadata: Metadata = {
  title: 'MOREN Belge Tarayıcı',
  description: "Fiş/fatura fotoğrafını çekip Fatura İşleme Merkezi'ne gönderir.",
  manifest: '/tara-manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Belge Tarayıcı' },
};

export const viewport: Viewport = {
  themeColor: '#0e2a58',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function TaraLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
