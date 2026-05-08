'use client';

/**
 * v1.36.81 — Bu Hafta Takvimi
 *
 * Bugün + sonraki 6 gün için yatay takvim. Her gün için:
 *  - Beyanname son tarihleri (KDV1=28, MUHTASAR=26, DAMGA=26, GECICI=17, BA-BS=ay sonu)
 *  - Bugün'ün vurgulu gösterimi
 *  - Hafta sonları farklı ton
 *
 * Mali müşavir için en kritik bilgi son tarihler — bu yüzden takvim
 * dashboard'da "şu hafta ne yetişiyor" sorusunu net cevaplıyor.
 */

import { Calendar, AlertCircle, FileText, Receipt, FileCheck } from 'lucide-react';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';

interface BeyanDeadline {
  tip: string;
  short: string;
  icon: any;
  color: string;
}

const DAYS_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** Belirli ay-gün için beyanname son tarihleri */
function deadlinesForDay(date: Date): BeyanDeadline[] {
  const day = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const isLastDayOfMonth = (() => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return next.getMonth() !== date.getMonth();
  })();

  const out: BeyanDeadline[] = [];

  // KDV1 (aylık) — her ayın 28'i
  if (day === 28) out.push({ tip: 'KDV Beyannamesi', short: 'KDV', icon: FileText, color: '#a855f7' });
  // MUHTASAR + DAMGA — her ayın 26'sı
  if (day === 26) {
    out.push({ tip: 'Muhtasar Beyanname', short: 'Muhtasar', icon: FileText, color: '#3b82f6' });
    out.push({ tip: 'Damga Vergisi', short: 'Damga', icon: FileCheck, color: '#f59e0b' });
  }
  // BA-BS — ay sonu
  if (isLastDayOfMonth) out.push({ tip: 'Ba-Bs Bildirimi', short: 'Ba-Bs', icon: Receipt, color: '#22c55e' });

  // Geçici Vergi — sadece Şubat (Q4), Mayıs (Q1), Ağustos (Q2), Kasım (Q3) ayının 17'si
  if (day === 17 && [2, 5, 8, 11].includes(month)) {
    out.push({ tip: 'Geçici Vergi', short: 'Geçici', icon: FileText, color: '#ef4444' });
  }
  // Yıllık Gelir Vergisi — Mart sonu (31)
  if (month === 3 && day === 31) {
    out.push({ tip: 'Yıllık Gelir Vergisi', short: 'GV', icon: FileText, color: '#ef4444' });
  }
  // Kurumlar Vergisi — Nisan sonu
  if (month === 4 && day === 30) {
    out.push({ tip: 'Kurumlar Vergisi', short: 'KV', icon: FileText, color: '#ef4444' });
  }

  return out;
}

function buildDays(start: Date, count: number): Array<{ date: Date; isToday: boolean; isWeekend: boolean; deadlines: BeyanDeadline[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dCopy = new Date(d);
    dCopy.setHours(0, 0, 0, 0);
    out.push({
      date: d,
      isToday: dCopy.getTime() === today.getTime(),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      deadlines: deadlinesForDay(d),
    });
  }
  return out;
}

export function BuHaftaTakvim() {
  const today = new Date();
  const days = buildDays(today, 7);

  // Toplam yaklaşan deadline sayısı
  const yaklaşanDeadlineSayisi = days.reduce((acc, d) => acc + d.deadlines.length, 0);

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
        <h3 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
          <Calendar size={14} style={{ color: GOLD_SOFT }} />
          Bu Hafta Takvimi
        </h3>
        {yaklaşanDeadlineSayisi > 0 && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ml-1"
            style={{ background: 'rgba(212,184,118,0.14)', color: GOLD, border: '1px solid rgba(212,184,118,0.28)' }}
          >
            {yaklaşanDeadlineSayisi} son tarih
          </span>
        )}
        <span className="ml-auto text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
          {today.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} - {days[6].date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((d, idx) => (
          <DayCell key={idx} day={d} />
        ))}
      </div>
    </div>
  );
}

function DayCell({ day }: { day: ReturnType<typeof buildDays>[number] }) {
  const hasDeadline = day.deadlines.length > 0;
  const date = day.date;

  return (
    <div
      className="rounded-xl px-3 py-3 transition-all relative overflow-hidden"
      style={{
        background: day.isToday
          ? 'linear-gradient(180deg, rgba(212,184,118,0.16), rgba(212,184,118,0.04))'
          : day.isWeekend
            ? 'rgba(255,255,255,0.015)'
            : 'rgba(255,255,255,0.025)',
        border: day.isToday
          ? '1px solid rgba(212,184,118,0.5)'
          : hasDeadline
            ? '1px solid rgba(212,184,118,0.18)'
            : '1px solid rgba(255,255,255,0.05)',
        minHeight: 110,
      }}
    >
      <div className="flex items-baseline justify-between mb-1.5">
        <span
          className="text-[10px] uppercase font-bold tracking-wider"
          style={{
            color: day.isToday ? GOLD : day.isWeekend ? 'rgba(250,250,249,0.3)' : 'rgba(250,250,249,0.5)',
          }}
        >
          {DAYS_TR[date.getDay()]}
        </span>
        <span
          className="tabular-nums leading-none"
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 22,
            fontWeight: 700,
            color: day.isToday ? GOLD : '#fafaf9',
            letterSpacing: '-.03em',
          }}
        >
          {date.getDate()}
        </span>
      </div>
      {day.isToday && (
        <div className="text-[9px] font-bold uppercase tracking-[.18em] mb-1.5" style={{ color: GOLD }}>
          Bugün
        </div>
      )}
      <div className="space-y-1">
        {day.deadlines.length === 0 ? (
          <span className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.3)' }}>—</span>
        ) : (
          day.deadlines.map((d, i) => {
            const Icon = d.icon;
            return (
              <div
                key={i}
                className="flex items-center gap-1 text-[10.5px] font-semibold rounded px-1.5 py-0.5"
                style={{
                  background: `${d.color}15`,
                  color: d.color,
                  border: `1px solid ${d.color}30`,
                }}
                title={d.tip}
              >
                <Icon size={9} />
                <span className="truncate">{d.short}</span>
              </div>
            );
          })
        )}
      </div>
      {/* Bugün vurgu çubuğu */}
      {day.isToday && (
        <span
          className="absolute bottom-0 left-2 right-2 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }}
        />
      )}
    </div>
  );
}
