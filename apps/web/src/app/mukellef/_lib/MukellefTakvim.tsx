'use client';

/**
 * Mükellef Mali Takvim — ofis (müşavir) BuHaftaTakvim bileşeninin BİREBİR kopyası.
 * Tek fark: müşavire özel /tasks (görev/not) çağrısı yok; gerisi (son tarih kuralları,
 * 7 günlük şerit, aciliyet tonları, satır kartları) aynıdır.
 */

import { Calendar, FileText, Receipt, FileCheck, Bell, Bookmark } from 'lucide-react';

const GOLD = '#d4b876';
const ROSE = '#f5a6b8';
const ROSE_SOFT = '#f0b4c0';
const CURRENT_MONTH_LABEL = 'Kalan akış';

interface DeadlineRow {
  date: Date;
  gunFark: number;
  title: string;
  subtitle: string;
  icon: any;
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
    out.push({ title: 'Turizm Payı Beyannamesi', subtitle: 'Konaklama, yat, seyahat acentesi · izleyen ayın SON GÜNÜ (23:59)', icon: Bell });
  }

  if (day === 10 || day === 14) {
    const mukellefGrubu = day === 10 ? 'Gelir vergisi mükellefleri' : 'Kurumlar/diğer mükellefler';
    const aylikDonem = previousPeriodLabel(date, 4);
    out.push({
      title: 'e-Defter Berat Yükleme (Aylık Tercih)',
      subtitle: `${aylikDonem} dönemi · ${mukellefGrubu} · ayın ${day}. günü sonu`,
      icon: Bookmark,
    });

    const quarterPeriod = quarterlyLedgerPeriodForDueDate(date);
    if (quarterPeriod) {
      out.push({
        title: 'e-Defter Berat Yükleme (Geçici Vergi Dönemi)',
        subtitle: `${quarterPeriod} dönemi · ${mukellefGrubu} · ayın ${day}. günü sonu`,
        icon: Bookmark,
      });
    }
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
  if (gunFark < 0) return { accent: '#64748b', bg: 'rgba(148,163,184,0.035)', border: 'rgba(148,163,184,0.18)', pillBg: 'rgba(148,163,184,0.08)', pillBorder: 'rgba(148,163,184,0.22)', pillText: '#cbd5e1', label: `${Math.abs(gunFark)} gün geçti` };
  if (gunFark === 0) return { accent: '#fb7185', bg: 'rgba(245,166,184,0.085)', border: 'rgba(245,166,184,0.50)', pillBg: 'rgba(245,166,184,0.15)', pillBorder: 'rgba(245,166,184,0.56)', pillText: '#ffc4cf', label: 'Bugün' };
  if (gunFark === 1) return { accent: '#f5a6b8', bg: 'rgba(245,166,184,0.065)', border: 'rgba(245,166,184,0.42)', pillBg: 'rgba(245,166,184,0.13)', pillBorder: 'rgba(245,166,184,0.46)', pillText: '#f8c6d0', label: 'Yarın' };
  if (gunFark <= 3) return { accent: '#f0b4c0', bg: 'rgba(245,166,184,0.052)', border: 'rgba(245,166,184,0.34)', pillBg: 'rgba(245,166,184,0.11)', pillBorder: 'rgba(245,166,184,0.40)', pillText: ROSE, label: `${gunFark} gün` };
  if (gunFark <= 5) return { accent: '#d4b876', bg: 'rgba(212,184,118,0.04)', border: 'rgba(212,184,118,0.28)', pillBg: 'rgba(212,184,118,0.10)', pillBorder: 'rgba(212,184,118,0.36)', pillText: '#e4c986', label: `${gunFark} gün` };
  if (gunFark <= 7) return { accent: '#c0a079', bg: 'rgba(192,160,121,0.035)', border: 'rgba(192,160,121,0.24)', pillBg: 'rgba(192,160,121,0.09)', pillBorder: 'rgba(192,160,121,0.30)', pillText: '#d8c19a', label: `${gunFark} gün` };
  return { accent: '#94a3b8', bg: 'rgba(148,163,184,0.04)', border: 'rgba(148,163,184,0.22)', pillBg: 'rgba(148,163,184,0.08)', pillBorder: 'rgba(148,163,184,0.28)', pillText: '#cbd5e1', label: `${gunFark} gün` };
}

function monthName(date: Date) {
  return date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

function previousPeriodLabel(date: Date, monthOffset: number) {
  const period = new Date(date.getFullYear(), date.getMonth() - monthOffset, 1);
  return monthName(period);
}

function quarterlyLedgerPeriodForDueDate(date: Date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if ((month === 6 || month === 9 || month === 12) && (day === 10 || day === 14)) {
    if (month === 6) return 'Ocak-Şubat-Mart';
    if (month === 9) return 'Nisan-Mayıs-Haziran';
    return 'Temmuz-Ağustos-Eylül';
  }
  if (month === 4 && day === 10) return 'Ekim-Kasım-Aralık';
  if (month === 5 && day === 14) return 'Ekim-Kasım-Aralık';
  return null;
}

function buildCurrentMonthDeadlineList(): DeadlineRow[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: DeadlineRow[] = [];
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(today.getFullYear(), today.getMonth(), day);
    const gunFark = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (gunFark < 0) continue;
    const items = deadlinesForDate(d);
    for (const it of items) {
      out.push({ ...it, date: d, gunFark });
    }
  }
  return out;
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function buildCalendarDays(rows: DeadlineRow[]) {
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
    };
  });
}

