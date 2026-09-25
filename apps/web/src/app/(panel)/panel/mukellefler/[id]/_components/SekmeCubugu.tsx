'use client';
import { portalStyle } from '@/lib/portal-theme';

import React from 'react';
import { BookOpen, Contact, FileText, Landmark, Mail, MessageSquareText, Shield, Sparkles, UserCog } from 'lucide-react';
import { GOLD, LINE, MUTED, TEXT } from '../_lib/tema';

export type TabKey =
  | 'bilgiler'
  | 'beyannameler'
  | 'sgk'
  | 'tebligat'
  | 'dosyalar'
  | 'cariHesap'
  | 'morenAi'
  | 'iseGiris'
  | 'notlar';

export const REAL_TABS: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
  { key: 'bilgiler', label: 'Bilgiler', icon: Contact },
  { key: 'beyannameler', label: 'Beyannameler', icon: FileText },
  { key: 'sgk', label: 'SGK', icon: Shield },
  { key: 'tebligat', label: 'E-Tebligat', icon: Mail },
  { key: 'dosyalar', label: 'Dosyalar', icon: BookOpen },
  { key: 'cariHesap', label: 'Cari Hesap', icon: Landmark },
  { key: 'morenAi', label: 'MOREN AI', icon: Sparkles },
  { key: 'iseGiris', label: 'İşe Giriş Bildirgesi', icon: UserCog },
  { key: 'notlar', label: 'Mükellef Not', icon: MessageSquareText },
];

/** Tek satır sekmeler: taşarsa yatay kaydırma (çubuk gizli), aktifte 2px altın alt çizgi, ikon 16px. 2 satıra kırılmaz.
 *  Şerit zemini 2026-09-25'te hafif çelik maviye alındı — neredeyse beyazdı, gövdeden ayrılmıyordu. */
export function SekmeCubugu({ tabs, activeTab, onChange }: { tabs: typeof REAL_TABS; activeTab: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <nav
      role="tablist"
      className="flex overflow-x-auto border-b px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={portalStyle({ borderColor: LINE, background: 'linear-gradient(180deg, rgba(79,134,201,0.10), rgba(79,134,201,0.04))' })}
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = activeTab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className="relative inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3.5 text-[13px] transition-colors hover:bg-white/[0.03]"
            style={portalStyle({ color: active ? TEXT : MUTED, fontWeight: active ? 700 : 500 })}
          >
            <Icon size={16} style={portalStyle({ color: active ? GOLD : MUTED })} />
            <span>{t.label}</span>
            <span
              className="absolute inset-x-2 bottom-0 h-[2px] rounded-t-full transition-opacity"
              style={portalStyle({ background: GOLD, opacity: active ? 1 : 0 })}
            />
          </button>
        );
      })}
    </nav>
  );
}
