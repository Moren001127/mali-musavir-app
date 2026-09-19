'use client';
import { portalStyle } from '@/lib/portal-theme';


import { Repeat } from 'lucide-react';
import { WEEKDAY_LABEL, type RecurrenceConfig, type RecurrenceType } from '@/lib/tasks';
import { GIRDI, GOLD, IKINCIL } from './ortak';

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const SECENEK_STIL = { background: '#14110e' };

/** Tekrar ayarı — eski RecurrenceField mantığı korunur (yok / günlük / haftalık günler / aylık gün / yıllık ay+gün). */
export function TekrarAlani({ value, onChange }: { value: RecurrenceConfig | null | undefined; onChange: (r: RecurrenceConfig) => void }) {
  const v: RecurrenceConfig = value || { type: 'NONE' };
  return (
    <div className="space-y-2">
      <label className="block text-[10.5px] font-bold uppercase tracking-[.12em]" style={portalStyle({ color: IKINCIL })}>
        <Repeat size={10} className="mr-1 inline" /> Tekrar
      </label>
      <select value={v.type || 'NONE'} onChange={(e) => onChange({ ...v, type: e.target.value as RecurrenceType })} className="h-9 w-full px-3 text-[12.5px]" style={portalStyle(GIRDI)} title="Tekrar sıklığı">
        <option value="NONE" style={portalStyle(SECENEK_STIL)}>Tekrar yok (tek seferlik)</option>
        <option value="DAILY" style={portalStyle(SECENEK_STIL)}>Her gün</option>
        <option value="WEEKLY" style={portalStyle(SECENEK_STIL)}>Haftalık (belli günler)</option>
        <option value="MONTHLY" style={portalStyle(SECENEK_STIL)}>Aylık (ayın belli günü)</option>
        <option value="YEARLY" style={portalStyle(SECENEK_STIL)}>Yıllık</option>
      </select>

      {v.type === 'WEEKLY' && (
        <div className="flex gap-1">
          {WEEKDAY_LABEL.map((d, idx) => {
            const sel = (v.weekdays || []).includes(idx);
            return (
              <button
                key={idx}
                type="button"
                title={d}
                aria-pressed={sel}
                onClick={() => {
                  const wd = v.weekdays || [];
                  onChange({ ...v, weekdays: sel ? wd.filter((w) => w !== idx) : [...wd, idx] });
                }}
                className="flex-1 rounded-md py-1.5 text-[11px] font-semibold"
                style={portalStyle({ background: sel ? GOLD : 'rgba(255,255,255,0.05)', color: sel ? '#0f0d0b' : IKINCIL, border: '1px solid rgba(255,255,255,0.08)' })}
              >
                {d}
              </button>
            );
          })}
        </div>
      )}

      {v.type === 'MONTHLY' && (
        <input
          type="number"
          min={1}
          max={31}
          value={v.monthDay || ''}
          onChange={(e) => onChange({ ...v, monthDay: parseInt(e.target.value) || undefined })}
          placeholder="Ayın günü 1-31 (örn. 26)"
          title="Ayın hangi günü"
          className="h-9 w-full px-3 text-[12.5px]"
          style={portalStyle(GIRDI)}
        />
      )}

      {v.type === 'YEARLY' && (
        <div className="grid grid-cols-2 gap-2">
          <select value={v.yearMonth || 1} onChange={(e) => onChange({ ...v, yearMonth: parseInt(e.target.value) })} className="h-9 w-full px-3 text-[12.5px]" style={portalStyle(GIRDI)} title="Ay">
            {AYLAR.map((m, i) => (
              <option key={i} value={i + 1} style={portalStyle(SECENEK_STIL)}>
                {m}
              </option>
            ))}
          </select>
          <input type="number" min={1} max={31} value={v.yearDay || 1} onChange={(e) => onChange({ ...v, yearDay: parseInt(e.target.value) || 1 })} title="Gün" className="h-9 w-full px-3 text-[12.5px]" style={portalStyle(GIRDI)} />
        </div>
      )}
    </div>
  );
}
