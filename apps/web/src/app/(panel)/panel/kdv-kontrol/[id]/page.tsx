/**
 * Eski detay sayfası kaldırıldı — ana sayfa artık tüm akışı yönetiyor.
 * Bu route sadece URL uyumluluğu için kalıyor ve seansı query param ile
 * ana sayfaya yönlendirir.
 */
import { redirect } from 'next/navigation';

export default async function KdvSessionRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/panel/kdv-kontrol?s=${id}`);
}
