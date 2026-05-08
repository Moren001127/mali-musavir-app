'use client';

import React from 'react';
import { Workflow, Construction } from 'lucide-react';

const GOLD = '#d4b876';

/**
 * v1.36.75: İş Akışı sayfası placeholder.
 * Backend Workflow Faz 1 tamamlandığında gerçek pipeline (Kanban) ile değiştirilecek.
 * Placeholder şu an "yakında" mesajı gösterir, sidebar 404 vermesin diye.
 */
export default function IsYukuPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <Workflow size={10} className="inline mr-1" /> İŞ AKIŞI
          </span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
          İş Akışı Pipeline
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Mükellef × dönem bazında tüm operasyonel akışı tek yerden yönet — Evrak → Fatura → KDV → Beyanname → Gönderildi
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
          Yakında — Kanban Pipeline Görünümü
        </h2>
        <p className="text-[13.5px] mb-5 max-w-xl mx-auto leading-relaxed" style={{ color: 'rgba(250,250,249,0.55)' }}>
          Bu modül her mükellefin her dönemini bir kart olarak takip eder. Aşamalar otomatik ilerler:
          Mihsap'tan fatura geldi → KDV Kontrol bitti → Beyanname hazır → gönderildi.
          Sistem her sabah sana &quot;sıradaki yapılacak iş&quot; listesi sunar.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-3xl mx-auto mt-6">
          {[
            { label: 'EVRAK BEKLENİYOR', count: 0, color: '#94a3b8' },
            { label: 'FATURA İŞLENİYOR', count: 0, color: '#3b82f6' },
            { label: 'KDV KONTROL', count: 0, color: '#f59e0b' },
            { label: 'BEYANNAME', count: 0, color: '#a855f7' },
            { label: 'GÖNDERİLDİ', count: 0, color: '#22c55e' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-3 text-center"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="text-[10px] uppercase font-bold tracking-wider mb-1" style={{ color: s.color }}>
                {s.label}
              </div>
              <div className="text-[24px] tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, color: 'rgba(250,250,249,0.4)' }}>
                {s.count}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] mt-6" style={{ color: 'rgba(250,250,249,0.35)' }}>
          Faz 1 (MVP) — yakında devreye girecek. Schema, otomatik geçişler ve UI hazırlanıyor.
        </p>
      </div>
    </div>
  );
}
