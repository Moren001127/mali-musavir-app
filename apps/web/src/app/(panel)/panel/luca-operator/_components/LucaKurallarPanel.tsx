'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { getLucaOperatorDurum, deleteLucaRule } from '@/lib/moren-ai';

const ACCENT = '#d4b876';

/**
 * Ofis kuralları: operatörün ekrandan veya geçmiş kayıttan ÇIKARAMAYACAĞI kararlar.
 * Sohbette bir kural söylendiğinde operatör kendiliğinden buraya kaydeder ve
 * bundan sonraki her işte uygular.
 */
export function LucaKurallarPanel() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const { data } = useQuery({
    queryKey: ['luca-operator-durum'],
    queryFn: getLucaOperatorDurum,
    refetchInterval: 20000,
    staleTime: 10000,
  });
  const kurallar = data?.kurallar || [];
  const del = useMutation({
    mutationFn: (id: string) => deleteLucaRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['luca-operator-durum'] }),
    onError: () => toast.error('Kural silinemedi'),
  });

  return (
    <div
      className="flex-shrink-0 overflow-hidden rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${ACCENT}22` }}
    >
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <Scale size={14} style={{ color: ACCENT }} />
        <span className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: ACCENT }}>
          Ofis Kuralları
        </span>
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
          style={{ background: `${ACCENT}22`, color: ACCENT }}
        >
          {kurallar.length}
        </span>
        <span className="ml-auto" style={{ color: 'rgba(250,250,249,0.4)' }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {kurallar.length === 0 ? (
            <div className="px-1 text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Kural yok — sohbette bir çalışma kuralı söyle (ör. &quot;ödenecek çıkıyorsa 360, çıkmıyorsa 190&quot;);
              operatör kendiliğinden buraya kaydeder ve bir daha sormaz.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {kurallar.map((k) => (
                <div
                  key={k.id}
                  className="flex items-start gap-2 rounded-lg px-2.5 py-1.5"
                  style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold" style={{ color: '#fafaf9' }}>
                      {k.baslik}
                    </div>
                    <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
                      {k.kural}
                    </div>
                  </div>
                  <button
                    onClick={() => del.mutate(k.id)}
                    className="flex-shrink-0 rounded p-1 transition-colors hover:bg-white/10"
                    title="Kuralı sil"
                    style={{ color: 'rgba(248,113,113,0.75)' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
