'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare, Plus, Calendar, AlertTriangle, Clock, CheckCircle2,
  Filter, Search, Trash2, X, Edit3, MessageSquare, Bell, BellOff,
  Loader2, Tag, User as UserIcon, Building2, Repeat, Mail,
  MoreVertical, Play, Ban, Pause, RotateCcw, FileText,
  LayoutGrid, List,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  tasksApi, Task, TaskCounts, CreateTaskInput, RecurrenceConfig,
  PRIORITY_LABEL, PRIORITY_COLOR, STATUS_LABEL, CATEGORY_OPTIONS, WEEKDAY_LABEL,
  getDueStatus, formatDueDate, taxpayerName,
} from '@/lib/tasks';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const BG_CARD = 'rgba(255,255,255,0.02)';
const BORDER = 'rgba(255,255,255,0.05)';

interface TaxpayerOption {
  id: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
}

export default function GorevlerPage() {
  const qc = useQueryClient();
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('OPEN');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');

  const { data: counts } = useQuery<TaskCounts>({
    queryKey: ['task-counts'],
    queryFn: () => tasksApi.counts(),
    refetchInterval: 30000,
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ['tasks', { status: viewMode === 'kanban' ? '' : filterStatus, category: filterCategory, priority: filterPriority, search: searchInput, viewMode }],
    queryFn: () => tasksApi.list({
      status: viewMode === 'kanban' ? undefined : filterStatus || undefined,
      category: filterCategory || undefined,
      priority: filterPriority || undefined,
      search: searchInput || undefined,
      isTemplate: 'false',
      limit: 200,
    }),
  });

  const { data: taxpayers = [] } = useQuery<TaxpayerOption[]>({
    queryKey: ['taxpayers-options'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => tasksApi.complete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-counts'] });
      toast.success('Görev tamamlandı');
    },
  });

  // v1.36.74: Tamamlanmış görevi geri al (DONE → OPEN)
  const reopenMut = useMutation({
    mutationFn: (id: string) => tasksApi.update(id, { status: 'OPEN' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-counts'] });
      toast.success('Görev tekrar açıldı');
    },
  });

  // Devam Ediyor (IN_PROGRESS) — başlandığını işaretle
  const startMut = useMutation({
    mutationFn: (id: string) => tasksApi.update(id, { status: 'IN_PROGRESS' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-counts'] });
      toast.success('Görev başlatıldı');
    },
  });

  // İptal et — yapılmayacak görev (CANCELLED)
  const cancelMut = useMutation({
    mutationFn: (id: string) => tasksApi.update(id, { status: 'CANCELLED' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-counts'] });
      toast.success('Görev iptal edildi');
    },
  });

  // Ertele — kullanıcının seçtiği tarihe kadar SNOOZED durumuna geçir
  const snoozeMut = useMutation({
    mutationFn: ({ id, until }: { id: string; until: string }) => tasksApi.snooze(id, until),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-counts'] });
      toast.success('Görev ertelendi');
    },
  });

  // Not ekle
  const addNoteMut = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => tasksApi.addNote(id, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Not eklendi');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-counts'] });
      toast.success('Görev silindi');
    },
  });

  const quickTaskMut = useMutation({
    mutationFn: (input: CreateTaskInput) => tasksApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-counts'] });
      toast.success('Hızlı görev oluşturuldu');
    },
  });

  const quickTemplates: CreateTaskInput[] = [
    { title: 'KDV kontrolü', category: 'BEYANNAME', priority: 'HIGH', dueDate: new Date().toISOString(), notifyInApp: true, notifyBrowser: true },
    { title: 'Banka ekstresi iste', category: 'BANKA', priority: 'MEDIUM', dueDate: new Date().toISOString(), notifyInApp: true, notifyBrowser: true },
    { title: 'Tahsilat araması yap', category: 'MUKELLEF', priority: 'HIGH', dueDate: new Date().toISOString(), notifyInApp: true, notifyBrowser: true },
    { title: 'Evrak teslim takibi', category: 'MIHSAP', priority: 'MEDIUM', dueDate: new Date().toISOString(), notifyInApp: true, notifyBrowser: true },
  ];

  // Snooze dialog state
  const [snoozeTarget, setSnoozeTarget] = useState<Task | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState('');

  // Note dialog state
  const [noteTarget, setNoteTarget] = useState<Task | null>(null);
  const [noteContent, setNoteContent] = useState('');

  const tasks = listData?.items || [];

  // Vade durumlarına göre grupla
  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], none: [] };
    for (const t of tasks) {
      const s = getDueStatus(t);
      g[s].push(t);
    }
    return g;
  }, [tasks]);

  const kanban = useMemo(() => {
    const g: Record<string, Task[]> = { OPEN: [], IN_PROGRESS: [], SNOOZED: [], DONE: [] };
    for (const t of tasks) {
      if (t.status === 'CANCELLED' || t.status === 'MISSED') continue;
      const key = g[t.status] ? t.status : 'OPEN';
      g[key].push(t);
    }
    return g;
  }, [tasks]);

  return (
    <div className="space-y-5 max-w-none">
      {/* Header */}
      <div className="pb-5 flex items-end justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
              <CheckSquare size={10} className="inline mr-1" /> Görevler
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Görevler & Notlar
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Tek seferlik veya tekrarlı hatırlatmalar — vade geldiğinde sistem bildirim atar
          </p>
        </div>
        <button
          onClick={() => { setEditingTask(null); setShowNewModal(true); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-[13px]"
          style={{ background: GOLD, color: '#0f0d0b' }}
        >
          <Plus size={14} /> Yeni Görev
        </button>
      </div>

      {/* Sayaçlar */}
      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CountCard label="Bugün" value={counts.today} icon={Clock} color="#3b82f6" />
          <CountCard label="Gecikmiş" value={counts.overdue} icon={AlertTriangle} color="#ef4444" pulse={counts.overdue > 0} />
          <CountCard label="Bu Hafta" value={counts.thisWeek} icon={Calendar} color="#f59e0b" />
          <CountCard label="Açık Görev" value={counts.totalOpen} icon={CheckSquare} color={GOLD} />
        </div>
      )}

      {/* Filtreler */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[10.5px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              Görünüm
            </label>
            <div className="flex p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {[
                { key: 'list', label: 'Liste', icon: List },
                { key: 'kanban', label: 'Kanban', icon: LayoutGrid },
              ].map((opt) => {
                const Icon = opt.icon;
                const active = viewMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setViewMode(opt.key as 'list' | 'kanban')}
                    className="px-3 py-1.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5"
                    style={{ background: active ? 'rgba(212,184,118,0.16)' : 'transparent', color: active ? GOLD : 'rgba(250,250,249,0.55)' }}
                  >
                    <Icon size={12} /> {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10.5px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Search size={10} className="inline mr-1" /> Ara
            </label>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="başlık veya açıklama..."
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            />
          </div>
          <SelectField label="Durum" value={filterStatus} onChange={setFilterStatus}
            options={[
              { value: '', label: 'Tümü' },
              { value: 'OPEN', label: 'Açık' },
              { value: 'IN_PROGRESS', label: 'Devam Ediyor' },
              { value: 'DONE', label: 'Tamamlandı' },
              { value: 'SNOOZED', label: 'Ertelendi' },
              { value: 'MISSED', label: 'Kaçırıldı' },
            ]} />
          <SelectField label="Kategori" value={filterCategory} onChange={setFilterCategory}
            options={[{ value: '', label: 'Tümü' }, ...CATEGORY_OPTIONS]} />
          <SelectField label="Öncelik" value={filterPriority} onChange={setFilterPriority}
            options={[
              { value: '', label: 'Tümü' },
              { value: 'URGENT', label: 'ACİL' },
              { value: 'HIGH', label: 'Yüksek' },
              { value: 'MEDIUM', label: 'Orta' },
              { value: 'LOW', label: 'Düşük' },
            ]} />
        </div>
      </div>

      {/* Görev grupları */}
      <div className="flex flex-wrap gap-2">
        {quickTemplates.map((tpl) => (
          <button
            key={tpl.title}
            onClick={() => quickTaskMut.mutate(tpl)}
            disabled={quickTaskMut.isPending}
            className="px-3 py-1.5 rounded-md text-[11.5px] font-semibold disabled:opacity-50"
            style={{ background: 'rgba(212,184,118,0.10)', color: GOLD, border: '1px solid rgba(212,184,118,0.24)' }}
          >
            <Plus size={12} className="inline mr-1" /> {tpl.title}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-10" style={{ color: 'rgba(250,250,249,0.4)' }}>
          <Loader2 className="inline animate-spin mr-2" size={16} /> Yükleniyor...
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-16 rounded-xl" style={{ background: BG_CARD, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,0.4)' }}>
          <CheckSquare size={32} className="mx-auto mb-3" style={{ color: 'rgba(250,250,249,0.2)' }} />
          <p className="text-[14px]">Görev yok</p>
          <p className="text-[12px] mt-1">Yeni Görev butonu ile ekleyebilirsin</p>
        </div>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard
          groups={kanban}
          onComplete={(id: string) => completeMut.mutate(id)}
          onReopen={(id: string) => reopenMut.mutate(id)}
          onStart={(id: string) => startMut.mutate(id)}
          onCancel={(id: string) => cancelMut.mutate(id)}
          onSnooze={(t: Task) => { setSnoozeTarget(t); const d = new Date(); d.setDate(d.getDate() + 1); setSnoozeUntil(d.toISOString().slice(0,10)); }}
          onAddNote={(t: Task) => { setNoteTarget(t); setNoteContent(''); }}
          onDelete={(id: string) => deleteMut.mutate(id)}
          onEdit={(t: Task) => { setEditingTask(t); setShowNewModal(true); }}
        />
      ) : (
        <div className="space-y-5">
          <TaskGroup title="GECİKMİŞ" tasks={grouped.overdue} accent="#ef4444" pulse onComplete={(id: string) => completeMut.mutate(id)} onReopen={(id: string) => reopenMut.mutate(id)} onStart={(id: string) => startMut.mutate(id)} onCancel={(id: string) => cancelMut.mutate(id)} onSnooze={(t: Task) => { setSnoozeTarget(t); const d = new Date(); d.setDate(d.getDate() + 1); setSnoozeUntil(d.toISOString().slice(0,10)); }} onAddNote={(t: Task) => { setNoteTarget(t); setNoteContent(''); }} onDelete={(id: string) => deleteMut.mutate(id)} onEdit={(t: Task) => { setEditingTask(t); setShowNewModal(true); }} />
          <TaskGroup title="BUGÜN" tasks={grouped.today} accent="#3b82f6" onComplete={(id: string) => completeMut.mutate(id)} onReopen={(id: string) => reopenMut.mutate(id)} onStart={(id: string) => startMut.mutate(id)} onCancel={(id: string) => cancelMut.mutate(id)} onSnooze={(t: Task) => { setSnoozeTarget(t); const d = new Date(); d.setDate(d.getDate() + 1); setSnoozeUntil(d.toISOString().slice(0,10)); }} onAddNote={(t: Task) => { setNoteTarget(t); setNoteContent(''); }} onDelete={(id: string) => deleteMut.mutate(id)} onEdit={(t: Task) => { setEditingTask(t); setShowNewModal(true); }} />
          <TaskGroup title="YARIN" tasks={grouped.tomorrow} accent="#f59e0b" onComplete={(id: string) => completeMut.mutate(id)} onReopen={(id: string) => reopenMut.mutate(id)} onStart={(id: string) => startMut.mutate(id)} onCancel={(id: string) => cancelMut.mutate(id)} onSnooze={(t: Task) => { setSnoozeTarget(t); const d = new Date(); d.setDate(d.getDate() + 1); setSnoozeUntil(d.toISOString().slice(0,10)); }} onAddNote={(t: Task) => { setNoteTarget(t); setNoteContent(''); }} onDelete={(id: string) => deleteMut.mutate(id)} onEdit={(t: Task) => { setEditingTask(t); setShowNewModal(true); }} />
          <TaskGroup title="BU HAFTA" tasks={grouped.thisWeek} accent={GOLD} onComplete={(id: string) => completeMut.mutate(id)} onReopen={(id: string) => reopenMut.mutate(id)} onStart={(id: string) => startMut.mutate(id)} onCancel={(id: string) => cancelMut.mutate(id)} onSnooze={(t: Task) => { setSnoozeTarget(t); const d = new Date(); d.setDate(d.getDate() + 1); setSnoozeUntil(d.toISOString().slice(0,10)); }} onAddNote={(t: Task) => { setNoteTarget(t); setNoteContent(''); }} onDelete={(id: string) => deleteMut.mutate(id)} onEdit={(t: Task) => { setEditingTask(t); setShowNewModal(true); }} />
          <TaskGroup title="DAHA SONRA" tasks={grouped.later} accent="rgba(250,250,249,0.4)" onComplete={(id: string) => completeMut.mutate(id)} onReopen={(id: string) => reopenMut.mutate(id)} onStart={(id: string) => startMut.mutate(id)} onCancel={(id: string) => cancelMut.mutate(id)} onSnooze={(t: Task) => { setSnoozeTarget(t); const d = new Date(); d.setDate(d.getDate() + 1); setSnoozeUntil(d.toISOString().slice(0,10)); }} onAddNote={(t: Task) => { setNoteTarget(t); setNoteContent(''); }} onDelete={(id: string) => deleteMut.mutate(id)} onEdit={(t: Task) => { setEditingTask(t); setShowNewModal(true); }} />
          <TaskGroup title="TARİHSİZ" tasks={grouped.none} accent="rgba(250,250,249,0.3)" onComplete={(id: string) => completeMut.mutate(id)} onReopen={(id: string) => reopenMut.mutate(id)} onStart={(id: string) => startMut.mutate(id)} onCancel={(id: string) => cancelMut.mutate(id)} onSnooze={(t: Task) => { setSnoozeTarget(t); const d = new Date(); d.setDate(d.getDate() + 1); setSnoozeUntil(d.toISOString().slice(0,10)); }} onAddNote={(t: Task) => { setNoteTarget(t); setNoteContent(''); }} onDelete={(id: string) => deleteMut.mutate(id)} onEdit={(t: Task) => { setEditingTask(t); setShowNewModal(true); }} />
        </div>
      )}

      {showNewModal && (
        <TaskModal
          task={editingTask}
          taxpayers={taxpayers}
          onClose={() => { setShowNewModal(false); setEditingTask(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['tasks'] });
            qc.invalidateQueries({ queryKey: ['task-counts'] });
            setShowNewModal(false);
            setEditingTask(null);
          }}
        />
      )}

      {/* Snooze (Erteleme) dialog'u */}
      {snoozeTarget && (
        <MiniDialog title="Görevi Ertele" onClose={() => setSnoozeTarget(null)}>
          <p className="text-[12px] mb-3" style={{ color: 'rgba(250,250,249,0.6)' }}>
            <strong style={{ color: '#fafaf9' }}>{snoozeTarget.title}</strong> görevini ne zamana kadar erteleyelim?
          </p>
          <div className="flex gap-2 mb-3 flex-wrap">
            {[
              { label: 'Yarın', days: 1 },
              { label: '3 gün', days: 3 },
              { label: '1 hafta', days: 7 },
              { label: '2 hafta', days: 14 },
            ].map((opt) => (
              <button
                key={opt.label}
                onClick={() => {
                  const d = new Date(); d.setDate(d.getDate() + opt.days);
                  setSnoozeUntil(d.toISOString().slice(0, 10));
                }}
                className="px-3 py-1.5 rounded-md text-[11.5px] font-semibold"
                style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={snoozeUntil}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setSnoozeUntil(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setSnoozeTarget(null)} className="px-3 py-2 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
              Vazgeç
            </button>
            <button
              onClick={() => {
                if (!snoozeUntil) return toast.error('Tarih seç');
                snoozeMut.mutate({ id: snoozeTarget.id, until: new Date(snoozeUntil).toISOString() });
                setSnoozeTarget(null);
              }}
              className="px-4 py-2 rounded-lg text-[12.5px] font-semibold inline-flex items-center gap-2"
              style={{ background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc' }}
            >
              <Pause size={12} /> Ertele
            </button>
          </div>
        </MiniDialog>
      )}

      {/* Not ekleme dialog'u */}
      {noteTarget && (
        <MiniDialog title="Not Ekle" onClose={() => setNoteTarget(null)}>
          <p className="text-[12px] mb-3" style={{ color: 'rgba(250,250,249,0.6)' }}>
            <strong style={{ color: '#fafaf9' }}>{noteTarget.title}</strong>
          </p>
          <textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            rows={4}
            placeholder="Görev hakkında not ekle..."
            className="w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setNoteTarget(null)} className="px-3 py-2 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
              Vazgeç
            </button>
            <button
              onClick={() => {
                if (!noteContent.trim()) return toast.error('Not boş olamaz');
                addNoteMut.mutate({ id: noteTarget.id, content: noteContent.trim() });
                setNoteTarget(null);
              }}
              className="px-4 py-2 rounded-lg text-[12.5px] font-semibold inline-flex items-center gap-2"
              style={{ background: GOLD, color: '#0f0d0b' }}
            >
              <MessageSquare size={12} /> Kaydet
            </button>
          </div>
        </MiniDialog>
      )}
    </div>
  );
}

interface MiniDialogProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}
function MiniDialog({ title, children, onClose }: MiniDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-xl overflow-hidden" style={{ background: '#0f0d0b', border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 className="text-[14px] font-bold" style={{ color: '#fafaf9' }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5">
            <X size={14} style={{ color: 'rgba(250,250,249,0.5)' }} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

interface CountCardProps {
  label: string;
  value: number;
  icon: any;
  color: string;
  pulse?: boolean;
}
function CountCard({ label, value, icon: Icon, color, pulse }: CountCardProps) {
  return (
    <div
      className="rounded-2xl p-4 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${color}16, rgba(255,255,255,0.015))`,
        border: `1px solid ${color}28`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035)',
      }}
    >
      <span className="absolute left-0 top-4 bottom-4 w-[2px] rounded" style={{ background: color }} />
      <div className="flex items-center gap-2 mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.55)' }}>
        <Icon size={12} style={{ color }} />
        <span>{label}</span>
        {pulse && value > 0 && <span className="w-1.5 h-1.5 rounded-full ml-auto" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />}
      </div>
      <p className="leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 32, fontWeight: 700, color: '#fafaf9' }}>
        {value}
      </p>
    </div>
  );
}

interface SelectOption { value: string; label: string }
interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}
function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <div>
      <label className="text-[10.5px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg text-sm border outline-none"
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9', minWidth: 140 }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: '#0f0d0b' }}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

interface TaskGroupProps {
  title: string;
  tasks: Task[];
  accent: string;
  pulse?: boolean;
  onComplete: (id: string) => void;
  onReopen: (id: string) => void;
  onStart: (id: string) => void;
  onCancel: (id: string) => void;
  onSnooze: (t: Task) => void;
  onAddNote: (t: Task) => void;
  onDelete: (id: string) => void;
  onEdit: (t: Task) => void;
}

function KanbanBoard({
  groups, onComplete, onReopen, onStart, onCancel, onSnooze, onAddNote, onDelete, onEdit,
}: {
  groups: Record<string, Task[]>;
  onComplete: (id: string) => void;
  onReopen: (id: string) => void;
  onStart: (id: string) => void;
  onCancel: (id: string) => void;
  onSnooze: (t: Task) => void;
  onAddNote: (t: Task) => void;
  onDelete: (id: string) => void;
  onEdit: (t: Task) => void;
}) {
  const columns = [
    { key: 'OPEN', title: 'Açık', color: GOLD },
    { key: 'IN_PROGRESS', title: 'Devam', color: '#3b82f6' },
    { key: 'SNOOZED', title: 'Ertelendi', color: '#a855f7' },
    { key: 'DONE', title: 'Tamamlandı', color: '#22c55e' },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
      {columns.map((col) => {
        const items = groups[col.key] || [];
        return (
          <div key={col.key} className="rounded-2xl overflow-hidden min-h-[260px]" style={{ background: 'rgba(255,255,255,0.018)', border: `1px solid ${BORDER}` }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ background: `${col.color}12`, borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />
              <h3 className="text-[12px] font-bold uppercase tracking-[.14em]" style={{ color: col.color }}>{col.title}</h3>
              <span className="ml-auto text-[11px] tabular-nums px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.6)' }}>{items.length}</span>
            </div>
            <div className="p-2 space-y-2">
              {items.length === 0 ? (
                <div className="text-[12px] text-center py-8" style={{ color: 'rgba(250,250,249,0.35)' }}>Bu kolonda görev yok</div>
              ) : items.map((t) => (
                <div key={t.id} className="rounded-xl overflow-hidden" style={{ background: 'rgba(15,13,11,0.65)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <TaskRow
                    task={t}
                    onComplete={onComplete}
                    onReopen={onReopen}
                    onStart={onStart}
                    onCancel={onCancel}
                    onSnooze={onSnooze}
                    onAddNote={onAddNote}
                    onDelete={onDelete}
                    onEdit={onEdit}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskGroup({ title, tasks, accent, pulse, onComplete, onReopen, onStart, onCancel, onSnooze, onAddNote, onDelete, onEdit }: TaskGroupProps) {
  if (tasks.length === 0) return null;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.018)', border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.055)', background: `${accent}0f` }}>
        <span className="w-[3px] h-4 rounded-sm" style={{ background: accent, boxShadow: pulse ? `0 0 8px ${accent}` : undefined }} />
        <h3 className="text-[12px] font-bold uppercase tracking-[.14em]" style={{ color: accent }}>
          {title}
        </h3>
        <span className="text-[11px] tabular-nums px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.6)' }}>
          {tasks.length}
        </span>
      </div>
      <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.045)' }}>
        {tasks.map((t: Task) => (
          <TaskRow
            key={t.id}
            task={t}
            onComplete={onComplete}
            onReopen={onReopen}
            onStart={onStart}
            onCancel={onCancel}
            onSnooze={onSnooze}
            onAddNote={onAddNote}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}

interface TaskRowProps {
  task: Task;
  onComplete: (id: string) => void;
  onReopen: (id: string) => void;
  onStart: (id: string) => void;
  onCancel: (id: string) => void;
  onSnooze: (t: Task) => void;
  onAddNote: (t: Task) => void;
  onDelete: (id: string) => void;
  onEdit: (t: Task) => void;
}
function TaskRow({ task, onComplete, onReopen, onStart, onCancel, onSnooze, onAddNote, onDelete, onEdit }: TaskRowProps) {
  const isDone = task.status === 'DONE';
  const isInProgress = task.status === 'IN_PROGRESS';
  const isSnoozed = task.status === 'SNOOZED';
  const isCancelled = task.status === 'CANCELLED';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Menu dışına tıklayınca kapansın
  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div
      className="flex items-start gap-3 px-4 py-3.5 hover:bg-white/[0.025] transition group"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.035)' }}
    >
      {/* Tamamla / Geri Al — checkbox toggle */}
      <button
        onClick={() => isDone ? onReopen(task.id) : onComplete(task.id)}
        title={isDone ? 'Tekrar aç (geri al)' : 'Tamamla'}
        className="mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition hover:scale-110"
        style={{
          borderColor: isDone ? '#22c55e' : 'rgba(250,250,249,0.3)',
          background: isDone ? 'rgba(34,197,94,0.18)' : 'transparent',
        }}
      >
        {isDone && <CheckCircle2 size={13} style={{ color: '#22c55e' }} />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
            style={{ background: PRIORITY_COLOR[task.priority] + '20', color: PRIORITY_COLOR[task.priority] }}
          >
            {PRIORITY_LABEL[task.priority]}
          </span>
          {task.category && (
            <span className="text-[10.5px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: 'rgba(250,250,249,0.5)', background: 'rgba(255,255,255,0.04)' }}>
              {CATEGORY_OPTIONS.find((c) => c.value === task.category)?.label || task.category}
            </span>
          )}
          {task.recurrence && task.recurrence.type !== 'NONE' && (
            <span className="inline-flex items-center gap-0.5 text-[10.5px] px-1.5 py-0.5 rounded" style={{ color: '#a855f7', background: 'rgba(168,85,247,0.1)' }}>
              <Repeat size={9} /> tekrar
            </span>
          )}
          {task.taxpayer && (
            <span className="inline-flex items-center gap-0.5 text-[10.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Building2 size={9} /> {taxpayerName(task.taxpayer)}
            </span>
          )}
          {/* Durum rozetleri — DONE/IN_PROGRESS/SNOOZED/CANCELLED için ek görsel */}
          {isInProgress && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>
              <Play size={8} /> Devam
            </span>
          )}
          {isSnoozed && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
              <Pause size={8} /> Ertelendi
            </span>
          )}
          {isCancelled && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>
              <Ban size={8} /> İptal
            </span>
          )}
        </div>
        <h4 className={`text-[13.5px] mt-1 ${isDone || isCancelled ? 'line-through opacity-50' : ''}`} style={{ color: '#fafaf9', fontWeight: 500 }}>
          {task.title}
        </h4>
        {task.description && (
          <p className="text-[12px] mt-0.5 line-clamp-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
            {task.description}
          </p>
        )}
        {((task as any)._count?.notes > 0 || (task as any).notes?.[0]) && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[11px]" style={{ background: 'rgba(212,184,118,0.08)', color: 'rgba(250,250,249,0.68)', border: '1px solid rgba(212,184,118,0.16)' }}>
            <MessageSquare size={11} style={{ color: GOLD }} />
            <span>{(task as any)._count?.notes || 1} not</span>
            {(task as any).notes?.[0]?.content && <span className="max-w-[360px] truncate">- {(task as any).notes[0].content}</span>}
          </div>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {task.dueDate && (
            <span className="inline-flex items-center gap-1">
              <Calendar size={10} /> {formatDueDate(task)}
            </span>
          )}
          {isSnoozed && task.snoozedUntil && (
            <span className="inline-flex items-center gap-1" style={{ color: '#a855f7' }}>
              <Pause size={10} /> {new Date(task.snoozedUntil).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })} kadar ertelendi
            </span>
          )}
        </div>
      </div>

      {/* Aksiyon butonları — daima görünür kısa-yol + üç nokta menü */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Sık kullanılan kısa-yol: tamamla DEĞİL ise Devam Ediyor (başla) */}
        {!isDone && !isCancelled && !isInProgress && !isSnoozed && (
          <button
            onClick={() => onStart(task.id)}
            className="p-1.5 rounded hover:bg-blue-500/10 opacity-0 group-hover:opacity-100 transition"
            title="Başla (Devam Ediyor)"
          >
            <Play size={13} style={{ color: '#3b82f6' }} />
          </button>
        )}

        {/* Üç nokta menüsü — diğer aksiyonlar */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="p-1.5 rounded hover:bg-white/5 opacity-60 group-hover:opacity-100 transition"
            title="Aksiyonlar"
          >
            <MoreVertical size={14} style={{ color: 'rgba(250,250,249,0.7)' }} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-20 w-52 rounded-lg shadow-2xl overflow-hidden"
              style={{ background: '#0f0d0b', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}
            >
              {!isDone && !isCancelled && (
                <MenuItem icon={CheckCircle2} label="Tamamlandı işaretle" color="#22c55e" onClick={() => { onComplete(task.id); setMenuOpen(false); }} />
              )}
              {isDone && (
                <MenuItem icon={RotateCcw} label="Tekrar aç (geri al)" color="#3b82f6" onClick={() => { onReopen(task.id); setMenuOpen(false); }} />
              )}
              {!isDone && !isCancelled && !isInProgress && (
                <MenuItem icon={Play} label="Devam Ediyor" color="#3b82f6" onClick={() => { onStart(task.id); setMenuOpen(false); }} />
              )}
              {!isDone && !isCancelled && (
                <MenuItem icon={Pause} label="Ertele (Snooze)" color="#a855f7" onClick={() => { onSnooze(task); setMenuOpen(false); }} />
              )}
              {!isDone && !isCancelled && (
                <MenuItem icon={Ban} label="İptal et" color="#94a3b8" onClick={() => {
                  if (confirm('Bu görevi iptal etmek istediğinden emin misin?')) onCancel(task.id);
                  setMenuOpen(false);
                }} />
              )}
              <MenuItem icon={MessageSquare} label="Not ekle" color={GOLD} onClick={() => { onAddNote(task); setMenuOpen(false); }} />
              <MenuItem icon={Edit3} label="Düzenle" color="rgba(250,250,249,0.7)" onClick={() => { onEdit(task); setMenuOpen(false); }} />
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
              <MenuItem icon={Trash2} label="Sil" color="#ef4444" onClick={() => {
                if (confirm('Bu görevi silmek istediğinden emin misin?')) onDelete(task.id);
                setMenuOpen(false);
              }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface MenuItemProps {
  icon: any;
  label: string;
  color: string;
  onClick: () => void;
}
function MenuItem({ icon: Icon, label, color, onClick }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12.5px] hover:bg-white/[0.04] transition"
      style={{ color: 'rgba(250,250,249,0.85)' }}
    >
      <Icon size={13} style={{ color }} />
      <span>{label}</span>
    </button>
  );
}

// Modal Component — yeni görev oluştur veya düzenle
function TaskModal({ task, taxpayers, onClose, onSaved }: { task: Task | null; taxpayers: TaxpayerOption[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!task;
  const [form, setForm] = useState<CreateTaskInput>({
    title: task?.title || '',
    description: task?.description || '',
    category: task?.category || '',
    priority: task?.priority || 'MEDIUM',
    taxpayerId: task?.taxpayerId || undefined,
    dueDate: task?.dueDate ? task.dueDate.split('T')[0] : '',
    dueTime: task?.dueTime || '',
    allDay: task?.allDay ?? true,
    recurrence: task?.recurrence || { type: 'NONE' },
    notifyInApp: task?.notifyInApp ?? true,
    notifyEmail: task?.notifyEmail ?? false,
    notifyBrowser: task?.notifyBrowser ?? true,
    notifySound: task?.notifySound ?? false,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const payload: any = { ...form };
      if (!payload.dueDate) payload.dueDate = undefined;
      if (payload.allDay) payload.dueTime = undefined;
      if (payload.recurrence?.type === 'NONE') payload.recurrence = null;
      return isEdit
        ? tasksApi.update(task!.id, payload)
        : tasksApi.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Görev güncellendi' : 'Görev oluşturuldu');
      onSaved();
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || 'Kayıt başarısız');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" style={{ background: '#0f0d0b', border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h2 className="text-[16px] font-bold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>
            {isEdit ? 'Görevi Düzenle' : 'Yeni Görev'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/5">
            <X size={16} style={{ color: 'rgba(250,250,249,0.5)' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <Field label="Başlık *">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
              placeholder="Örn: ABC mükellef KDV beyannamesi"
            />
          </Field>

          <Field label="Açıklama">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kategori">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}>
                <option value="" style={{ background: '#0f0d0b' }}>Seçilmedi</option>
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} style={{ background: '#0f0d0b' }}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Öncelik">
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
                className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}>
                <option value="LOW" style={{ background: '#0f0d0b' }}>Düşük</option>
                <option value="MEDIUM" style={{ background: '#0f0d0b' }}>Orta</option>
                <option value="HIGH" style={{ background: '#0f0d0b' }}>Yüksek</option>
                <option value="URGENT" style={{ background: '#0f0d0b' }}>ACİL</option>
              </select>
            </Field>
          </div>

          <Field label="Mükellef (opsiyonel)">
            <select value={form.taxpayerId || ''} onChange={(e) => setForm({ ...form, taxpayerId: e.target.value || undefined })}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}>
              <option value="" style={{ background: '#0f0d0b' }}>— Yok —</option>
              {taxpayers.map((tp) => (
                <option key={tp.id} value={tp.id} style={{ background: '#0f0d0b' }}>
                  {tp.companyName || `${tp.firstName ?? ''} ${tp.lastName ?? ''}`.trim()}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-lg p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}` }}>
            <div className="text-[11px] uppercase font-bold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.6)' }}>
              <Calendar size={10} className="inline mr-1" /> Zaman
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vade Tarihi">
                <input
                  type="date"
                  value={form.dueDate || ''}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                  style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                />
              </Field>
              <Field label="Saat (opsiyonel)">
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={form.dueTime || ''}
                    disabled={form.allDay}
                    onChange={(e) => setForm({ ...form, dueTime: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg text-sm border outline-none disabled:opacity-40"
                    style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                  />
                  <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
                    <input
                      type="checkbox"
                      checked={form.allDay}
                      onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
                    />
                    Tüm gün
                  </label>
                </div>
              </Field>
            </div>

            {/* Recurrence */}
            <RecurrenceField value={form.recurrence as RecurrenceConfig} onChange={(r) => setForm({ ...form, recurrence: r })} />
          </div>

          <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}` }}>
            <div className="text-[11px] uppercase font-bold tracking-[.12em] mb-2" style={{ color: 'rgba(250,250,249,0.6)' }}>
              <Bell size={10} className="inline mr-1" /> Bildirim Kanalları
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.85)' }}>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.notifyInApp} onChange={(e) => setForm({ ...form, notifyInApp: e.target.checked })} /> Uygulama içi (bildirim çanı)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.notifyBrowser} onChange={(e) => setForm({ ...form, notifyBrowser: e.target.checked })} /> Tarayıcı bildirimi</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.notifyEmail} onChange={(e) => setForm({ ...form, notifyEmail: e.target.checked })} /> E-posta</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.notifySound} onChange={(e) => setForm({ ...form, notifySound: e.target.checked })} /> Sesli alarm</label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
            Vazgeç
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !form.title.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-[13px] disabled:opacity-50"
            style={{ background: GOLD, color: '#0f0d0b' }}
          >
            {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
            {isEdit ? 'Kaydet' : 'Oluştur'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: React.ReactNode;
  children: React.ReactNode;
}
function Field({ label, children }: FieldProps) {
  return (
    <div>
      <label className="text-[10.5px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function RecurrenceField({ value, onChange }: { value: RecurrenceConfig; onChange: (r: RecurrenceConfig) => void }) {
  return (
    <div className="space-y-2">
      <Field label={<><Repeat size={10} className="inline mr-1" /> Tekrar</>}>
        <select
          value={value?.type || 'NONE'}
          onChange={(e) => onChange({ ...value, type: e.target.value as any })}
          className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
        >
          <option value="NONE" style={{ background: '#0f0d0b' }}>Tekrar yok (tek seferlik)</option>
          <option value="DAILY" style={{ background: '#0f0d0b' }}>Her gün</option>
          <option value="WEEKLY" style={{ background: '#0f0d0b' }}>Haftalık (belli günler)</option>
          <option value="MONTHLY" style={{ background: '#0f0d0b' }}>Aylık (ayın belli günü)</option>
          <option value="YEARLY" style={{ background: '#0f0d0b' }}>Yıllık</option>
        </select>
      </Field>

      {value?.type === 'WEEKLY' && (
        <div>
          <label className="text-[11px] block mb-1.5" style={{ color: 'rgba(250,250,249,0.6)' }}>Hangi günler:</label>
          <div className="flex gap-1">
            {WEEKDAY_LABEL.map((d, idx) => {
              const sel = (value.weekdays || []).includes(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    const wd = value.weekdays || [];
                    const next = sel ? wd.filter((w) => w !== idx) : [...wd, idx];
                    onChange({ ...value, weekdays: next });
                  }}
                  className="flex-1 py-1.5 text-[11px] rounded font-semibold"
                  style={{
                    background: sel ? GOLD : 'rgba(255,255,255,0.04)',
                    color: sel ? '#0f0d0b' : 'rgba(250,250,249,0.6)',
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {value?.type === 'MONTHLY' && (
        <Field label="Ayın hangi günü">
          <input
            type="number"
            min={1}
            max={31}
            value={value.monthDay || ''}
            onChange={(e) => onChange({ ...value, monthDay: parseInt(e.target.value) || undefined })}
            className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            placeholder="1-31 (örn. 26 = her ayın 26'sı)"
          />
        </Field>
      )}

      {value?.type === 'YEARLY' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ay">
            <select value={value.yearMonth || 1} onChange={(e) => onChange({ ...value, yearMonth: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}>
              {['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'].map((m, i) => (
                <option key={i} value={i+1} style={{ background: '#0f0d0b' }}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Gün">
            <input type="number" min={1} max={31} value={value.yearDay || 1}
              onChange={(e) => onChange({ ...value, yearDay: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }} />
          </Field>
        </div>
      )}
    </div>
  );
}
