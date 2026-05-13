'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Code2, Sparkles, Play, Plus, X, Loader2, FileCode, ArrowRight, ArrowLeft, ChevronRight } from 'lucide-react';
import { DEV_TEAM, type DevAgentId } from './_components/team';
import { DevAgentCard } from './_components/DevAgentCard';
import { portalDevApi, type DevTask, type TaskStatus } from '@/lib/portal-dev';
import { toast } from 'sonner';

const GOLD = '#d4b876';

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'Planlanıyor',
  in_review: 'İncelemede',
  done: 'Bitti',
  cancelled: 'İptal',
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: 'rgba(250,250,249,0.55)',
  in_progress: '#fbbf24',
  in_review: '#d4b876',
  done: '#86efac',
  cancelled: 'rgba(250,250,249,0.35)',
};

export default function MorenPortalGelistirmePage() {
  const [selectedAgent, setSelectedAgent] = useState<DevAgentId | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [selectedTask, setSelectedTask] = useState<DevTask | null>(null);
  const qc = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['portal-dev-tasks'],
    queryFn: () => portalDevApi.tasks(),
    refetchInterval: 15000,
  });

  const createMut = useMutation({
    mutationFn: () => portalDevApi.create({ title: formTitle, description: formDesc }),
    onSuccess: () => {
      toast.success('Görev oluşturuldu');
      setFormTitle('');
      setFormDesc('');
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['portal-dev-tasks'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message),
  });

  const planMut = useMutation({
    mutationFn: (id: string) => portalDevApi.runPlan(id),
    onSuccess: (data) => {
      toast.success('Ekip planı hazırladı');
      setSelectedTask(data);
      qc.invalidateQueries({ queryKey: ['portal-dev-tasks'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message),
  });

  const detailMut = useMutation({
    mutationFn: (id: string) => portalDevApi.task(id),
    onSuccess: (data) => setSelectedTask(data),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => portalDevApi.setStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-dev-tasks'] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message),
  });

  // Kanban: status'a göre grupla
  const KANBAN_COLS: { status: TaskStatus; next?: TaskStatus; prev?: TaskStatus }[] = [
    { status: 'backlog', next: 'in_progress' },
    { status: 'in_progress', next: 'in_review', prev: 'backlog' },
    { status: 'in_review', next: 'done', prev: 'in_progress' },
    { status: 'done', prev: 'in_review' },
  ];
  const tasksByStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
            <Code2 size={11} className="inline mr-1" /> Moren AI
          </div>
          <h1 className="mt-1" style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: '#fafaf9' }}>
            Moren Portal Geliştirme
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            5 kişilik ekip · EREN kapsamı çıkarır, MELİS tasarlar, SEDA PR planını yazar, OKAN inceler, BERK deploy notu hazırlar
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-3 py-2 rounded-md text-xs font-bold flex items-center gap-1.5"
          style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
        >
          <Plus size={13} /> Yeni Görev
        </button>
      </div>

      {/* Ekip kartları */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {DEV_TEAM.map((agent) => (
          <DevAgentCard
            key={agent.id}
            agent={agent}
            selected={selectedAgent === agent.id}
            onClick={() => setSelectedAgent(agent.id === selectedAgent ? null : agent.id)}
          />
        ))}
      </div>

      {selectedAgent && (() => {
        const a = DEV_TEAM.find((x) => x.id === selectedAgent);
        if (!a) return null;
        return (
          <div className="rounded-xl p-4" style={{ background: `linear-gradient(90deg, ${a.accentColor}15 0%, transparent 100%)`, border: `1px solid ${a.accentColor}30` }}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs uppercase tracking-wider font-bold" style={{ color: a.accentColor }}>{a.displayName}</span>
                  <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.6)' }}>{a.fullName} · {a.age} · {a.role}</span>
                </div>
                <p className="text-xs" style={{ color: 'rgba(250,250,249,0.75)' }}>{a.personality}</p>
              </div>
              <button onClick={() => setSelectedAgent(null)} className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.6)' }}>
                Kapat
              </button>
            </div>
          </div>
        );
      })()}

      {/* Görev formu */}
      {showForm && (
        <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.06) 0%, rgba(15,11,21,0.85) 100%)', border: '1px solid rgba(212,184,118,0.30)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD }}>
              Yeni Görev — EREN kapsamı keser
            </h3>
            <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-white/5">
              <X size={14} style={{ color: 'rgba(250,250,249,0.55)' }} />
            </button>
          </div>
          <input
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            placeholder="Görev başlığı — örn. 'Mükellef profilinde telefon numarası alanı'"
            className="w-full mb-2 px-3 py-2 rounded text-[13px] outline-none"
            style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.20)', color: '#fafaf9' }}
          />
          <textarea
            value={formDesc}
            onChange={(e) => setFormDesc(e.target.value)}
            placeholder="Detay açıklama — ne istiyorsun, neden, hangi senaryolar"
            rows={4}
            className="w-full mb-2 px-3 py-2 rounded text-[13px] outline-none"
            style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.20)', color: '#fafaf9' }}
          />
          <button
            onClick={() => createMut.mutate()}
            disabled={!formTitle.trim() || !formDesc.trim() || createMut.isPending}
            className="px-3 py-2 rounded text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          >
            {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Oluştur
          </button>
        </div>
      )}

      {/* Kanban Tahtası — 4 sütun */}
      <div className="rounded-2xl p-3" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.04) 0%, rgba(15,11,21,0.85) 100%)', border: '1px solid rgba(212,184,118,0.20)' }}>
        <div className="px-2 pb-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <Sparkles size={13} style={{ color: GOLD }} />
          <span className="text-[10.5px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD }}>
            Kanban Tahtası
          </span>
          <span className="text-[10px] ml-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
            {tasks.length} toplam görev
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>Yükleniyor...</div>
        ) : tasks.length === 0 ? (
          <div className="p-10 text-center text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
            "Yeni Görev" ile bir özellik yaz, ekip plan çıkarır.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
            {KANBAN_COLS.map(({ status, next, prev }) => {
              const colTasks = tasksByStatus(status);
              return (
                <div
                  key={status}
                  className="rounded-lg flex flex-col"
                  style={{
                    background: 'rgba(0,0,0,0.20)',
                    border: '1px solid rgba(255,255,255,0.04)',
                    minHeight: 360,
                  }}
                >
                  <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: STATUS_COLOR[status] }}
                    />
                    <span className="text-[10px] uppercase font-bold tracking-[.14em]" style={{ color: STATUS_COLOR[status] }}>
                      {STATUS_LABEL[status]}
                    </span>
                    <span className="text-[10px] ml-auto font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      {colTasks.length}
                    </span>
                  </div>
                  <div className="p-2 space-y-2 flex-1 overflow-y-auto" style={{ maxHeight: 540 }}>
                    {colTasks.length === 0 && (
                      <div className="py-6 text-center text-[10px]" style={{ color: 'rgba(250,250,249,0.30)' }}>
                        boş
                      </div>
                    )}
                    {colTasks.map((t) => (
                      <div
                        key={t.id}
                        className="rounded-md p-2.5"
                        style={{
                          background: 'rgba(255,255,255,0.025)',
                          border: '1px solid rgba(255,255,255,0.05)',
                        }}
                      >
                        <p className="text-[12px] font-semibold mb-1 line-clamp-2" style={{ color: '#fafaf9' }}>
                          {t.title}
                        </p>
                        <p className="text-[10.5px] line-clamp-2 mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
                          {t.description}
                        </p>
                        <div className="flex items-center gap-1 flex-wrap mb-1.5">
                          <span className="text-[9px] uppercase tracking-wider px-1 py-[1px] rounded" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.55)' }}>
                            {t.type}
                          </span>
                          {t.proposedFiles.length > 0 && (
                            <span className="text-[9px] flex items-center gap-0.5 font-mono px-1 py-[1px] rounded" style={{ background: `${GOLD}10`, color: GOLD }}>
                              <FileCode size={8} /> {t.proposedFiles.length}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {prev && (
                            <button
                              onClick={() => statusMut.mutate({ id: t.id, status: prev })}
                              className="p-1 rounded hover:bg-white/5"
                              style={{ color: 'rgba(250,250,249,0.45)' }}
                              title={`Geri: ${STATUS_LABEL[prev]}`}
                            >
                              <ArrowLeft size={10} />
                            </button>
                          )}
                          <button
                            onClick={() => detailMut.mutate(t.id)}
                            className="flex-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold"
                            style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.7)' }}
                          >
                            Detay
                          </button>
                          {status === 'backlog' && (
                            <button
                              onClick={() => planMut.mutate(t.id)}
                              disabled={planMut.isPending}
                              className="px-1.5 py-0.5 rounded text-[9.5px] font-bold flex items-center gap-1"
                              style={{ background: `${GOLD}30`, color: GOLD }}
                              title="Plan Üret"
                            >
                              {planMut.isPending && planMut.variables === t.id ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
                            </button>
                          )}
                          {next && (
                            <button
                              onClick={() => statusMut.mutate({ id: t.id, status: next })}
                              className="p-1 rounded hover:bg-white/5"
                              style={{ color: 'rgba(250,250,249,0.45)' }}
                              title={`İlerlet: ${STATUS_LABEL[next]}`}
                            >
                              <ArrowRight size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Görev detayı modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={() => setSelectedTask(null)}>
          <div className="rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.06) 0%, rgba(15,11,21,0.98) 100%)', border: '1px solid rgba(212,184,118,0.30)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-4 pb-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-[.14em] px-2 py-[2px] rounded" style={{ background: `${STATUS_COLOR[selectedTask.status]}20`, color: STATUS_COLOR[selectedTask.status] }}>
                  {STATUS_LABEL[selectedTask.status]}
                </span>
              </div>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: '#fafaf9', letterSpacing: '-0.02em' }}>
                {selectedTask.title}
              </h2>
              <p className="text-[12px] mt-2" style={{ color: 'rgba(250,250,249,0.7)' }}>{selectedTask.description}</p>
            </div>

            <div className="p-5 space-y-4">
              {selectedTask.messages && selectedTask.messages.length > 0 ? (
                selectedTask.messages.map((m) => {
                  const persona = DEV_TEAM.find((d) => d.id === m.agent);
                  const accent = persona?.accentColor || GOLD;
                  return (
                    <div key={m.id}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
                        <span className="text-[10.5px] uppercase font-bold tracking-[.14em]" style={{ color: accent }}>
                          {persona?.displayName || m.agent.toUpperCase()}
                        </span>
                        <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>· {persona?.role.split('/')[0].trim()}</span>
                      </div>
                      <div className="px-3.5 py-2.5 rounded-lg text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${accent}28`, color: 'rgba(250,250,249,0.92)' }}>
                        {m.content}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-center text-xs py-6" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Henüz ekip yorumu yok. "Plan Üret" tıkla.
                </p>
              )}

              {selectedTask.proposedDiff && (
                <div className="mt-4 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <p className="text-[10px] uppercase font-bold tracking-[.14em] mb-2" style={{ color: GOLD }}>
                    SEDA — PR Planı (Verdent'e kopyala)
                  </p>
                  <pre className="text-[11px] p-3 rounded overflow-x-auto whitespace-pre-wrap" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.20)', color: 'rgba(250,250,249,0.85)' }}>
                    {selectedTask.proposedDiff}
                  </pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedTask.proposedDiff || '');
                      toast.success('Panoya kopyalandı');
                    }}
                    className="mt-2 px-2.5 py-1 rounded text-[10px] font-bold"
                    style={{ background: 'rgba(212,184,118,0.15)', color: GOLD, border: '1px solid rgba(212,184,118,0.30)' }}
                  >
                    Panoya Kopyala
                  </button>
                </div>
              )}
            </div>

            <div className="px-5 py-3 flex items-center justify-end gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.3)' }}>
              <button onClick={() => setSelectedTask(null)} className="px-3 py-2 rounded text-[12px] font-semibold" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.65)' }}>
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
