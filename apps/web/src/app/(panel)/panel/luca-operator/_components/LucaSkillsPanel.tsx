'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { getLucaSkills, deleteLucaSkill } from '@/lib/moren-ai';

const ACCENT = '#d4b876';

export function LucaSkillsPanel() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const { data: skills = [] } = useQuery({
    queryKey: ['luca-skills'],
    queryFn: getLucaSkills,
    staleTime: 30000,
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteLucaSkill(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['luca-skills'] }),
    onError: () => toast.error('Beceri silinemedi'),
  });

  return (
    <div
      className="flex-shrink-0 overflow-hidden rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${ACCENT}22` }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <GraduationCap size={14} style={{ color: ACCENT }} />
        <span className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: ACCENT }}>
          Öğrenilen Beceriler
        </span>
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
          style={{ background: `${ACCENT}22`, color: ACCENT }}
        >
          {skills.length}
        </span>
        <span className="ml-auto" style={{ color: 'rgba(250,250,249,0.4)' }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {skills.length === 0 ? (
            <div className="px-1 text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Henüz beceri yok — bir işi operatöre yaptır, sonra &quot;bunu kaydet&quot; de; öğrensin.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {skills.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                  style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium" style={{ color: '#fafaf9' }}>
                      {s.ad}
                    </div>
                    {s.aciklama && (
                      <div className="truncate text-[11px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
                        {s.aciklama}
                      </div>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                    {s.adimSayisi} adım
                  </span>
                  <button
                    onClick={() => del.mutate(s.id)}
                    disabled={del.isPending}
                    className="flex-shrink-0 rounded p-1 transition-colors hover:bg-red-500/15 disabled:opacity-40"
                    title="Beceriyi sil"
                    style={{ color: '#f0888f' }}
                  >
                    <Trash2 size={12} />
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
