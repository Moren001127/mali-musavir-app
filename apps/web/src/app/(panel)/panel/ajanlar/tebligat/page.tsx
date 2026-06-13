'use client';

import { MailSearch } from 'lucide-react';
import ETebligatModule from '@/components/portal-automation/ETebligatModule';

export default function TebligatAutomationPage() {
  return (
    <div className="space-y-4 max-w-7xl">
      {/* Header — Fiş Yazdırma imzası: kart + üst renk şeridi + radial parıltı + degrade ikon kutusu */}
      <div
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: 'rgba(255,255,255,0.06)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' }}
        />
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-[26px] h-px" style={{ background: '#d4b876' }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>GİB · e-Tebligat</span>
        </div>
        <div className="flex items-center gap-3.5">
          <span
            className="grid place-items-center rounded-xl flex-shrink-0"
            style={{ width: 46, height: 46, background: 'linear-gradient(135deg, #d4b876, #b8a06f)', boxShadow: '0 8px 22px rgba(212,184,118,0.32)' }}
          >
            <MailSearch size={24} style={{ color: '#1a1410' }} />
          </span>
          <div className="min-w-0">
            <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.05 }}>
              e-Tebligat Kontrol
            </h1>
            <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Vergi dairesi şifresi kayıtlı mükelleflerin e-Tebligat kutusu her gece otomatik kontrol edilir; gelen tebligatlar gönderen kurum, belge türü ve belge no ile kaydedilir.
            </p>
          </div>
        </div>
      </div>

      <ETebligatModule />
    </div>
  );
}
