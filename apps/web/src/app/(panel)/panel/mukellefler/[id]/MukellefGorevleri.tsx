'use client';

/**
 * Mükellef kartı → "Mükellef Not" sekmesi: bu mükellefe bağlı GÖREVLER ve NOTLAR (Görevler & Notlar modülü, 2026-09-14 Faz 3).
 * Serbest metin notunun altında: açık görevler (vade/öncelik), sabit notlar; tek satırdan hızlı görev/not ekleme;
 * "Görevler'de aç" → /panel/gorevler?mukellef=<id> (o ekran süzgeci mükellefe kilitler).
 */
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ListTodo, Pin, Plus, StickyNote } from 'lucide-react';
import { tasksApi, type Task, PRIORITY_COLOR, PRIORITY_LABEL, kategoriEtiketi, formatDueDate, getDueStatus } from '@/lib/tasks';

const MUTED = 'rgba(245,245,244,0.60)';
const FAINT = 'rgba(245,245,244,0.36)';
const LINE = 'rgba(255,255,255,0.11)';
const GOLD = '#d4b876';
const GREEN = '#5fcf8e';
const RED = '#ef6b6b';
const AMBER = '#f0b755';

const ACIK = new Set(['OPEN', 'IN_PROGRESS', 'SNOOZED', 'MISSED']);

function vadeRengi(t: Task): string {
  const d = getDueStatus(t);
  if (d === 'overdue') return RED;
  if (d === 'today' || d === 'tomorrow') return AMBER;
  return MUTED;
}

