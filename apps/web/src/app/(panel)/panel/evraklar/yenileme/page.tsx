// Modul gecici olarak kapatildi - islem yapildikca yeniden acilacak.
import { redirect } from 'next/navigation';
export default function Page() {
  redirect('/panel');
}
