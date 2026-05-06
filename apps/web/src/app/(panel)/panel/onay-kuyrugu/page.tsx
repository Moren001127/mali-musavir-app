'use client';
// Onay Kuyrugu modulu Mihsap Fatura Isleme sayfasina entegre edildi.
// Bu sayfa artik kullanilmiyor — kullaniciyi yeni konuma yonlendirir.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function OnayKuyruguRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/panel/ajanlar/mihsap');
  }, [router]);
  return (
    <div className="p-6 text-center text-stone-500 text-sm">
      Onay Kuyruğu, Fatura İşleme modülüne taşındı. Yönlendiriliyor…
    </div>
  );
}