export function MukellefTakvim() {
  const rows = buildCurrentMonthDeadlineList();
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const calendarDays = buildCalendarDays(rows);
  const urgentCount = rows.filter((r) => r.gunFark >= 0 && r.gunFark <= 3).length;

  return (
    <div
      className="rounded-2xl p-4 sm:p-5"
      style={{
        background: 'linear-gradient(180deg, rgba(245,166,184,0.052), rgba(255,255,255,0.014))',
        border: '1px solid rgba(245,166,184,0.16)',
      }}
    >
      <div className="flex flex-wrap items-center gap-2.5 mb-3">
        <span className="w-[3px] h-4 rounded-sm" style={{ background: ROSE }} />
        <h3 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
          <Calendar size={14} style={{ color: ROSE_SOFT }} />
          Bu Ay Mali Takvim
        </h3>
        {rows.length > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ml-1" style={{ background: 'rgba(245,166,184,0.12)', color: ROSE, border: '1px solid rgba(245,166,184,0.30)' }}>
            {rows.length} son tarih
          </span>
        )}
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          title="KDV2: ayın 25'i · MUHSGK/Damga/Konaklama: ayın 26'sı · KDV1: ayın 28'i · Geçici Vergi: Şubat/Mayıs/Ağustos/Kasım 17'si · Ay sonu: Turizm Payı"
          style={{ background: 'rgba(255,255,255,0.045)', color: 'rgba(250,250,249,0.58)', border: '1px solid rgba(255,255,255,0.09)' }}
        >
          {CURRENT_MONTH_LABEL}
        </span>
        {urgentCount > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(245,166,184,0.12)', color: '#ffc4cf', border: '1px solid rgba(245,166,184,0.30)' }}>
            {urgentCount} yakın
          </span>
        )}
        <span className="ml-auto text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {monthStart.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} — {monthEnd.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
        </span>
      </div>

      <div className="overflow-x-auto pb-1 mb-3">
        <div className="grid grid-cols-7 gap-2 min-w-[720px]">
          {calendarDays.map((d) => (
            <CalendarDayTile key={d.key} day={d} />
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl py-10 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-[13px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Kalan günlerde beyanname veya bildirim son tarihi yok.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => <DeadlineRowItem key={i} row={r} />)}
        </div>
      )}
    </div>
  );
}

function CalendarDayTile({ day }: { day: ReturnType<typeof buildCalendarDays>[number] }) {
  const firstDeadline = day.deadlines[0];
  const tone = urgencyTone(firstDeadline?.gunFark ?? day.gunFark);
  const hasDeadline = day.deadlines.length > 0;
  const month = day.date.toLocaleDateString('tr-TR', { month: 'short' });
  const titleParts = day.deadlines.map((d) => d.title);

  return (
    <div
      className="min-h-[76px] rounded-xl p-2.5 transition-all"
      title={titleParts.join('\n')}
      style={{
        background: hasDeadline ? tone.bg : 'rgba(255,255,255,0.016)',
        border: hasDeadline ? `1px solid ${tone.border}` : '1px solid rgba(255,255,255,0.05)',
        boxShadow: hasDeadline ? 'inset 0 1px 0 rgba(255,255,255,0.035)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[17px] leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, color: hasDeadline ? tone.pillText : 'rgba(250,250,249,0.72)' }}>
            {day.date.getDate()}
          </div>
          <div className="text-[9px] uppercase font-bold mt-1" style={{ color: 'rgba(250,250,249,0.38)' }}>{month}</div>
        </div>
        {hasDeadline && (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.accent }} />
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {hasDeadline && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: tone.pillBg, border: `1px solid ${tone.pillBorder}`, color: tone.pillText }}>
            {day.deadlines.length} son
          </span>
        )}
      </div>
    </div>
  );
}

function DeadlineRowItem({ row }: { row: DeadlineRow }) {
  const tone = urgencyTone(row.gunFark);
  const Icon = row.icon;
  const month = row.date.getMonth();

  return (
    <div
      className="rounded-xl flex items-center gap-3 pl-1 pr-3 py-2 transition-all hover:translate-x-[2px] relative"
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        boxShadow: row.gunFark <= 1 ? `inset 3px 0 0 ${tone.accent}` : `inset 2px 0 0 ${tone.accent}`,
      }}
    >
      <div className="pl-3 pr-1 min-w-[58px] flex flex-col items-start">
        <span className="tabular-nums leading-none" style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: '#fafaf9', letterSpacing: '-.03em' }}>
          {row.date.getDate()}
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wider mt-0.5" style={{ color: 'rgba(250,250,249,0.4)' }}>
          {MONTHS_TR[month]}
        </span>
      </div>

      <div className="flex-1 min-w-0 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: tone.pillBg, border: `1px solid ${tone.pillBorder}`, color: tone.pillText }}>
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9', letterSpacing: '-0.01em' }}>{row.title}</div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(250,250,249,0.5)' }}>{row.subtitle}</div>
        </div>
      </div>

      <span className="text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: tone.pillBg, color: tone.pillText, border: `1px solid ${tone.pillBorder}` }}>
        {tone.label}
      </span>
    </div>
  );
}
