'use client';

import React from 'react';
import { Coins, Construction } from 'lucide-react';

const GOLD = '#d4b876';

/**
 * v1.36.75: Tahsilat & Cari sayfası placeholder.
 * Müşterilerden alınacak mali müşavirlik ücretlerinin takibi modülü.
 * Faturalar, ödeme planları, gecikmiş alacaklar burada listelenecek.
 */
export default function TahsilatPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <Coins size={10} className="inline mr-1" /> TAHSİLAT
          </span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
          Tahsilat & Cari
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Mali müşavirlik ücret tahsilatı — müşterilerden alacaklar, ödeme planları, gecikmiş bakiyeler tek yerde
        </p>
      </div>

      <div
        className="rounded-2xl p-10 text-center"
        style={{
          background: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(212,184,118,0.02))',
          border: '1px solid rgba(212,184,118,0.20)',
        }}
      >
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
          style={{ background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.30)' }}>
          <Construction size={28} style={{ color: GOLD }} />
        </div>
        <h2 className="text-[22px] mb-2" style={{ fontFamily: 'Fraunces, serif', fontWeight: 600, color: '#fafaf9' }}>
          Yakında — Tahsilat Yönetimi
        </h2>
        <p className="text-[13.5px] mb-5 max-w-xl mx-auto leading-relaxed" style={{ color: 'rgba(250,250,249,0.55)' }}>
          Mevcut <strong style={{ color: '#fafaf9' }}>Cari Kasa</strong> modülüyle entegre çalışacak.
          Mükellef başına ücret yapısı (aylık/yıllık/işlem başına), faturalama, ödeme takibi,
          60+ gün geciken alacaklar otomatik tespit ve hatırlatma.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto mt-6">
          {[
            { label: 'AÇIK ALACAK', value: '—', color: '#3b82f6' },
            { label: 'GECİKMİŞ', value: '—', color: '#ef4444' },
            { label: 'BU AY TAHSİL', value: '—', color: '#22c55e' },
            { label: 'YIL BAŞINDAN', value: '—', color: GOLD },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-3 text-center"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="text-[10px] uppercase font-bold tracking-wider mb-1" style={{ color: s.color }}>
                {s.label}
              </div>
              <div className="text-[20px] tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, color: 'rgba(250,250,249,0.4)' }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] mt-6" style={{ color: 'rgba(250,250,249,0.35)' }}>
          Şu an Cari Kasa modülü kullanılabilir. Bu özelleşmiş Tahsilat yönetimi sonraki sürümde gelir.
        </p>
      </div>
    </div>
  );
}
