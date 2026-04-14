'use client';
import { ShieldCheck } from 'lucide-react';
import { ComingSoon } from '../_components/ComingSoon';

export default function SgkAgentPage() {
  return (
    <ComingSoon
      title="SGK Bildirge Takip"
      desc="İşe giriş/çıkış ve MUHSGK durumlarını takip eder, geciken bildirimleri uyarır, ay sonu MUHSGK tahakkukunu hazırlar."
      icon={ShieldCheck}
      gradient="linear-gradient(135deg, #dc2626 0%, #b91c1c 50%, #991b1b 100%)"
      features={[
        'SGK işveren panelinden bildirge durumu çekme',
        'İşe giriş/çıkış son tarih hatırlatması',
        'MUHSGK ön-hazırlık (bordro verisinden)',
        'Geciken bildirimleri kritik listesine ekleme',
        'Ay sonu tahakkuk fişi taslağı',
      ]}
    />
  );
}
