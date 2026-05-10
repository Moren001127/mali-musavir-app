'use client';

/**
 * v1.36.82 — Yaklaşan Beyanname Son Tarihleri (canlı liste)
 *
 * Sonraki 14 gün içindeki tüm beyanname son tarihleri tek tek listelenir.
 * Aciliyete göre renk tonu (Bugün=kırmızı yoğun → 14gün=sakin gri-altın).
 *
 * v1.36.82 ek:
 *   - Görev/hatırlatma var mı diye `/tasks` endpoint'ini sorar
 *   - O tarihte görev varsa sağda küçük bir "nokta" indikator'u sade pulse ile yanar
 *   - Hover edince görev başlıkları tooltip
 */

import { useQuery } from '@tanstack/react-query';
import { Calendar, FileText, Receipt, FileCheck, Bell, Bookmark } from 'lucide-react';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';

interface DeadlineRow {
  date: Date;
  gunFark: number;
  title: string;
  subtitle: string;
  icon: any;
}

interface TaskItem {
  id: string;
  title: string;
  dueDate: string;
  status?: string;
  isCompleted?: boolean;
  done?: boolean;
}

const MONTHS_TR = ['OCAK', 'ŞUBAT', 'MART', 'NİSAN', 'MAYIS', 'HAZİRAN', 'TEMMUZ', 'AĞUSTOS', 'EYLÜL', 'EKİM', 'KASIM', 'ARALIK'];

function deadlinesForDate(date: Date): Omit<DeadlineRow, 'date' | 'gunFark'>[] {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const isLastDay = (() => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return next.getMonth() !== date.getMonth();
  })();

  const out: Omit<DeadlineRow, 'date' | 'gunFark'>[] = [];

  if (day === 25) {
    out.push({
      title: "KDV2 Tevkifat Beyannamesi (2 No'lu KDV)",
      subtitle: "Tevkifata tâbi işlemler · 164 Sıra No'lu VUK Sirküleri · izleyen ayın 25'i",
      icon: FileText,
    });
  }
  if (day === 26) {
    out.push({ title: 'Muhtasar ve Prim Hizmet Beyannamesi (MUHSGK)', subtitle: 'Bir önceki ay dönemi — birleşik muhtasar + SGK', icon: FileText });
    out.push({ title: 'Damga Vergisi Beyannamesi', subtitle: 'Önceki ay damga vergisi beyan ve ödeme', icon: FileCheck });
    out.push({ title: 'Konaklama Vergisi Beyannamesi', subtitle: 'Otel/pansiyon/tatil köyü · önceki ay · %2', icon: Bell });
  }
  if (day === 28) {
    out.push({ title: 'KDV Beyannamesi (KDV1)', subtitle: "Önceki ay KDV beyan ve ödeme · izleyen ayın 28'i", icon: Receipt });
  }
  if (isLastDay) {
    out.push({ title: 'Form Ba-Bs Bildirimi', subtitle: 'Mal ve hizmet alım/satım bildirimi · ay sonu', icon: FileText });
    out.push({ title: 'Turizm Payı Beyannamesi', subtitle: 'Konaklama, yat, seyahat acentesi · izleyen ayın SON GÜNÜ (23:59)', icon: Bell });
  }
  if (day === 17 && [2, 5, 8, 11].includes(month)) {
    out.push({ title: 'Geçici Vergi Beyannamesi', subtitle: '3 aylık dönem geçici vergi', icon: FileText });
  }
  if (month === 3 && day === 31) {
    out.push({ title: 'Yıllık Gelir Vergisi Beyannamesi', subtitle: 'Önceki yıl gelirleri · Mart sonu', icon: FileText });
  }
  if (month === 4 && day === 30) {
    out.push({ title: 'Yıllık Kurumlar Vergisi Beyannamesi', subtitle: 'Önceki takvim yılı kurumlar vergisi · 1-30 Nisan', icon: FileText });
  }

  return out;
}

function urgencyTone(gunFark: number) {
  if (gunFark <= 0) return { accent: '#ef4444', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.45)', pillBg: 'rgba(239,68,68,0.15)', pillBorder: 'rgba(239,68,68,0.55)', pillText: '#fca5a5', label: 'Bugün' };
  if (gunFark === 1) return { accent: '#ef4444', bg: 'rgba(239,68,68,0.04)', border: 'rgba(239,68,68,0.40)', pillBg: 'rgba(239,68,68,0.12)', pillBorder: 'rgba(239,68,68,0.45)', pillText: '#fca5a5', label: 'Yarın' };
  if (gunFark <= 3) return { accent: '#f43f5e', bg: 'rgba(244,63,94,0.04)', border: 'rgba(244,63,94,0.32)', pillBg: 'rgba(244,63,94,0.10)', pillBorder: 'rgba(244,63,94,0.40)', pillText: '#fb7185', label: `${gunFark} gün` };
  if (gunFark <= 5) return { accent: '#f59e0b', bg: 'rgba(245,158,11,0.04)', border: 'rgba(245,158,11,0.30)', pillBg: 'rgba(245,158,11,0.10)', pillBorder: 'rgba(245,158,11,0.40)', pillText: '#fbbf24', label: `${gunFark} gün` };
  if (gunFark <= 7) return { accent: '#d4b876', bg: 'rgba(212,184,118,0.04)', border: 'rgba(212,184,118,0.26)', pillBg: 'rgba(212,184,118,0.10)', pillBorder: 'rgba(212,184,118,0.34)', pillText: '#d4b876', label: `${gunFark} gün` };
  return { accent: '#94a3b8', bg: 'rgba(148,163,184,0.04)', border: 'rgba(148,163,184,0.22)', pillBg: 'rgba(148,163,184,0.08)', pillBorder: 'rgba(148,163,184,0.28)', pillText: '#cbd5e1', label: `${gunFark} gün` };
}

