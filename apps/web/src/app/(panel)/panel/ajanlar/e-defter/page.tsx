'use client';
import { BookOpen } from 'lucide-react';
import { ComingSoon } from '../_components/ComingSoon';

export default function EDefterAgentPage() {
  return (
    <ComingSoon
      title="E-Defter Kontrol"
      desc="E-defter berat durumlarını günlük kontrol eder, eksik/geciken yüklemeleri bildirir, KDV dönem sonunda mukayese yapar."
      icon={BookOpen}
      gradient="linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)"
      features={[
        'GİB e-defter portal kontrolü (berat durumu)',
        'Eksik yüklenmiş aylar listesi',
        'Ay sonu yaklaştığında uyarı',
        'Luca yevmiye ile e-defter mukayese',
        'Tutar farklarını işaretleme',
      ]}
    />
  );
}
