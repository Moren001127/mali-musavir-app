// Modul gecici olarak kapatildi - islem yapildikca yeniden acilacak.
// Eski URL'ye giden kullanici Fatura Isleme ana ekranina yonlendirilir.
import { redirect } from 'next/navigation';
export default function Page() {
  redirect('/panel/ajanlar/mihsap');
}
