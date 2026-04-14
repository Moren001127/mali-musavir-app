'use client';
import { Calculator } from 'lucide-react';
import { ComingSoon } from '../_components/ComingSoon';

export default function KdvHazirlikAgentPage() {
  return (
    <ComingSoon
      title="KDV Beyanname Ön-Hazırlık"
      desc="Ay sonu KDV1/KDV2 beyanname taslaklarını hesap muavinlerinden hazırlar, ödenecek/devreden KDV hesaplar, anomalileri işaretler."
      icon={Calculator}
      gradient="linear-gradient(135deg, #10b981 0%, #14b8a6 50%, #06b6d4 100%)"
      features={[
        'Luca 191/391 muavinleri otomatik çekme',
        'KDV matrahları ve tutarları toplama',
        'İndirilecek KDV — hesaplanan KDV karşılaştırması',
        'Devreden / ödenecek KDV hesaplama',
        'Anormal sapmaları Claude ile analiz (önceki aylarla karşılaştırma)',
        'Taslak PDF + excel çıktısı',
      ]}
    />
  );
}
