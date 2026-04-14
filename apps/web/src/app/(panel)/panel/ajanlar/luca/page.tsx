'use client';
import { FileInput } from 'lucide-react';
import { ComingSoon } from '../_components/ComingSoon';

export default function LucaAgentPage() {
  return (
    <ComingSoon
      title="Luca E-Arşiv İndirici"
      desc="Luca Mali'den mükellefin e-arşiv faturalarını otomatik indirir, zip'ten çıkarır, XML'leri klasörleyip Google Drive'a taşır."
      icon={FileInput}
      gradient="linear-gradient(135deg, #0ea5e9 0%, #3b82f6 50%, #6366f1 100%)"
      features={[
        'Luca panelinde ay seçici ile otomatik zip indirme',
        'Zip açma, XML + PDF ayrıştırma',
        'Mükellef bazlı klasör yapısı (Google Drive)',
        'İndirilen fatura sayısı + tutar özetini panel loguna atar',
        'Eksik fatura var mı kontrol eder (beklenen sayıya göre)',
      ]}
    />
  );
}