export function MukellefGorevleri({ taxpayerId }: { taxpayerId: string }) {
  const qc = useQueryClient();
  const [metin, setMetin] = useState('');
  const [tur, setTur] = useState<'GOREV' | 'NOT'>('GOREV');

  const q = useQuery({
    queryKey: ['mukellef-gorevler', taxpayerId],
    queryFn: () => tasksApi.list({ taxpayerId, isTemplate: 'false', limit: 200 }),
    staleTime: 30_000,
  });
  const kayitlar: Task[] = useMemo(() => (q.data?.items || []) as Task[], [q.data]);
  const gorevler = useMemo(
    () =>
      kayitlar
        .filter((t) => (t.tur || 'GOREV') === 'GOREV' && ACIK.has(t.status))
        .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')),
    [kayitlar],
  );
  const notlar = useMemo(
    () =>
      kayitlar
        .filter((t) => t.tur === 'NOT' && t.status !== 'CANCELLED')
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
    [kayitlar],
  );
  const bitenSayisi = useMemo(() => kayitlar.filter((t) => (t.tur || 'GOREV') === 'GOREV' && t.status === 'DONE').length, [kayitlar]);

  const yenile = () => {
    qc.invalidateQueries({ queryKey: ['mukellef-gorevler', taxpayerId] });
    qc.invalidateQueries({ queryKey: ['gorevler-ajanda'] });
  };
  const ekle = useMutation({
    mutationFn: (girdi: { title: string; tur: 'GOREV' | 'NOT' }) =>
      tasksApi.create({ title: girdi.title, taxpayerId, tur: girdi.tur, category: girdi.tur === 'NOT' ? 'MUKELLEF' : 'DIGER', priority: 'MEDIUM', allDay: true }),
    onSuccess: (_r, v) => {
      setMetin('');
      toast.success(v.tur === 'NOT' ? 'Not eklendi' : 'Görev eklendi');
      yenile();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Eklenemedi'),
  });
  const tamamla = useMutation({
    mutationFn: (id: string) => tasksApi.complete(id),
    onSuccess: () => {
      toast.success('Tamamlandı');
      yenile();
    },
    onError: () => toast.error('Tamamlanamadı'),
  });

  const gonder = () => {
    const t = metin.trim();
    if (!t) return;
    ekle.mutate({ title: t, tur });
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListTodo size={15} style={{ color: GOLD }} />
          <span className="text-[13px] font-semibold" style={{ color: '#f5f5f4' }}>
            Görevler & Notlar
          </span>
          <span className="text-[11.5px]" style={{ color: FAINT }}>
            {gorevler.length} açık · {notlar.length} not{bitenSayisi ? ` · ${bitenSayisi} bitti` : ''}
          </span>
        </div>
        <Link
          href={`/panel/gorevler?mukellef=${encodeURIComponent(taxpayerId)}`}
          className="text-[12px] font-semibold underline-offset-2 hover:underline"
          style={{ color: GOLD }}
        >
          Görevler'de aç →
        </Link>
      </div>

      {/* Hızlı ekleme */}
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-[9px] border" style={{ borderColor: LINE }}>
          {(['GOREV', 'NOT'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTur(k)}
              className="px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors"
              style={{ background: tur === k ? 'rgba(212,184,118,0.18)' : 'transparent', color: tur === k ? GOLD : MUTED }}
            >
              {k === 'GOREV' ? 'Görev' : 'Not'}
            </button>
          ))}
        </div>
        <input
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              gonder();
            }
          }}
          placeholder={tur === 'NOT' ? 'Bu mükellef için not…' : 'Bu mükellef için görev… (vade/öncelik Görevler ekranında)'}
          className="h-9 flex-1 rounded-[9px] border bg-[#0d0e13] px-3 text-[12.5px] text-[#f5f5f4] outline-none placeholder:text-white/25 focus:border-[#d4b876]/60"
          style={{ borderColor: LINE }}
        />
        <button
          type="button"
          onClick={gonder}
          disabled={!metin.trim() || ekle.isPending}
          className="flex h-9 items-center gap-1 rounded-[9px] px-3 text-[12px] font-semibold disabled:opacity-40"
          style={{ background: 'rgba(212,184,118,0.18)', color: GOLD, border: `1px solid rgba(212,184,118,0.35)` }}
        >
          <Plus size={13} /> Ekle
        </button>
      </div>

      {q.isLoading ? (
        <div className="text-[12px]" style={{ color: FAINT }}>
          Yükleniyor…
        </div>
      ) : (
        <>
          {/* Açık görevler */}
          <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: LINE }}>
            {gorevler.length === 0 ? (
              <div className="px-3 py-3 text-[12px]" style={{ color: FAINT }}>
                Açık görev yok.
              </div>
            ) : (
              gorevler.map((t) => (
                <div key={t.id} className="flex items-center gap-2.5 border-b px-3 py-2 last:border-b-0" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <button
                    type="button"
                    title="Tamamla"
                    onClick={() => tamamla.mutate(t.id)}
                    className="shrink-0 rounded-full p-0.5 transition-colors hover:bg-white/10"
                    style={{ color: GREEN }}
                  >
                    <CheckCircle2 size={15} />
                  </button>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[t.priority] || MUTED }} title={PRIORITY_LABEL[t.priority]} />
                  <Link href={`/panel/gorevler?gorev=${encodeURIComponent(t.id)}`} className="min-w-0 flex-1 truncate text-[12.5px] font-medium hover:underline" style={{ color: '#f5f5f4' }}>
                    {t.title}
                  </Link>
                  <span className="shrink-0 text-[11px]" style={{ color: FAINT }}>
                    {kategoriEtiketi(t.category)}
                  </span>
                  <span className="shrink-0 text-[11.5px] font-semibold" style={{ color: vadeRengi(t) }}>
                    {t.dueDate ? formatDueDate(t) : 'vadesiz'}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Notlar */}
          {notlar.length > 0 && (
            <div className="space-y-1.5">
              {notlar.map((n) => (
                <Link
                  key={n.id}
                  href={`/panel/gorevler?gorev=${encodeURIComponent(n.id)}`}
                  className="flex items-start gap-2 rounded-[9px] border px-3 py-2 transition-colors hover:bg-white/[0.03]"
                  style={{ borderColor: LINE, background: 'rgba(212,184,118,0.05)' }}
                >
                  {n.pinned ? <Pin size={13} className="mt-0.5 shrink-0" style={{ color: GOLD }} /> : <StickyNote size={13} className="mt-0.5 shrink-0" style={{ color: MUTED }} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium" style={{ color: '#f5f5f4' }}>
                      {n.title}
                    </div>
                    {n.description && (
                      <div className="line-clamp-2 text-[11.5px]" style={{ color: MUTED }}>
                        {n.description}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
