/**
 * Eski detay sayfası kaldırıldı — ana sayfa artık tüm akışı yönetiyor.
 * Bu route sadece URL uyumluluğu için kalıyor ve seansı query param ile
 * ana sayfaya yönlendirir.
 */
import { redirect } from 'next/navigation';

export default function KdvSessionRedirect({ params }: { params: { id: string } }) {
  redirect(`/panel/kdv-kontrol?s=${params.id}`);
}
