'use client';
import { Mailbox } from 'lucide-react';
import { ComingSoon } from '../_components/ComingSoon';

export default function TebligatAgentPage() {
  return (
    <ComingSoon
      title="Tebligat Özet Ajanı"
      desc="Hattat'tan günlük tebligat/rapor özetini çıkarır, önem sırasına göre sınıflar, kritik olanları bildirim olarak yollar."
      icon={Mailbox}
      gradient="linear-gradient(135deg, #f59e0b 0%, #ef4444 50%, #ec4899 100%)"
      features={[
        'Hattat portalinden günlük tebligat listesi çekme',
        'Claude ile tebligat içeriği sınıflandırma (vergi/ssk/icra/mahkeme)',
        'Kritiklik puanlama (0-10)',
        'Mükellef bazlı özet PDF oluşturma',
        'Yüksek kritiklikte WhatsApp/SMS bildirim',
      ]}
    />
  );
}
