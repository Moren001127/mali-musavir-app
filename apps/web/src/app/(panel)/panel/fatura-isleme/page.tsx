/* Eski /panel/fatura-isleme rotası — yeni /fatura-merkezi'ye yönlendirir.
   Eski bookmark veya iç bağlantılar bozulmasın diye sayfa olarak duruyor;
   tam ekran yeni modüle anında yönlendirir.

   v2 öncesi 2600+ satırlık eski iskelet kaldırıldı — backend endpoint'leri
   aynı tablolara yazdığı için veri kaybı yok; yeni /fatura-merkezi
   tam fonksiyonel halefi.
*/

import { redirect } from 'next/navigation';

export default function FaturaIslemeRedirect() {
  redirect('/fatura-merkezi');
}