function buildDeadlineList(daysAhead: number): DeadlineRow[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: DeadlineRow[] = [];
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const items = deadlinesForDate(d);
    for (const it of items) {
      out.push({ ...it, date: d, gunFark: i });
    }
  }
  return out;
}

/** Tasks API'den gelen tüm aktif görevleri tarih→başlık[] map'i olarak döndürür */
function tasksByDate(tasks: TaskItem[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const t of tasks) {
    const status = String((t as any).status || '').toUpperCase();
    if ((t as any).done || (t as any).isCompleted || status === 'DONE' || status === 'CANCELLED') continue;
    const d = new Date(t.dueDate);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(t.title);
  }
  return m;
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function buildCalendarDays(rows: DeadlineRow[], taskMap: Map<string, string[]>) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const key = dateKey(date);
    return {
      date,
      key,
      gunFark: i,
      deadlines: rows.filter((r) => dateKey(r.date) === key),
      tasks: taskMap.get(key) || [],
    };
  });
}

export function BuHaftaTakvim() {
  const rows = buildDeadlineList(14);
  const today = new Date();
  const ikiHaftaSonra = new Date(today.getTime() + 13 * 86400000);

  // Görev API — backend bekleyen görev verir
  const { data: tasksData } = useQuery<{ items: TaskItem[] } | TaskItem[]>({
    queryKey: ['takvim-gorevler'],
    queryFn: () => api.get('/tasks', { params: { isTemplate: 'false', limit: 200 } }).then((r) => r.data).catch(() => ({ items: [] })),
    staleTime: 60 * 1000,
  });
  const tasks: TaskItem[] = Array.isArray(tasksData) ? tasksData : ((tasksData as any)?.items || []);
  const taskMap = tasksByDate(tasks);
  const calendarDays = buildCalendarDays(rows, taskMap);
  const visibleRows = rows.slice(0, 4);
  const extraCount = Math.max(rows.length - visibleRows.length, 0);
  const urgentCount = rows.filter((r) => r.gunFark <= 3).length;
  const noteCount = calendarDays.reduce((total, d) => total + d.tasks.length, 0);

  return (
    <div
      className="rounded-2xl p-3 sm:p-4"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.024), rgba(255,255,255,0.012))',
        border: '1px solid rgba(255,255,255,0.055)',
      }}
    >
      <div className="flex flex-wrap items-center gap-2.5 mb-3">
        <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
        <h3 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
          <Calendar size={14} style={{ color: GOLD_SOFT }} />
          Yaklaşan Beyanname Son Tarihleri
        </h3>
        {rows.length > 0 && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ml-1"
            style={{ background: 'rgba(212,184,118,0.14)', color: GOLD, border: '1px solid rgba(212,184,118,0.28)' }}
          >
            {rows.length} son tarih
          </span>
        )}
        {urgentCount > 0 && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
            style={{ background: 'rgba(244,63,94,0.10)', color: '#fb7185', border: '1px solid rgba(244,63,94,0.28)' }}
          >
            {urgentCount} yakın
          </span>
        )}
        {noteCount > 0 && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
            style={{ background: 'rgba(96,165,250,0.10)', color: '#93c5fd', border: '1px solid rgba(96,165,250,0.25)' }}
          >
            {noteCount} not
          </span>
        )}
        <span className="ml-auto text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {today.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} — {ikiHaftaSonra.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
        </span>
      </div>

      <div className="overflow-x-auto pb-1 mb-3">
        <div className="grid grid-cols-7 gap-1.5 min-w-[680px]">
          {calendarDays.map((d) => (
            <CalendarDayTile key={d.key} day={d} />
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl py-10 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-[13px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Önümüzdeki 14 günde beyanname son tarihi yok.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {visibleRows.map((r, i) => {
            const key = `${r.date.getFullYear()}-${r.date.getMonth() + 1}-${r.date.getDate()}`;
            const dayTasks = taskMap.get(key) || [];
            return <DeadlineRowItem key={i} row={r} dayTasks={dayTasks} />;
          })}
          {extraCount > 0 && (
            <div
              className="rounded-xl px-3 py-2 text-[12px] font-semibold"
              style={{
                color: 'rgba(250,250,249,0.55)',
                background: 'rgba(255,255,255,0.018)',
                border: '1px solid rgba(255,255,255,0.055)',
              }}
            >
              +{extraCount} son tarih daha var; en yakın olanlar yukarıda.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CalendarDayTile({ day }: { day: ReturnType<typeof buildCalendarDays>[number] }) {
  const firstDeadline = day.deadlines[0];
  const tone = urgencyTone(firstDeadline?.gunFark ?? day.gunFark);
  const hasDeadline = day.deadlines.length > 0;
  const hasTask = day.tasks.length > 0;
  const month = day.date.toLocaleDateString('tr-TR', { month: 'short' });
  const titleParts = [
    ...day.deadlines.map((d) => d.title),
    ...day.tasks.map((t) => `Not: ${t}`),
  ];

  return (
    <div
      className="min-h-[64px] rounded-xl p-2 transition-all"
      title={titleParts.join('\n')}
      style={{
        background: hasDeadline ? tone.bg : hasTask ? 'rgba(96,165,250,0.07)' : 'rgba(255,255,255,0.016)',
        border: hasDeadline ? `1px solid ${tone.border}` : hasTask ? '1px solid rgba(212,184,118,0.28)' : '1px solid rgba(255,255,255,0.05)',
        boxShadow: hasDeadline || hasTask ? 'inset 0 1px 0 rgba(255,255,255,0.035)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[17px] leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, color: hasDeadline ? tone.pillText : hasTask ? '#93c5fd' : 'rgba(250,250,249,0.72)' }}>
            {day.date.getDate()}
          </div>
          <div className="text-[9px] uppercase font-bold mt-1" style={{ color: 'rgba(250,250,249,0.38)' }}>{month}</div>
        </div>
        {(hasDeadline || hasTask) && (
          <div className="flex items-center gap-1">
            {hasDeadline && <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.accent }} />}
            {hasTask && <span className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD, boxShadow: `0 0 6px ${GOLD}66` }} />}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {hasDeadline && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: tone.pillBg, border: `1px solid ${tone.pillBorder}`, color: tone.pillText }}>
            {day.deadlines.length} son
          </span>
        )}
        {hasTask && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(96,165,250,0.11)', border: '1px solid rgba(96,165,250,0.28)', color: '#93c5fd' }}>
            {day.tasks.length} not
          </span>
        )}
      </div>
    </div>
  );
}

function DeadlineRowItem({ row, dayTasks }: { row: DeadlineRow; dayTasks: string[] }) {
  const tone = urgencyTone(row.gunFark);
  const Icon = row.icon;
  const month = row.date.getMonth();
  const hasTask = dayTasks.length > 0;

  return (
    <div
      className="rounded-xl flex items-center gap-3 pl-1 pr-3 py-2 transition-all hover:translate-x-[2px] relative"
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        boxShadow: row.gunFark <= 1 ? `inset 3px 0 0 ${tone.accent}` : `inset 2px 0 0 ${tone.accent}`,
      }}
    >
      {/* Sol: tarih bloğu */}
      <div className="pl-3 pr-1 min-w-[58px] flex flex-col items-start">
        <span
          className="tabular-nums leading-none"
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 22,
            fontWeight: 700,
            color: '#fafaf9',
            letterSpacing: '-.03em',
          }}
        >
          {row.date.getDate()}
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wider mt-0.5" style={{ color: 'rgba(250,250,249,0.4)' }}>
          {MONTHS_TR[month]}
        </span>
      </div>

      {/* Orta: ikon + başlık + altyazı */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: tone.pillBg,
            border: `1px solid ${tone.pillBorder}`,
            color: tone.pillText,
          }}
        >
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9', letterSpacing: '-0.01em' }}>
            {row.title}
          </div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(250,250,249,0.5)' }}>
            {row.subtitle}
          </div>
        </div>
      </div>

      {/* Sağ: görev göstergesi (eğer bu güne not/hatırlatma varsa) + pill badge */}
      {hasTask && (
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-md flex-shrink-0"
          style={{
            background: 'rgba(96,165,250,0.10)',
            border: '1px solid rgba(96,165,250,0.24)',
          }}
          title={dayTasks.slice(0, 5).join('\n')}
        >
          <span
            className="moren-task-pulse w-1.5 h-1.5 rounded-full"
            style={{ background: '#93c5fd', boxShadow: '0 0 6px rgba(147,197,253,0.45)' }}
          />
          <Bookmark size={11} style={{ color: '#93c5fd' }} />
          <span className="text-[11px] font-semibold tabular-nums" style={{ color: '#93c5fd' }}>
            {dayTasks.length}
          </span>
        </div>
      )}

      <span
        className="text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex-shrink-0"
        style={{
          background: tone.pillBg,
          color: tone.pillText,
          border: `1px solid ${tone.pillBorder}`,
        }}
      >
        {tone.label}
      </span>
    </div>
  );
}
