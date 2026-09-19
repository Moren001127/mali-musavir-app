'use client';
import { portalStyle } from '@/lib/portal-theme';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { FAINT, GOLD, IC_ZEMIN, LINE, R_ALAN, STEEL_BR, TEXT, portalDateTr } from '../_lib/tema';
import { BosDurum, PortalTabState, SekmeBasligi } from './ortak/Tablo';

/** MOREN AI sohbetleri — mükellefin portaldaki konuşmaları (eski → yeni). */
export function MorenAiSohbetTab({ taxpayerId }: { taxpayerId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['taxpayer-ai-chat', taxpayerId],
    queryFn: () => api.get(`/portal/admin/taxpayers/${taxpayerId}/ai-chat`).then((r) => r.data),
  });
  const rows: any[] = Array.isArray(data) ? data : [];

  if (isLoading) return <PortalTabState><Loader2 className="mr-2 animate-spin" size={16} /> Yükleniyor…</PortalTabState>;
  if (!rows.length) return (
    <BosDurum icon={Sparkles} title="MOREN AI sohbeti yok" text="Mükellef portalda MOREN AI ile konuştukça konuşmalar burada görünür." />
  );

  return (
    <div>
      <SekmeBasligi title="MOREN AI Sohbetleri" text={`Mükellefin portalda MOREN AI ile yaptığı konuşmalar (eski → yeni) · ${rows.length} mesaj`} />
      <div className="space-y-2 p-3" style={portalStyle(IC_ZEMIN)}>
        {rows.map((m: any) => {
          const user = m.role === 'user';
          return (
            <div key={m.id} className={`flex ${user ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[78%] px-3 py-2"
                style={portalStyle(user
                  ? { background: `${GOLD}14`, border: `1px solid ${GOLD}44`, borderRadius: R_ALAN }
                  : { background: 'rgba(255,255,255,0.03)', border: `1px solid ${LINE}`, borderRadius: R_ALAN })}
              >
                <div className="mb-1 text-[11.5px] font-medium" style={portalStyle({ color: user ? GOLD : STEEL_BR })}>
                  {user ? 'Mükellef' : 'MOREN AI'} <span style={portalStyle({ color: FAINT })}>· {portalDateTr(m.createdAt)}</span>
                </div>
                <div className="whitespace-pre-wrap text-[13px]" style={portalStyle({ color: TEXT, lineHeight: 1.55 })}>{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
